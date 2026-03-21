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
    # PUBLIC: rebuild_embeddings
    # Called automatically after any story create / update / delete
    # so the chatbot can find newly added stories immediately.
    # ─────────────────────────────────────────────────────────
    def rebuild_embeddings(self, db: Session) -> None:
        print("[MLService] rebuilding embeddings after story change...")

        # delete stale cache files so _get_*_embeddings rebuilds fresh
        if os.path.exists(STORY_EMB_CACHE):
            os.remove(STORY_EMB_CACHE)
        if os.path.exists(VOCAB_EMB_CACHE):
            os.remove(VOCAB_EMB_CACHE)

        # reload everything from DB and recompute vectors
        df = self._load_df(db)
        self._story_meta                 = df[["story_id", "title", "story", "keywords"]].to_dict("records")
        self._vocab, self._vocab_emb     = self._get_vocab_embeddings(df)
        self._story_emb, self._story_ids = self._get_story_embeddings(df)

        # clear anchor cache so age-anchor scores are recomputed too
        self._anchor_emb_cache.clear()

        print(f"[MLService] rebuild complete — {len(self._story_ids)} stories indexed")

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
            "title":    s.entity      or "",
            "story":    s.story_text  or "",
            "keywords": s.keywords    or "",
            "virtue":   s.virtues     or "",
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
        inputs = self._tokenizer(
            prompt,
            return_tensors="pt",
            max_length=512,
            truncation=True,
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
        return self._tokenizer.decode(out[0], skip_special_tokens=True).strip()

    def _run_model_batch(self, prompts: list[str], max_new_tokens: int = 40) -> list[str]:
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
        if age == "adult":
            return story

        sentences = sent_tokenize(story)
        BATCH_SIZE = 4

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
    # STEP 4 — MORAL
    # ─────────────────────────────────────────────────────────
    def _generate_moral(self, story: str, virtue: str, age: str) -> str:
        sentences = sent_tokenize(story)

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

        prompt = (
            f"Story context: {context}\n\n"
            f"What does this story teach about {virtue_hint}? "
            f"Write one short universal lesson in one sentence.\n"
            f"Lesson:"
        )
        moral = self._run_model_single(prompt, max_new_tokens=50)

        if not moral or len(moral.split()) < 4:
            return _age_moral_suffix(virtue_hint, age)

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
                virtue             = virtue,
                age_group          = age_group,
                length_preference  = length,
                retrieved_story_id = story_id,
                generated_story    = adapted,
                moral              = moral,
                response_time_ms   = elapsed_ms,
            )
            db.add(conv)
            db.commit()
        except Exception as e:
            print(f"[MLService] ⚠️  failed to persist conversation: {e}")
            db.rollback()


# ─────────────────────────────────────────────────────────────
# SINGLETON management
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