from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class IdentityProfile(Base):
    __tablename__ = "identity_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reference_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    legal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    date_of_birth: Mapped[date] = mapped_column(Date, nullable=False)

    kyc_status: Mapped[str] = mapped_column(String(32), default="NOT_STARTED", nullable=False)
    persona_inquiry_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    persona_inquiry_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dashboard_unlocked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dashboard_unlocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    events = relationship("IdentityEvent", back_populates="profile", cascade="all, delete-orphan")


class IdentityEvent(Base):
    __tablename__ = "identity_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    profile_id: Mapped[int | None] = mapped_column(ForeignKey("identity_profiles.id"), nullable=True)
    event_name: Mapped[str] = mapped_column(String(128), nullable=False)
    event_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    inquiry_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    profile = relationship("IdentityProfile", back_populates="events")
