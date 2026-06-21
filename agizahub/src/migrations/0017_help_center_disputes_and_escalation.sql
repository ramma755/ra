ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS requires_admin_intervention BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS bot_thread_frozen BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS support_ticket_context JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requires_admin_intervention BOOLEAN NOT NULL DEFAULT FALSE;

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
      'DISPUTED_HOLD',
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
      'DISPUTED_HOLD',
      'COMPLETED',
      'FAILED'
    )
  );

CREATE INDEX IF NOT EXISTS idx_platform_users_admin_intervention
  ON platform_users(requires_admin_intervention, bot_thread_frozen, current_step);

CREATE INDEX IF NOT EXISTS idx_orders_admin_intervention
  ON orders(requires_admin_intervention, settlement_status, payment_status, created_at);
