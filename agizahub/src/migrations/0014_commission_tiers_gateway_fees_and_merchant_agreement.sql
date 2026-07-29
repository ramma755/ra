ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS incoming_gateway_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (incoming_gateway_fee_kes >= 0);

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS merchant_agreement_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS merchant_agreement_accepted_at TIMESTAMPTZ;

ALTER TABLE platform_users
  DROP CONSTRAINT IF EXISTS platform_users_merchant_agreement_status_check;

ALTER TABLE platform_users
  ADD CONSTRAINT platform_users_merchant_agreement_status_check
  CHECK (merchant_agreement_status IN ('PENDING', 'ACCEPTED', 'REJECTED'));

CREATE INDEX IF NOT EXISTS idx_platform_users_merchant_agreement
  ON platform_users(merchant_agreement_status, user_type, current_step);
