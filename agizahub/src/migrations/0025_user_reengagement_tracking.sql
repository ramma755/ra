ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS last_inbound_message_at TIMESTAMPTZ;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS last_reengagement_prompt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_users_last_inbound_message
  ON platform_users(last_inbound_message_at DESC);
