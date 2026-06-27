from datetime import date, datetime
from pydantic import BaseModel, Field


class GenericMessageResponse(BaseModel):
    ok: bool
    message: str


class IdentityProfileRequest(BaseModel):
    external_id: str = Field(min_length=2, max_length=128)
    legal_name: str = Field(min_length=2, max_length=255)
    date_of_birth: date


class StartPersonaRequest(BaseModel):
    external_id: str = Field(min_length=2, max_length=128)


class StartPersonaResponse(BaseModel):
    ok: bool
    inquiry_id: str
    inquiry_url: str
    status: str


class AutoCompleteRequest(BaseModel):
    external_id: str = Field(min_length=2, max_length=128)
    verification_template_ids: list[str] = Field(default_factory=list)


class IdentityStatusResponse(BaseModel):
    ok: bool
    external_id: str
    legal_name: str
    date_of_birth: date
    kyc_status: str
    persona_inquiry_id: str | None
    persona_inquiry_status: str | None
    dashboard_unlocked: bool
    dashboard_unlocked_at: datetime | None
