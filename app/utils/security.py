from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status
from app.models.user import TokenBlacklist
from app.config import get_settings

settings = get_settings()

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# -------------------- PASSWORD UTILS --------------------

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


# -------------------- JWT UTILS --------------------

def create_access_token(
    data: Dict[str, Any],
    expires_delta: Optional[timedelta] = None
) -> str:
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

    # ✅ Add standard JWT claims
    to_encode.update({
        "exp": expire,
        "sub": str(data.get("user_id"))  # JWT standard subject
    })

    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )

    return encoded_jwt


def decode_access_token(token: str) -> Dict[str, Any]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return payload

    except JWTError:
        raise credentials_exception
    

def blacklist_token(db, token: str):
    exists = db.query(TokenBlacklist).filter(TokenBlacklist.token == token).first()
    if not exists:
        db.add(TokenBlacklist(token=token))
        db.commit()


def is_token_blacklisted(db, token: str) -> bool:
    return db.query(TokenBlacklist).filter(TokenBlacklist.token == token).first() is not None

# -------------------- PASSWORD RESET --------------------

def create_password_reset_token(user_id: int) -> str:
    data = {
        "user_id": user_id,
        "type": "password_reset"
    }
    expires_delta = timedelta(hours=1)
    return create_access_token(data, expires_delta)


def verify_password_reset_token(token: str) -> Optional[int]:
    try:
        payload = decode_access_token(token)

        if payload.get("type") != "password_reset":
            return None

        return payload.get("user_id")

    except HTTPException:
        return None


# -------------------- PASSWORD STRENGTH --------------------

def check_password_strength(password: str) -> Dict[str, Any]:
    score = 0
    feedback = []

    # ✅ Length check (UNIFIED TO 8)
    if len(password) >= 8:
        score += 1
    else:
        feedback.append("Password should be at least 8 characters long")

    # Uppercase check
    if any(c.isupper() for c in password):
        score += 1
    else:
        feedback.append("Add at least one uppercase letter")

    # Lowercase check
    if any(c.islower() for c in password):
        score += 1
    else:
        feedback.append("Add at least one lowercase letter")

    # Digit check
    if any(c.isdigit() for c in password):
        score += 1
    else:
        feedback.append("Add at least one number")

    # Special character check
    if any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in password):
        score += 1
    else:
        feedback.append("Add at least one special character")

    if score <= 2:
        strength = "weak"
    elif score == 3:
        strength = "medium"
    elif score == 4:
        strength = "strong"
    else:
        strength = "very_strong"

    return {
        "score": score,
        "max_score": 5,
        "strength": strength,
        "feedback": feedback
    }


# -------------------- MISC UTILS --------------------

def generate_session_token() -> str:
    import secrets
    return secrets.token_urlsafe(32)


def mask_email(email: str) -> str:
    if "@" not in email:
        return email

    username, domain = email.split("@")

    if len(username) <= 1:
        masked_username = "*"
    elif len(username) <= 3:
        masked_username = username[0] + "*" * (len(username) - 1)
    else:
        masked_username = username[0] + "***"

    return f"{masked_username}@{domain}"


def mask_phone(phone: str) -> str:
    if len(phone) < 4:
        return "***"
    return f"***-***-{phone[-4:]}"
