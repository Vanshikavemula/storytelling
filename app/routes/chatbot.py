# from fastapi import APIRouter, Depends, HTTPException
# from sqlalchemy.orm import Session
# import uuid

# from app.database import get_db
# from app.schemas.chatbot import ChatbotRequest, ChatbotResponse
# from app.services.ml_service import get_ml_service
# from app.models.user import User, UserRole
# from app.utils.dependencies import role_required

# router = APIRouter(prefix="/api/chatbot", tags=["Chatbot"])


# @router.post("/query", response_model=ChatbotResponse)
# async def chatbot_query(
#     request: ChatbotRequest,
#     current_user: User = Depends(role_required(UserRole.USER, UserRole.ADMIN)),
#     db: Session = Depends(get_db)
# ):
#     try:
#         temp_session_id = str(uuid.uuid4())
#         ml_service = get_ml_service()

#         result = ml_service.run_pipeline(
#             db=db,
#             age_group=request.age_group,
#             genre_or_virtue=request.genre_or_virtue,
#             story_length=request.story_length or "medium",
#             other_notes=request.other_notes,
#             user_id=current_user.user_id,
#             session_id=temp_session_id
#         )

#         return result

#     except ValueError as e:
#         raise HTTPException(status_code=400, detail=str(e))
#     except Exception as e:
#         print("❌ Chatbot error:", e)
#         raise HTTPException(status_code=500, detail="Chatbot failed")

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
import uuid
from typing import List, Optional

from app.database import get_db
from app.schemas.chatbot import ChatbotRequest, ChatbotResponse, ChatbotHistoryItem, ChatbotHistoryList
from app.services.ml_service import get_ml_service
from app.models.user import User, UserRole
from app.models.story import ChatbotConversation
from app.utils.dependencies import role_required, get_current_user

router = APIRouter(prefix="/api/chatbot", tags=["Chatbot"])


# ─────────────────────────────────────────────
#  POST /query  — generate a story
# ─────────────────────────────────────────────
@router.post("/query", response_model=ChatbotResponse)
async def chatbot_query(
    request: ChatbotRequest,
    current_user: User = Depends(role_required(UserRole.USER, UserRole.ANNOTATOR, UserRole.ADMIN)),
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


# ─────────────────────────────────────────────
#  GET /history  — fetch past conversations
#  Used by the sidebar in the updated Chatbot UI
# ─────────────────────────────────────────────
@router.get("/history", response_model=ChatbotHistoryList)
async def get_chatbot_history(
    limit: int = Query(default=20, ge=1, le=100, description="Max number of history items"),
    skip: int = Query(default=0, ge=0, description="Offset for pagination"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns the authenticated user's past chatbot queries.
    Powers the sidebar history list in the Chatbot page.
    """
    try:
        query = (
            db.query(ChatbotConversation)
            .filter(ChatbotConversation.user_id == current_user.user_id)
            .order_by(ChatbotConversation.created_at.desc())
        )

        total = query.count()
        conversations = query.offset(skip).limit(limit).all()

        return ChatbotHistoryList(
            history=[
                ChatbotHistoryItem(
                    conversation_id=c.conversation_id,
                    session_id=c.session_id,
                    user_query=c.user_query,
                    age_group=c.age_group,
                    story_length=c.length_preference,
                    generated_story=c.generated_story,
                    moral=c.moral,
                    created_at=c.created_at
                )
                for c in conversations
            ],
            total=total,
            limit=limit,
            skip=skip
        )

    except Exception as e:
        print("❌ History fetch error:", e)
        raise HTTPException(status_code=500, detail="Failed to fetch history")


# ─────────────────────────────────────────────
#  DELETE /history/{conversation_id}
#  Let users delete a single history entry
# ─────────────────────────────────────────────
@router.delete("/history/{conversation_id}")
async def delete_history_item(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Deletes a single conversation from history.
    Triggered when user removes an item from the sidebar.
    """
    item = db.query(ChatbotConversation).filter(
        ChatbotConversation.conversation_id == conversation_id,
        ChatbotConversation.user_id == current_user.user_id
    ).first()

    if not item:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.delete(item)
    db.commit()

    return {"message": "Conversation deleted successfully", "conversation_id": conversation_id}


# ─────────────────────────────────────────────
#  DELETE /history/clear — wipe all history
#  Triggered by the "clear chat" button
# ─────────────────────────────────────────────
@router.delete("/history/clear")
async def clear_all_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Deletes all chatbot conversation history for the current user.
    Triggered by the clear/refresh button in the Chatbot topbar.
    """
    deleted = db.query(ChatbotConversation).filter(
        ChatbotConversation.user_id == current_user.user_id
    ).delete(synchronize_session=False)

    db.commit()

    return {
        "message": f"Cleared {deleted} conversation(s)",
        "deleted_count": deleted
    }