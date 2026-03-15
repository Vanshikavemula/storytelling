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

# app/routes/chatbot.py
# Full replacement — adds session-based endpoints on top of existing ones

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
import uuid
from typing import List, Optional

from app.database import get_db
from app.schemas.chatbot import (
    ChatbotRequest, ChatbotResponse,
    ChatbotHistoryItem, ChatbotHistoryList,
)
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
    db: Session = Depends(get_db),
):
    try:
        # Use provided session_id (for multi-turn) or create a new one
        session_id = request.session_id or str(uuid.uuid4())
        ml_service = get_ml_service()

        result = ml_service.run_pipeline(
            db=db,
            age_group=request.age_group,
            genre_or_virtue=request.genre_or_virtue,
            story_length=request.story_length or "medium",
            other_notes=request.other_notes,
            user_id=current_user.user_id,
            session_id=session_id,
        )
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print("❌ Chatbot error:", e)
        raise HTTPException(status_code=500, detail="Chatbot failed")


# ─────────────────────────────────────────────
#  GET /sessions  — one entry per session (sidebar)
#  Groups conversations by session_id, returns the
#  first user_query as the session title and the
#  latest created_at as the sort key.
# ─────────────────────────────────────────────
@router.get("/sessions")
async def get_sessions(
    limit: int = Query(default=50, ge=1, le=200),
    skip:  int = Query(default=0,  ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns one item per chat session for the sidebar.
    Each item: { session_id, title, message_count, last_updated, age_group }
    """
    try:
        # Get all distinct session_ids ordered by latest message
        rows = (
            db.query(
                ChatbotConversation.session_id,
                func.min(ChatbotConversation.user_query).label("first_query"),
                func.count(ChatbotConversation.conversation_id).label("message_count"),
                func.max(ChatbotConversation.created_at).label("last_updated"),
                func.min(ChatbotConversation.age_group).label("age_group"),
            )
            .filter(ChatbotConversation.user_id == current_user.user_id)
            .group_by(ChatbotConversation.session_id)
            .order_by(func.max(ChatbotConversation.created_at).desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

        sessions = [
            {
                "session_id":    r.session_id,
                "title":         (r.first_query or "Untitled chat")[:60],
                "message_count": r.message_count,
                "last_updated":  r.last_updated.isoformat() if r.last_updated else None,
                "age_group":     r.age_group or "child",
            }
            for r in rows
        ]
        return {"sessions": sessions, "total": len(sessions)}

    except Exception as e:
        print("❌ Sessions fetch error:", e)
        raise HTTPException(status_code=500, detail="Failed to fetch sessions")


# ─────────────────────────────────────────────
#  GET /sessions/{session_id}  — all messages in a session
# ─────────────────────────────────────────────
@router.get("/sessions/{session_id}")
async def get_session_messages(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns all conversation turns for a given session_id.
    Used when the user clicks a session in the sidebar.
    """
    rows = (
        db.query(ChatbotConversation)
        .filter(
            ChatbotConversation.session_id == session_id,
            ChatbotConversation.user_id == current_user.user_id,
        )
        .order_by(ChatbotConversation.created_at.asc())
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = []
    for c in rows:
        messages.append({"role": "user",  "text": c.user_query, "conversation_id": c.conversation_id})
        messages.append({"role": "bot",   "story": c.generated_story, "moral": c.moral, "conversation_id": c.conversation_id})

    return {
        "session_id":    session_id,
        "age_group":     rows[0].age_group or "child",
        "story_length":  rows[0].length_preference or "medium",
        "messages":      messages,
    }


# ─────────────────────────────────────────────
#  DELETE /sessions/{session_id}  — delete whole session
# ─────────────────────────────────────────────
@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deleted = (
        db.query(ChatbotConversation)
        .filter(
            ChatbotConversation.session_id == session_id,
            ChatbotConversation.user_id == current_user.user_id,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": f"Deleted {deleted} message(s)", "session_id": session_id}


# ─────────────────────────────────────────────
#  GET /history  — kept for backward compat
# ─────────────────────────────────────────────
@router.get("/history", response_model=ChatbotHistoryList)
async def get_chatbot_history(
    limit: int = Query(default=30, ge=1, le=100),
    skip:  int = Query(default=0,  ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        q     = (
            db.query(ChatbotConversation)
            .filter(ChatbotConversation.user_id == current_user.user_id)
            .order_by(ChatbotConversation.created_at.desc())
        )
        total = q.count()
        convs = q.offset(skip).limit(limit).all()
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
                    created_at=c.created_at,
                )
                for c in convs
            ],
            total=total, limit=limit, skip=skip,
        )
    except Exception as e:
        print("❌ History fetch error:", e)
        raise HTTPException(status_code=500, detail="Failed to fetch history")


# ─────────────────────────────────────────────
#  DELETE /history/clear — kept for backward compat
#  ⚠️  MUST stay BEFORE /history/{conversation_id}
# ─────────────────────────────────────────────
@router.delete("/history/clear")
async def clear_all_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deleted = (
        db.query(ChatbotConversation)
        .filter(ChatbotConversation.user_id == current_user.user_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"message": f"Cleared {deleted} conversation(s)", "deleted_count": deleted}


# ─────────────────────────────────────────────
#  DELETE /history/{conversation_id}
#  ⚠️  Must stay AFTER /history/clear
# ─────────────────────────────────────────────
@router.delete("/history/{conversation_id}")
async def delete_history_item(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = (
        db.query(ChatbotConversation)
        .filter(
            ChatbotConversation.conversation_id == conversation_id,
            ChatbotConversation.user_id == current_user.user_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(item)
    db.commit()
    return {"message": "Conversation deleted successfully", "conversation_id": conversation_id}