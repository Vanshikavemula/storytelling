from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, Base
from app.models import User, Story, ChatbotConversation
from app.routes import auth, stories, chatbot

settings = get_settings()

app = FastAPI()

# -------------------- CORS CONFIG --------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:4173",   # Vite preview
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- ROUTERS --------------------
app.include_router(auth.router)
app.include_router(stories.router)
app.include_router(chatbot.router)

# -------------------- HEALTH --------------------
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "database": "connected",
        "api_version": "1.0.0"
    }

# -------------------- STARTUP --------------------
@app.on_event("startup")
async def startup_event():
    print("=" * 60)
    print("🚀 Story Annotation API Server Starting...")
    print("=" * 60)

    print("Creating tables...")
    Base.metadata.create_all(bind=engine)
    print("✅ Tables created successfully")

    port = settings.PORT if hasattr(settings, "PORT") else 8000
    print(f"📚 API Documentation: http://localhost:{port}/docs")
    print(f"🔧 ReDoc: http://localhost:{port}/redoc")
    print("=" * 60)

# -------------------- SHUTDOWN --------------------
@app.on_event("shutdown")
async def shutdown_event():
    print("\n👋 Shutting down Story Annotation API Server...")
