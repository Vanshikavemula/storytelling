from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship, validates
from app.database import Base
import re

class Story(Base):
    __tablename__ = "stories"

    story_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"))
    entity = Column(String(255), nullable=False)
    virtues = Column(Text)
    keywords = Column(Text)
    age_group = Column(String(50))
    story_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="stories")

    # ✅ Validators
    @validates("entity")
    def validate_entity(self, key, value):
        if not value or not value.strip():
            raise ValueError("Story title (entity) cannot be empty.")
        return value.strip()

    @validates("story_text")
    def validate_story_text(self, key, value):
        if not value or len(value.strip()) < 20:
            raise ValueError("Story text must contain meaningful content.")
        return value.strip()

    @validates("virtues", "keywords", "story_group")
    def normalize_text_fields(self, key, value):
        return value.strip() if value else value


class ChatbotConversation(Base):
    __tablename__ = "chatbot_conversations"

    conversation_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False, index=True)
    session_id = Column(String(100), nullable=False, index=True)
    user_query = Column(Text, nullable=False)

    virtue = Column(String(255))
    age_group = Column(String(20))
    length_preference = Column(String(20))

    retrieved_story_id = Column( Integer,
    ForeignKey("stories.story_id", ondelete="CASCADE"),
    nullable=True)
    
    generated_story = Column(Text)
    moral = Column(Text)

    response_time_ms = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    @validates("session_id")
    def validate_session(self, key, value):
        if not value or len(value) < 5:
            raise ValueError("Invalid session_id.")
        return value

    @validates("length_preference")
    def validate_length(self, key, value):
        allowed = {"short", "medium", "long"}
        if value and value.lower() not in allowed:
            raise ValueError(f"Invalid length_preference: {value}")
        return value.lower() if value else value

    @validates("age_group")
    def validate_age_group(self, key, value):
        allowed = {"child", "teen", "adult"}
        if value and value.lower() not in allowed:
            raise ValueError(f"Invalid age_group: {value}")
        return value.lower() if value else value