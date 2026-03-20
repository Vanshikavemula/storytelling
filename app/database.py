# from sqlalchemy import create_engine
# from sqlalchemy.ext.declarative import declarative_base
# from sqlalchemy.orm import sessionmaker
# from app.config import get_settings

# settings = get_settings()

# engine = create_engine(
#     settings.DATABASE_URL,
#     pool_pre_ping=True,
#     pool_size=10,
#     max_overflow=20
# )

# SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base = declarative_base()

# # Dependency for FastAPI routes
# def get_db():
#     db = SessionLocal()
#     try:
#         yield db
#     finally:
#         db.close()


from typing import Annotated
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from fastapi import Depends, FastAPI, HTTPException, Query
from app.config import settings

# PostgreSQL Database Configuration 
POSTGRES_USER = settings.database_username
POSTGRES_PASSWORD = settings.database_password
POSTGRES_DB = settings.database_name
POSTGRES_HOST = settings.database_hostname  
POSTGRES_PORT = settings.database_port  


DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

print("Loaded DB config:")
print("HOST:", POSTGRES_HOST)
print("PORT:", POSTGRES_PORT)
print("USER:", POSTGRES_USER)
print("DB:", POSTGRES_DB)

def get_db():
    db= SessionLocal()
    try:
        yield db
    finally:
        db.close()

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False,autoflush=False,bind=engine)

Base = declarative_base()
Base.metadata.schema = "nlp_story"

