from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import uuid

from app.database import get_db
from app.schemas.chatbot import ChatbotRequest, ChatbotResponse
from app.services.ml_service import get_ml_service
from app.models.user import User, UserRole
from app.utils.dependencies import role_required

router = APIRouter(prefix="/api/chatbot", tags=["Chatbot"])


@router.post("/query", response_model=ChatbotResponse)
async def chatbot_query(
    request: ChatbotRequest,
    current_user: User = Depends(role_required(UserRole.USER, UserRole.ADMIN)),
    db: Session = Depends(get_db)
):
    try:
        temp_session_id = str(uuid.uuid4())
        ml_service = get_ml_service()

        result = ml_service.run_pipeline(
            db=db,
            age_group=request.age_group,
            genre_or_virtue=request.genre_or_virtue,
            story_length=request.story_length or "medium",
            other_notes=request.other_notes,
            user_id=current_user.user_id,
            session_id=temp_session_id
        )

        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print("❌ Chatbot error:", e)
        raise HTTPException(status_code=500, detail="Chatbot failed")