from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User, UserRole
from app.utils.security import decode_access_token, is_token_blacklisted

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    if is_token_blacklisted(db, token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked. Please login again."
        )

    payload = decode_access_token(token)

    user_id: Optional[int] = payload.get("user_id")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


def role_required(*allowed_roles: UserRole):
    def dependency(user = Depends(get_current_user)):
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to access this resource."
            )
        return user
    return dependency

async def get_current_admin_user(
    current_user: User = Depends(get_current_user)
) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return current_user


async def get_current_annotator_user(
    current_user: User = Depends(get_current_user)
) -> User:
    if current_user.role not in {UserRole.ANNOTATOR, UserRole.ADMIN}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Annotator privileges required"
        )
    return current_user


def require_roles(*allowed_roles: UserRole):
    async def role_checker(
        current_user: User = Depends(get_current_user)
    ) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized for this action"
            )
        return current_user

    return role_checker


async def get_optional_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    if not credentials:
        return None

    try:
        payload = decode_access_token(credentials.credentials)
        user_id = payload.get("user_id")
        if not user_id:
            return None
        return db.query(User).filter(User.user_id == user_id).first()
    except Exception:
        return None

def clean_optional_field(value: str):
    if not value:
        return None

    value = value.strip()

    if value.lower() in {"string", "null", "none", ""}:
        return None

    return value

from fastapi import HTTPException, status

def normalize_age_group(age: str) -> str:
    if not age or not age.strip():
        return None

    raw = age.strip().lower()

    mapping = {

        # ---------- CHILD ----------
        "kid": "child",
        "kids": "child",
        "child": "child",
        "children": "child",
        "toddler": "child",
        "toddlers": "child",
        "baby": "child",
        "babies": "child",
        "infant": "child",
        "infants": "child",
        "preteen": "child",
        "pre teen": "child",
        "school kid": "child",
        "school kids": "child",

        # ---------- TEEN ----------
        "teen": "teen",
        "teens": "teen",
        "teenager": "teen",
        "teenagers": "teen",
        "adolescent": "teen",
        "adolescents": "teen",
        "youth": "teen",
        "youths": "teen",
        "high school": "teen",
        "student": "teen",
        "students": "teen",

        # ---------- ADULT ----------
        "adult": "adult",
        "adults": "adult",
        "young adult": "adult",
        "young adults": "adult",
        "mature": "adult",
        "elder": "adult",
        "elders": "adult",
        "senior": "adult",
        "seniors": "adult",
        "middle age": "adult",
        "middle-aged": "adult"
    }

    if raw in mapping:
        return mapping[raw]

    # ⭐ Intelligent fallback detection (very useful for messy CSVs)

    if any(word in raw for word in ["kid", "child", "toddler", "baby", "infant"]):
        return "child"

    if any(word in raw for word in ["teen", "youth", "adolescent", "student"]):
        return "teen"

    if any(word in raw for word in ["adult", "senior", "elder", "mature"]):
        return "adult"

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Invalid age_group: '{age}'. Allowed values map to: child, teen, adult"
    )