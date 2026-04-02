from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import SessionLocal
from app.services.ml_service import init_ml_service
from app.routes import auth, stories, chatbot


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[startup] loading ML service …")
    db = SessionLocal()
    try:
        init_ml_service(db)
        print("[startup] ML service ready ✓")
    except Exception as e:
        import traceback
        print("[startup] ⚠️ ML service failed to load")
        traceback.print_exc()
    finally:
        db.close()

    yield

    print("[shutdown] ML service shutting down")


app = FastAPI(
    title="Story API",
    lifespan=lifespan,
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "https://storytelling-zeta.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chatbot.router)
app.include_router(auth.router)
app.include_router(stories.router)