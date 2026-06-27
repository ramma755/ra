from datetime import datetime
import json
import logging
import re

from fastapi import Depends, FastAPI, HTTPException, Request, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import IdentityEvent, User
from app.otp import create_and_send_otp, verify_otp
from app.persona_client import (
    PersonaConfigError,
    create_inquiry,
    extract_verified_identity,
    fetch_inquiry,
    names_match,
    parse_event_name,
    parse_inquiry_id,
    verify_webhook_signature,
)
from app.schemas import (
    GenericMessageResponse,
    IdentityStatusResponse,
    SendOtpRequest,
    SignupRequest,
    StartPersonaRequest,
    StartPersonaResponse,
    VerifyOtpRequest,
)


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kyc-test-bot")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="KYC Test Bot", version="1.0.0")


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


def _normalize_phone(phone: str) -> str:
    cleaned = re.sub(r"[^\d+]", "", phone.strip())
    if cleaned.startswith("+"):
        cleaned = cleaned[1:]
    # Kenyan normalization first.
    if re.fullmatch(r"254[71]\d{8}", cleaned):
        return cleaned
    if re.fullmatch(r"0[71]\d{8}", cleaned):
        return f"254{cleaned[1:]}"
    if re.fullmatch(r"[71]\d{8}", cleaned):
        return f"254{cleaned}"
    # Fallback for international testing.
    digits = re.sub(r"\D", "", cleaned)
    if 11 <= len(digits) <= 15:
        return digits
    raise ValueError("Invalid phone format")


@app.get("/health")
def health():
    return {"ok": True, "service": "python-kyc-test-bot"}


@app.post("/auth/signup", response_model=GenericMessageResponse)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    existing = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    phone = _normalize_phone(payload.phone)
    phone_exists = db.execute(select(User).where(User.phone == phone)).scalar_one_or_none()
    if phone_exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Phone already registered")

    user = User(
        email=payload.email.lower().strip(),
        password_hash=pwd_context.hash(payload.password),
        legal_name=payload.legal_name.strip(),
        date_of_birth=payload.date_of_birth,
        phone=phone,
        email_verified=True,
        phone_verified=False,
        kyc_status="NOT_STARTED",
        dashboard_unlocked=False,
    )
    db.add(user)
    db.commit()
    return {"ok": True, "message": "Signup successful. Verify phone with OTP."}


@app.post("/auth/phone/send-otp", response_model=GenericMessageResponse)
def send_phone_otp(payload: SendOtpRequest, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == payload.email.lower().strip())).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    create_and_send_otp(db, user)
    return {"ok": True, "message": "OTP sent."}


@app.post("/auth/phone/verify-otp", response_model=GenericMessageResponse)
def verify_phone_otp(payload: VerifyOtpRequest, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == payload.email.lower().strip())).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    valid = verify_otp(db, user, payload.otp_code.strip())
    if not valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OTP")
    return {"ok": True, "message": "Phone verified."}


@app.post("/identity/persona/start", response_model=StartPersonaResponse)
def start_persona(payload: StartPersonaRequest, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == payload.email.lower().strip())).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.phone_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone must be verified before identity verification.",
        )

    try:
        inquiry_id, inquiry_url = create_inquiry(
            user_id=user.id,
            legal_name=user.legal_name,
            date_of_birth=user.date_of_birth,
        )
    except PersonaConfigError as error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Persona start failed: {error}")

    user.persona_inquiry_id = inquiry_id
    user.persona_inquiry_status = "created"
    user.kyc_status = "IN_PROGRESS"
    user.updated_at = datetime.utcnow()
    db.add(
        IdentityEvent(
            user_id=user.id,
            event_name="inquiry.started",
            inquiry_id=inquiry_id,
            status="IN_PROGRESS",
            reason=None,
            payload={"source": "api"},
        )
    )
    db.commit()

    return {
        "ok": True,
        "inquiry_id": inquiry_id,
        "inquiry_url": inquiry_url,
        "status": "IN_PROGRESS",
    }


@app.get("/identity/status", response_model=IdentityStatusResponse)
def identity_status(email: str, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == email.lower().strip())).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {
        "ok": True,
        "email": user.email,
        "phone_verified": user.phone_verified,
        "kyc_status": user.kyc_status,
        "persona_inquiry_id": user.persona_inquiry_id,
        "persona_inquiry_status": user.persona_inquiry_status,
        "dashboard_unlocked": user.dashboard_unlocked,
        "dashboard_unlocked_at": user.dashboard_unlocked_at,
    }


@app.post("/webhooks/persona")
async def persona_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    signature = request.headers.get("persona-signature")
    if not verify_webhook_signature(signature, raw_body):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload")

    event_name = parse_event_name(payload)
    inquiry_id = parse_inquiry_id(payload)
    user = (
        db.execute(select(User).where(User.persona_inquiry_id == inquiry_id)).scalar_one_or_none()
        if inquiry_id
        else None
    )

    db.add(
        IdentityEvent(
            user_id=user.id if user else None,
            event_name=event_name or "unknown",
            inquiry_id=inquiry_id or None,
            status=None,
            reason=None,
            payload=payload,
        )
    )

    if not user:
        db.commit()
        return {"ok": True, "message": "event logged (no user mapped)"}

    user.persona_inquiry_status = event_name or user.persona_inquiry_status

    if event_name in {"inquiry.approved", "inquiry.completed"}:
        try:
            inquiry_payload = fetch_inquiry(inquiry_id)
            verified_name, verified_dob = extract_verified_identity(inquiry_payload)
        except Exception as error:
            user.kyc_status = "FAILED"
            user.dashboard_unlocked = False
            user.updated_at = datetime.utcnow()
            db.add(
                IdentityEvent(
                    user_id=user.id,
                    event_name="inquiry.failed",
                    inquiry_id=inquiry_id,
                    status="FAILED",
                    reason=f"failed-to-fetch-inquiry: {error}",
                    payload=None,
                )
            )
            db.commit()
            return {"ok": True, "message": "inquiry fetch failed; marked FAILED"}

        signup_name = user.legal_name
        signup_dob = user.date_of_birth.isoformat()
        dob_matches = bool(verified_dob and verified_dob == signup_dob)
        name_matches = names_match(signup_name, verified_name or "")

        if name_matches and dob_matches:
            user.kyc_status = "APPROVED"
            user.dashboard_unlocked = True
            user.dashboard_unlocked_at = datetime.utcnow()
            user.updated_at = datetime.utcnow()
        else:
            user.kyc_status = "FAILED"
            user.dashboard_unlocked = False
            user.updated_at = datetime.utcnow()
            db.add(
                IdentityEvent(
                    user_id=user.id,
                    event_name="inquiry.failed",
                    inquiry_id=inquiry_id,
                    status="FAILED",
                    reason=f"name_or_dob_mismatch(name={name_matches},dob={dob_matches})",
                    payload={
                        "signup_name": signup_name,
                        "verified_name": verified_name,
                        "signup_dob": signup_dob,
                        "verified_dob": verified_dob,
                    },
                )
            )
    elif event_name in {"inquiry.declined", "inquiry.failed"}:
        user.kyc_status = "FAILED"
        user.dashboard_unlocked = False
        user.updated_at = datetime.utcnow()

    db.commit()
    return {"ok": True}
