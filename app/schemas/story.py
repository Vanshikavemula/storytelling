from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class StoryBase(BaseModel):
    entity: str = Field(..., min_length=1, max_length=255, description="Entity/Character name")
    virtues: Optional[str] = Field(None, description="Comma-separated virtues")
    keywords: Optional[str] = Field(None, description="Comma-separated keywords")
    age_group: Optional[str] = Field(None, max_length=50, description="Target age group")
    story_text: str = Field(..., min_length=10, description="The actual story content")


class StoryCreate(StoryBase):
    pass


class StoryUpdate(BaseModel):
    entity: Optional[str] = Field(None, min_length=1, max_length=255)
    virtues: Optional[str] = None
    keywords: Optional[str] = None
    age_group: Optional[str] = Field(None, max_length=50)
    story_text: Optional[str] = Field(None, min_length=10)
    class Config:
        extra = "forbid"

class StoryResponse(StoryBase):
    story_id: int
    user_id: int
    created_at: datetime
    updated_at: Optional[datetime]

    similarity_score: Optional[float] = None
    retrieval_reason: Optional[str] = None

    class Config:
        from_attributes = True


class StoryList(BaseModel):
    stories: List[StoryResponse]
    total: int
    page: int = 1
    page_size: int = 50


# class StorySearch(BaseModel):
#     search_term: Optional[str] = None
#     age_group: Optional[str] = None
#     genre: Optional[str] = None
#     virtue: Optional[str] = None
#     page: int = Field(default=1, ge=1)
#     page_size: int = Field(default=50, ge=1, le=100)


# class StoryExport(BaseModel):
#     entity: str
#     virtues: Optional[str]
#     keywords: Optional[str]
#     age_group: Optional[str]
#     story_group: Optional[str]
#     story_text: str