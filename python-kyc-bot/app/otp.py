import logging
import random
from datetime import datetime, timedelta

from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import PhoneOtp, User


logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _generate_otp() -> str:
    return f"{random.randint(0, 999999):06d}"


def create_and_send_otp(db: Session, user: User) -> None:
    active = db.execute(
        select(PhoneOtp).where(PhoneOtp.user_id == user.id, PhoneOtp.is_used.is_(False))
    ).scalars()
    for otp in active:
        otp.is_used = True

    raw_code = _generate_otp()
    otp = PhoneOtp(
        user_id=user.id,
        code_hash=pwd_context.hash(raw_code),
        expires_at=datetime.utcnow() + timedelta(seconds=settings.otp_code_ttl_seconds),
        is_used=False,
    )
    db.add(otp)
    db.commit()

    if settings.otp_debug_mode:
        logger.info("TEST OTP issued", extra={"email": user.email, "phone": user.phone, "otp": raw_code})
    else:
        # Integrate your SMS provider here in non-debug mode.
        logger.info("OTP generated for delivery", extra={"email": user.email, "phone": user.phone})


def verify_otp(db: Session, user: User, otp_code: str) -> bool:
    latest = (
        db.execute(
            select(PhoneOtp)
            .where(PhoneOtp.user_id == user.id, PhoneOtp.is_used.is_(False))
            .order_by(PhoneOtp.created_at.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if not latest:
        return False
    if latest.expires_at < datetime.utcnow():
        latest.is_used = True
        db.commit()
        return False
    if not pwd_context.verify(otp_code, latest.code_hash):
        return False

    latest.is_used = True
    user.phone_verified = True
    user.updated_at = datetime.utcnow()
    db.commit()
    return True
