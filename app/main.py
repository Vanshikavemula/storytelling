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
from fastapi import Request
from fastapi.responses import JSONResponse

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
 
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print("UNHANDLED ERROR:", repr(exc))
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"}
    ) 
 
@app.get("/health")
async def health_check():
    return {"status": "ok"}

# Keep your existing CORS / middleware setup unchanged
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173",
    "http://localhost:3000",
    "https://storytelling-zeta.vercel.app"],             # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok"}
 
# Include routers (unchanged)
app.include_router(chatbot.router)
app.include_router(auth.router)
app.include_router(stories.router)