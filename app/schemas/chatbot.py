# from pydantic import BaseModel, Field
# from typing import Literal, Optional


# class ChatbotRequest(BaseModel):
#     age_group: Literal["child", "teen", "adult"]
#     genre_or_virtue: str = Field(
#         ..., min_length=1,
#         description="Genre or virtue like honesty, courage, adventure"
#     )
#     story_length: Optional[Literal["short", "medium", "long"]] = "medium"
#     other_notes: Optional[str] = Field(
#         None, description="Any extra instructions or preferences"
#     )


# class ChatbotResponse(BaseModel):
#     title: str
#     story: str
#     moral: str
#     retrieved_story_id: int
#     processing_time_ms: int

#     class Config:
#         from_attributes = True
# app/schemas/chatbot.py
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime


class ChatbotRequest(BaseModel):
    genre_or_virtue: str = Field(..., min_length=2, max_length=300)
    age_group: str = Field(default="child")
    story_length: Optional[str] = Field(default="medium")
    other_notes: Optional[str] = Field(default="", max_length=500)
    session_id: Optional[str] = Field(default=None, description="Pass to continue an existing chat session")

    @validator("age_group")
    def validate_age_group(cls, v):
        allowed = {"child", "teen", "adult"}
        if v.lower() not in allowed:
            raise ValueError(f"age_group must be one of: {', '.join(allowed)}")
        return v.lower()

    @validator("story_length")
    def validate_story_length(cls, v):
        if v is None:
            return "medium"
        allowed = {"short", "medium", "long"}
        if v.lower() not in allowed:
            raise ValueError(f"story_length must be one of: {', '.join(allowed)}")
        return v.lower()


class ChatbotResponse(BaseModel):
    generated_story: str = Field(..., alias="story", description="The adapted story text")
    moral: str
    moral_label: Optional[str] = None
    title: Optional[str] = None
    session_id: Optional[str] = None
    retrieved_story_id: Optional[int] = None
    age_group: Optional[str] = None
    story_length: Optional[str] = None
    word_count: Optional[int] = None
    processing_time_ms: Optional[int] = None

    class Config:
        from_attributes = True
        populate_by_name = True


class ChatbotHistoryItem(BaseModel):
    conversation_id: int
    session_id: str
    user_query: str
    age_group: Optional[str] = None
    story_length: Optional[str] = None
    generated_story: Optional[str] = None
    moral: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ChatbotHistoryList(BaseModel):
    history: List[ChatbotHistoryItem]
    total: int
    limit: int
    skip: int