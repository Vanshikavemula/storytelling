from fastapi import APIRouter, Depends, HTTPException, status, Response, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import List, Optional
from datetime import datetime
import csv
from io import StringIO

from app.database import get_db
from app.models.user import User, UserRole
from app.models.story import Story
from app.schemas.story import (
    StoryCreate,
    StoryUpdate,
    StoryResponse,
    StoryList
)
from app.utils.dependencies import role_required, normalize_age_group

router = APIRouter(prefix="/api/stories", tags=["Stories"])


@router.post("/", response_model=StoryResponse, status_code=status.HTTP_201_CREATED)
async def create_story(
    story_data: StoryCreate,
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)),
    db: Session = Depends(get_db)
):
    try:
        story_text_clean = " ".join(story_data.story_text.split())

        normalized_age_group = normalize_age_group(story_data.age_group)

        existing = db.query(Story).filter(
            Story.user_id == current_user.user_id,
            (
                (Story.story_text == story_text_clean) |
                (Story.entity.ilike(story_data.entity))
            )
        ).first()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Story with same title or content already exists"
            )

        new_story = Story(
            user_id=current_user.user_id,
            entity=story_data.entity,
            virtues=story_data.virtues,
            keywords=story_data.keywords,
            age_group=normalized_age_group,
            story_text=story_text_clean
        )

        db.add(new_story)
        db.commit()
        db.refresh(new_story)

        return new_story

    except HTTPException:
        raise
    except Exception as e:
        print("ERROR:", e)
        raise HTTPException(500, "Failed to create story")
    except Exception as e:
        print("ERROR:", e) 
        raise HTTPException(
            status_code=500,
            detail=str(e)     
        )


@router.get("/", response_model=StoryList)
async def get_all_stories(
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    age_group: Optional[str] = None,
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)), 
    db: Session = Depends(get_db)
):
    
    query = db.query(Story).filter(Story.user_id == current_user.user_id)
    
    # Apply search filter
    if search:
        search_filter = or_(
            Story.entity.ilike(f"%{search}%"),
            Story.virtues.ilike(f"%{search}%"),
            Story.keywords.ilike(f"%{search}%"),
            Story.story_text.ilike(f"%{search}%")
        )
        query = query.filter(search_filter)
    
    # Apply age group filter
    if age_group:
        query = query.filter(Story.age_group == age_group)
    
    # Get total count
    total = query.count()
    
    # Get paginated results
    stories = query.order_by(Story.story_id.asc()).offset(skip).limit(limit).all()
    
    return StoryList(
        stories=stories,
        total=total,
        page=(skip // limit) + 1 if limit > 0 else 1,
        page_size=limit
    )


@router.get("/{story_id}", response_model=StoryResponse)
async def get_story_by_id(
    story_id: int,
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)), 
    db: Session = Depends(get_db)
):
    
    story = db.query(Story).filter(
        Story.story_id == story_id,
        Story.user_id == current_user.user_id
    ).first()
    
    if not story:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Story not found"
        )
    
    return story

@router.put("/{story_id}", response_model=StoryResponse)
async def update_story(
    story_id: int,
    story_update: StoryUpdate,
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)),
    db: Session = Depends(get_db)
):
    story = db.query(Story).filter(
        Story.story_id == story_id,
        Story.user_id == current_user.user_id
    ).first()

    if not story:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Story not found"
        )

    update_data = story_update.dict(exclude_unset=True)

    if "story_text" in update_data and update_data["story_text"]:
        update_data["story_text"] = " ".join(update_data["story_text"].split())

        duplicate = db.query(Story).filter(
            Story.user_id == current_user.user_id,
            Story.story_id != story_id,
            Story.story_text == update_data["story_text"]
        ).first()

        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Another story with same content already exists"
            )

    if "entity" in update_data and update_data["entity"]:
        duplicate = db.query(Story).filter(
            Story.user_id == current_user.user_id,
            Story.story_id != story_id,
            Story.entity.ilike(update_data["entity"])
        ).first()

        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Another story with same title already exists"
            )

    for field, value in update_data.items():
        setattr(story, field, value)

    db.commit()
    db.refresh(story)

    return story


@router.delete("/{story_id}")
async def delete_story(
    story_id: int,
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)), 
    db: Session = Depends(get_db)
):
    
    story = db.query(Story).filter(
        Story.story_id == story_id,
        Story.user_id == current_user.user_id
    ).first()
    
    if not story:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Story not found"
        )
    
    db.delete(story)
    db.commit()
    
    return {"message": "Story deleted successfully"}


@router.post("/bulk-delete")
async def bulk_delete_stories(
    story_ids: List[int],
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)), 
    db: Session = Depends(get_db)
):
    deleted_count = db.query(Story).filter(
        Story.story_id.in_(story_ids),
        Story.user_id == current_user.user_id
    ).delete(synchronize_session=False)
    
    db.commit()
    
    return {
        "message": f"Successfully deleted {deleted_count} stories",
        "deleted_count": deleted_count
    }

from fastapi import Query
from fastapi.responses import Response
from io import StringIO
import csv

def clean_csv_field(value):
    if not value or not value.strip():
        return None
    return ", ".join(part.strip() for part in value.split(","))

@router.get("/export/csv")
async def export_stories_csv(
    virtue: str = Query(None, description="Filter by virtue"),
    age_group: str = Query(None, description="Filter by age group"),
    limit: int = Query(500, ge=1, le=5000, description="Max rows to export"),
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)),
    db: Session = Depends(get_db)
):

    query = db.query(Story).filter(
        Story.user_id == current_user.user_id
    )

    if virtue:
        query = query.filter(Story.virtues.ilike(f"%{virtue.strip()}%"))

    if age_group:
        query = query.filter(Story.age_group.ilike(age_group.strip()))

    stories = query.order_by(Story.story_id.asc()).limit(limit).all()

    if not stories:
        raise HTTPException(404, "No stories found for selected filters")

    output = StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "id",
        "title",
        "story",
        "virtues",
        "keywords",
        "age_group"
    ])

    for story in stories:

        writer.writerow([
            story.story_id,
            story.entity,
            story.story_text,
            clean_csv_field(story.virtues),
            clean_csv_field(story.keywords),
            story.age_group
        ])

    csv_content = output.getvalue()
    output.close()

    filename = f"stories_{current_user.username}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )

@router.post("/import/csv")
async def import_stories_csv(
    file: UploadFile = File(...),
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)),
    db: Session = Depends(get_db)
):
    try:
        if not file.filename.lower().endswith(".csv"):
            raise HTTPException(400, "Only CSV files are supported")

        content = await file.read()
        csv_file = StringIO(content.decode("utf-8"))

        reader = csv.DictReader(csv_file)

        if not reader.fieldnames:
            raise HTTPException(400, "Invalid CSV file")

        imported = []
        duplicates = []
        skipped = []

        for row in reader:

            entity = (
                row.get("title")
                or row.get("Entity/Name")
                or row.get("entity")
            )

            story_text = (
                row.get("story")
                or row.get("Story Text / Story Problem")
                or row.get("Story Text/ Story Problem")
                or row.get("story_text")
            )

            virtues = (
                row.get("virtues")
                or row.get("Virtue(s)")
                or row.get("Virtues")
            )

            keywords = (
                row.get("keywords")
                or row.get("Keywords/Synonyms")
                or row.get("Keywords")
            )

            raw_age = row.get("age_group") or row.get("Age Group")

            if not entity or not story_text:
                skipped.append("Missing title/story")
                continue

            story_text_clean = " ".join(story_text.split())

            if len(story_text_clean) < 20:
                skipped.append(entity)
                continue

            virtues = clean_csv_field(virtues)
            keywords = clean_csv_field(keywords)

            age_group = normalize_age_group(raw_age)

            existing = db.query(Story).filter(
                Story.user_id == current_user.user_id,
                (
                    (Story.story_text == story_text_clean) |
                    (Story.entity.ilike(entity.strip()))
                )
            ).first()

            if existing:
                duplicates.append(entity)
                continue

            new_story = Story(
                user_id=current_user.user_id,
                entity=entity.strip(),
                virtues=virtues,
                keywords=keywords,     # ⭐ FIXED
                age_group=age_group,
                story_text=story_text_clean
            )

            db.add(new_story)
            imported.append(entity)

        db.commit()

        return {
            "message": "CSV import completed",
            "imported_count": len(imported),
            "duplicate_count": len(duplicates),
            "skipped_count": len(skipped),
            "imported_stories": imported,
            "duplicate_stories": duplicates,
            "skipped_stories": skipped
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(400, f"Error importing CSV: {str(e)}")


@router.get("/stats/summary")
async def get_story_statistics(
    current_user: User = Depends(role_required(UserRole.ANNOTATOR, UserRole.ADMIN)), 
    db: Session = Depends(get_db)
):
    
    total_stories = db.query(func.count(Story.story_id)).filter(
        Story.user_id == current_user.user_id
    ).scalar()
    
    # Count by age group
    age_group_stats = db.query(
        Story.age_group,
        func.count(Story.story_id)
    ).filter(
        Story.user_id == current_user.user_id,
        Story.age_group.isnot(None)
    ).group_by(Story.age_group).all()
    
    return {
        "total_stories": total_stories,
        "by_age_group": {ag: count for ag, count in age_group_stats}
    }