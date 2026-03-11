# import torch
# import nltk
# import pandas as pd
# import re
# from sentence_transformers import SentenceTransformer, util
# from nltk.tokenize import sent_tokenize

# from app.database import SessionLocal
# from app.models.story import Story

# # ---------------- CONFIG ----------------
# RETRIEVAL_MODEL = "all-MiniLM-L6-v2"

# TARGET_WORDS = {
#     "short": 250,
#     "medium": 450,
#     "long": 650
# }

# device = "cuda" if torch.cuda.is_available() else "cpu"
# print(f"Using device: {device}")

# # ---------------- NLTK ----------------
# for resource in ["punkt"]:
#     try:
#         nltk.data.find(f"tokenizers/{resource}")
#     except LookupError:
#         nltk.download(resource, quiet=True)

# # ---------------- LOAD STORIES FROM DATABASE ----------------
# def load_dataset_from_db():
#     db = SessionLocal()

#     try:
#         stories = db.query(Story).all()

#         if not stories:
#             raise ValueError("No stories found in database")

#         df = pd.DataFrame([{
#             "story_id": s.story_id,
#             "title": s.entity,
#             "story": s.story_text,
#             "virtues": s.virtues or "",
#             "keywords": s.keywords or ""
#         } for s in stories])

#         df["story"] = df["story"].astype(str)

#         print(f"✅ Loaded {len(df)} stories from PostgreSQL")

#         return df

#     finally:
#         db.close()

# # ---------------- BUILD VOCAB ----------------
# def build_vocab_from_dataset(df):
#     vocab = set()

#     for col in ["virtues", "keywords"]:
#         for v in df[col]:
#             for w in str(v).split():
#                 cleaned = w.lower().strip()
#                 if cleaned:
#                     vocab.add(cleaned)

#     seeds = [
#         "kind", "honesty", "courage", "patience",
#         "compassion", "truth", "respect", "friendship"
#     ]

#     vocab.update(seeds)
#     return sorted(list(vocab))

# # ---------------- SYNONYM EXPANSION ----------------
# def semantic_synonyms(word, embedder, vocab, vocab_emb, topk=5):
#     if not word:
#         return []

#     w_emb = embedder.encode(word, convert_to_tensor=True, device=device)
#     scores = util.cos_sim(w_emb, vocab_emb)[0]

#     k = min(topk, len(vocab))
#     top = torch.topk(scores, k=k)

#     return [vocab[i] for i in top.indices.cpu().tolist()]

# # ---------------- RETRIEVAL ----------------
# def retrieve_story(df, story_embeddings, embedder, virtue, character, vocab, vocab_emb):
#     query_terms = []

#     if virtue:
#         query_terms.extend(semantic_synonyms(virtue, embedder, vocab, vocab_emb))

#     if character:
#         query_terms.extend(character.lower().split())

#     if not query_terms:
#         idx = 0
#     else:
#         query = " ".join(query_terms)
#         q_emb = embedder.encode(query, convert_to_tensor=True, device=device)

#         scores = util.cos_sim(q_emb, story_embeddings)[0]
#         idx = int(torch.argmax(scores))

#     return df.iloc[idx]

# # ---------------- ML COMPRESSION (FIXED) ----------------
# def compress_with_embeddings(story, embedder, length):

#     target_words = TARGET_WORDS[length]
#     sentences = sent_tokenize(story)

#     if len(sentences) <= 2:
#         return story

#     sent_embeddings = embedder.encode(sentences, convert_to_tensor=True, device=device)
#     story_embedding = embedder.encode(story, convert_to_tensor=True, device=device)

#     importance_scores = util.cos_sim(
#         sent_embeddings,
#         story_embedding.unsqueeze(0)
#     ).squeeze()

#     centrality_scores = util.cos_sim(sent_embeddings, sent_embeddings).mean(dim=1)

#     combined_scores = 0.6 * importance_scores + 0.4 * centrality_scores

#     # ⭐ Ratio-based compression (key fix)
#     compression_ratio = min(1.0, target_words / len(story.split()))
#     target_sentences = int(len(sentences) * compression_ratio)

#     target_sentences = max(2, min(target_sentences, len(sentences)))

#     must_include = {0, len(sentences) - 1}

#     top_indices = torch.topk(combined_scores, k=target_sentences).indices
#     selected = set(top_indices.cpu().tolist()) | must_include

#     ordered = [sentences[i] for i in sorted(selected)]

#     compressed = " ".join(ordered)

#     # Optional hard cap (keeps demo stable)
#     return " ".join(compressed.split()[:target_words])

# # ---------------- MORAL EXTRACTION ----------------
# def extract_moral_from_story(story, virtue, embedder):

#     sentences = sent_tokenize(story)

#     if not sentences:
#         return "This story teaches us to be good."

#     candidates = sentences[-3:] if len(sentences) >= 3 else sentences

#     if not virtue:
#         moral_sentence = candidates[-1]
#     else:
#         v_emb = embedder.encode(virtue, convert_to_tensor=True, device=device)
#         c_emb = embedder.encode(candidates, convert_to_tensor=True, device=device)

#         scores = util.cos_sim(v_emb, c_emb)[0]
#         moral_sentence = candidates[int(torch.argmax(scores))]

#     moral_sentence = re.sub(r'\b[A-Z][a-z]+\b', 'they', moral_sentence)

#     return moral_sentence.strip()

# # ---------------- MAIN ----------------
# if __name__ == "__main__":

#     df = load_dataset_from_db()

#     print(f"\n🔄 Loading model: {RETRIEVAL_MODEL}")
#     embedder = SentenceTransformer(RETRIEVAL_MODEL, device=device)

#     print("🔄 Computing embeddings...")
#     story_embeddings = embedder.encode(
#         df["story"].tolist(),
#         convert_to_tensor=True,
#         device=device
#     )

#     vocab = build_vocab_from_dataset(df)
#     vocab_emb = embedder.encode(vocab, convert_to_tensor=True, device=device)

#     character = input("Enter character (optional): ").strip()
#     virtue = input("Enter virtue: ").strip()
#     length = input("Length (short/medium/long): ").strip().lower()

#     row = retrieve_story(
#         df,
#         story_embeddings,
#         embedder,
#         virtue,
#         character,
#         vocab,
#         vocab_emb
#     )

#     compressed = compress_with_embeddings(row["story"], embedder, length)
#     moral = extract_moral_from_story(compressed, virtue, embedder)

#     print("\n==============================")
#     print("FINAL OUTPUT")
#     print("==============================\n")

#     print(f"Title: {row['title']}\n")
#     print(compressed)
#     print(f"\nMoral: {moral}")

import torch
import nltk
import re
from sentence_transformers import util
from nltk.tokenize import sent_tokenize

TARGET_WORDS = {
    "short": 250,
    "medium": 450,
    "long": 650
}

device = "cuda" if torch.cuda.is_available() else "cpu"

# ---------------- NLTK ----------------
for resource in ["punkt"]:
    try:
        nltk.data.find(f"tokenizers/{resource}")
    except LookupError:
        nltk.download(resource, quiet=True)

# ---------------- SEMANTIC SYNONYMS ----------------
def semantic_synonyms(word, embedder, vocab, vocab_emb, topk=5):

    if not word:
        return []

    w_emb = embedder.encode(word, convert_to_tensor=True, device=device)
    scores = util.cos_sim(w_emb, vocab_emb)[0]

    k = min(topk, len(vocab))
    top = torch.topk(scores, k=k)

    return [vocab[i] for i in top.indices.cpu().tolist()]

# ---------------- CHARACTER MATCH ----------------
def character_match_score(story, character_words):

    if not character_words:
        return 0.0

    story_lower = story.lower()
    matches = sum(1 for w in character_words if w in story_lower)

    return matches / len(character_words)

# ---------------- STORY QUALITY ----------------
def assess_story_quality(story, length_preference):

    word_count = len(story.split())
    target = TARGET_WORDS[length_preference]

    compression_ratio = target / word_count if word_count > target else 1.0

    quality_score = 1.0

    if compression_ratio < 0.3:
        quality_score = 0.3
    elif compression_ratio < 0.5:
        quality_score = 0.6
    elif compression_ratio < 0.7:
        quality_score = 0.8

    return quality_score

# ---------------- COMPRESSION ----------------
def compress_with_embeddings(story, embedder, length):

    target_words = TARGET_WORDS[length]
    sentences = sent_tokenize(story)

    if len(sentences) <= 3:
        return story

    sent_embeddings = embedder.encode(sentences, convert_to_tensor=True, device=device)

    story_embedding = embedder.encode(story, convert_to_tensor=True, device=device)

    importance_scores = util.cos_sim(
        sent_embeddings,
        story_embedding.unsqueeze(0)
    ).squeeze()

    centrality_scores = util.cos_sim(sent_embeddings, sent_embeddings).mean(dim=1)

    combined_scores = 0.6 * importance_scores + 0.4 * centrality_scores

    current_words = len(story.split())
    avg_words_per_sentence = current_words / len(sentences)

    target_sentences = int(target_words / avg_words_per_sentence)
    target_sentences = max(5, min(target_sentences, len(sentences)))

    must_include = {0, len(sentences) - 1}

    top_indices = torch.topk(
        combined_scores,
        k=min(target_sentences, len(sentences))
    ).indices

    selected_indices = set(top_indices.cpu().tolist()) | must_include

    selected_sentences = [sentences[i] for i in sorted(selected_indices)]

    compressed = " ".join(selected_sentences)

    # ⭐ Safe trimming (no mid-sentence cuts)
    words = compressed.split()

    if len(words) <= target_words:
        return compressed

    trimmed = " ".join(words[:target_words])

    last_punct = max(trimmed.rfind("."), trimmed.rfind("!"), trimmed.rfind("?"))

    if last_punct != -1:
        trimmed = trimmed[:last_punct + 1]

    return trimmed

# ---------------- MORAL EXTRACTION ----------------
def extract_moral_from_story(story, virtue, embedder):

    sentences = sent_tokenize(story)

    if not sentences:
        return "This story teaches us to be good."

    candidate_sentences = sentences[-3:] if len(sentences) >= 3 else sentences

    if not virtue:
        moral_sentence = candidate_sentences[-1]
    else:
        virtue_embedding = embedder.encode(virtue, convert_to_tensor=True, device=device)

        candidate_embeddings = embedder.encode(
            candidate_sentences,
            convert_to_tensor=True,
            device=device
        )

        similarities = util.cos_sim(virtue_embedding, candidate_embeddings)[0]

        moral_sentence = candidate_sentences[int(torch.argmax(similarities))]

    moral_sentence = moral_sentence.strip()

    # ⭐ Much safer cleanup (does NOT destroy sentence)
    moral_sentence = re.sub(r'\b([A-Z][a-z]{2,})\b', 'the', moral_sentence)
    # moral_sentence = re.sub(r'\bthey was\b', 'they were', moral_sentence)

    return moral_sentence