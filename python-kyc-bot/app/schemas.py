from datetime import date, datetime
from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    legal_name: str = Field(min_length=2, max_length=255)
    date_of_birth: date
    phone: str = Field(min_length=9, max_length=32)


class GenericMessageResponse(BaseModel):
    ok: bool
    message: str


class SendOtpRequest(BaseModel):
    email: EmailStr


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp_code: str = Field(min_length=4, max_length=8)


class StartPersonaRequest(BaseModel):
    email: EmailStr


class StartPersonaResponse(BaseModel):
    ok: bool
    inquiry_id: str
    inquiry_url: str
    status: str


class IdentityStatusResponse(BaseModel):
    ok: bool
    email: EmailStr
    phone_verified: bool
    kyc_status: str
    persona_inquiry_id: str | None
    persona_inquiry_status: str | None
    dashboard_unlocked: bool
    dashboard_unlocked_at: datetime | None
