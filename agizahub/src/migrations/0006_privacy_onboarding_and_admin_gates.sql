CREATE TABLE IF NOT EXISTS platform_users (
  id BIGSERIAL PRIMARY KEY,
  phone_number VARCHAR(30) UNIQUE NOT NULL,
  user_type VARCHAR(30) CHECK (
    user_type IN (
      'BUYER',
      'SUPPLIER',
      'TRANSPORTER_BIKE',
      'TRANSPORTER_TRUCK',
      'ADMIN'
    )
  ),
  masked_id VARCHAR(5) UNIQUE NOT NULL CHECK (masked_id ~ '^[0-9]{5}$'),
  company_name VARCHAR(100),
  current_step VARCHAR(40) NOT NULL DEFAULT 'START',
  payment_mode VARCHAR(20) CHECK (payment_mode IN ('SEND_MONEY', 'PAYBILL', 'TILL')),
  business_number VARCHAR(30),
  account_number VARCHAR(50),
  payout_phone VARCHAR(20),
  subscription_tier VARCHAR(20) NOT NULL DEFAULT 'STANDARD' CHECK (
    subscription_tier IN ('STANDARD', 'PREMIUM')
  ),
  subscription_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_verified_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id BIGSERIAL PRIMARY KEY,
  seller_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id),
  commodity_name VARCHAR(50) NOT NULL,
  price_per_unit INT NOT NULL CHECK (price_per_unit > 0),
  unit_measure VARCHAR(20) NOT NULL DEFAULT '50kg bag',
  location_label VARCHAR(80) NOT NULL DEFAULT 'Njabini Hub',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_action_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  actor_phone TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS premium_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 1500;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS buyer_masked_id VARCHAR(5) REFERENCES platform_users(masked_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS supplier_masked_id VARCHAR(5) REFERENCES platform_users(masked_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transporter_masked_id VARCHAR(5) REFERENCES platform_users(masked_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS release_requested_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS release_approved_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS released_by_admin_phone TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_decision_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_decided_by_phone TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5, 2);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS logistics_premium_percent NUMERIC(5, 2) NOT NULL DEFAULT 10;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS matching_commission_kes NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS logistics_premium_kes NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS premium_supplier_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_premium_supplier BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (
    payment_status IN (
      'PENDING_PAYMENT',
      'PAID_HELD',
      'PAYMENT_FAILED',
      'REFUND_REQUESTED',
      'REFUNDED'
    )
  );

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_settlement_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_settlement_status_check
  CHECK (
    settlement_status IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'AWAITING_RELEASE',
      'ON_HOLD',
      'COMPLETED',
      'FAILED',
      'REFUND_IN_PROGRESS'
    )
  );

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_distribution_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_distribution_status_check
  CHECK (
    distribution_status IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'AWAITING_RELEASE',
      'ON_HOLD',
      'COMPLETED',
      'FAILED'
    )
  );

CREATE INDEX IF NOT EXISTS idx_platform_users_phone ON platform_users(phone_number);
CREATE INDEX IF NOT EXISTS idx_platform_users_masked ON platform_users(masked_id);
CREATE INDEX IF NOT EXISTS idx_platform_users_type_step ON platform_users(user_type, current_step);
CREATE INDEX IF NOT EXISTS idx_catalog_items_seller_active ON catalog_items(seller_masked_id, is_active);
CREATE INDEX IF NOT EXISTS idx_admin_action_events_order ON admin_action_events(order_id, created_at);
