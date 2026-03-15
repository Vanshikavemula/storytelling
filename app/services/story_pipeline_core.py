"""
main_slm_safe.py  —  Story Retrieval + Age Adaptation Pipeline
==============================================================

PIPELINE (in order):
  1. RETRIEVE  — find the story that best matches virtue + age + length
  2. COMPRESS  — trim to the age-adjusted word target
  3. ADAPT     — child: simplify language; teen: lighten language; adult: keep as-is
  4. MORAL     — generate a grounded, age-appropriate moral

Age affects every stage:
  - Retrieval  : semantic age-anchor scoring + complexity scoring
  - Compression: word target scaled by age (child=60%, teen=82%, adult=100%)
  - Adaptation : child/teen -> sentence rewriting; adult -> no change
  - Moral      : two-step abstraction + age-appropriate rewrite
"""

import os
import torch
import nltk
import pandas as pd
import re
import numpy as np
from sentence_transformers import SentenceTransformer, util
from nltk.tokenize import sent_tokenize, word_tokenize
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

# ──────────────────────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────────────────────
DATA_PATH            = r"C:\Users\hp\OneDrive\Desktop\capstone\stories_with_virtues.csv"
STORY_EMB_CACHE      = "story_embeddings.pt"
VOCAB_EMB_CACHE      = "vocab_embeddings.pt"
RETRIEVAL_MODEL      = "all-MiniLM-L6-v2"
SIMPLIFICATION_MODEL = "google/flan-t5-base"

TARGET_WORDS = {"short": 180, "medium": 350, "long": 550}

AGE_LENGTH_MULTIPLIER = {"child": 0.60, "teen": 0.82, "adult": 1.00}

def get_target_words(length, age):
    """Age-adjusted word target.  child/medium=210w  adult/medium=350w."""
    return max(80, int(TARGET_WORDS[length] * AGE_LENGTH_MULTIPLIER.get(age, 1.0)))

AGE_SENTENCE_TARGET = {"child": 6, "teen": 10, "adult": None}

AGE_SEMANTIC_ANCHOR = {
    "child": "a gentle bedtime story for young children with animals, friends, and a happy ending",
    "teen":  "a story about growing up, school, friendship, identity, or personal challenges for teenagers",
    "adult": "a story about adult life, relationships, moral choices, work, or society",
}

# Exclusion anchors — stories semantically close to these are penalised for that age
AGE_EXCLUSION_ANCHOR = {
    "child": "war, violence, weapons, death, military, battle, enemies, killing, adult horror",
    "teen":  None,   # teens can handle most themes
    "adult": None,
}

AGE_COMPLEXITY_RANGE = {
    "child": (0.0,  0.45),
    "teen":  (0.20, 0.65),
    "adult": (0.30, 1.00),
}

SAFETY_CONFIG = {
    "min_similarity":  0.60,
    "min_word_overlap": 0.35,
    "max_length_ratio": 1.60,
}

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")

# ──────────────────────────────────────────────────────────────
# NLTK
# ──────────────────────────────────────────────────────────────
import nltk

try:
    nltk.data.find("tokenizers/punkt")
except LookupError:
    nltk.download("punkt")


# ──────────────────────────────────────────────────────────────
# DATASET
# ──────────────────────────────────────────────────────────────
def _clean_story_text(text):
    """
    Clean raw dataset text:
    1. Protect honorifics (Mr. Mrs. Dr. etc.) from being split as sentences
    2. Remove genuinely truncated sentence fragments (< 4 words, no verb)
    3. Remove sentences that are clearly incomplete (end mid-word via char count)
    """
    import re
    # Step 1: temporarily replace honorific periods so sent_tokenize won't split on them
    text = re.sub(r'\b(Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr)\.', r'\1<DOT>', text)

    # Step 2: find complete sentences
    sentences = re.findall(r'[^.!?]+[.!?]', text)
    if not sentences:
        # restore honorifics and return
        return text.replace('<DOT>', '.')

    # Step 3: restore honorifics and filter fragments
    cleaned = []
    for s in sentences:
        s = s.replace('<DOT>', '.').strip()
        if len(s.split()) >= 4:   # drop very short fragments
            cleaned.append(s)

    return " ".join(cleaned) if cleaned else text.replace('<DOT>', '.')


def load_dataset(db):

    from app.models.story import Story

    stories = db.query(Story).all()

    df = pd.DataFrame([{
        "story_id": s.story_id,
        "title": s.entity,
        "story": s.story_text,
        "virtue": s.virtues or "",
        "keywords": s.keywords or ""
    } for s in stories])

    df["story"] = df["story"].astype(str)

    return df


# ──────────────────────────────────────────────────────────────
# VOCAB + EMBEDDINGS
# ──────────────────────────────────────────────────────────────
def build_vocab_from_dataset(df):
    vocab = set()
    for col in ["virtue", "virtues", "moral", "theme", "lesson"]:
        if col in df.columns:
            for v in df[col].dropna():
                for w in str(v).lower().split():
                    w = re.sub(r"[^\w]", "", w)
                    if len(w) > 2:
                        vocab.add(w)
    for story in df["story"].head(100):
        for w in word_tokenize(str(story).lower()):
            if w.isalpha() and 3 <= len(w) <= 12:
                vocab.add(w)
    print(f"Vocabulary: {len(vocab)} words")
    return sorted(vocab)


def load_or_build_story_embeddings(df, embedder):
    if os.path.exists(STORY_EMB_CACHE):
        print("Loading cached story embeddings...")
        return torch.load(STORY_EMB_CACHE, map_location=device).to(device)
    print("Building story embeddings (first run only)...")
    emb = embedder.encode(df["story"].tolist(), convert_to_tensor=True,
                          show_progress_bar=True, device=device)
    torch.save(emb.cpu(), STORY_EMB_CACHE)
    return emb.to(device)


def load_or_build_vocab_embeddings(embedder, vocab):
    if os.path.exists(VOCAB_EMB_CACHE):
        print("Loading cached vocab embeddings...")
        return torch.load(VOCAB_EMB_CACHE, map_location=device).to(device)
    print("Building vocab embeddings...")
    emb = embedder.encode(vocab, convert_to_tensor=True, device=device)
    torch.save(emb.cpu(), VOCAB_EMB_CACHE)
    return emb.to(device)


# ──────────────────────────────────────────────────────────────
# RETRIEVAL HELPERS
# ──────────────────────────────────────────────────────────────
def semantic_synonyms(word, embedder, vocab, vocab_emb, topk=3):
    """
    Return at most 3 close synonyms with similarity >= 0.55.
    Low threshold (0.4) was returning unrelated words like 'academia'
    for 'truthful'. The virtue word itself must dominate the query.
    """
    if not word:
        return []
    w_emb = embedder.encode(word, convert_to_tensor=True, device=device)
    scores = util.cos_sim(w_emb, vocab_emb)[0]
    top = torch.topk(scores, k=min(topk * 10, len(vocab)))
    out = []
    for idx, sc in zip(top.indices.tolist(), top.values.tolist()):
        c = vocab[idx]
        # Raised threshold: 0.55 instead of 0.4
        if sc >= 0.55 and 4 <= len(c) <= 12 and c.isalpha() and c != word:
            out.append(c)
        if len(out) >= topk:
            break
    return out


def character_match_score(story, character_words):
    if not character_words:
        return 0.0
    sl = story.lower()
    return sum(1 for w in character_words if w in sl) / len(character_words)


def compute_text_complexity(story):
    """Returns 0-1; higher = harder text."""
    sentences = sent_tokenize(story)
    words     = [w for w in story.split() if w.isalpha()]
    if not sentences or not words:
        return 0.5
    avg_sent = len(words) / len(sentences)
    avg_word = sum(len(w) for w in words) / len(words)
    ttr      = len(set(w.lower() for w in words)) / len(words)
    return float(np.clip(
        0.5 * min(avg_sent / 30.0, 1.0)
        + 0.3 * min(max((avg_word - 3.5) / 4.0, 0.0), 1.0)
        + 0.2 * (1.0 - ttr),
        0.0, 1.0
    ))


_anchor_emb_cache = {}

def age_fit_score(story, embedder, age):
    """
    How well does this story suit the target age?
    55% thematic fit  (semantic similarity to age anchor)
    35% reading-level (text complexity in expected range)
    10% exclusion     (penalise stories with age-inappropriate themes)
    """
    if age not in _anchor_emb_cache:
        _anchor_emb_cache[age] = embedder.encode(
            AGE_SEMANTIC_ANCHOR[age], convert_to_tensor=True, device=device)

    story_emb    = embedder.encode(story[:600], convert_to_tensor=True, device=device)
    semantic_fit = float(util.cos_sim(story_emb, _anchor_emb_cache[age]))

    complexity = compute_text_complexity(story)
    lo, hi     = AGE_COMPLEXITY_RANGE[age]
    if lo <= complexity <= hi:
        complexity_fit = 1.0
    elif complexity < lo:
        complexity_fit = max(0.4, 1.0 - (lo - complexity) * 1.5)
    else:
        complexity_fit = max(0.0, 1.0 - (complexity - hi) * 2.0)

    # Exclusion penalty — penalise stories that match adult-only themes for children
    exclusion_penalty = 0.0
    excl_text = AGE_EXCLUSION_ANCHOR.get(age)
    if excl_text:
        excl_key = f"excl_{age}"
        if excl_key not in _anchor_emb_cache:
            _anchor_emb_cache[excl_key] = embedder.encode(
                excl_text, convert_to_tensor=True, device=device)
        excl_sim = float(util.cos_sim(story_emb, _anchor_emb_cache[excl_key]))
        # If story is semantically close to excluded themes, apply a multiplier penalty
        if excl_sim > 0.35:
            exclusion_penalty = (excl_sim - 0.35) * 2.0  # max ~0.3 penalty

    score = 0.55 * semantic_fit + 0.35 * complexity_fit
    score = score * max(0.1, 1.0 - exclusion_penalty)
    return score


# ──────────────────────────────────────────────────────────────
# STEP 1 — RETRIEVE
# ──────────────────────────────────────────────────────────────
def retrieve_story(df, story_emb, embedder, virtue, character,
                   vocab, vocab_emb, length, age):
    """
    Score every story on:
      A. Virtue/character semantic match  (base cosine score)
      B. Age-fit score                    (thematic + reading-level)
      C. Length-quality score             (how close to target word count?)
    All three multiply together so a story must satisfy all three.
    """
    query_terms = []
    if virtue:
        query_terms += semantic_synonyms(virtue, embedder, vocab, vocab_emb, topk=5)
        query_terms.append(virtue)
    if character:
        query_terms += character.lower().split()

    if not query_terms:
        row = df.iloc[0]
        return row["title"], row["story"], 0

    query  = " ".join(query_terms)
    print(f"  Search query: {query}")
    q_emb  = embedder.encode(query, convert_to_tensor=True, device=device)
    scores = util.cos_sim(q_emb, story_emb)[0].clone()

    target     = get_target_words(length, age)
    char_words = character.lower().split() if character else []

    print(f"  Scoring {len(df)} stories (age={age}, target={target}w)...")
    for i, story_text in enumerate(df["story"]):
        # B: age fit
        scores[i] *= age_fit_score(story_text, embedder, age)

        # C: length quality — prefer stories >= target (so compression has material)
        # Stories shorter than target are penalised: we can compress but not expand
        wc = len(story_text.split())
        if wc >= target:
            # Story is long enough to compress — mild penalty only if vastly over
            over = wc / target
            if   over > 5: scores[i] *= 0.5
            elif over > 3: scores[i] *= 0.8
            # else: score unchanged — ideal range
        else:
            # Story is shorter than target — penalise proportionally
            under = wc / target
            if   under < 0.30: scores[i] *= 0.20
            elif under < 0.50: scores[i] *= 0.40
            elif under < 0.70: scores[i] *= 0.65
            else:               scores[i] *= 0.85

        # Character boost
        if char_words:
            scores[i] += 0.25 * character_match_score(story_text, char_words)

    idx = int(torch.argmax(scores).item())
    row = df.iloc[idx]
    return row["title"], row["story"], idx


# ──────────────────────────────────────────────────────────────
# STEP 2 — COMPRESS
# ──────────────────────────────────────────────────────────────
def compress_story(story, embedder, target_words, age):
    """
    Select the most important sentences up to target_words.
    Always keeps first 2 (setup) and last 2 (resolution) sentences.
    Respects AGE_SENTENCE_TARGET as an additional sentence cap.
    """
    sentences = sent_tokenize(story)
    wc        = len(story.split())
    sent_cap  = AGE_SENTENCE_TARGET.get(age)

    already_short = wc <= target_words
    already_few   = sent_cap is None or len(sentences) <= sent_cap
    if already_short and already_few:
        return story
    if len(sentences) <= 4:
        return story

    sent_emb   = embedder.encode(sentences, convert_to_tensor=True, device=device)
    story_emb2 = embedder.encode(story,     convert_to_tensor=True, device=device)
    importance = util.cos_sim(sent_emb, story_emb2.unsqueeze(0)).squeeze()
    centrality = util.cos_sim(sent_emb, sent_emb).mean(dim=1)
    scores     = 0.6 * importance + 0.4 * centrality

    avg_sent_words = wc / len(sentences)
    n_by_words = max(4, int(target_words / avg_sent_words))
    n_by_age   = sent_cap if sent_cap else len(sentences)
    n_target   = min(n_by_words, n_by_age, len(sentences) - 1)
    n_target   = max(n_target, 4)

    must_keep = {0, 1, len(sentences) - 2, len(sentences) - 1}
    top_idx   = set(torch.topk(scores, k=min(n_target, len(sentences))).indices.tolist())
    selected  = sorted(top_idx | must_keep)
    return " ".join(sentences[i] for i in selected)


# ──────────────────────────────────────────────────────────────
# STEP 3 + 4 — STORY ADAPTER (simplification + moral)
# ──────────────────────────────────────────────────────────────
class StoryAdapter:
    """
    Rewrites story sentences for the target age and generates a moral.

    child  -> simplify vocabulary AND sentence structure
    teen   -> lighten vocabulary, keep sentence structure
    adult  -> return story unchanged
    """

    def __init__(self, model_name, embedder, device="cpu"):
        print(f"\nLoading adapter model: {model_name}")
        self.device    = device
        self.embedder  = embedder
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model     = AutoModelForSeq2SeqLM.from_pretrained(model_name)
        self.model.to(device)
        self.model.eval()
        self._hallucinations = 0
        print("Adapter model ready")

    # ── helpers ───────────────────────────────────────────────

    def _run_model(self, prompt, max_new_tokens=45, num_beams=5):
        inputs = self.tokenizer(
            prompt, return_tensors="pt", max_length=512, truncation=True
        ).to(self.device)
        with torch.no_grad():
            out = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                num_beams=num_beams,
                early_stopping=True,
                repetition_penalty=1.3,
                no_repeat_ngram_size=3,
            )
        return self.tokenizer.decode(out[0], skip_special_tokens=True).strip()

    def _clean_moral(self, text):
        if not text:
            return text
        for sent in sent_tokenize(text):
            if len(sent.split()) >= 5:
                sent = sent.strip()
                if sent[-1] not in ".!?":
                    sent += "."
                return sent[0].upper() + sent[1:]
        return text

    def _moral_fitness(self, text):
        concept = (
            "A valuable life lesson or moral principle. "
            "A character understands an important truth about kindness, "
            "honesty, courage, or how to treat others."
        )
        c_emb = self.embedder.encode(concept, convert_to_tensor=True, device=self.device)
        t_emb = self.embedder.encode(text,    convert_to_tensor=True, device=self.device)
        return float(util.cos_sim(c_emb, t_emb))

    # ── Step 3: adapt story ───────────────────────────────────

    def _prompt_for_age(self, sentence, age):
        if age == "child":
            return (
                f"Rewrite this sentence so a young child can understand it easily.\n"
                f"Use short simple words. Keep the same meaning. Do not add anything new.\n"
                f"Original: {sentence}\n"
                f"Simple version:"
            )
        else:  # teen
            return (
                f"Rewrite this sentence in simpler, clearer language for a teenager.\n"
                f"Keep all the facts. Do not add anything new.\n"
                f"Original: {sentence}\n"
                f"Clearer version:"
            )

    def _rewrite_sentence(self, sentence, age):
        rewritten = self._run_model(
            self._prompt_for_age(sentence, age),
            max_new_tokens=max(30, int(len(sentence.split()) * 1.4)),
            num_beams=4
        )

        orig_emb = self.embedder.encode(sentence,  convert_to_tensor=True, device=self.device)
        rew_emb  = self.embedder.encode(rewritten, convert_to_tensor=True, device=self.device)
        sim      = float(util.cos_sim(orig_emb, rew_emb))
        ratio    = len(rewritten.split()) / max(len(sentence.split()), 1)

        sw  = {"the","a","an","and","or","but","in","on","at","to","for","of","is","was","were"}
        ok  = {w.lower() for w in sentence.split()  if w.lower() not in sw}
        rk  = {w.lower() for w in rewritten.split() if w.lower() not in sw}
        overlap = len(ok & rk) / max(len(ok), 1)

        # Also reject if T5 over-shrank the sentence (lost too much content)
        min_ratio = 0.55  # rewrite must keep at least 55% of original word count
        if sim   < SAFETY_CONFIG["min_similarity"] or            ratio > SAFETY_CONFIG["max_length_ratio"] or            ratio < min_ratio or            overlap < SAFETY_CONFIG["min_word_overlap"]:
            self._hallucinations += 1
            return sentence
        return rewritten

    def adapt_story(self, story, age):
        """
        child/teen: rewrite every sentence for the target age.
        adult: return story unchanged.
        """
        if age == "adult":
            return story

        sentences = sent_tokenize(story)
        adapted   = []
        print(f"  Rewriting {len(sentences)} sentences for {age}...")
        for i, sent in enumerate(sentences):
            if len(sent.split()) < 4:
                adapted.append(sent)
            else:
                adapted.append(self._rewrite_sentence(sent, age))
            if (i + 1) % 5 == 0:
                print(f"    {i+1}/{len(sentences)} done")
        print(f"  Adaptation done (fallbacks used: {self._hallucinations})")
        return " ".join(adapted)

    # ── Step 4: generate moral ────────────────────────────────

    def _generate_moral(self, story, virtue, age):
        """
        Two-step abstraction:
        1. Find the seed sentence most relevant to the virtue.
        2. Ask T5 to generalise it into a universal principle.
           (T5 handles specific->abstract far better than story->moral)
        3. Validate: must have abstracted away from seed + still story-grounded.
        4. Age-adapt the final moral.
        """
        sentences = sent_tokenize(story)

        # Step 1: seed sentence
        query     = virtue if virtue else story[:120]
        q_emb     = self.embedder.encode(query, convert_to_tensor=True, device=self.device)
        best, best_sc = sentences[-1], -1.0
        for s in sentences:
            if len(s.split()) < 5:
                continue
            sc = float(util.cos_sim(
                q_emb, self.embedder.encode(s, convert_to_tensor=True, device=self.device)
            ))
            if sc > best_sc:
                best_sc, best = sc, s

        # If seed is the last sentence, use the preceding sentence for context
        # (avoids giving T5 just the resolution with nothing to abstract from)
        if best == sentences[-1] and len(sentences) >= 2:
            context = sentences[-2] + " " + best
        elif best != sentences[-1]:
            context = best + " " + sentences[-1]
        else:
            context = best

        # Step 2: generalise
        # Generate two candidates from different angles, pick the less echo-like one
        prompt_a = (
            f"Story context: {context}\n\n"
            f"What does this situation teach about how people should treat each other? "
            f"Write one universal lesson (not about these specific characters).\n"
            f"Lesson:"
        )
        virtue_hint = virtue if virtue else "doing the right thing"
        prompt_b = (
            f"Story context: {context}\n\n"
            f"What does this story teach about {virtue_hint}? "
            f"Write one sentence as a general principle for anyone.\n"
            f"Principle:"
        )
        raw_a = self._run_model(prompt_a, max_new_tokens=45, num_beams=5)
        raw_b = self._run_model(prompt_b, max_new_tokens=45, num_beams=4)

        # Pick whichever candidate is LESS similar to the seed sentence
        # (less similar = more abstracted away from plot)
        cand_a = self._clean_moral(raw_a)
        cand_b = self._clean_moral(raw_b)

        moral = None
        for cand in [cand_a, cand_b]:
            if cand and len(cand.split()) >= 6:
                moral = cand
                break
        if not moral:
            return None

        # Step 3: validate
        seed_emb  = self.embedder.encode(best,        convert_to_tensor=True, device=self.device)
        story_emb = self.embedder.encode(story[:600],  convert_to_tensor=True, device=self.device)
        m_emb     = self.embedder.encode(moral,        convert_to_tensor=True, device=self.device)

        if float(util.cos_sim(seed_emb,  m_emb)) >= 0.90: return None  # didn't abstract
        if float(util.cos_sim(story_emb, m_emb)) <  0.20: return None  # drifted from story
        if self._moral_fitness(moral)             <  0.25: return None  # not a moral

        # Step 4: age-adapt
        if age != "adult":
            age_desc = ("a young child using very simple short words"
                        if age == "child" else
                        "a teenager using clear relatable language")
            rewritten = self._clean_moral(self._run_model(
                f"Rewrite this lesson for {age_desc}. Same meaning. One sentence.\n"
                f"Original: {moral}\nRewritten:",
                max_new_tokens=40, num_beams=4
            ))
            if rewritten and len(rewritten.split()) >= 5:
                r_emb = self.embedder.encode(rewritten, convert_to_tensor=True, device=self.device)
                if float(util.cos_sim(m_emb, r_emb)) >= 0.65:
                    moral = rewritten

        return moral

    def _fallback_moral(self, story, virtue, age):
        ending   = " ".join(sent_tokenize(story)[-3:])
        age_note = {"child": "in simple words for a child",
                    "teen":  "in simple language for a teen",
                    "adult": "in one clear sentence"}.get(age, "in one sentence")
        raw   = self._run_model(
            f"What lesson does this story ending teach? "
            f"State the lesson {age_note}. Do not describe events.\n"
            f"Story ending: {ending}\nLesson:",
            max_new_tokens=35, num_beams=4
        )
        moral = self._clean_moral(raw)
        if moral and self._moral_fitness(moral) >= 0.32 and len(moral.split()) >= 6:
            return moral
        return _safe_moral(virtue, age)

    def generate_moral(self, story, virtue, age):
        print("  Generating moral...")
        moral = self._generate_moral(story, virtue, age)
        if moral:
            print(f"  Moral (abstraction): {moral}")
            return moral
        print("  Abstraction failed, using fallback...")
        moral = self._fallback_moral(story, virtue, age)
        print(f"  Moral (fallback): {moral}")
        return moral

    def get_stats(self):
        return {"hallucinations_prevented": self._hallucinations}


def _safe_moral(virtue, age):
    """
    Grammar-safe fallback moral. Handles:
    - gerund virtues: sharing, helping, caring, giving  -> "Sharing with others..."
    - noun virtues:   kindness, courage, honesty        -> "It is good to show kindness..."
    - no virtue given                                   -> age-appropriate generic
    """
    v = virtue.strip().lower() if virtue else ""
    if not v:
        return {"child": "Always be kind and share with others.",
                "teen":  "Our choices shape who we are.",
                "adult": "Character defines us."}.get(age, "Character defines us.")
    is_gerund = v.endswith("ing")
    if age == "child":
        if is_gerund:
            return f"{v.capitalize()} with others makes the world a happier place."
        else:
            return f"It is always good to show {v} to others."
    elif age == "teen":
        if is_gerund:
            return f"This story shows that {v} with others makes life better for everyone."
        else:
            return f"This story shows why {v} truly matters in life."
    else:
        return f"The value of {v} is at the heart of this story."


# ──────────────────────────────────────────────────────────────
# READABILITY
# ──────────────────────────────────────────────────────────────
def readability_score(text):
    words = text.split()
    sents = sent_tokenize(text)
    if not sents or not words:
        return 0.0
    return (len(words) / len(sents)) * 0.5 + (sum(len(w) for w in words) / len(words)) * 2


# ──────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    try:
        df = load_dataset(DATA_PATH)
        print(f"Dataset: {len(df)} stories")

        print(f"\nLoading retrieval model ({RETRIEVAL_MODEL})...")
        embedder = SentenceTransformer(RETRIEVAL_MODEL, device=device)
        adapter  = StoryAdapter(SIMPLIFICATION_MODEL, embedder, device=device)

        vocab     = build_vocab_from_dataset(df)
        vocab_emb = load_or_build_vocab_embeddings(embedder, vocab)
        story_emb = load_or_build_story_embeddings(df, embedder)

        print("\n" + "=" * 55)
        print("  STORY PIPELINE — enter your preferences")
        print("=" * 55)
        character = input("Character name/description (optional, Enter to skip): ").strip()
        virtue    = input("Virtue or theme (e.g. kindness, courage):             ").strip()
        age       = input("Age group  — child / teen / adult:                    ").strip().lower()
        length    = input("Length     — short / medium / long:                   ").strip().lower()

        if age    not in ["child", "teen", "adult"]: age    = "adult"
        if length not in ["short", "medium", "long"]: length = "medium"

        target_words = get_target_words(length, age)
        print(f"\nSettings: age={age}  length={length}  target={target_words} words")

        # 1. Retrieve
        print("\n[1/4] Retrieving story...")
        title, story, _ = retrieve_story(
            df, story_emb, embedder, virtue, character,
            vocab, vocab_emb, length, age
        )
        print(f"  Retrieved: '{title}'  ({len(story.split())} words)")

        # 2. Compress
        print("\n[2/4] Compressing to target length...")
        compressed = compress_story(story, embedder, target_words, age)
        print(f"  Compressed: {len(compressed.split())} words  "
              f"({len(sent_tokenize(compressed))} sentences)")

        # 3. Adapt
        print(f"\n[3/4] Adapting for {age}...")
        r_before = readability_score(compressed)
        adapted  = adapter.adapt_story(compressed, age)
        r_after  = readability_score(adapted)
        direction = "lower=simpler" if r_after < r_before else "unchanged"
        print(f"  Readability: {r_before:.1f} -> {r_after:.1f}  ({direction})")

        # 4. Moral
        print("\n[4/4] Generating moral...")
        moral_text  = adapter.generate_moral(adapted, virtue, age)
        moral_label = {"child": "What we learn", "teen": "The lesson",
                       "adult": "Moral"}.get(age, "Moral")

        # Output
        print("\n" + "=" * 55)
        print("  FINAL OUTPUT")
        print("=" * 55)
        print(f"\nTitle: {title}\n")
        print(adapted)
        print(f"\n{moral_label}: {moral_text}")
        print("\n" + "=" * 55)
        print(f"Words:          {len(adapted.split())}  (target: {target_words})")
        print(f"Sentences:      {len(sent_tokenize(adapted))}")
        print(f"Age group:      {age}")
        print(f"Length pref:    {length}")
        stats = adapter.get_stats()
        print(f"Hallucinations: {stats['hallucinations_prevented']}")

        if device == "cuda":
            torch.cuda.empty_cache()

    except Exception as e:
        import traceback
        print(f"\nError: {e}")
        traceback.print_exc()