from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.user import User
from app.schemas.user_schemas import (
    UserSignup,
    UserLogin,
    LoginResponse,
    UserResponse,
    UserProfile,
    UserUpdate,
    PasswordChange
)
# from app.utils import security
from app.utils.security import (
    get_password_hash,
    verify_password,
    create_access_token
)
from app.models.user import UserRole
from app.utils.dependencies import get_current_user, role_required, clean_optional_field
from app.utils.security import blacklist_token

security = HTTPBearer()

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def signup(user_data: UserSignup, db: Session = Depends(get_db)):

    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")

    existing_email = db.query(User).filter(User.email == user_data.email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already registered")

    if user_data.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Admin registration is not allowed."
        )

    allowed_roles = {UserRole.USER, UserRole.ANNOTATOR}
    role = user_data.role if user_data.role in allowed_roles else UserRole.USER

    new_user = User(
        username=user_data.username.strip(),

        firstname=clean_optional_field(user_data.firstname),
        middlename=clean_optional_field(user_data.middlename),
        lastname=clean_optional_field(user_data.lastname),

        email=user_data.email.strip(),
        phone=clean_optional_field(user_data.phone),

        password_hash=get_password_hash(user_data.password),
        role=role
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


@router.post("/login", response_model=LoginResponse)
async def login(credentials: UserLogin, db: Session = Depends(get_db)):
    
    # Find user by username
    user = db.query(User).filter(User.username == credentials.username).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    # Verify password
    if not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    # Create access token
    access_token = create_access_token(
        data={"user_id": user.user_id, "username": user.username}
    )
    
    return LoginResponse(
        message="Login successful",
        token=access_token,
        user=UserResponse.from_orm(user)
    )


@router.get("/me", response_model=UserProfile)
async def get_current_user_profile(current_user: User = Depends(get_current_user)):

    return UserProfile(
        user_id=current_user.user_id,
        username=current_user.username,
        firstname=current_user.firstname,
        middlename=current_user.middlename,
        lastname=current_user.lastname,
        email=current_user.email,
        phone=current_user.phone,
        role=current_user.role.value if hasattr(current_user.role, 'value') else current_user.role,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at,
        full_name=current_user.full_name,
        story_count=current_user.story_count
    )


@router.put("/me", response_model=UserResponse)
async def update_user_profile(
    user_update: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    
    # Check if email is being updated and is already taken
    if user_update.email and user_update.email != current_user.email:
        existing_email = db.query(User).filter(
            User.email == user_update.email,
            User.user_id != current_user.user_id
        ).first()
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered to another account"
            )
    
    # Update fields
    update_data = user_update.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)
    
    db.commit()
    db.refresh(current_user)
    
    return current_user


@router.post("/change-password")
async def change_password(
    password_data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    
    # Verify current password
    if not verify_password(password_data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    # Update password
    current_user.password_hash = get_password_hash(password_data.new_password)
    db.commit()
    
    return {"message": "Password changed successfully"}


@router.get("/users", response_model=List[UserResponse])
async def get_all_users(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(role_required(UserRole.ADMIN)), 
    db: Session = Depends(get_db)
):
    
    users = db.query(User).offset(skip).limit(limit).all()
    return users


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(role_required(UserRole.ADMIN)), 
    db: Session = Depends(get_db)
):
    
    # Allow users to delete their own account or admins to delete any
    if (
        current_user.user_id != user_id
        and current_user.role != UserRole.ADMIN
    ):

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this user"
        )
    
    user = db.query(User).filter(User.user_id == user_id).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    db.delete(user)
    db.commit()
    
    return {"message": "User deleted successfully"}


# @router.get("/check-username/{username}")
# async def check_username_availability(username: str, db: Session = Depends(get_db)):

#     existing_user = db.query(User).filter(User.username == username).first()
    
#     return {
#         "username": username,
#         "available": existing_user is None
#     }


# @router.get("/check-email/{email}")
# async def check_email_availability(email: str, db: Session = Depends(get_db)):
#     existing_email = db.query(User).filter(User.email == email).first()
    
#     return {
#         "email": email,
#         "available": existing_email is None
#     }

# from app.utils.security import check_password_strength

# @router.post("/check-password-strength")
# async def check_password(password: str):
#     result = check_password_strength(password)
#     return result

@router.post("/logout")
async def logout(
    token: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    jwt_token = token.credentials

    blacklist_token(db, jwt_token)

    return {"message": "Successfully logged out"}