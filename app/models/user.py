from sqlalchemy import Column, Integer, String, DateTime, Enum, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class UserRole(str, enum.Enum):
    ANNOTATOR = "annotator"
    ADMIN = "admin"
    USER = "user"


class User(Base):  
    __tablename__ = "users"
    user_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    firstname = Column(String(100), nullable=False)
    middlename = Column(String(100), nullable=True)
    lastname = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(15), nullable=False)
    role = Column(
        Enum(UserRole, native_enum=False, length=20),
        default=UserRole.ANNOTATOR,
        nullable=False
    )
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
    stories = relationship(
        "Story",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="dynamic"
    )
    
    def __repr__(self):
        return f"<User(id={self.user_id}, username='{self.username}', role='{self.role}')>"
    
    def to_dict(self):
        return {
            "user_id": self.user_id,
            "username": self.username,
            "firstname": self.firstname,
            "middlename": self.middlename,
            "lastname": self.lastname,
            "email": self.email,
            "phone": self.phone,
            "role": self.role.value if isinstance(self.role, UserRole) else self.role,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
    
    @property
    def full_name(self):
        """Get user's full name"""
        if self.middlename:
            return f"{self.firstname} {self.middlename} {self.lastname}"
        return f"{self.firstname} {self.lastname}"
    
    @property
    def story_count(self):
        """Get count of stories created by this user"""
        return self.stories.count()
    
class TokenBlacklist(Base):
    __tablename__ = "token_blacklist"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(Text, nullable=False, unique=True)
    blacklisted_at = Column(DateTime(timezone=True), server_default=func.now())