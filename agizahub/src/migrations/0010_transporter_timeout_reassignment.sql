ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transporter_assigned_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transporter_reassignment_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_transporter_timeout
  ON orders(transporter_assigned_at, settlement_status, payment_status)
  WHERE transporter_masked_id IS NOT NULL;
