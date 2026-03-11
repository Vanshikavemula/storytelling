"""
app/utils/__init__.py

Utilities package initialization
"""

from app.utils.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    decode_access_token,
    check_password_strength,
    generate_session_token,
    mask_email,
    mask_phone
)

from app.utils.dependencies import (
    get_current_user,
    get_current_admin_user,
    get_current_annotator_user,
    get_optional_current_user,
    require_roles
)

__all__ = [
    # Security utilities
    "verify_password",
    "get_password_hash",
    "create_access_token",
    "decode_access_token",
    "verify_token",
    "check_password_strength",
    "generate_session_token",
    "mask_email",
    "mask_phone",
    
    # Dependencies
    "get_current_user",
    "get_current_active_user",
    "get_current_admin_user",
    "get_current_annotator_user",
    "get_optional_current_user",
    "require_roles",
    "RateLimiter",
    "get_pagination_params"
]