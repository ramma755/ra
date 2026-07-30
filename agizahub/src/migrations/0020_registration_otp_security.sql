ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS registration_otp_hash TEXT;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS registration_otp_expires_at TIMESTAMPTZ;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS registration_otp_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_platform_users_phone_verification
  ON platform_users(phone_verified, current_step, created_at);
