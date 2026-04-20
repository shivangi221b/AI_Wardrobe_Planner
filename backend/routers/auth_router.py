from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import (
    create_password_user,
    get_password_user_by_email,
    is_valid_login_email,
    normalize_login_email,
    verify_password_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=8, max_length=256)


class LoginBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=256)


class AuthSuccessResponse(BaseModel):
    user_id: str
    email: str


@router.post("/register", response_model=AuthSuccessResponse, status_code=201)
def register_email_password(body: RegisterBody) -> AuthSuccessResponse:
    normalized = normalize_login_email(body.email)
    if not is_valid_login_email(normalized):
        raise HTTPException(status_code=400, detail="Invalid email address.")
    try:
        row = create_password_user(normalized, body.password)
    except ValueError as exc:
        code = str(exc)
        if code == "email_taken":
            raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
        if code == "weak_password":
            raise HTTPException(
                status_code=400,
                detail="Password must be at least 8 characters.",
            ) from exc
        if code == "invalid_email":
            raise HTTPException(status_code=400, detail="Invalid email address.") from exc
        raise HTTPException(status_code=400, detail="Could not create account.") from exc
    except Exception as exc:
        if get_password_user_by_email(normalized):
            raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
        raise HTTPException(status_code=503, detail="Registration failed. Please try again.") from exc
    return AuthSuccessResponse(user_id=row["user_id"], email=row["email"])


@router.post("/login", response_model=AuthSuccessResponse)
def login_email_password(body: LoginBody) -> AuthSuccessResponse:
    normalized = normalize_login_email(body.email)
    if not is_valid_login_email(normalized):
        raise HTTPException(status_code=400, detail="Invalid email address.")
    user_id = verify_password_user(normalized, body.password)
    if not user_id:
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    return AuthSuccessResponse(user_id=user_id, email=normalized)
