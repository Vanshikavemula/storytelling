from pydantic import BaseModel, EmailStr, Field, validator
from typing import Optional
from datetime import datetime
from app.models.user import UserRole
import re


class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    firstname: str = Field(..., min_length=1, max_length=100)
    middlename: Optional[str] = Field(None, max_length=100)
    lastname: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=10, max_length=15)


class UserSignup(UserBase):
    password: str = Field(..., min_length=6, max_length=100)
    confirm_password: str = Field(..., min_length=6, max_length=100)
    role: Optional[UserRole] = UserRole.USER 

    @validator('phone')
    def validate_phone(cls, v):
        digits_only = re.sub(r'\D', '', v)
        if len(digits_only) != 10:
            raise ValueError('Phone number must be exactly 10 digits')
        return digits_only
    
    @validator('confirm_password')
    def passwords_match(cls, v, values):
        if 'password' in values and v != values['password']:
            raise ValueError('Passwords do not match')
        return v
    
    @validator('password')
    def validate_password_strength(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        
        return v


class UserLogin(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=100)


class UserResponse(BaseModel):
    user_id: int
    username: str
    firstname: str
    middlename: Optional[str]
    lastname: str
    email: str
    phone: str
    role: str
    created_at: datetime
    updated_at: Optional[datetime]
    
    class Config:
        from_attributes = True 


class UserProfile(UserResponse):
    full_name: str
    story_count: Optional[int] = 0


class UserUpdate(BaseModel):
    firstname: Optional[str] = Field(None, min_length=1, max_length=100)
    middlename: Optional[str] = Field(None, max_length=100)
    lastname: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, min_length=10, max_length=15)
    
    @validator('phone')
    def validate_phone(cls, v):
        if v is not None:
            digits_only = re.sub(r'\D', '', v)
            if len(digits_only) != 10:
                raise ValueError('Phone number must be exactly 10 digits')
            return digits_only
        return v
    class Config:
        extra = "forbid"


class PasswordChange(BaseModel):
    current_password: str = Field(..., min_length=6, max_length=100)
    new_password: str = Field(..., min_length=6, max_length=100)
    confirm_new_password: str = Field(..., min_length=6, max_length=100)
    
    @validator('confirm_new_password')
    def passwords_match(cls, v, values):
        if 'new_password' in values and v != values['new_password']:
            raise ValueError('New passwords do not match')
        return v
    
    @validator('new_password')
    def validate_password_strength(cls, v):
        if len(v) < 6:
            raise ValueError('Password must be at least 6 characters long')
        return v


class LoginResponse(BaseModel):
    message: str
    token: str
    user: UserResponse