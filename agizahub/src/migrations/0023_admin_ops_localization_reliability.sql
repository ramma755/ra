ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'EN';

ALTER TABLE platform_users
  DROP CONSTRAINT IF EXISTS platform_users_preferred_language_check;

ALTER TABLE platform_users
  ADD CONSTRAINT platform_users_preferred_language_check
  CHECK (preferred_language IN ('EN', 'SW'));

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS delivery_address_label TEXT;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS seller_tier TEXT NOT NULL DEFAULT 'FREE';

ALTER TABLE platform_users
  DROP CONSTRAINT IF EXISTS platform_users_seller_tier_check;

ALTER TABLE platform_users
  ADD CONSTRAINT platform_users_seller_tier_check
  CHECK (seller_tier IN ('FREE', 'PREMIUM'));

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS flash_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS flash_discount_ends_at TIMESTAMPTZ;

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS promoted_until TIMESTAMPTZ;

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS bulk_discount_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS restock_alert_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  buyer_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id) ON DELETE CASCADE,
  catalog_item_id BIGINT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (buyer_masked_id, catalog_item_id)
);

CREATE INDEX IF NOT EXISTS idx_restock_alerts_item
  ON restock_alert_subscriptions(catalog_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outbound_message_queue (
  id BIGSERIAL PRIMARY KEY,
  to_phone TEXT NOT NULL,
  message_text TEXT NOT NULL,
  interactive_list JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_retry
  ON outbound_message_queue(status, next_attempt_at, created_at);
