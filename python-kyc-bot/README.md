# Python Identity Verification Bot (Persona Sandbox)

Identity-only orchestration service for testing ID/DL + selfie verification with Persona.

No email auth, no phone OTP, no admin manual approve/fail.

## How it works (Persona <-> your platform)

This follows Persona's recommended production pattern:

1. Your frontend asks backend to start an inquiry.
2. Backend creates Persona inquiry (`reference-id` = your user external id) and returns inquiry URL.
3. Frontend opens Persona flow (ID front/back + selfie).
4. Persona sends webhook events to your backend.
5. Backend verifies `Persona-Signature` (HMAC on raw body).
6. Backend fetches authoritative inquiry data from Persona API.
7. Backend compares verified Name + DOB to your expected profile.
8. Backend sets final status automatically:
   - `APPROVED` -> unlock
   - `FAILED` / `NEEDS_REVIEW` -> stay locked

## 1) Editable file before running bot

Edit this file first:

`profiles.json`

```json
{
  "profiles": [
    {
      "external_id": "test-user-001",
      "legal_name": "Jane Wanjiku Doe",
      "date_of_birth": "1997-08-11"
    }
  ]
}
```

This file is loaded automatically on startup.

## 2) Install

```bash
cd python-kyc-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set Persona sandbox values in `.env`:

- `PERSONA_API_KEY`
- `PERSONA_TEMPLATE_ID`
- `PERSONA_WEBHOOK_SECRET`

## 3) Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

## 4) API

### List loaded test profiles
`GET /profiles`

### Update or add one profile
`POST /profiles/upsert`

```json
{
  "external_id": "test-user-003",
  "legal_name": "Alice Njeri",
  "date_of_birth": "1999-01-09"
}
```

### Reload profiles from editable file
`POST /profiles/reload`

### Start Persona inquiry
`POST /identity/persona/start`

```json
{
  "external_id": "test-user-001"
}
```

Response includes:

- `inquiry_id`
- `inquiry_url`
- `status`

### Auto-complete the Persona step in sandbox (your screenshot step)
`POST /identity/persona/auto-complete-success`

```json
{
  "external_id": "test-user-001",
  "verification_template_ids": []
}
```

Use this after opening/starting inquiry in test mode when you want automation to push the inquiry to success.

- Internally runs Persona simulate actions
- Then calls Persona `approve inquiry`
- Updates local status to APPROVED immediately (webhook later reconciles)

### Check identity status
`GET /identity/status?external_id=test-user-001`

## 5) Persona webhook setup

Set webhook URL:

`POST /webhooks/persona`

Recommended events:

- `inquiry.created`
- `inquiry.started`
- `inquiry.completed`
- `inquiry.approved`
- `inquiry.declined`
- `inquiry.failed`
- `inquiry.marked-for-review`

### Recommended Persona dashboard setup for clean automation

In Sandbox Workflows:
1. Trigger: `inquiry.completed`
2. Action: `Approve Inquiry`

This mirrors real provider-side orchestration where your backend waits for `inquiry.approved` as final actionable status.

## 6) Name + DOB matching rules

- Name normalized (lowercase, punctuation removed, spaces collapsed)
- Signup/profile name tokens must all be present in verified name
- DOB must match exact date (`YYYY-MM-DD`)

All decisions are automatic; no admin approval path.
