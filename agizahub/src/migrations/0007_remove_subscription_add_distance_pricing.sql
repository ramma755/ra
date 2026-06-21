ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS hub_latitude NUMERIC(9, 6);

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS hub_longitude NUMERIC(9, 6);

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS delivery_latitude NUMERIC(9, 6);

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS delivery_longitude NUMERIC(9, 6);

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS pending_order_id UUID REFERENCES orders(id);

ALTER TABLE platform_users
  DROP COLUMN IF EXISTS subscription_fee_kes;

ALTER TABLE platform_users
  DROP COLUMN IF EXISTS subscription_tier;

ALTER TABLE vendors
  DROP COLUMN IF EXISTS is_premium;

ALTER TABLE vendors
  DROP COLUMN IF EXISTS premium_fee_kes;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS base_transport_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS extra_distance_km NUMERIC(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS extra_distance_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS raw_transport_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transport_rate_payload JSONB;

ALTER TABLE orders
  DROP COLUMN IF EXISTS premium_supplier_fee_kes;

ALTER TABLE orders
  DROP COLUMN IF EXISTS is_premium_supplier;
