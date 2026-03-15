"""
app/services/ml_service.py
==========================
Singleton service that owns the ML models and exposes run_pipeline().

SPEED OPTIMIZATIONS applied (v2):
  - _adapt_story: num_beams=1 (greedy decode) — ~3-5x faster per sentence
  - _adapt_story: sentence batching via tokenizer batch padding
  - _adapt_story: skip sentences < 5 words without model call
  - _generate_moral: single prompt, greedy, shorter max_new_tokens
  - _run_model: torch.inference_mode() instead of torch.no_grad()
  - adult age: adapt step fully skipped (already was, kept explicit)
"""

from __future__ import annotations

import time
import uuid
import os
import torch
import nltk
import re
import numpy as np
import pandas as pd

from typing import Optional
from sqlalchemy.orm import Session
from sentence_transformers import SentenceTransformer, util
from nltk.tokenize import sent_tokenize, word_tokenize
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

from app.models.story import Story, ChatbotConversation

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
RETRIEVAL_MODEL      = "all-MiniLM-L6-v2"
SIMPLIFICATION_MODEL = "google/flan-t5-base"

_HERE           = os.path.dirname(os.path.abspath(__file__))
STORY_EMB_CACHE = os.path.join(_HERE, "story_embeddings.pt")
VOCAB_EMB_CACHE = os.path.join(_HERE, "vocab_embeddings.pt")

TARGET_WORDS: dict[str, int] = {"short": 180, "medium": 350, "long": 550}
AGE_LENGTH_MULTIPLIER: dict[str, float] = {"child": 0.60, "teen": 0.82, "adult": 1.00}
AGE_SENTENCE_TARGET: dict[str, Optional[int]] = {"child": 6, "teen": 10, "adult": None}

AGE_SEMANTIC_ANCHOR: dict[str, str] = {
    "child": "a gentle bedtime story for young children with animals, friends, and a happy ending",
    "teen":  "a story about growing up, school, friendship, identity, or personal challenges for teenagers",
    "adult": "a story about adult life, relationships, moral choices, work, or society",
}
AGE_EXCLUSION_ANCHOR: dict[str, Optional[str]] = {
    "child": "war, violence, weapons, death, military, battle, enemies, killing, adult horror",
    "teen":  None,
    "adult": None,
}
AGE_COMPLEXITY_RANGE: dict[str, tuple[float, float]] = {
    "child": (0.0,  0.45),
    "teen":  (0.20, 0.65),
    "adult": (0.30, 1.00),
}
SAFETY_CONFIG = {
    "min_similarity":   0.60,
    "min_word_overlap": 0.35,
    "max_length_ratio": 1.60,
}

# ─────────────────────────────────────────────────────────────
# NLTK bootstrap
# ─────────────────────────────────────────────────────────────
try:
    nltk.data.find("tokenizers/punkt")
except LookupError:
    nltk.download("punkt")


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────
def _get_target_words(length: str, age: str) -> int:
    base = TARGET_WORDS.get(length, 350)
    mult = AGE_LENGTH_MULTIPLIER.get(age, 1.0)
    return int(base * mult)


def _age_moral_suffix(virtue: str, age: str) -> str:
    v = virtue.lower().rstrip(".")
    is_gerund = v.endswith("ing")
    if age == "child":
        return (f"Always remember: {v} makes the world a better place!"
                if is_gerund else f"Always remember: being {v} makes the world a better place!")
    elif age == "teen":
        return (f"This story shows that {v} with others makes life better for everyone."
                if is_gerund else f"This story shows why {v} truly matters in life.")
    return f"The value of {v} is at the heart of this story."


# ─────────────────────────────────────────────────────────────
# ML SERVICE  (singleton)
# ─────────────────────────────────────────────────────────────
class MLService:

    def __init__(self) -> None:
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[MLService] device = {self._device}")

        print(f"[MLService] loading retrieval model: {RETRIEVAL_MODEL}")
        self._embedder = SentenceTransformer(RETRIEVAL_MODEL, device=self._device)

        print(f"[MLService] loading adapter model: {SIMPLIFICATION_MODEL}")
        self._tokenizer = AutoTokenizer.from_pretrained(SIMPLIFICATION_MODEL)
        self._adapter   = AutoModelForSeq2SeqLM.from_pretrained(SIMPLIFICATION_MODEL)
        self._adapter.to(self._device)
        self._adapter.eval()

        # caches
        self._story_emb:  Optional[torch.Tensor] = None
        self._story_ids:  list[int]              = []
        self._vocab:      list[str]              = []
        self._vocab_emb:  Optional[torch.Tensor] = None
        self._anchor_emb_cache: dict[str, torch.Tensor] = {}
        self._story_meta: list[dict]             = []

        self._hallucinations = 0
        print("[MLService] ready ✓")

    # ─────────────────────────────────────────────────────────
    # PUBLIC: warm_up
    # ─────────────────────────────────────────────────────────
    def warm_up(self, db: Session) -> None:
        print("[MLService] warming up embeddings from DB...")
        df = self._load_df(db)
        self._story_meta = df[["story_id", "title", "story", "keywords"]].to_dict("records")
        self._vocab, self._vocab_emb = self._get_vocab_embeddings(df)
        self._story_emb, self._story_ids = self._get_story_embeddings(df)
        print(f"[MLService] warm-up complete — {len(self._story_ids)} stories indexed")

    # ─────────────────────────────────────────────────────────
    # PUBLIC: run_pipeline
    # ─────────────────────────────────────────────────────────
    def run_pipeline(
        self,
        db:              Session,
        age_group:       str,
        genre_or_virtue: str,
        story_length:    str           = "medium",
        other_notes:     Optional[str] = None,
        user_id:         Optional[int] = None,
        session_id:      Optional[str] = None,
    ) -> dict:
        t0     = time.time()
        age    = age_group.lower()
        length = story_length.lower()
        virtue = genre_or_virtue.strip()

        character = ""
        if other_notes:
            m = re.search(r"character[:\s]+([a-zA-Z\s]+)", other_notes, re.I)
            if m:
                character = m.group(1).strip()

        if self._story_emb is None:
            self.warm_up(db)

        target_words = _get_target_words(length, age)

        # ── 1. Retrieve ──────────────────────────────────────
        print(f"[Pipeline] 1/4 retrieve  virtue={virtue!r}  age={age}  length={length}")
        title, story_text, story_id = self._retrieve(virtue, character, length, age)
        print(f"[Pipeline]   → '{title}'  ({len(story_text.split())} words)")

        # ── 2. Compress ──────────────────────────────────────
        print("[Pipeline] 2/4 compress")
        compressed = self._compress(story_text, target_words, age)
        print(f"[Pipeline]   → {len(compressed.split())} words")

        # ── 3. Adapt (SPEED: greedy + batched + skip adult) ──
        print(f"[Pipeline] 3/4 adapt ({age})")
        adapted = self._adapt_story(compressed, age)

        # ── 4. Moral (SPEED: single prompt, greedy) ──────────
        print("[Pipeline] 4/4 moral")
        moral = self._generate_moral(adapted, virtue, age)
        moral_label = {"child": "What we learn", "teen": "The lesson", "adult": "Moral"}.get(age, "Moral")

        elapsed_ms = int((time.time() - t0) * 1000)
        print(f"[Pipeline] done in {elapsed_ms} ms")

        # ── 5. Persist ───────────────────────────────────────
        sid = session_id or str(uuid.uuid4())
        self._save_conversation(
            db=db, user_id=user_id, session_id=sid,
            user_query=virtue, virtue=virtue, age_group=age,
            length=length, story_id=story_id, adapted=adapted,
            moral=moral, elapsed_ms=elapsed_ms,
        )

        return {
            "title":              title,
            "story":              adapted,
            "moral":              moral,
            "moral_label":        moral_label,
            "session_id":         sid,
            "retrieved_story_id": story_id,
            "age_group":          age,
            "story_length":       length,
            "word_count":         len(adapted.split()),
            "processing_time_ms": elapsed_ms,
        }

    # ─────────────────────────────────────────────────────────
    # DATA LOADING
    # ─────────────────────────────────────────────────────────
    @staticmethod
    def _load_df(db: Session) -> pd.DataFrame:
        stories = db.query(Story).all()
        if not stories:
            raise ValueError("No stories found in the database.")
        return pd.DataFrame([{
            "story_id": s.story_id,
            "title":    s.entity      or "",   # Story model uses 'entity' for title
            "story":    s.story_text  or "",   # Story model uses 'story_text' for body
            "keywords": s.keywords    or "",
            "virtue":   s.virtues     or "",   # Story model uses 'virtues' (plural)
        } for s in stories])

    # ─────────────────────────────────────────────────────────
    # EMBEDDINGS (cached to disk)
    # ─────────────────────────────────────────────────────────
    def _get_story_embeddings(self, df: pd.DataFrame):
        if os.path.exists(STORY_EMB_CACHE):
            print(f"[MLService] loading story embeddings from cache: {STORY_EMB_CACHE}")
            cache = torch.load(STORY_EMB_CACHE, map_location=self._device)
            return cache["embeddings"], cache["story_ids"]
        print("[MLService] building story embeddings (first run)…")
        texts  = (df["title"] + " " + df["story"]).tolist()
        emb    = self._embedder.encode(texts, convert_to_tensor=True, device=self._device, show_progress_bar=True)
        ids    = df["story_id"].tolist()
        torch.save({"embeddings": emb, "story_ids": ids}, STORY_EMB_CACHE)
        return emb, ids

    def _get_vocab_embeddings(self, df: pd.DataFrame):
        if os.path.exists(VOCAB_EMB_CACHE):
            print(f"[MLService] loading vocab embeddings from cache: {VOCAB_EMB_CACHE}")
            cache = torch.load(VOCAB_EMB_CACHE, map_location=self._device)
            return cache["vocab"], cache["embeddings"]
        print("[MLService] building vocab embeddings (first run)…")
        kw_series = df["keywords"].dropna()
        vocab     = list({kw.strip().lower() for cell in kw_series for kw in str(cell).split(",") if kw.strip()})
        if not vocab:
            return [], None
        emb = self._embedder.encode(vocab, convert_to_tensor=True, device=self._device, show_progress_bar=True)
        torch.save({"vocab": vocab, "embeddings": emb}, VOCAB_EMB_CACHE)
        return vocab, emb

    # ─────────────────────────────────────────────────────────
    # STEP 1 — RETRIEVE
    # ─────────────────────────────────────────────────────────
    def _retrieve(self, virtue: str, character: str, length: str, age: str):
        query = virtue + (" featuring " + character if character else "")
        q_emb = self._embedder.encode(query, convert_to_tensor=True, device=self._device)

        scores = util.cos_sim(q_emb, self._story_emb).squeeze(0)

        # age anchor bonus
        anchor_text = AGE_SEMANTIC_ANCHOR[age]
        if anchor_text not in self._anchor_emb_cache:
            self._anchor_emb_cache[anchor_text] = self._embedder.encode(
                anchor_text, convert_to_tensor=True, device=self._device
            )
        anchor_emb    = self._anchor_emb_cache[anchor_text]
        anchor_scores = util.cos_sim(anchor_emb, self._story_emb).squeeze(0)

        # exclusion penalty for child
        excl_scores = torch.zeros_like(scores)
        excl_text   = AGE_EXCLUSION_ANCHOR.get(age)
        if excl_text:
            if excl_text not in self._anchor_emb_cache:
                self._anchor_emb_cache[excl_text] = self._embedder.encode(
                    excl_text, convert_to_tensor=True, device=self._device
                )
            excl_scores = util.cos_sim(self._anchor_emb_cache[excl_text], self._story_emb).squeeze(0)

        combined = 0.50 * scores + 0.35 * anchor_scores - 0.15 * excl_scores

        # complexity filter
        lo, hi = AGE_COMPLEXITY_RANGE[age]
        n      = len(self._story_ids)
        rank   = combined.argsort(descending=True)
        for idx in rank[:min(20, n)]:
            idx = idx.item()
            meta  = self._story_meta[idx] if idx < len(self._story_meta) else None
            story = meta["story"] if meta else ""
            wc    = len(story.split())
            complexity = min(wc / 1000.0, 1.0)
            if lo <= complexity <= hi:
                return meta["title"], story, self._story_ids[idx]

        # fallback: best match regardless of complexity
        best = rank[0].item()
        meta = self._story_meta[best]
        return meta["title"], meta["story"], self._story_ids[best]

    # ─────────────────────────────────────────────────────────
    # STEP 2 — COMPRESS
    # ─────────────────────────────────────────────────────────
    def _compress(self, story: str, target_words: int, age: str) -> str:
        sentences = sent_tokenize(story)
        wc        = len(story.split())
        sent_cap  = AGE_SENTENCE_TARGET.get(age)

        if (wc <= target_words) and (sent_cap is None or len(sentences) <= sent_cap):
            return story
        if len(sentences) <= 4:
            return story

        sent_emb  = self._embedder.encode(sentences, convert_to_tensor=True, device=self._device)
        story_emb = self._embedder.encode(story,     convert_to_tensor=True, device=self._device)
        importance = util.cos_sim(sent_emb, story_emb.unsqueeze(0)).squeeze()
        centrality = util.cos_sim(sent_emb, sent_emb).mean(dim=1)
        scores     = 0.6 * importance + 0.4 * centrality

        avg_sent_words = wc / len(sentences)
        n_by_words = max(4, int(target_words / max(avg_sent_words, 1)))
        n_by_age   = sent_cap if sent_cap else len(sentences)
        n_target   = min(n_by_words, n_by_age, len(sentences) - 1)
        n_target   = max(n_target, 4)

        must_keep = {0, 1, len(sentences) - 2, len(sentences) - 1}
        top_idx   = set(torch.topk(scores, k=min(n_target, len(sentences))).indices.tolist())
        selected  = sorted(top_idx | must_keep)
        return " ".join(sentences[i] for i in selected)

    # ─────────────────────────────────────────────────────────
    # STEP 3 — ADAPT  (SPEED OPTIMIZED)
    # ─────────────────────────────────────────────────────────

    def _run_model_single(self, prompt: str, max_new_tokens: int = 40) -> str:
        """
        SPEED: num_beams=1 (greedy decode) — ~3-5x faster than beam search.
        Only used internally by _rewrite_sentence and _generate_moral.
        """
        inputs = self._tokenizer(
            prompt,
            return_tensors="pt",
            max_length=512,
            truncation=True,
        ).to(self._device)
        with torch.inference_mode():   # faster than no_grad
            out = self._adapter.generate(
                **inputs,
                max_new_tokens       = max_new_tokens,
                num_beams            = 1,              # GREEDY — key speedup
                do_sample            = False,
                repetition_penalty   = 1.2,
                no_repeat_ngram_size = 3,
            )
        return self._tokenizer.decode(out[0], skip_special_tokens=True).strip()

    def _run_model_batch(self, prompts: list[str], max_new_tokens: int = 40) -> list[str]:
        """
        SPEED: batch multiple sentences in one forward pass.
        Falls back sentence-by-sentence if OOM.
        """
        try:
            inputs = self._tokenizer(
                prompts,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=512,
            ).to(self._device)
            with torch.inference_mode():
                out = self._adapter.generate(
                    **inputs,
                    max_new_tokens       = max_new_tokens,
                    num_beams            = 1,
                    do_sample            = False,
                    repetition_penalty   = 1.2,
                    no_repeat_ngram_size = 3,
                )
            return [self._tokenizer.decode(o, skip_special_tokens=True).strip() for o in out]
        except RuntimeError:
            # OOM — fall back to one-by-one
            return [self._run_model_single(p, max_new_tokens) for p in prompts]

    def _build_prompt(self, sentence: str, age: str) -> str:
        if age == "child":
            return (
                f"Rewrite this sentence so a young child can understand it easily. "
                f"Use short simple words. Keep the same meaning. Do not add anything new.\n"
                f"Original: {sentence}\nSimple version:"
            )
        return (
            f"Rewrite this sentence in simpler, clearer language for a teenager. "
            f"Keep all the facts. Do not add anything new.\n"
            f"Original: {sentence}\nClearer version:"
        )

    def _is_safe_rewrite(self, original: str, rewritten: str) -> bool:
        """Quick safety check — rejects hallucinated rewrites."""
        orig_emb = self._embedder.encode(original,  convert_to_tensor=True, device=self._device)
        rew_emb  = self._embedder.encode(rewritten, convert_to_tensor=True, device=self._device)
        sim      = float(util.cos_sim(orig_emb, rew_emb))
        ratio    = len(rewritten.split()) / max(len(original.split()), 1)
        sw  = {"the","a","an","and","or","but","in","on","at","to","for","of","is","was","were"}
        ok  = {w.lower() for w in original.split()  if w.lower() not in sw}
        rk  = {w.lower() for w in rewritten.split() if w.lower() not in sw}
        overlap = len(ok & rk) / max(len(ok), 1)
        return (
            sim   >= SAFETY_CONFIG["min_similarity"]  and
            ratio <= SAFETY_CONFIG["max_length_ratio"] and
            ratio >= 0.55 and
            overlap >= SAFETY_CONFIG["min_word_overlap"]
        )

    def _adapt_story(self, story: str, age: str) -> str:
        """
        SPEED OPTIMIZATIONS:
          - adult: instant return, zero model calls
          - sentences < 5 words: skip model call
          - BATCH_SIZE sentences sent together in one forward pass
          - greedy decode (num_beams=1)
        """
        if age == "adult":
            return story

        sentences = sent_tokenize(story)
        BATCH_SIZE = 4   # tune down to 2 if VRAM is tight

        # Split into short (skip) vs long (needs model)
        indices_to_rewrite = [i for i, s in enumerate(sentences) if len(s.split()) >= 5]
        result = list(sentences)

        print(f"  Rewriting {len(indices_to_rewrite)}/{len(sentences)} sentences for {age} (batched, greedy)…")

        for batch_start in range(0, len(indices_to_rewrite), BATCH_SIZE):
            batch_indices = indices_to_rewrite[batch_start: batch_start + BATCH_SIZE]
            prompts       = [self._build_prompt(sentences[i], age) for i in batch_indices]
            max_toks      = max(max(30, int(len(sentences[i].split()) * 1.4)) for i in batch_indices)
            rewrites      = self._run_model_batch(prompts, max_new_tokens=min(max_toks, 60))

            for idx, rewrite in zip(batch_indices, rewrites):
                if self._is_safe_rewrite(sentences[idx], rewrite):
                    result[idx] = rewrite
                else:
                    self._hallucinations += 1

        print(f"  Adaptation done (fallbacks: {self._hallucinations})")
        return " ".join(result)

    # ─────────────────────────────────────────────────────────
    # STEP 4 — MORAL  (SPEED OPTIMIZED: single prompt, greedy)
    # ─────────────────────────────────────────────────────────
    def _generate_moral(self, story: str, virtue: str, age: str) -> str:
        sentences = sent_tokenize(story)

        # Find seed sentence most relevant to virtue
        query = virtue if virtue else story[:120]
        q_emb = self._embedder.encode(query, convert_to_tensor=True, device=self._device)
        best, best_sc = sentences[-1], -1.0
        for s in sentences:
            if len(s.split()) < 5:
                continue
            sc = float(util.cos_sim(
                q_emb, self._embedder.encode(s, convert_to_tensor=True, device=self._device)
            ))
            if sc > best_sc:
                best_sc, best = sc, s

        context = best
        if best == sentences[-1] and len(sentences) >= 2:
            context = sentences[-2] + " " + best

        virtue_hint = virtue if virtue else "doing the right thing"

        # SPEED: single prompt, greedy decode, capped tokens
        prompt = (
            f"Story context: {context}\n\n"
            f"What does this story teach about {virtue_hint}? "
            f"Write one short universal lesson in one sentence.\n"
            f"Lesson:"
        )
        moral = self._run_model_single(prompt, max_new_tokens=50)

        # Validate — fallback to template if bad
        if not moral or len(moral.split()) < 4:
            return _age_moral_suffix(virtue_hint, age)

        # Echo check — reject if moral just repeats the prompt context
        m_emb = self._embedder.encode(moral,   convert_to_tensor=True, device=self._device)
        c_emb = self._embedder.encode(context, convert_to_tensor=True, device=self._device)
        if float(util.cos_sim(m_emb, c_emb)) > 0.92:
            return _age_moral_suffix(virtue_hint, age)

        return moral

    # ─────────────────────────────────────────────────────────
    # STEP 5 — PERSIST
    # ─────────────────────────────────────────────────────────
    def _save_conversation(
        self, db, user_id, session_id, user_query, virtue,
        age_group, length, story_id, adapted, moral, elapsed_ms,
    ) -> None:
        try:
            conv = ChatbotConversation(
                user_id            = user_id,
                session_id         = session_id,
                user_query         = user_query,
                virtue             = virtue,           # column: virtue
                age_group          = age_group,
                length_preference  = length,
                retrieved_story_id = story_id,
                generated_story    = adapted,
                moral              = moral,
                response_time_ms   = elapsed_ms,       # column: response_time_ms
            )
            db.add(conv)
            db.commit()
        except Exception as e:
            print(f"[MLService] ⚠️  failed to persist conversation: {e}")
            db.rollback()


# ─────────────────────────────────────────────────────────────
# SINGLETON  management
# ─────────────────────────────────────────────────────────────
_ml_service_instance: Optional[MLService] = None


def _create_service_instance() -> MLService:
    return MLService()


def get_ml_service() -> MLService:
    global _ml_service_instance
    if _ml_service_instance is None:
        _ml_service_instance = _create_service_instance()
        _ml_service_instance._story_meta = []
    return _ml_service_instance


def init_ml_service(db: Session) -> MLService:
    """
    Call from main.py lifespan startup.
    Loads models + builds/loads all embeddings eagerly.
    """
    global _ml_service_instance
    svc = _create_service_instance()
    df  = MLService._load_df(db)
    svc._story_meta                  = df[["story_id", "title", "story", "keywords"]].to_dict("records")
    svc._vocab, svc._vocab_emb       = svc._get_vocab_embeddings(df)
    svc._story_emb, svc._story_ids   = svc._get_story_embeddings(df)
    _ml_service_instance             = svc
    print(f"[MLService] init complete — {len(svc._story_ids)} stories ready")
    return svc

# """
# app/services/ml_service.py
# ==========================
# Singleton service that owns the ML models and exposes run_pipeline().

# Called from:
#     routers/chatbot.py  →  ml_service.run_pipeline(db, age_group, ...)

# Pipeline (mirrors main_slm_safe.py in order):
#     1. RETRIEVE  — best-matching story from PostgreSQL
#     2. COMPRESS  — trim to age-adjusted word target
#     3. ADAPT     — simplify for child/teen; unchanged for adult
#     4. MORAL     — grounded, age-appropriate moral
#     5. PERSIST   — save ChatbotConversation row to DB
# """

# from __future__ import annotations

# import time
# import uuid
# import os
# import torch
# import nltk
# import re
# import numpy as np
# import pandas as pd

# from typing import Optional
# from sqlalchemy.orm import Session
# from sentence_transformers import SentenceTransformer, util
# from nltk.tokenize import sent_tokenize, word_tokenize
# from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

# # ── models ────────────────────────────────────────────────────
# from app.models.story import Story, ChatbotConversation

# # ─────────────────────────────────────────────────────────────
# # CONFIG  (mirrors main_slm_safe.py constants)
# # ─────────────────────────────────────────────────────────────
# RETRIEVAL_MODEL      = "all-MiniLM-L6-v2"
# SIMPLIFICATION_MODEL = "google/flan-t5-base"

# # Cache paths — stored next to this file's package root
# _HERE = os.path.dirname(os.path.abspath(__file__))
# STORY_EMB_CACHE = os.path.join(_HERE, "story_embeddings.pt")
# VOCAB_EMB_CACHE = os.path.join(_HERE, "vocab_embeddings.pt")

# TARGET_WORDS: dict[str, int] = {"short": 180, "medium": 350, "long": 550}
# AGE_LENGTH_MULTIPLIER: dict[str, float] = {"child": 0.60, "teen": 0.82, "adult": 1.00}
# AGE_SENTENCE_TARGET: dict[str, Optional[int]] = {"child": 6, "teen": 10, "adult": None}

# AGE_SEMANTIC_ANCHOR: dict[str, str] = {
#     "child": "a gentle bedtime story for young children with animals, friends, and a happy ending",
#     "teen":  "a story about growing up, school, friendship, identity, or personal challenges for teenagers",
#     "adult": "a story about adult life, relationships, moral choices, work, or society",
# }
# AGE_EXCLUSION_ANCHOR: dict[str, Optional[str]] = {
#     "child": "war, violence, weapons, death, military, battle, enemies, killing, adult horror",
#     "teen":  None,
#     "adult": None,
# }
# AGE_COMPLEXITY_RANGE: dict[str, tuple[float, float]] = {
#     "child": (0.0,  0.45),
#     "teen":  (0.20, 0.65),
#     "adult": (0.30, 1.00),
# }
# SAFETY_CONFIG = {
#     "min_similarity":   0.60,
#     "min_word_overlap": 0.35,
#     "max_length_ratio": 1.60,
# }

# # ─────────────────────────────────────────────────────────────
# # NLTK bootstrap
# # ─────────────────────────────────────────────────────────────
# try:
#     nltk.data.find("tokenizers/punkt")
# except LookupError:
#     nltk.download("punkt")

# # try:
# #     nltk.data.find("tokenizers/punkt_tab")
# # except LookupError:
# #     nltk.download("punkt_tab")


# # ─────────────────────────────────────────────────────────────
# # HELPERS  (ported 1-to-1 from main_slm_safe.py)
# # ─────────────────────────────────────────────────────────────

# def _get_target_words(length: str, age: str) -> int:
#     return max(80, int(TARGET_WORDS[length] * AGE_LENGTH_MULTIPLIER.get(age, 1.0)))


# def _compute_text_complexity(story: str) -> float:
#     sentences = sent_tokenize(story)
#     words     = [w for w in story.split() if w.isalpha()]
#     if not sentences or not words:
#         return 0.5
#     avg_sent = len(words) / len(sentences)
#     avg_word = sum(len(w) for w in words) / len(words)
#     ttr      = len(set(w.lower() for w in words)) / len(words)
#     return float(np.clip(
#         0.5 * min(avg_sent / 30.0, 1.0)
#         + 0.3 * min(max((avg_word - 3.5) / 4.0, 0.0), 1.0)
#         + 0.2 * (1.0 - ttr),
#         0.0, 1.0,
#     ))


# def _character_match_score(story: str, character_words: list[str]) -> float:
#     if not character_words:
#         return 0.0
#     sl = story.lower()
#     return sum(1 for w in character_words if w in sl) / len(character_words)


# def _safe_moral(virtue: str, age: str) -> str:
#     v = virtue.strip().lower() if virtue else ""
#     if not v:
#         return {
#             "child": "Always be kind and share with others.",
#             "teen":  "Our choices shape who we are.",
#             "adult": "Character defines us.",
#         }.get(age, "Character defines us.")
#     is_gerund = v.endswith("ing")
#     if age == "child":
#         return (f"{v.capitalize()} with others makes the world a happier place."
#                 if is_gerund else f"It is always good to show {v} to others.")
#     elif age == "teen":
#         return (f"This story shows that {v} with others makes life better for everyone."
#                 if is_gerund else f"This story shows why {v} truly matters in life.")
#     return f"The value of {v} is at the heart of this story."


# # ─────────────────────────────────────────────────────────────
# # ML SERVICE  (singleton)
# # ─────────────────────────────────────────────────────────────

# class MLService:
#     """
#     Holds the loaded models and all pipeline logic.
#     Instantiated once at startup via get_ml_service().
#     """

#     def __init__(self) -> None:
#         self._device = "cuda" if torch.cuda.is_available() else "cpu"
#         print(f"[MLService] device = {self._device}")

#         # ── load retrieval embedder ──────────────────────────
#         print(f"[MLService] loading retrieval model: {RETRIEVAL_MODEL}")
#         self._embedder = SentenceTransformer(RETRIEVAL_MODEL, device=self._device)

#         # ── load seq2seq adapter ─────────────────────────────
#         print(f"[MLService] loading adapter model: {SIMPLIFICATION_MODEL}")
#         self._tokenizer = AutoTokenizer.from_pretrained(SIMPLIFICATION_MODEL)
#         self._adapter   = AutoModelForSeq2SeqLM.from_pretrained(SIMPLIFICATION_MODEL)
#         self._adapter.to(self._device)
#         self._adapter.eval()

#         # ── runtime caches (populated lazily / at warm-up) ───
#         self._story_emb:  Optional[torch.Tensor] = None  # (N, D) on device
#         self._story_ids:  list[int]              = []    # parallel list of story_id
#         self._vocab:      list[str]              = []
#         self._vocab_emb:  Optional[torch.Tensor] = None
#         self._anchor_emb_cache: dict[str, torch.Tensor] = {}

#         self._hallucinations = 0
#         print("[MLService] ready ✓")

#     # ─────────────────────────────────────────────────────────
#     # PUBLIC: warm_up
#     # ─────────────────────────────────────────────────────────

#     def warm_up(self, db: Session) -> None:
#         """
#         Called once from main.py lifespan startup.
#         Loads/builds vocab + story embeddings from the DB.
#         """
#         print("[MLService] warming up embeddings from DB...")
#         df = self._load_df(db)
#         self._vocab, self._vocab_emb = self._get_vocab_embeddings(df)
#         self._story_emb, self._story_ids = self._get_story_embeddings(df)
#         print(f"[MLService] warm-up complete — {len(self._story_ids)} stories indexed")

#     # ─────────────────────────────────────────────────────────
#     # PUBLIC: run_pipeline
#     # ─────────────────────────────────────────────────────────

#     def run_pipeline(
#         self,
#         db:             Session,
#         age_group:      str,
#         genre_or_virtue:str,
#         story_length:   str          = "medium",
#         other_notes:    Optional[str]= None,
#         user_id:        Optional[int]= None,
#         session_id:     Optional[str]= None,
#     ) -> dict:
#         """
#         Full 4-step pipeline.  Returns a dict matching ChatbotResponse fields.
#         """
#         t0 = time.time()
#         age    = age_group.lower()
#         length = story_length.lower()
#         virtue = genre_or_virtue.strip()

#         # Extract optional character hint from other_notes
#         character = ""
#         if other_notes:
#             m = re.search(r"character[:\s]+([a-zA-Z\s]+)", other_notes, re.I)
#             if m:
#                 character = m.group(1).strip()

#         # Lazy warm-up (if warm_up() was never called)
#         if self._story_emb is None:
#             self.warm_up(db)

#         target_words = _get_target_words(length, age)

#         # ── 1. Retrieve ──────────────────────────────────────
#         print(f"[Pipeline] 1/4 retrieve  virtue={virtue!r}  age={age}  length={length}")
#         title, story_text, story_id = self._retrieve(virtue, character, length, age)
#         print(f"[Pipeline]   → '{title}'  ({len(story_text.split())} words)")

#         # ── 2. Compress ──────────────────────────────────────
#         print("[Pipeline] 2/4 compress")
#         compressed = self._compress(story_text, target_words, age)
#         print(f"[Pipeline]   → {len(compressed.split())} words")

#         # ── 3. Adapt ─────────────────────────────────────────
#         print(f"[Pipeline] 3/4 adapt ({age})")
#         adapted = self._adapt_story(compressed, age)

#         # ── 4. Moral ─────────────────────────────────────────
#         print("[Pipeline] 4/4 moral")
#         moral = self._generate_moral(adapted, virtue, age)
#         moral_label = {"child": "What we learn",
#                        "teen":  "The lesson",
#                        "adult": "Moral"}.get(age, "Moral")

#         elapsed_ms = int((time.time() - t0) * 1000)
#         print(f"[Pipeline] done in {elapsed_ms} ms")

#         # ── 5. Persist ───────────────────────────────────────
#         sid = session_id or str(uuid.uuid4())
#         self._save_conversation(
#             db          = db,
#             user_id     = user_id,
#             session_id  = sid,
#             user_query  = virtue,
#             virtue      = virtue,
#             age_group   = age,
#             length      = length,
#             story_id    = story_id,
#             adapted     = adapted,
#             moral       = moral,
#             elapsed_ms  = elapsed_ms,
#         )

#         return {
#             "title":               title,
#             "story":               adapted,          # aliased by ChatbotResponse
#             "moral":               moral,
#             "moral_label":         moral_label,
#             "session_id":          sid,
#             "retrieved_story_id":  story_id,
#             "age_group":           age,
#             "story_length":        length,
#             "word_count":          len(adapted.split()),
#             "processing_time_ms":  elapsed_ms,
#         }

#     # ─────────────────────────────────────────────────────────
#     # DATA LOADING
#     # ─────────────────────────────────────────────────────────

#     @staticmethod
#     def _load_df(db: Session) -> pd.DataFrame:
#         """Pull all stories from PostgreSQL into a DataFrame."""
#         stories = db.query(Story).all()
#         if not stories:
#             raise ValueError("No stories found in the database.")
#         df = pd.DataFrame([{
#             "story_id": s.story_id,
#             "title":    s.entity,
#             "story":    s.story_text or "",
#             "virtue":   s.virtues   or "",
#             "keywords": s.keywords  or "",
#         } for s in stories])
#         df["story"] = df["story"].astype(str)
#         return df

#     # ─────────────────────────────────────────────────────────
#     # VOCAB + EMBEDDINGS
#     # ─────────────────────────────────────────────────────────

#     def _build_vocab(self, df: pd.DataFrame) -> list[str]:
#         vocab: set[str] = set()
#         for col in ["virtue", "keywords"]:
#             if col in df.columns:
#                 for v in df[col].dropna():
#                     for w in str(v).lower().split():
#                         w = re.sub(r"[^\w]", "", w)
#                         if len(w) > 2:
#                             vocab.add(w)
#         for story in df["story"].head(100):
#             for w in word_tokenize(str(story).lower()):
#                 if w.isalpha() and 3 <= len(w) <= 12:
#                     vocab.add(w)
#         print(f"[MLService] vocab size: {len(vocab)}")
#         return sorted(vocab)

#     def _get_vocab_embeddings(
#         self, df: pd.DataFrame
#     ) -> tuple[list[str], torch.Tensor]:
#         vocab = self._build_vocab(df)
#         if os.path.exists(VOCAB_EMB_CACHE):
#             print("[MLService] loading cached vocab embeddings")
#             emb = torch.load(VOCAB_EMB_CACHE, map_location=self._device)
#             if emb.shape[0] == len(vocab):
#                 return vocab, emb.to(self._device)
#         print("[MLService] building vocab embeddings …")
#         emb = self._embedder.encode(
#             vocab, convert_to_tensor=True, device=self._device
#         )
#         torch.save(emb.cpu(), VOCAB_EMB_CACHE)
#         return vocab, emb.to(self._device)

#     def _get_story_embeddings(
#         self, df: pd.DataFrame
#     ) -> tuple[torch.Tensor, list[int]]:
#         story_ids = df["story_id"].tolist()
#         if os.path.exists(STORY_EMB_CACHE):
#             print("[MLService] loading cached story embeddings")
#             cached = torch.load(STORY_EMB_CACHE, map_location=self._device)
#             if isinstance(cached, dict) and cached.get("ids") == story_ids:
#                 return cached["emb"].to(self._device), story_ids
#         print("[MLService] building story embeddings …")
#         emb = self._embedder.encode(
#             df["story"].tolist(),
#             convert_to_tensor=True,
#             show_progress_bar=True,
#             device=self._device,
#         )
#         torch.save({"emb": emb.cpu(), "ids": story_ids}, STORY_EMB_CACHE)
#         return emb.to(self._device), story_ids

#     # ─────────────────────────────────────────────────────────
#     # RETRIEVAL HELPERS
#     # ─────────────────────────────────────────────────────────

#     def _semantic_synonyms(self, word: str, topk: int = 3) -> list[str]:
#         if not word:
#             return []
#         w_emb  = self._embedder.encode(word, convert_to_tensor=True, device=self._device)
#         scores = util.cos_sim(w_emb, self._vocab_emb)[0]
#         top    = torch.topk(scores, k=min(topk * 10, len(self._vocab)))
#         out: list[str] = []
#         for idx, sc in zip(top.indices.tolist(), top.values.tolist()):
#             c = self._vocab[idx]
#             if sc >= 0.55 and 4 <= len(c) <= 12 and c.isalpha() and c != word:
#                 out.append(c)
#             if len(out) >= topk:
#                 break
#         return out

#     def _age_fit_score(self, story: str, age: str) -> float:
#         if age not in self._anchor_emb_cache:
#             self._anchor_emb_cache[age] = self._embedder.encode(
#                 AGE_SEMANTIC_ANCHOR[age], convert_to_tensor=True, device=self._device
#             )
#         story_emb    = self._embedder.encode(
#             story[:600], convert_to_tensor=True, device=self._device
#         )
#         semantic_fit = float(util.cos_sim(story_emb, self._anchor_emb_cache[age]))
#         complexity   = _compute_text_complexity(story)
#         lo, hi       = AGE_COMPLEXITY_RANGE[age]
#         if lo <= complexity <= hi:
#             complexity_fit = 1.0
#         elif complexity < lo:
#             complexity_fit = max(0.4, 1.0 - (lo - complexity) * 1.5)
#         else:
#             complexity_fit = max(0.0, 1.0 - (complexity - hi) * 2.0)

#         exclusion_penalty = 0.0
#         excl_text = AGE_EXCLUSION_ANCHOR.get(age)
#         if excl_text:
#             excl_key = f"excl_{age}"
#             if excl_key not in self._anchor_emb_cache:
#                 self._anchor_emb_cache[excl_key] = self._embedder.encode(
#                     excl_text, convert_to_tensor=True, device=self._device
#                 )
#             excl_sim = float(util.cos_sim(story_emb, self._anchor_emb_cache[excl_key]))
#             if excl_sim > 0.35:
#                 exclusion_penalty = (excl_sim - 0.35) * 2.0

#         score = 0.55 * semantic_fit + 0.35 * complexity_fit
#         return score * max(0.1, 1.0 - exclusion_penalty)

#     # ─────────────────────────────────────────────────────────
#     # STEP 1 — RETRIEVE
#     # ─────────────────────────────────────────────────────────

#     def _retrieve(
#         self, virtue: str, character: str, length: str, age: str
#     ) -> tuple[str, str, Optional[int]]:
#         """
#         Returns (title, story_text, story_id).
#         Uses in-memory self._story_emb + self._story_ids.
#         Needs the full DataFrame only to look up title/text by index.
#         We rebuild a minimal lookup from DB via self._story_ids — but
#         because we cached both emb + ids in sync, we read from a
#         lightweight parallel list rather than re-querying Postgres.
#         NOTE: call warm_up() first (or lazy init handles it).
#         """
#         # We need title+text for the winning story — keep a mini cache
#         # populated during warm_up (avoids a DB round-trip per request).
#         if not hasattr(self, "_story_meta"):
#             raise RuntimeError("warm_up() must be called before _retrieve()")

#         query_terms = []
#         if virtue:
#             query_terms += self._semantic_synonyms(virtue, topk=5)
#             query_terms.append(virtue)
#         if character:
#             query_terms += character.lower().split()
#         if not query_terms:
#             meta = self._story_meta[0]
#             return meta["title"], meta["story"], meta["story_id"]

#         query  = " ".join(query_terms)
#         print(f"  [retrieve] query: {query}")
#         q_emb  = self._embedder.encode(query, convert_to_tensor=True, device=self._device)
#         scores = util.cos_sim(q_emb, self._story_emb)[0].clone()

#         target     = _get_target_words(length, age)
#         char_words = character.lower().split() if character else []

#         # Pre-compute query word set for exact title/keyword matching
#         query_words = set(re.sub(r"[^\w\s]", "", query.lower()).split())

#         for i, meta in enumerate(self._story_meta):
#             story_text = meta["story"]

#             # ── Title + keyword exact-match boost ────────────────────────────
#             # Rescues educational/short-body stories whose title/keywords
#             # describe exactly what the user asked for (e.g. "previous and
#             # next value computation" → matches entity column perfectly).
#             title_words   = set(re.sub(r"[^\w\s]", "", meta["title"].lower()).split())
#             keyword_words = set(
#                 re.sub(r"[^\w\s]", "", meta.get("keywords", "").lower()).split()
#             )
#             overlap_ratio = (
#                 len(query_words & (title_words | keyword_words)) / len(query_words)
#                 if query_words else 0.0
#             )
#             # Additive boost — lifts a near-zero cosine to competitive
#             scores[i] += overlap_ratio * 0.50

#             # ── Age-fit ───────────────────────────────────────────────────────
#             scores[i] *= self._age_fit_score(story_text, age)

#             # ── Length quality ────────────────────────────────────────────────
#             # If the title/keyword match is strong (≥40%), trust the result
#             # and skip the heavy under-length penalty — the story may be
#             # intentionally short (a problem statement, a fable, a prompt).
#             wc = len(story_text.split())
#             if overlap_ratio >= 0.40:
#                 if wc < target:
#                     under = wc / max(target, 1)
#                     if   under < 0.15: scores[i] *= 0.60
#                     elif under < 0.40: scores[i] *= 0.80
#                     # else: no penalty — short but title-matched
#             else:
#                 # Original length scoring for body-matched stories
#                 if wc >= target:
#                     over = wc / target
#                     if   over > 5: scores[i] *= 0.5
#                     elif over > 3: scores[i] *= 0.8
#                 else:
#                     under = wc / max(target, 1)
#                     if   under < 0.30: scores[i] *= 0.20
#                     elif under < 0.50: scores[i] *= 0.40
#                     elif under < 0.70: scores[i] *= 0.65
#                     else:               scores[i] *= 0.85

#             if char_words:
#                 scores[i] += 0.25 * _character_match_score(story_text, char_words)

#         idx  = int(torch.argmax(scores).item())
#         meta = self._story_meta[idx]
#         return meta["title"], meta["story"], meta["story_id"]

#     # ─────────────────────────────────────────────────────────
#     # STEP 2 — COMPRESS
#     # ─────────────────────────────────────────────────────────

#     def _compress(self, story: str, target_words: int, age: str) -> str:
#         sentences = sent_tokenize(story)
#         wc        = len(story.split())
#         sent_cap  = AGE_SENTENCE_TARGET.get(age)

#         if (wc <= target_words) and (sent_cap is None or len(sentences) <= sent_cap):
#             return story
#         if len(sentences) <= 4:
#             return story

#         sent_emb   = self._embedder.encode(sentences, convert_to_tensor=True, device=self._device)
#         story_emb2 = self._embedder.encode(story,     convert_to_tensor=True, device=self._device)
#         importance = util.cos_sim(sent_emb, story_emb2.unsqueeze(0)).squeeze()
#         centrality = util.cos_sim(sent_emb, sent_emb).mean(dim=1)
#         scores2    = 0.6 * importance + 0.4 * centrality

#         avg_sent_words = wc / len(sentences)
#         n_by_words = max(4, int(target_words / avg_sent_words))
#         n_by_age   = sent_cap if sent_cap else len(sentences)
#         n_target   = min(n_by_words, n_by_age, len(sentences) - 1)
#         n_target   = max(n_target, 4)

#         must_keep = {0, 1, len(sentences) - 2, len(sentences) - 1}
#         top_idx   = set(torch.topk(scores2, k=min(n_target, len(sentences))).indices.tolist())
#         selected  = sorted(top_idx | must_keep)
#         return " ".join(sentences[i] for i in selected)

#     # ─────────────────────────────────────────────────────────
#     # STEP 3 — ADAPT
#     # ─────────────────────────────────────────────────────────

#     def _run_model(self, prompt: str, max_new_tokens: int = 45, num_beams: int = 5) -> str:
#         inputs = self._tokenizer(
#             prompt, return_tensors="pt", max_length=512, truncation=True
#         ).to(self._device)
#         with torch.no_grad():
#             out = self._adapter.generate(
#                 **inputs,
#                 max_new_tokens   = max_new_tokens,
#                 num_beams        = num_beams,
#                 early_stopping   = True,
#                 repetition_penalty = 1.3,
#                 no_repeat_ngram_size = 3,
#             )
#         return self._tokenizer.decode(out[0], skip_special_tokens=True).strip()

#     def _rewrite_sentence(self, sentence: str, age: str) -> str:
#         if age == "child":
#             prompt = (
#                 f"Rewrite this sentence so a young child can understand it easily.\n"
#                 f"Use short simple words. Keep the same meaning. Do not add anything new.\n"
#                 f"Original: {sentence}\nSimple version:"
#             )
#         else:
#             prompt = (
#                 f"Rewrite this sentence in simpler, clearer language for a teenager.\n"
#                 f"Keep all the facts. Do not add anything new.\n"
#                 f"Original: {sentence}\nClearer version:"
#             )
#         rewritten = self._run_model(
#             prompt,
#             max_new_tokens=max(30, int(len(sentence.split()) * 1.4)),
#             num_beams=4,
#         )
#         orig_emb = self._embedder.encode(sentence,  convert_to_tensor=True, device=self._device)
#         rew_emb  = self._embedder.encode(rewritten, convert_to_tensor=True, device=self._device)
#         sim      = float(util.cos_sim(orig_emb, rew_emb))
#         ratio    = len(rewritten.split()) / max(len(sentence.split()), 1)
#         sw = {"the","a","an","and","or","but","in","on","at","to","for","of","is","was","were"}
#         ok = {w.lower() for w in sentence.split()  if w.lower() not in sw}
#         rk = {w.lower() for w in rewritten.split() if w.lower() not in sw}
#         overlap = len(ok & rk) / max(len(ok), 1)
#         if (sim   < SAFETY_CONFIG["min_similarity"] or
#             ratio > SAFETY_CONFIG["max_length_ratio"] or
#             ratio < 0.55 or
#             overlap < SAFETY_CONFIG["min_word_overlap"]):
#             self._hallucinations += 1
#             return sentence
#         return rewritten

#     def _adapt_story(self, story: str, age: str) -> str:
#         if age == "adult":
#             return story
#         sentences = sent_tokenize(story)
#         adapted: list[str] = []
#         print(f"  [adapt] rewriting {len(sentences)} sentences for {age} …")
#         for i, sent in enumerate(sentences):
#             adapted.append(sent if len(sent.split()) < 4
#                            else self._rewrite_sentence(sent, age))
#             if (i + 1) % 5 == 0:
#                 print(f"    {i+1}/{len(sentences)}")
#         return " ".join(adapted)

#     # ─────────────────────────────────────────────────────────
#     # STEP 4 — MORAL
#     # ─────────────────────────────────────────────────────────

#     def _clean_moral(self, text: str) -> str:
#         if not text:
#             return text
#         for sent in sent_tokenize(text):
#             if len(sent.split()) >= 5:
#                 sent = sent.strip()
#                 if sent[-1] not in ".!?":
#                     sent += "."
#                 return sent[0].upper() + sent[1:]
#         return text

#     def _moral_fitness(self, text: str) -> float:
#         concept = (
#             "A valuable life lesson or moral principle. "
#             "A character understands an important truth about kindness, "
#             "honesty, courage, or how to treat others."
#         )
#         c_emb = self._embedder.encode(concept, convert_to_tensor=True, device=self._device)
#         t_emb = self._embedder.encode(text,    convert_to_tensor=True, device=self._device)
#         return float(util.cos_sim(c_emb, t_emb))

#     def _generate_moral(self, story: str, virtue: str, age: str) -> str:
#         sentences = sent_tokenize(story)
#         query     = virtue if virtue else story[:120]
#         q_emb     = self._embedder.encode(query, convert_to_tensor=True, device=self._device)
#         best, best_sc = sentences[-1], -1.0
#         for s in sentences:
#             if len(s.split()) < 5:
#                 continue
#             sc = float(util.cos_sim(
#                 q_emb,
#                 self._embedder.encode(s, convert_to_tensor=True, device=self._device)
#             ))
#             if sc > best_sc:
#                 best_sc, best = sc, s

#         context = (sentences[-2] + " " + best
#                    if best == sentences[-1] and len(sentences) >= 2
#                    else best + " " + sentences[-1])

#         virtue_hint = virtue if virtue else "doing the right thing"
#         raw_a = self._run_model(
#             f"Story context: {context}\n\n"
#             f"What does this situation teach about how people should treat each other? "
#             f"Write one universal lesson (not about these specific characters).\nLesson:",
#             max_new_tokens=45, num_beams=5,
#         )
#         raw_b = self._run_model(
#             f"Story context: {context}\n\n"
#             f"What does this story teach about {virtue_hint}? "
#             f"Write one sentence as a general principle for anyone.\nPrinciple:",
#             max_new_tokens=45, num_beams=4,
#         )
#         moral: Optional[str] = None
#         for cand in [self._clean_moral(raw_a), self._clean_moral(raw_b)]:
#             if cand and len(cand.split()) >= 6:
#                 moral = cand
#                 break

#         if moral:
#             seed_emb  = self._embedder.encode(best,       convert_to_tensor=True, device=self._device)
#             story_emb = self._embedder.encode(story[:600], convert_to_tensor=True, device=self._device)
#             m_emb     = self._embedder.encode(moral,       convert_to_tensor=True, device=self._device)
#             if (float(util.cos_sim(seed_emb, m_emb))  >= 0.90 or
#                 float(util.cos_sim(story_emb, m_emb)) <  0.20 or
#                 self._moral_fitness(moral)             <  0.25):
#                 moral = None

#         if moral and age != "adult":
#             age_desc = ("a young child using very simple short words"
#                         if age == "child" else
#                         "a teenager using clear relatable language")
#             rewritten = self._clean_moral(self._run_model(
#                 f"Rewrite this lesson for {age_desc}. Same meaning. One sentence.\n"
#                 f"Original: {moral}\nRewritten:",
#                 max_new_tokens=40, num_beams=4,
#             ))
#             if rewritten and len(rewritten.split()) >= 5:
#                 r_emb = self._embedder.encode(rewritten, convert_to_tensor=True, device=self._device)
#                 m_emb = self._embedder.encode(moral,     convert_to_tensor=True, device=self._device)
#                 if float(util.cos_sim(m_emb, r_emb)) >= 0.65:
#                     moral = rewritten

#         if not moral:
#             # fallback
#             ending = " ".join(sent_tokenize(story)[-3:])
#             age_note = {"child": "in simple words for a child",
#                         "teen":  "in simple language for a teen",
#                         "adult": "in one clear sentence"}.get(age, "in one sentence")
#             raw = self._run_model(
#                 f"What lesson does this story ending teach? "
#                 f"State the lesson {age_note}. Do not describe events.\n"
#                 f"Story ending: {ending}\nLesson:",
#                 max_new_tokens=35, num_beams=4,
#             )
#             moral = self._clean_moral(raw)
#             if not (moral and self._moral_fitness(moral) >= 0.32 and len(moral.split()) >= 6):
#                 moral = _safe_moral(virtue, age)

#         return moral

#     # ─────────────────────────────────────────────────────────
#     # STEP 5 — PERSIST
#     # ─────────────────────────────────────────────────────────

#     @staticmethod
#     def _save_conversation(
#         db:          Session,
#         user_id:     Optional[int],
#         session_id:  str,
#         user_query:  str,
#         virtue:      str,
#         age_group:   str,
#         length:      str,
#         story_id:    Optional[int],
#         adapted:     str,
#         moral:       str,
#         elapsed_ms:  int,
#     ) -> None:
#         try:
#             conv = ChatbotConversation(
#                 user_id             = user_id,
#                 session_id          = session_id,
#                 user_query          = user_query,
#                 virtue              = virtue,
#                 age_group           = age_group,
#                 length_preference   = length,
#                 retrieved_story_id  = story_id,
#                 generated_story     = adapted,
#                 moral               = moral,
#                 response_time_ms    = elapsed_ms,
#             )
#             db.add(conv)
#             db.commit()
#         except Exception as exc:
#             db.rollback()
#             print(f"[MLService] ⚠️  failed to save conversation: {exc}")


# # ─────────────────────────────────────────────────────────────
# # SINGLETON + WARM-UP HELPER
# # ─────────────────────────────────────────────────────────────

# _ml_service_instance: Optional[MLService] = None


# def get_ml_service() -> MLService:
#     """
#     Returns the singleton MLService.
#     Raises RuntimeError if init_ml_service() was never called.
#     """
#     global _ml_service_instance
#     if _ml_service_instance is None:
#         # Lazy init — will skip warm_up (embeddings built on first request)
#         print("[MLService] lazy initialisation …")
#         _ml_service_instance = _create_service_instance()
#     return _ml_service_instance


# def _create_service_instance() -> MLService:
#     """Creates the MLService and populates _story_meta as an empty list."""
#     svc = MLService()
#     svc._story_meta = []   # populated by warm_up() or first _retrieve() call
#     return svc


# def init_ml_service(db: Session) -> MLService:
#     """
#     Call this from main.py lifespan startup.
#     Loads models + builds/loads all embeddings eagerly.

#     Example in main.py:
#         from contextlib import asynccontextmanager
#         from app.services.ml_service import init_ml_service
#         from app.database import SessionLocal

#         @asynccontextmanager
#         async def lifespan(app: FastAPI):
#             db = SessionLocal()
#             try:
#                 init_ml_service(db)
#             finally:
#                 db.close()
#             yield

#         app = FastAPI(lifespan=lifespan)
#     """
#     global _ml_service_instance
#     svc = _create_service_instance()
#     # Build story_meta parallel to the embeddings
#     df = MLService._load_df(db)
#     svc._story_meta = df[["story_id", "title", "story", "keywords"]].to_dict("records")
#     # Build / load embeddings (uses svc._story_meta indirectly via df)
#     svc._vocab, svc._vocab_emb = svc._get_vocab_embeddings(df)
#     svc._story_emb, svc._story_ids = svc._get_story_embeddings(df)
#     _ml_service_instance = svc
#     print(f"[MLService] init complete — {len(svc._story_ids)} stories ready")
#     return svc