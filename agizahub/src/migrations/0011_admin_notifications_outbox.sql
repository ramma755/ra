CREATE TABLE IF NOT EXISTS admin_notifications_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('WHATSAPP', 'TELEGRAM', 'DASHBOARD', 'LOG')),
  destination TEXT NOT NULL,
  message_text TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_status_created
  ON admin_notifications_outbox(status, created_at DESC);
