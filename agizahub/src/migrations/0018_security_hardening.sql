CREATE TABLE IF NOT EXISTS webhook_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  route_path TEXT NOT NULL,
  method TEXT NOT NULL,
  caller_ip TEXT,
  sender_phone TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  headers JSONB,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sender_abuse_controls (
  phone_number TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 0,
  muted_until TIMESTAMPTZ,
  banned_until TIMESTAMPTZ,
  violation_count INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_phone TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_access_sessions (
  admin_phone TEXT PRIMARY KEY,
  verified_until TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_created
  ON webhook_request_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_sender
  ON webhook_request_logs(sender_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sender_abuse_blocking
  ON sender_abuse_controls(muted_until, banned_until, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_access_tokens_phone
  ON admin_access_tokens(admin_phone, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_stk_receipt_number
  ON mpesa_stk_transactions(mpesa_receipt_number)
  WHERE mpesa_receipt_number IS NOT NULL;
