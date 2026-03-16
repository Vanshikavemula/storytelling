# from fastapi import FastAPI
# from fastapi.middleware.cors import CORSMiddleware

# from app.config import get_settings
# from app.database import engine, Base
# from app.models import User, Story, ChatbotConversation
# from app.routes import auth, stories, chatbot

# settings = get_settings()

# app = FastAPI(title="StoryNest API", version="1.0.0")


# # ── CORS ──────────────────────────────────────────────────────
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )


# # ── ROUTERS ───────────────────────────────────────────────────
# app.include_router(auth.router)
# app.include_router(stories.router)
# app.include_router(chatbot.router)


# # ── HEALTH CHECK ──────────────────────────────────────────────
# @app.get("/health")
# async def health_check():
#     return {
#         "status": "healthy",
#         "database": "connected",
#         "api_version": "1.0.0"
#     }


# # ── STARTUP ───────────────────────────────────────────────────
# @app.on_event("startup")
# async def startup_event():
#     print("=" * 60)
#     print("🚀 StoryNest API Server Starting...")
#     print("=" * 60)

#     # Create DB tables
#     print("Creating tables...")
#     Base.metadata.create_all(bind=engine)
#     print("✅ Tables ready.")
#     print("Initialising ML service (loading SentenceTransformer + flan-t5-base)...")
#     try:
#         from app.services.ml_service import get_ml_service
#         get_ml_service()          # no db arg — singleton takes none
#         print("✅ ML service initialised.")
#     except Exception as e:
#         print(f"⚠️  ML service failed to initialise: {e}")
#         print("   The API will still start; ML will retry on first request.")

#     port = 8000
#     print(f"📚 Swagger docs : http://localhost:{port}/docs")
#     print("=" * 60)


# # ── SHUTDOWN ──────────────────────────────────────────────────
# @app.on_event("shutdown")
# async def shutdown_event():
#     print("\n👋 Shutting down StoryNest API Server...")

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
 
from app.database import SessionLocal
from app.services.ml_service import init_ml_service
from app.routes import chatbot   # your existing router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, Base
from app.models import User, Story, ChatbotConversation
from app.routes import auth, stories, chatbot
 
 
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Runs ONCE at startup — loads ML models + builds/loads embeddings.
    This replaces any @app.on_event("startup") you may already have.
    """
    print("[startup] loading ML service …")
    db = SessionLocal()
    try:
        init_ml_service(db)          # ← the only new line that matters
        print("[startup] ML service ready ✓")
    except Exception as e:
        print(f"[startup] ⚠️  ML service failed to load: {e}")
        # App still starts — first request will trigger lazy init
    finally:
        db.close()
    yield                            # app runs here
    # (optional teardown below yield)
    print("[shutdown] ML service shutting down")
 
 
app = FastAPI(
    title="Story API",
    lifespan=lifespan,               # ← pass lifespan here
)
 
@app.get("/health")
async def health_check():
    return {"status": "ok"}

# Keep your existing CORS / middleware setup unchanged
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],             # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
 
# Include routers (unchanged)
app.include_router(chatbot.router)
app.include_router(auth.router)
app.include_router(stories.router)