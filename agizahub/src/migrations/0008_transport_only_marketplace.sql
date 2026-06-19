ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS pending_transport_payload JSONB;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'SUPPLY' CHECK (
    order_type IN ('SUPPLY', 'TRANSPORT_ONLY')
  );

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transport_job_category TEXT CHECK (
    transport_job_category IN ('COMMERCIAL_FREIGHT', 'PERSONAL_RELOCATION')
  );

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requested_vehicle_type TEXT CHECK (
    requested_vehicle_type IN ('MOTORBIKE', 'TUKTUK_PICKUP', 'CANTER_TRUCK')
  );

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_location_label TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requester_commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requester_commission_kes NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transporter_commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS transporter_commission_kes NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_transport_open
  ON orders(order_type, transport_job_category, requested_vehicle_type, payment_status, created_at);
