from datetime import datetime
import json
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, SessionLocal, engine, get_db
from app.models import IdentityEvent, IdentityProfile
from app.persona_client import (
    PersonaConfigError,
    approve_inquiry,
    create_inquiry,
    extract_verified_identity,
    fetch_inquiry,
    names_match,
    parse_event_id,
    parse_event_name,
    parse_inquiry_id,
    parse_reference_id,
    perform_simulate_actions,
    verify_webhook_signature,
)
from app.schemas import (
    AutoCompleteRequest,
    GenericMessageResponse,
    IdentityProfileRequest,
    IdentityStatusResponse,
    StartPersonaRequest,
    StartPersonaResponse,
)


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("identity-kyc-bot")

app = FastAPI(title="Identity Verification Bot", version="3.0.0")


def _mark_profile_approved(profile: IdentityProfile) -> None:
    now = datetime.utcnow()
    profile.kyc_status = "APPROVED"
    profile.dashboard_unlocked = True
    profile.dashboard_unlocked_at = profile.dashboard_unlocked_at or now
    profile.updated_at = now


def _load_profiles_from_file(db: Session) -> int:
    path = Path(settings.test_profiles_file)
    if not path.exists():
        logger.warning("Profiles file not found", extra={"path": str(path)})
        return 0

    raw = json.loads(path.read_text(encoding="utf-8"))
    items = raw.get("profiles", raw) if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        raise ValueError("profiles file must contain a JSON array or {\"profiles\": [...]}")

    upserts = 0
    for item in items:
        reference_id = str(item.get("reference_id") or item.get("external_id") or "").strip()
        legal_name = str(item.get("legal_name", "")).strip()
        dob_raw = str(item.get("date_of_birth", "")).strip()
        if not reference_id or not legal_name or not dob_raw:
            continue

        try:
            dob = datetime.strptime(dob_raw, "%Y-%m-%d").date()
        except ValueError:
            continue

        profile = db.execute(
            select(IdentityProfile).where(IdentityProfile.reference_id == reference_id)
        ).scalar_one_or_none()
        if profile:
            profile.legal_name = legal_name
            profile.date_of_birth = dob
            profile.updated_at = datetime.utcnow()
        else:
            db.add(
                IdentityProfile(
                    reference_id=reference_id,
                    legal_name=legal_name,
                    date_of_birth=dob,
                    kyc_status="NOT_STARTED",
                    dashboard_unlocked=False,
                )
            )
        upserts += 1

    db.commit()
    return upserts


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        count = _load_profiles_from_file(db)
        logger.info("Preloaded identity profiles", extra={"count": count})


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "identity-kyc-bot",
        "mode": "identity-only",
        "always_success_mode": settings.always_success_mode,
        "persona_style": "reference-id + webhook + inquiry-fetch",
        "profiles_file": settings.test_profiles_file,
    }


@app.get("/profiles")
def list_profiles(db: Session = Depends(get_db)):
    rows = db.execute(select(IdentityProfile).order_by(IdentityProfile.created_at.asc())).scalars().all()
    return {
        "ok": True,
        "count": len(rows),
        "profiles": [
            {
                "reference_id": row.reference_id,
                "legal_name": row.legal_name,
                "date_of_birth": row.date_of_birth.isoformat(),
                "kyc_status": row.kyc_status,
                "dashboard_unlocked": row.dashboard_unlocked,
            }
            for row in rows
        ],
    }


@app.post("/profiles/upsert", response_model=GenericMessageResponse)
def upsert_profile(payload: IdentityProfileRequest, db: Session = Depends(get_db)):
    profile = db.execute(
        select(IdentityProfile).where(IdentityProfile.reference_id == payload.reference_id.strip())
    ).scalar_one_or_none()
    if profile:
        profile.legal_name = payload.legal_name.strip()
        profile.date_of_birth = payload.date_of_birth
        profile.updated_at = datetime.utcnow()
    else:
        db.add(
            IdentityProfile(
                reference_id=payload.reference_id.strip(),
                legal_name=payload.legal_name.strip(),
                date_of_birth=payload.date_of_birth,
                kyc_status="NOT_STARTED",
                dashboard_unlocked=False,
            )
        )
    db.commit()
    return {"ok": True, "message": "Profile saved."}


@app.post("/profiles/reload", response_model=GenericMessageResponse)
def reload_profiles(db: Session = Depends(get_db)):
    count = _load_profiles_from_file(db)
    return {"ok": True, "message": f"Reloaded {count} profile entries from file."}


@app.post("/identity/persona/start", response_model=StartPersonaResponse)
def start_persona(payload: StartPersonaRequest, db: Session = Depends(get_db)):
    profile = db.execute(
        select(IdentityProfile).where(IdentityProfile.reference_id == payload.reference_id.strip())
    ).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    try:
        inquiry_id, inquiry_url = create_inquiry(
            reference_id=profile.reference_id,
            legal_name=profile.legal_name,
            date_of_birth=profile.date_of_birth,
        )
    except PersonaConfigError as error:
        if not settings.always_success_mode:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error))
        inquiry_id = f"local-success-{uuid4().hex[:16]}"
        inquiry_url = ""
        logger.warning("Persona config error; falling back to local success inquiry", exc_info=True)
    except Exception as error:
        if not settings.always_success_mode:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Persona start failed: {error}")
        inquiry_id = f"local-success-{uuid4().hex[:16]}"
        inquiry_url = ""
        logger.warning("Persona start failed; falling back to local success inquiry", exc_info=True)

    profile.persona_inquiry_id = inquiry_id
    profile.persona_inquiry_status = "inquiry.created"
    profile.kyc_status = "IN_PROGRESS"
    profile.dashboard_unlocked = False
    profile.updated_at = datetime.utcnow()
    db.add(
        IdentityEvent(
            profile_id=profile.id,
            event_name="inquiry.started",
            inquiry_id=inquiry_id,
            status="IN_PROGRESS",
            reason="Persona inquiry started",
            payload={"source": "api", "reference_id": profile.reference_id},
        )
    )
    db.commit()

    return {
        "ok": True,
        "inquiry_id": inquiry_id,
        "inquiry_url": inquiry_url,
        "status": "IN_PROGRESS",
    }


@app.post("/identity/persona/auto-complete-success", response_model=GenericMessageResponse)
def auto_complete_persona_success(payload: AutoCompleteRequest, db: Session = Depends(get_db)):
    profile = db.execute(
        select(IdentityProfile).where(IdentityProfile.reference_id == payload.reference_id.strip())
    ).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    if not profile.persona_inquiry_id:
        if not settings.always_success_mode:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No Persona inquiry found. Start inquiry first.",
            )
        profile.persona_inquiry_id = f"local-success-{uuid4().hex[:16]}"

    inquiry_id = profile.persona_inquiry_id
    try:
        actions: list[dict] = [{"type": "start_inquiry"}]
        for vt_id in payload.verification_template_ids:
            actions.append(
                {
                    "type": "create_passed_verification",
                    "data": {"verification-template-id": vt_id},
                }
            )
        actions.append({"type": "complete_inquiry"})
        perform_simulate_actions(inquiry_id, actions)
        approve_inquiry(inquiry_id)
    except Exception as error:
        if not settings.always_success_mode:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Persona auto-complete failed: {error}",
            )
        logger.warning("Persona auto-complete failed; forcing local approval", exc_info=True)

    profile.persona_inquiry_status = "inquiry.completed"
    _mark_profile_approved(profile)
    db.add(
        IdentityEvent(
            profile_id=profile.id,
            event_name="inquiry.completed",
            event_id=None,
            inquiry_id=inquiry_id,
            status="APPROVED",
            reason="sandbox-auto-complete-success-enforced",
            payload={"verification_template_ids": payload.verification_template_ids},
        )
    )
    db.commit()
    return {"ok": True, "message": "Verification completed successfully and dashboard unlocked."}


@app.get("/identity/status", response_model=IdentityStatusResponse)
def identity_status(reference_id: str = Query(..., min_length=2), db: Session = Depends(get_db)):
    profile = db.execute(
        select(IdentityProfile).where(IdentityProfile.reference_id == reference_id.strip())
    ).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return {
        "ok": True,
        "reference_id": profile.reference_id,
        "legal_name": profile.legal_name,
        "date_of_birth": profile.date_of_birth,
        "kyc_status": profile.kyc_status,
        "persona_inquiry_id": profile.persona_inquiry_id,
        "persona_inquiry_status": profile.persona_inquiry_status,
        "dashboard_unlocked": profile.dashboard_unlocked,
        "dashboard_unlocked_at": profile.dashboard_unlocked_at,
    }


@app.post("/webhooks/persona")
async def persona_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    signature = request.headers.get("persona-signature")
    if not verify_webhook_signature(signature, raw_body):
        if not settings.always_success_mode:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")
        logger.warning("Invalid Persona webhook signature accepted in always-success mode")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload")

    event_id = parse_event_id(payload)
    if event_id:
        already_seen = db.execute(
            select(IdentityEvent).where(IdentityEvent.event_id == event_id).limit(1)
        ).scalar_one_or_none()
        if already_seen:
            return {"ok": True, "message": "Duplicate webhook ignored."}

    event_name = parse_event_name(payload)
    inquiry_id = parse_inquiry_id(payload)
    profile = (
        db.execute(select(IdentityProfile).where(IdentityProfile.persona_inquiry_id == inquiry_id))
        .scalars()
        .first()
        if inquiry_id
        else None
    )

    db.add(
        IdentityEvent(
            profile_id=profile.id if profile else None,
            event_name=event_name or "unknown",
            event_id=event_id or None,
            inquiry_id=inquiry_id or None,
            status=None,
            reason=None,
            payload=payload,
        )
    )

    inquiry_payload = None
    if inquiry_id and not profile:
        try:
            inquiry_payload = fetch_inquiry(inquiry_id)
            reference_id = parse_reference_id(inquiry_payload)
            if reference_id:
                profile = db.execute(
                    select(IdentityProfile).where(IdentityProfile.reference_id == reference_id)
                ).scalar_one_or_none()
                if profile and not profile.persona_inquiry_id:
                    profile.persona_inquiry_id = inquiry_id
                    profile.updated_at = datetime.utcnow()
        except Exception:
            profile = None

    if not profile:
        db.commit()
        return {"ok": True, "message": "event logged (no profile mapped)"}

    profile.persona_inquiry_status = event_name or profile.persona_inquiry_status
    if event_name and event_name.startswith("inquiry."):
        _mark_profile_approved(profile)
        try:
            if inquiry_payload is None and inquiry_id:
                inquiry_payload = fetch_inquiry(inquiry_id)
            if inquiry_payload:
                verified_name, verified_dob = extract_verified_identity(inquiry_payload)
                expected_name = profile.legal_name
                expected_dob = profile.date_of_birth.isoformat()
                name_ok = names_match(expected_name, verified_name or "") if verified_name else None
                dob_ok = bool(verified_dob and verified_dob == expected_dob) if verified_dob else None
                db.add(
                    IdentityEvent(
                        profile_id=profile.id,
                        event_name="identity.profile_compare",
                        event_id=None,
                        inquiry_id=inquiry_id,
                        status="INFO",
                        reason=f"name_match={name_ok},dob_match={dob_ok}",
                        payload={
                            "expected_name": expected_name,
                            "verified_name": verified_name,
                            "expected_dob": expected_dob,
                            "verified_dob": verified_dob,
                        },
                    )
                )
        except Exception:
            pass

    db.commit()
    return {"ok": True}
