from pydantic_settings import BaseSettings
from typing import List
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    database_hostname: str
    database_username: str
    database_port: int
    database_name: str
    database_password: str

    # Security
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080

    # ML
    SENT_EMBED_MODEL: str = "all-MiniLM-L6-v2"
    PARAPHRASE_MODEL: str = "facebook/bart-large"
    EMBED_CACHE_PATH: str = "ml_models/cache/story_embeddings.pt"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
    ]

    class Config:
        env_file = ".env"
        extra = "ignore" 

@lru_cache()
def get_settings():
    return Settings()

# ✅ THIS IS IMPORTANT
settings = get_settings()
