import hashlib
import hmac
import json
import re
from datetime import date
from typing import Any

import requests
from dateutil import parser as date_parser

from app.config import settings


class PersonaConfigError(RuntimeError):
    pass


def _require_persona_ready() -> None:
    required = [settings.persona_api_key, settings.persona_template_id, settings.persona_base_url]
    if any(not value or value == "NONE" for value in required):
        raise PersonaConfigError("Persona config missing. Set PERSONA_API_KEY, PERSONA_TEMPLATE_ID, PERSONA_BASE_URL.")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.persona_api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def create_inquiry(*, reference_id: str, legal_name: str, date_of_birth: date) -> tuple[str, str]:
    _require_persona_ready()
    endpoint = f"{settings.persona_base_url.rstrip('/')}/inquiries"
    payload = {
        "data": {
            "type": "inquiry",
            "attributes": {
                "reference-id": str(reference_id),
                "note": f"signup_name={legal_name};signup_dob={date_of_birth.isoformat()}",
            },
            "relationships": {
                "inquiry-template": {
                    "data": {
                        "type": "inquiry-template",
                        "id": settings.persona_template_id,
                    }
                }
            },
        }
    }
    response = requests.post(endpoint, json=payload, headers=_headers(), timeout=30)
    response.raise_for_status()
    data = response.json()["data"]
    inquiry_id = data["id"]
    inquiry_url = f"https://withpersona.com/verify?inquiry-id={inquiry_id}"
    return inquiry_id, inquiry_url


def fetch_inquiry(inquiry_id: str) -> dict[str, Any]:
    _require_persona_ready()
    endpoint = f"{settings.persona_base_url.rstrip('/')}/inquiries/{inquiry_id}"
    params = {"include": "verifications,reports,sessions"}
    response = requests.get(endpoint, headers=_headers(), params=params, timeout=30)
    response.raise_for_status()
    return response.json()


def verify_webhook_signature(signature_header: str | None, raw_body: bytes) -> bool:
    secret = settings.persona_webhook_secret
    if not secret or secret == "NONE":
        return False
    if not signature_header:
        return False

    parsed: dict[str, str] = {}
    for piece in signature_header.split(","):
        if "=" not in piece:
            continue
        k, v = piece.split("=", 1)
        parsed[k.strip()] = v.strip()

    timestamp = parsed.get("t")
    signature_v1 = parsed.get("v1")
    if not timestamp or not signature_v1:
        return False

    signed_payload = f"{timestamp}.{raw_body.decode('utf-8')}"
    digest = hmac.new(secret.encode("utf-8"), signed_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature_v1)


def parse_event_name(webhook_json: dict[str, Any]) -> str:
    return str(
        webhook_json.get("data", {}).get("attributes", {}).get("name", "")
        or webhook_json.get("name", "")
        or webhook_json.get("event", "")
    ).strip().lower()


def parse_inquiry_id(webhook_json: dict[str, Any]) -> str:
    relationships = webhook_json.get("data", {}).get("relationships", {}) or {}
    inquiry = relationships.get("inquiry", {}).get("data", {}) or {}
    if inquiry.get("id"):
        return str(inquiry.get("id", "")).strip()

    payload_data = (
        webhook_json.get("data", {})
        .get("attributes", {})
        .get("payload", {})
        .get("data", {})
    )
    return str(payload_data.get("id", "")).strip()


def parse_event_id(webhook_json: dict[str, Any]) -> str:
    return str(webhook_json.get("data", {}).get("id", "")).strip()


def parse_reference_id(inquiry_payload: dict[str, Any]) -> str:
    return str(
        inquiry_payload.get("data", {}).get("attributes", {}).get("reference-id", "")
    ).strip()


def _normalize_name(raw_name: str) -> str:
    lowered = raw_name.lower()
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def names_match(signup_name: str, extracted_name: str) -> bool:
    if not signup_name or not extracted_name:
        return False
    a = _normalize_name(signup_name)
    b = _normalize_name(extracted_name)
    if a == b:
        return True
    signup_tokens = [t for t in a.split(" ") if t]
    extracted_tokens = [t for t in b.split(" ") if t]
    if not signup_tokens or not extracted_tokens:
        return False
    return all(token in extracted_tokens for token in signup_tokens)


def _safe_date(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        return date_parser.parse(raw).date().isoformat()
    except Exception:
        return None


def extract_verified_identity(inquiry_payload: dict[str, Any]) -> tuple[str | None, str | None]:
    data = inquiry_payload.get("data", {})
    attrs = data.get("attributes", {})

    possible_names = [
        attrs.get("name"),
        attrs.get("name-full"),
        attrs.get("name-first"),
        attrs.get("name-last"),
    ]
    possible_dobs = [attrs.get("birthdate"), attrs.get("date-of-birth"), attrs.get("dob")]

    included = inquiry_payload.get("included", []) or []
    for item in included:
        item_attrs = item.get("attributes", {}) or {}
        possible_names.extend(
            [
                item_attrs.get("name"),
                item_attrs.get("name-full"),
                item_attrs.get("name-first"),
                item_attrs.get("name-middle"),
                item_attrs.get("name-last"),
                item_attrs.get("full-name"),
            ]
        )
        possible_dobs.extend(
            [
                item_attrs.get("birthdate"),
                item_attrs.get("date-of-birth"),
                item_attrs.get("dob"),
                item_attrs.get("birth-date"),
            ]
        )
        # Some providers nest extracted values in "fields"
        fields = item_attrs.get("fields") or {}
        if isinstance(fields, dict):
            for key, value in fields.items():
                if isinstance(value, dict):
                    v = value.get("value")
                else:
                    v = value
                k = str(key).lower()
                if "name" in k:
                    possible_names.append(v)
                if "birth" in k or "dob" in k:
                    possible_dobs.append(v)

    verified_name = next((str(v).strip() for v in possible_names if v and str(v).strip()), None)
    verified_dob = next((d for d in (_safe_date(str(v)) for v in possible_dobs if v) if d), None)
    return verified_name, verified_dob


def to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True)
