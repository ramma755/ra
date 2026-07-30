CREATE TABLE IF NOT EXISTS route_distance_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key TEXT NOT NULL UNIQUE,
  origin_latitude NUMERIC(9, 6),
  origin_longitude NUMERIC(9, 6),
  destination_latitude NUMERIC(9, 6),
  destination_longitude NUMERIC(9, 6),
  distance_km NUMERIC(10, 2) NOT NULL CHECK (distance_km >= 0),
  provider TEXT NOT NULL,
  hit_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transport_job_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id),
  requested_vehicle_type TEXT NOT NULL CHECK (
    requested_vehicle_type IN ('MOTORBIKE', 'TUKTUK_PICKUP', 'CANTER_TRUCK')
  ),
  corridor_key TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'SENT', 'CLAIMED', 'SKIPPED', 'EXPIRED')
  ),
  skip_reason TEXT,
  sent_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, driver_masked_id)
);

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS transporter_vehicle_type TEXT CHECK (
    transporter_vehicle_type IN ('MOTORBIKE', 'TUKTUK_PICKUP', 'CANTER_TRUCK')
  );

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS service_corridor_label TEXT;

CREATE INDEX IF NOT EXISTS idx_route_distance_cache_updated
  ON route_distance_cache(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_driver_status
  ON transport_job_broadcasts(driver_masked_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_order_status
  ON transport_job_broadcasts(order_id, status);
