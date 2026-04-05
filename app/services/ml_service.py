from __future__ import annotations

# Silence TensorFlow/Keras noise BEFORE any other import
import os
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"   # stops oneDNN messages
os.environ["TF_CPP_MIN_LOG_LEVEL"]  = "3"   # 0=all  1=info  2=warnings  3=errors only

import warnings
import logging
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", message=".*sparse_softmax_cross_entropy.*")
warnings.filterwarnings("ignore", message=r".*tf\.losses.*")
logging.getLogger("tensorflow").setLevel(logging.ERROR)
logging.getLogger("absl").setLevel(logging.ERROR)

"""
ml_service.py  —  standalone, VS Code friendly
===============================================
Pipeline:  retrieve → compress → adapt → moral
Data:      database via SQLAlchemy Session
No CSV, no API, no database, no Flask/FastAPI required.

Run directly:
    python ml_service.py
"""

import time
import uuid
import re
import pandas as pd
import torch
import nltk

from typing import Optional
from sqlalchemy.orm import Session
from sentence_transformers import SentenceTransformer, util
from nltk.tokenize import sent_tokenize, word_tokenize
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

from app.models.story import Story, ChatbotConversation


# ══════════════════════════════════════════════════════════════
# CONFIG  ── every tunable value lives here, nothing buried below
# ══════════════════════════════════════════════════════════════

# ── Models ────────────────────────────────────────────────────
RETRIEVAL_MODEL      = "all-MiniLM-L6-v2"
SIMPLIFICATION_MODEL = "google/flan-t5-base"

# ── Paths ─────────────────────────────────────────────────────
BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
STORY_EMB_CACHE = os.path.join(BASE_DIR, "story_embeddings.pt")
VOCAB_EMB_CACHE = os.path.join(BASE_DIR, "vocab_embeddings.pt")

# ── Story length targets (words) ──────────────────────────────
TARGET_WORDS: dict[str, int] = {
    "short":  180,
    "medium": 350,
    "long":   550,
}

# ── Per-age adjustments ───────────────────────────────────────
AGE_LENGTH_MULTIPLIER: dict[str, float] = {
    "child": 0.60,
    "teen":  0.82,
    "adult": 1.00,
}
# Maximum number of sentences kept after compression (None = no cap)
AGE_SENTENCE_TARGET: dict[str, Optional[int]] = {
    "child": 6,
    "teen":  10,
    "adult": None,
}

# ── Retrieval: semantic anchors ───────────────────────────────
# These phrases describe the ideal story for each age group and
# are embedded and blended into the retrieval score so age-
# appropriate stories naturally rank higher.
AGE_SEMANTIC_ANCHOR: dict[str, str] = {
    "child": "a gentle bedtime story for young children with animals, friends, and a happy ending",
    "teen":  "a story about growing up, school, friendship, identity, or personal challenges for teenagers",
    "adult": "a story about adult life, relationships, moral choices, work, or society",
}

# Topics to actively penalise for the child age group
AGE_EXCLUSION_ANCHOR: dict[str, Optional[str]] = {
    "child": "war, violence, weapons, death, military, battle, enemies, killing, adult horror",
    "teen":  None,
    "adult": None,
}

# Word-count complexity range per age (story_words / 1000, capped at 1.0)
AGE_COMPLEXITY_RANGE: dict[str, tuple[float, float]] = {
    "child": (0.00, 0.45),
    "teen":  (0.20, 0.65),
    "adult": (0.30, 1.00),
}

# ── Retrieval score weights ────────────────────────────────────
# final_score = W_VIRTUE  * virtue_sim
#             + W_KEYWORD * keyword_sim      (from keywords column)
#             + W_VIRTUE_COL * virtue_col_sim (from virtues column)
#             + W_ANCHOR  * age_anchor_sim
#             - W_EXCL    * exclusion_sim     (child only)
#
# Both keyword and virtue columns contribute independently so the
# pipeline works correctly whether the DB has one, both, or neither.
W_VIRTUE     = 0.35   # user-supplied virtue / topic query
W_KEYWORD    = 0.20   # story's keywords column  (CS concepts, teaching topics)
W_VIRTUE_COL = 0.15   # story's virtues column   (moral themes)
W_ANCHOR     = 0.20   # age-appropriateness anchor
W_EXCL       = 0.10   # exclusion penalty  (child only)

RETRIEVAL_CANDIDATE_POOL    = 20    # top-N candidates to walk through complexity filter
COMPLEXITY_WORD_DENOMINATOR = 1000  # word count that maps to complexity = 1.0

# ── Compress step ─────────────────────────────────────────────
COMPRESS_IMPORTANCE_W  = 0.6   # sentence-to-story similarity weight
COMPRESS_CENTRALITY_W  = 0.4   # sentence-to-all-sentences similarity weight
COMPRESS_MIN_SENTENCES = 4     # never compress below this many sentences

# ── Adapt (rewrite) step ──────────────────────────────────────
ADAPT_MIN_WORDS        = 5     # skip sentences shorter than this (not worth rewriting)
ADAPT_BATCH_SIZE       = 4     # sentences per batched model call
ADAPT_TOKEN_MULTIPLIER = 1.4   # max_new_tokens = sentence_words × this
ADAPT_MIN_TOKENS       = 30    # floor for token budget
ADAPT_MAX_TOKENS       = 60    # ceiling for token budget
ADAPT_MIN_LENGTH_RATIO = 0.55  # rewrite must be ≥ this fraction of the original length

# ── Rewrite safety thresholds ─────────────────────────────────
SAFETY_CONFIG = {
    "min_similarity":   0.60,  # cosine sim between original and rewrite
    "min_word_overlap": 0.35,  # content-word overlap (stop-words excluded)
    "max_length_ratio": 1.60,  # rewrite must be ≤ 1.6× original length
}

# ── Moral generation ──────────────────────────────────────────
MORAL_MAX_TOKENS                  = 50    # token budget for the moral sentence
MORAL_MIN_WORDS                   = 4     # fall back to template if output is shorter
MORAL_COPY_THRESHOLD              = 0.92  # sim above this = parroting → use template
MORAL_CONTEXT_MIN_WORDS           = 5     # skip short sentences when picking context
MORAL_CONTEXT_LOOKAHEAD_MIN_SENTS = 2     # also include 2nd-to-last when best == last

# ── Model inference ───────────────────────────────────────────
MODEL_MAX_INPUT_LENGTH       = 512
MODEL_DEFAULT_MAX_NEW_TOKENS = 40
MODEL_REPETITION_PENALTY     = 1.2
MODEL_NO_REPEAT_NGRAM_SIZE   = 3
#####################
# ── Stop-words used for keyword overlap scoring ───────────────
_STOP_WORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of","is","was",
    "were","be","been","being","have","has","had","do","does","did","will","would",
    "shall","should","may","might","can","could","i","me","my","we","our","you",
    "your","he","she","it","they","them","their","this","that","these","those",
    "give","story","about","tell","write","create","get","make","show",
    "please","want","need","some","any","other","another","different","new",
    "more","else","one","two","three","four","five",
}
#########################

# ══════════════════════════════════════════════════════════════
# NLTK bootstrap  (downloads quietly on first run)
# ══════════════════════════════════════════════════════════════
try:
    nltk.data.find("tokenizers/punkt")
except LookupError:
    nltk.download("punkt")

# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════

def _get_target_words(length: str, age: str) -> int:
    return int(TARGET_WORDS.get(length, 350) * AGE_LENGTH_MULTIPLIER.get(age, 1.0))


def _age_moral_suffix(topic: str, age: str) -> str:
    """Template fallback moral when the model output is too short or too similar to context."""
    v = topic.lower().rstrip(".")
    is_gerund = v.endswith("ing")
    if age == "child":
        return (
            f"Always remember: {v} makes the world a better place!"
            if is_gerund
            else f"Always remember: being {v} makes the world a better place!"
        )
    if age == "teen":
        return (
            f"This story shows that {v} with others makes life better for everyone."
            if is_gerund
            else f"This story shows why {v} truly matters in life."
        )
    return f"The value of {v} is at the heart of this story."


def _safe_concat(*parts: str) -> str:
    """Join non-empty strings with a space — avoids double-spaces from empty columns."""
    return " ".join(p for p in parts if p and p.strip())

def _tokenize_query(text: str) -> set[str]:
    try:
        tokens = word_tokenize(text.lower())
    except Exception:
        tokens = re.findall(r"[a-z0-9]+", text.lower())
    return {t for t in tokens if t.isalnum() and t not in _STOP_WORDS and len(t) > 1}


def _partial_word_overlap(query_tokens: set[str], field_text: str) -> float:
    if not query_tokens or not field_text:
        return 0.0
    try:
        field_tokens = word_tokenize(field_text.lower())
    except Exception:
        field_tokens = re.findall(r"[a-z0-9]+", field_text.lower())

    field_tokens_set = {t for t in field_tokens if t.isalnum()}

    matched = 0
    for qt in query_tokens:
        for ft in field_tokens_set:
            if qt in ft or ft in qt:
                matched += 1
                break

    return matched / len(query_tokens)

_GREETING_TOKENS = {
    "hi", "hello", "hey", "hiya", "howdy", "sup", "yo", "greetings",
    "bye", "goodbye", "thanks", "thank", "ok", "okay", "yes", "no",
    "lol", "haha", "nice", "cool", "great", "wow", "hmm", "uh", "um",
}

def _is_story_query(text: str) -> bool:
    """
    Returns True only if the input looks like a genuine story/topic request.
    Rejects greetings, single-word gibberish, and inputs with no
    meaningful content tokens after stop-word removal.
    """
    if not text or not text.strip():
        return False

    tokens = re.findall(r"[a-z0-9]+", text.lower())

    # Reject pure greetings / social phrases
    if all(t in _GREETING_TOKENS for t in tokens):
        return False

    # Remove stop words AND greeting tokens, then check what's left
    meaningful = [
        t for t in tokens
        if t not in _STOP_WORDS
        and t not in _GREETING_TOKENS
        and len(t) > 1
    ]

    # Need at least one meaningful content word
    return len(meaningful) > 0


# ══════════════════════════════════════════════════════════════
# ML SERVICE
# ══════════════════════════════════════════════════════════════

class MLService:
    """
    Loads two models once, then exposes run_pipeline().

    Columns used from the DB (via Story model)
    ──────────────────────────────────────────
    story_id   — row identifier
    title      — mapped from: s.entity
    story      — mapped from: s.story_text
    keywords   — mapped from: s.keywords
    virtue     — mapped from: s.virtues

    Both `keywords` and `virtue` are used independently in retrieval
    so the pipeline works whether your DB has one, both, or neither.
    """

    def __init__(self) -> None:
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[MLService] device = {self._device}")

        print(f"[MLService] loading retrieval model  : {RETRIEVAL_MODEL}")
        self._embedder = SentenceTransformer(RETRIEVAL_MODEL, device=self._device)

        print(f"[MLService] loading simplification model : {SIMPLIFICATION_MODEL}")
        self._tokenizer = AutoTokenizer.from_pretrained(SIMPLIFICATION_MODEL)
        self._adapter   = AutoModelForSeq2SeqLM.from_pretrained(SIMPLIFICATION_MODEL)
        self._adapter.to(self._device)
        self._adapter.eval()

        # in-memory caches (populated by warm_up / init_ml_service)
        self._story_emb:        Optional[torch.Tensor]  = None
        self._story_ids:        list[int]               = []
        self._story_meta:       list[dict]              = []   # list of row dicts
        self._vocab:            list[str]               = []
        self._vocab_emb:        Optional[torch.Tensor]  = None
        self._anchor_emb_cache: dict[str, torch.Tensor] = {}

        # Story rotation: tracks which ranked position was last served
        # per session key so repeated queries cycle through all matching
        # stories rather than always returning the same one.
        self._last_served_index: dict[str, int] = {}

        self._hallucinations = 0   # reset each run_pipeline() call
        print("[MLService] ready ✓")

    # ──────────────────────────────────────────────────────────
    # warm_up / rebuild
    # ──────────────────────────────────────────────────────────

    def warm_up(self, db: Session) -> None:
        """Load DB and build/load embeddings.  Called lazily on first run_pipeline()."""
        print("[MLService] warming up from DB…")
        df = self._load_df(db)
        self._store_meta(df)
        print(f"[MLService] warm-up complete — {len(self._story_ids)} stories indexed")

    def rebuild_embeddings(self, db: Session) -> None:
        """Delete cached .pt files and rebuild from scratch.  Call after editing the DB."""
        print("[MLService] rebuilding embeddings…")
        for p in (STORY_EMB_CACHE, VOCAB_EMB_CACHE):
            if os.path.exists(p):
                os.remove(p)
        df = self._load_df(db)
        self._store_meta(df)
        self._anchor_emb_cache.clear()
        self._last_served_index.clear()
        print(f"[MLService] rebuild complete — {len(self._story_ids)} stories indexed")

    def _store_meta(self, df: pd.DataFrame) -> None:
        self._story_meta                 = df.to_dict("records")
        self._vocab, self._vocab_emb     = self._build_vocab_embeddings(df)
        self._story_emb, self._story_ids = self._build_story_embeddings(df)

    # ──────────────────────────────────────────────────────────
    # PUBLIC: run_pipeline
    # ──────────────────────────────────────────────────────────

    def run_pipeline(
        self,
        db:              Session,
        age_group:       str = "adult",
        genre_or_virtue: str="",
        story_length:    str           = "long",
        keywords:        Optional[str] = None,
        character:       Optional[str] = None,
        user_id:         Optional[int] = None,
        session_id:      Optional[str] = None,
    ) -> dict:

        self._hallucinations = 0
        t0 = time.time()

        age    = (age_group or "adult").lower().strip()
        length = (story_length or "long").lower().strip()
        virtue = (genre_or_virtue or "").strip()
        kw = (keywords or genre_or_virtue or "").strip()
        char   = (character or "").strip()

        if self._story_emb is None:
            self.warm_up(db)

        target_words = _get_target_words(length, age)

        # ── 1. Retrieve ────────────────────────────────────────
        print(f"[Pipeline] 1/4 retrieve  virtue={virtue!r} keywords={kw!r} age={age} length={length}")

        title, story_text, story_id = self._retrieve(virtue, kw, char, age)

        if not story_text:
            print("[Pipeline] ⚠️ No story found")

            sid = session_id or str(uuid.uuid4())
            msg = "No matching story found. Try a different topic."

            self._save_conversation(
                db=db,
                user_id=user_id,
                session_id=sid,
                user_query=virtue,
                virtue=virtue,
                keywords=kw,
                age_group=age,
                length=length,
                story_id=None,
                adapted=msg,
                moral="",
                elapsed_ms=int((time.time() - t0) * 1000),
            )

            return {
                "title": "Story Not Found",
                "story": msg,
                "moral": "",
                "moral_label": "N/A",
                "session_id": sid,
                "retrieved_story_id": None,
                "age_group": age,
                "story_length": length,
                "word_count": 0,
                "processing_time_ms": int((time.time() - t0) * 1000),
            }

        print(f"[Pipeline] → '{title}' ({len(story_text.split())} words)")

        # ── 2. Compress ────────────────────────────────────────
        print("[Pipeline] 2/4 compress")
        compressed = self._compress(story_text, target_words, age)

        # ── 3. Adapt ───────────────────────────────────────────
        print(f"[Pipeline] 3/4 adapt age={age}")
        adapted = self._adapt_story(compressed, age)

        # ── 4. Moral ───────────────────────────────────────────
        print("[Pipeline] 4/4 moral generation")

        topic = virtue or kw or "doing the right thing"
        moral = self._generate_moral(adapted, topic, age)

        moral_label = {
            "child": "What we learn",
            "teen": "The lesson",
            "adult": "Moral"
        }.get(age, "Moral")

        elapsed_ms = int((time.time() - t0) * 1000)

        print(f"[Pipeline] done in {elapsed_ms} ms")

        # ── 5. Persist ─────────────────────────────────────────
        sid = session_id or str(uuid.uuid4())

        self._save_conversation(
            db=db,
            user_id=user_id,
            session_id=sid,
            user_query=virtue,
            virtue=virtue,
            keywords=kw,
            age_group=age,
            length=length,
            story_id=story_id,
            adapted=adapted,
            moral=moral,
            elapsed_ms=elapsed_ms,
        )

        return {
            "title": title,
            "story": adapted,
            "moral": moral,
            "moral_label": moral_label,
            "session_id": sid,
            "retrieved_story_id": story_id,
            "age_group": age,
            "story_length": length,
            "word_count": len(adapted.split()),
            "processing_time_ms": elapsed_ms,
        }


    # ──────────────────────────────────────────────────────────
    # STEP 5 — PERSIST (DB)
    # ──────────────────────────────────────────────────────────
    def _save_conversation(
        self,
        db: Session,
        user_id: Optional[int],
        session_id: str,
        user_query: str,
        virtue: str,
        keywords: str,  
        age_group: str,
        length: str,
        story_id: Optional[int],
        adapted: str,
        moral: str,
        elapsed_ms: int,
    ) -> None:
        try:
            conv = ChatbotConversation(
                user_id=user_id,
                session_id=session_id,
                user_query=user_query,
                virtue=virtue,
                age_group=age_group,
                length_preference=length,
                retrieved_story_id=story_id,
                generated_story=adapted,
                moral=moral,
                response_time_ms=elapsed_ms,
            )

            db.add(conv)
            db.commit()
            db.refresh(conv)

        except Exception as e:
            print(f"[MLService] ⚠️ failed to persist conversation: {e}")
            db.rollback()


    # ──────────────────────────────────────────────────────────
    # DATA LOADING  
    # ──────────────────────────────────────────────────────────
    @staticmethod
    def _load_df(db: Session) -> pd.DataFrame:
        """
        Load from DB but apply SAME normalization logic as CSV version.
        """

        stories = db.query(Story).all()

        if not stories:
            raise ValueError(
                "[MLService] No stories found in the database.\n"
                "Please add stories via the admin panel or seed script."
            )

        # Step 1: Convert DB rows → raw dict (keep original column names)
        rows = []
        for s in stories:
            rows.append({
                "story_id": getattr(s, "story_id", None),
                "entity": getattr(s, "entity", ""),
                "story_text": getattr(s, "story_text", ""),
                "keywords": getattr(s, "keywords", ""),
                "virtues": getattr(s, "virtues", ""),
            })

        df = pd.DataFrame(rows)

        # Normalize column names like CSV version
        df.columns = df.columns.str.strip().str.lower()

        # SAME alias logic as CSV
        ALIASES: dict[str, list[str]] = {
            "story_id": ["story_id", "id", "index"],
            "title":    ["entity", "title", "name", "story_title"],
            "story":    ["story_text", "story", "text", "content"],
            "keywords": ["keywords", "keyword", "tags", "topic", "topics"],
            "virtue":   ["virtues", "virtue", "theme", "moral", "morals", "values"],
        }

        rename_map: dict[str, str] = {}
        for internal, candidates in ALIASES.items():
            for c in candidates:
                if c in df.columns and internal not in df.columns:
                    rename_map[c] = internal
                    break

        df = df.rename(columns=rename_map)

        # Auto-generate story_id if missing
        if "story_id" not in df.columns:
            df["story_id"] = range(1, len(df) + 1)

        # Fill missing columns (same as CSV)
        for col in ("title", "story", "keywords", "virtue"):
            if col not in df.columns:
                print(f"[MLService] ℹ️ column '{col}' not found in DB — using empty strings")
                df[col] = ""

        df = df.fillna("")

        df["story_id"] = (
            pd.to_numeric(df["story_id"], errors="coerce")
            .fillna(0)
            .astype(int)
        )
        if df.empty or df["story"].str.strip().eq("").all():
            raise ValueError(
                "[MLService] DB loaded but the 'story' column is empty.\n"
                "Check your Story model field names."
            )

        has_kw  = df["keywords"].str.strip().ne("").any()
        has_vir = df["virtue"].str.strip().ne("").any()

        print(
            f"[MLService] loaded {len(df)} stories  "
            f"| keywords column populated: {has_kw}  "
            f"| virtue column populated: {has_vir}"
        )

        return df[["story_id", "title", "story", "keywords", "virtue"]]

    # ──────────────────────────────────────────────────────────
    # EMBEDDINGS (disk-cached)
    # ──────────────────────────────────────────────────────────
    def _build_story_embeddings(self, df: pd.DataFrame):
        if os.path.exists(STORY_EMB_CACHE):
            try:
                print("[MLService] loading story embeddings from cache")
                cache = torch.load(STORY_EMB_CACHE, map_location=self._device, weights_only=False)
                emb = cache["embeddings"]
                ids = cache["story_ids"]
                if not isinstance(emb, torch.Tensor) or emb.dim() != 2:
                    raise ValueError("unexpected cache format")
                return emb, ids
            except Exception as e:
                print(f"[MLService] WARNING: story cache invalid ({e}) — deleting and rebuilding...")
                os.remove(STORY_EMB_CACHE)

        print("[MLService] building story embeddings (first run — may take ~1 min)…")

        texts = df.apply(
            lambda r: _safe_concat(
                r["title"], r["title"],    
                r["virtue"],
                r["keywords"],
                r["story"][:500]   
            ),
            axis=1,
        ).tolist()
        emb = self._embedder.encode(
            texts, convert_to_tensor=True, device=self._device, show_progress_bar=True
        )
        ids = df["story_id"].tolist()
        torch.save({"embeddings": emb, "story_ids": ids}, STORY_EMB_CACHE)
        return emb, ids

    def _build_vocab_embeddings(self, df: pd.DataFrame):
        if os.path.exists(VOCAB_EMB_CACHE):
            try:
                print("[MLService] loading vocab embeddings from cache")
                cache = torch.load(VOCAB_EMB_CACHE, map_location=self._device, weights_only=False)
                vocab = cache["vocab"]
                emb   = cache["embeddings"]
                if not isinstance(vocab, list) or not isinstance(emb, torch.Tensor) or emb.dim() != 2:
                    raise ValueError("unexpected cache format")
                return vocab, emb
            except Exception as e:
                print(f"[MLService] WARNING: vocab cache invalid ({e}) — deleting and rebuilding...")
                os.remove(VOCAB_EMB_CACHE)

        print("[MLService] building vocab embeddings (first run)…")
        # Collect unique terms from BOTH keywords and virtue columns
        terms: set[str] = set()
        for col in ("keywords", "virtue"):
            for cell in df[col].dropna():
                for tok in str(cell).replace(";", ",").split(","):
                    tok = tok.strip().lower()
                    if tok:
                        terms.add(tok)

        vocab = sorted(terms)
        if not vocab:
            return [], None
        emb = self._embedder.encode(
            vocab, convert_to_tensor=True, device=self._device, show_progress_bar=True
        )
        torch.save({"vocab": vocab, "embeddings": emb}, VOCAB_EMB_CACHE)
        return vocab, emb

    # ──────────────────────────────────────────────────────────
    # STEP 1 — RETRIEVE  (three-level priority retrieval)
    # ──────────────────────────────────────────────────────────

    def _embed(self, text: str) -> torch.Tensor:
        """Embed a short string, using the anchor cache to avoid redundant calls."""
        if text not in self._anchor_emb_cache:
            self._anchor_emb_cache[text] = self._embedder.encode(
                text, convert_to_tensor=True, device=self._device
            )
        return self._anchor_emb_cache[text]

    def _retrieve(self, virtue: str, keywords: str, character: str, age: str):
        query = _safe_concat(virtue, keywords, character).lower()
        if not query:
            return None, None, None
        if not _is_story_query(query):
            print(f"[Retrieve] non-story input rejected: {query!r}")
            return None, None, None

        query_tokens = _tokenize_query(query)

        # remove useless words
        STOP = {"any", "anything", "about", "give", "example", "story", "tell"}
        query_tokens = [t for t in query_tokens if t not in STOP]

        # ─────────────────────────────────────────
        # STEP 1: KEYWORD COLUMN PRIORITY 🔥
        # ─────────────────────────────────────────
        keyword_matches = []

        for i, meta in enumerate(self._story_meta):
            kw_text = (meta.get("keywords") or "").lower()

            if any(token in kw_text for token in query_tokens):
                keyword_matches.append(i)

        if keyword_matches:
            print(f"[Retrieve] keyword matches: {len(keyword_matches)}")
            return self._rotate_and_select(keyword_matches)

        # ─────────────────────────────────────────
        # STEP 2: TITLE + STORY MATCH
        # ─────────────────────────────────────────
        content_matches = []

        for i, meta in enumerate(self._story_meta):
            text = f"{meta['title']} {meta['story']}".lower()

            if any(token in text for token in query_tokens):
                content_matches.append(i)

        if content_matches:
            print(f"[Retrieve] content matches: {len(content_matches)}")
            return self._rotate_and_select(content_matches)

        # ─────────────────────────────────────────
        # STEP 3: PARTIAL OVERLAP
        # ─────────────────────────────────────────
        scored = []

        for i, meta in enumerate(self._story_meta):
            text = f"{meta['title']} {meta['keywords']} {meta['story']}".lower()
            score = sum(1 for t in query_tokens if t in text)

            if score > 0:
                scored.append((i, score))

        if scored:
            scored.sort(key=lambda x: x[1], reverse=True)
            indices = [i for i, _ in scored]
            print(f"[Retrieve] partial matches: {len(indices)}")
            return self._rotate_and_select(indices)

        # ─────────────────────────────────────────
        # STEP 4: EMBEDDING (STRICT)
        # ─────────────────────────────────────────
        q_scores = util.cos_sim(self._embed(query), self._story_emb).squeeze(0)

        THRESHOLD = 0.75  

        valid = [i.item() for i in q_scores.argsort(descending=True) if q_scores[i] > THRESHOLD]

        if valid:
            print(f"[Retrieve] embedding matches: {len(valid)}")
            return self._rotate_and_select(valid)

        # ❌ NO RANDOM STORY
        print("[Retrieve] no match found")
        return None, None, None

    # ──────────────────────────────────────────────────────────
    # STEP 2 — COMPRESS
    # ──────────────────────────────────────────────────────────

    def _compress(self, story: str, target_words: int, age: str) -> str:
        sentences = sent_tokenize(story)
        wc        = len(story.split())
        sent_cap  = AGE_SENTENCE_TARGET.get(age)

        # Already short enough — nothing to do
        if wc <= target_words and (sent_cap is None or len(sentences) <= sent_cap):
            return story
        # Too few sentences to compress meaningfully
        if len(sentences) <= COMPRESS_MIN_SENTENCES:
            return story

        sent_emb   = self._embedder.encode(sentences, convert_to_tensor=True, device=self._device)
        story_emb  = self._embedder.encode(story,     convert_to_tensor=True, device=self._device)
        importance = util.cos_sim(sent_emb, story_emb.unsqueeze(0)).squeeze()
        centrality = util.cos_sim(sent_emb, sent_emb).mean(dim=1)
        scores     = COMPRESS_IMPORTANCE_W * importance + COMPRESS_CENTRALITY_W * centrality

        avg_words  = wc / len(sentences)
        n_by_words = max(COMPRESS_MIN_SENTENCES, int(target_words / max(avg_words, 1)))
        n_by_age   = sent_cap if sent_cap else len(sentences)
        n_target   = max(min(n_by_words, n_by_age, len(sentences) - 1), COMPRESS_MIN_SENTENCES)

        # Always keep first two and last two sentences (opening + closing context)
        must_keep = {0, 1, len(sentences) - 2, len(sentences) - 1}
        top_idx   = set(torch.topk(scores, k=min(n_target, len(sentences))).indices.tolist())
        selected  = sorted(top_idx | must_keep)
        return " ".join(sentences[i] for i in selected)

    # ──────────────────────────────────────────────────────────
    # STEP 3 — ADAPT  (rewrite for age group)
    # ──────────────────────────────────────────────────────────

    def _run_model_single(self, prompt: str, max_new_tokens: int = MODEL_DEFAULT_MAX_NEW_TOKENS) -> str:
        inputs = self._tokenizer(
            prompt,
            return_tensors="pt",
            max_length=MODEL_MAX_INPUT_LENGTH,
            truncation=True,
        ).to(self._device)
        with torch.inference_mode():
            out = self._adapter.generate(
                **inputs,
                max_new_tokens       = max_new_tokens,
                num_beams            = 1,           # greedy — faster
                do_sample            = False,
                repetition_penalty   = MODEL_REPETITION_PENALTY,
                no_repeat_ngram_size = MODEL_NO_REPEAT_NGRAM_SIZE,
            )
        return self._tokenizer.decode(out[0], skip_special_tokens=True).strip()

    def _run_model_batch(self, prompts: list[str], max_new_tokens: int = MODEL_DEFAULT_MAX_NEW_TOKENS) -> list[str]:
        try:
            inputs = self._tokenizer(
                prompts,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=MODEL_MAX_INPUT_LENGTH,
            ).to(self._device)
            with torch.inference_mode():
                out = self._adapter.generate(
                    **inputs,
                    max_new_tokens       = max_new_tokens,
                    num_beams            = 1,
                    do_sample            = False,
                    repetition_penalty   = MODEL_REPETITION_PENALTY,
                    no_repeat_ngram_size = MODEL_NO_REPEAT_NGRAM_SIZE,
                )
            return [self._tokenizer.decode(o, skip_special_tokens=True).strip() for o in out]
        except RuntimeError as e:
            print(f"[MLService] ⚠️  batch failed ({e}), falling back to single mode")
            return [self._run_model_single(p, max_new_tokens) for p in prompts]

    def _build_adapt_prompt(self, sentence: str, age: str) -> str:
        """
        Build an age-appropriate rewriting prompt.
        child  → very simple vocabulary, short words
        teen   → clearer and more direct, but not dumbed down
        adult  → never called (adults get the original text)
        """
        if age == "child":
            return (
                "Rewrite this sentence so a young child can understand it easily. "
                "Use short, simple words. Keep the same meaning. Do not add anything new.\n"
                f"Original: {sentence}\nSimple version:"
            )
        # teen
        return (
            "Rewrite this sentence in simpler, clearer language suitable for a teenager. "
            "Keep all the facts. Do not add anything new.\n"
            f"Original: {sentence}\nClearer version:"
        )

    def _is_safe_rewrite(self, original: str, rewritten: str) -> bool:
        """
        Accept the rewrite only if it is semantically close to the original,
        not suspiciously short or bloated, and shares enough content words.
        """
        orig_emb = self._embedder.encode(original,  convert_to_tensor=True, device=self._device)
        rew_emb  = self._embedder.encode(rewritten, convert_to_tensor=True, device=self._device)
        sim      = float(util.cos_sim(orig_emb, rew_emb))
        ratio    = len(rewritten.split()) / max(len(original.split()), 1)
        stop     = {"the", "a", "an", "and", "or", "but", "in", "on", "at",
                    "to", "for", "of", "is", "was", "were", "it", "he", "she", "they"}
        ok       = {w.lower() for w in original.split()  if w.lower() not in stop}
        rk       = {w.lower() for w in rewritten.split() if w.lower() not in stop}
        overlap  = len(ok & rk) / max(len(ok), 1)
        return (
            sim     >= SAFETY_CONFIG["min_similarity"]   and
            ratio   <= SAFETY_CONFIG["max_length_ratio"] and
            ratio   >= ADAPT_MIN_LENGTH_RATIO            and
            overlap >= SAFETY_CONFIG["min_word_overlap"]
        )

    def _adapt_story(self, story: str, age: str) -> str:
        """
        Rewrite each sentence for the target age group.
        Adults receive the story unchanged.
        Sentences shorter than ADAPT_MIN_WORDS are left as-is (not worth rewriting).
        """
        if age == "adult":
            return story

        sentences = sent_tokenize(story)
        to_rewrite = [i for i, s in enumerate(sentences) if len(s.split()) >= ADAPT_MIN_WORDS]
        result     = list(sentences)

        print(f"  Rewriting {len(to_rewrite)}/{len(sentences)} sentences for '{age}'…")

        for start in range(0, len(to_rewrite), ADAPT_BATCH_SIZE):
            batch   = to_rewrite[start: start + ADAPT_BATCH_SIZE]
            prompts = [self._build_adapt_prompt(sentences[i], age) for i in batch]
            max_tok = max(
                max(ADAPT_MIN_TOKENS, int(len(sentences[i].split()) * ADAPT_TOKEN_MULTIPLIER))
                for i in batch
            )
            rewrites = self._run_model_batch(prompts, max_new_tokens=min(max_tok, ADAPT_MAX_TOKENS))

            for idx, rewrite in zip(batch, rewrites):
                if self._is_safe_rewrite(sentences[idx], rewrite):
                    result[idx] = rewrite
                else:
                    self._hallucinations += 1

        print(f"  Adapt done  (unsafe rewrites discarded: {self._hallucinations})")
        return " ".join(result)

    # ──────────────────────────────────────────────────────────
    # STEP 4 — MORAL
    # ──────────────────────────────────────────────────────────

    def _generate_moral(self, story: str, topic: str, age: str) -> str:
        """
        Find the sentence most relevant to `topic`, use it as context,
        then prompt the model to write a one-sentence lesson.
        Falls back to a template if the output is too short or too similar
        to the context (i.e. the model just parroted it back).
        """
        sentences = sent_tokenize(story)
        q_emb     = self._embedder.encode(topic if topic else story[:120],
                                           convert_to_tensor=True, device=self._device)

        best, best_sc = sentences[-1], -1.0
        for s in sentences:
            if len(s.split()) < MORAL_CONTEXT_MIN_WORDS:
                continue
            sc = float(util.cos_sim(
                q_emb,
                self._embedder.encode(s, convert_to_tensor=True, device=self._device)
            ))
            if sc > best_sc:
                best_sc, best = sc, s

        # Include the preceding sentence for richer context when best is the last sentence
        context = best
        if best == sentences[-1] and len(sentences) >= MORAL_CONTEXT_LOOKAHEAD_MIN_SENTS:
            context = sentences[-2] + " " + best

        prompt = (
            f"Story context: {context}\n\n"
            f"What does this story teach about {topic}? "
            f"Write one short universal lesson in one sentence.\n"
            f"Lesson:"
        )
        moral = self._run_model_single(prompt, max_new_tokens=MORAL_MAX_TOKENS)

        if not moral or len(moral.split()) < MORAL_MIN_WORDS:
            return _age_moral_suffix(topic, age)

        m_emb = self._embedder.encode(moral,   convert_to_tensor=True, device=self._device)
        c_emb = self._embedder.encode(context, convert_to_tensor=True, device=self._device)
        if float(util.cos_sim(m_emb, c_emb)) > MORAL_COPY_THRESHOLD:
            return _age_moral_suffix(topic, age)

        return moral

    def _rotate_and_select(self, indices: list[int]):
        if not indices:
            return None, None, None

        key = tuple(sorted(indices)) 

        last = self._last_served_index.get(key, -1)
        next_idx = (last + 1) % len(indices)

        self._last_served_index[key] = next_idx

        idx = indices[next_idx]
        meta = self._story_meta[idx]

        return meta["title"], meta["story"], self._story_ids[idx]



# ══════════════════════════════════════════════════════════════
# SINGLETON
# ══════════════════════════════════════════════════════════════

_instance: Optional[MLService] = None


def _create_service_instance() -> MLService:
    svc = MLService()
    return svc

def get_ml_service() -> MLService:
    global _instance
    if _instance is None:
        raise RuntimeError("MLService not initialized. Call init_ml_service() first.")
    return _instance

def init_ml_service(db: Session) -> MLService:
    global _instance
    if _instance is not None:
        return _instance
    svc = MLService()
    df = MLService._load_df(db)
    svc._story_meta = df[
        ["story_id", "title", "story", "keywords", "virtue"]
    ].to_dict("records")
    svc._story_emb, svc._story_ids = svc._build_story_embeddings(df)
    svc._vocab, svc._vocab_emb     = svc._build_vocab_embeddings(df)
    _instance = svc
    print(f"[MLService] init complete — {len(svc._story_ids)} stories ready")

    return svc