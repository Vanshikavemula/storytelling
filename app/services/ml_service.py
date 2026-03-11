import time
import torch
import pandas as pd
from sentence_transformers import SentenceTransformer, util
from sqlalchemy.orm import Session

from app.models.story import Story, ChatbotConversation
from app.services.model_pipeline import (
    semantic_synonyms,
    character_match_score,
    assess_story_quality,
    compress_with_embeddings,
    extract_moral_from_story
)

device = "cuda" if torch.cuda.is_available() else "cpu"


# Detect technical / programming queries
TECH_TERMS = [
    "swap", "variables", "python", "program",
    "list", "sets", "dictionary", "algorithm"
]

def is_technical_query(text: str) -> bool:
    if not text:
        return False
    text = text.lower()
    return any(term in text for term in TECH_TERMS)


class MLStoryService:

    def __init__(self):
        self.embedder = SentenceTransformer("all-MiniLM-L6-v2", device=device)

    def load_stories_from_db(self, db: Session):

        stories = db.query(Story).all()

        if not stories:
            raise ValueError("No stories found in DB")

        df = pd.DataFrame([{
            "story_id": s.story_id,
            "title": s.entity,
            "story": s.story_text,
            "virtues": s.virtues or "",
            "keywords": s.keywords or ""
        } for s in stories])

        df["story"] = df["story"].astype(str)

        return df

    def build_vocab(self, df):

        vocab = set()

        for col in ["virtues", "keywords"]:
            for v in df[col]:
                for w in str(v).split():
                    cleaned = w.lower().strip()
                    if cleaned:
                        vocab.add(cleaned)

        seeds = ["kindness", "honesty", "courage", "patience", "respect"]
        vocab.update(seeds)

        vocab = sorted(vocab)

        vocab_emb = self.embedder.encode(
            vocab,
            convert_to_tensor=True,
            device=device
        )

        return vocab, vocab_emb

    def retrieve_story(self, df, story_emb, virtue, character, vocab, vocab_emb, length):

        query_terms = []

        if virtue:
            if is_technical_query(virtue):
                query_terms.append(virtue) 
            else:
                query_terms.extend(
                    semantic_synonyms(virtue, self.embedder, vocab, vocab_emb)
                )

        character_words = []

        if character:
            character_words = character.lower().split()
            query_terms.extend(character_words)

        if not query_terms:
            idx = 0
        else:
            query = " ".join(query_terms)

            q_emb = self.embedder.encode(
                query,
                convert_to_tensor=True,
                device=device
            )

            scores = util.cos_sim(q_emb, story_emb)[0].clone()

            if character_words:
                for i, story in enumerate(df["story"]):
                    scores[i] += 0.30 * character_match_score(story, character_words)

            for i, story in enumerate(df["story"]):
                scores[i] *= assess_story_quality(story, length)

            idx = int(torch.argmax(scores))

        return df.iloc[idx]

    def run_pipeline(self, db: Session, age_group, genre_or_virtue,
                     story_length, other_notes, user_id, session_id):

        start = time.time()

        df = self.load_stories_from_db(db)

        combined_corpus = (
            df["title"].fillna("") + " " +
            df["keywords"].fillna("") + " " +
            df["story"].fillna("")
        )

        story_emb = self.embedder.encode(
            combined_corpus.tolist(),
            convert_to_tensor=True,
            device=device
        )

        vocab, vocab_emb = self.build_vocab(df)

        row = self.retrieve_story(
            df,
            story_emb,
            genre_or_virtue,
            other_notes,
            vocab,
            vocab_emb,
            story_length
        )

        compressed = compress_with_embeddings(
            row["story"],
            self.embedder,
            story_length
        )

        moral = extract_moral_from_story(
            compressed,
            genre_or_virtue,
            self.embedder
        )

        processing_time = int((time.time() - start) * 1000)

        convo = ChatbotConversation(
            user_id=user_id,
            session_id=session_id,
            user_query=genre_or_virtue,
            virtue=genre_or_virtue,
            age_group=age_group,
            length_preference=story_length,
            retrieved_story_id=int(row["story_id"]),
            generated_story=compressed,
            moral=moral,
            response_time_ms=processing_time
        )

        db.add(convo)
        db.commit()

        return {
            "title": row["title"],
            "story": compressed,
            "moral": moral,
            "retrieved_story_id": int(row["story_id"]),
            "processing_time_ms": processing_time
        }


_ml_service = None

def get_ml_service():
    global _ml_service
    if _ml_service is None:
        _ml_service = MLStoryService()
    return _ml_service