ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS seller_logistics_mode TEXT NOT NULL DEFAULT 'AGIZAHUB_MATCHING';

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_seller_logistics_mode_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_seller_logistics_mode_check
  CHECK (
    seller_logistics_mode IN (
      'PENDING_SELLER_DECISION',
      'SELLER_OWN_TRANSPORT',
      'AGIZAHUB_MATCHING'
    )
  );

UPDATE orders
SET seller_logistics_mode = 'AGIZAHUB_MATCHING'
WHERE seller_logistics_mode IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_supply_logistics_mode
  ON orders(order_type, seller_logistics_mode, payment_status, created_at);
