ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_progress_status TEXT NOT NULL DEFAULT 'CREATED';

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_order_progress_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_order_progress_status_check
  CHECK (
    order_progress_status IN (
      'CREATED',
      'PACKED',
      'EN_ROUTE',
      'DELIVERED',
      'CANCELLED'
    )
  );

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS low_stock_threshold INT NOT NULL DEFAULT 10 CHECK (low_stock_threshold >= 0);

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS referred_by_masked_id VARCHAR(5) REFERENCES platform_users(masked_id);

CREATE TABLE IF NOT EXISTS order_line_items (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  catalog_item_id BIGINT REFERENCES catalog_items(id),
  seller_masked_id VARCHAR(5) REFERENCES platform_users(masked_id),
  commodity_name TEXT NOT NULL,
  unit_price_kes NUMERIC(12, 2) NOT NULL CHECK (unit_price_kes >= 0),
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  line_total_kes NUMERIC(12, 2) NOT NULL CHECK (line_total_kes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_line_items_order
  ON order_line_items(order_id, created_at);

CREATE TABLE IF NOT EXISTS cart_items (
  id BIGSERIAL PRIMARY KEY,
  buyer_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id) ON DELETE CASCADE,
  catalog_item_id BIGINT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  seller_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id),
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(buyer_masked_id, catalog_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_buyer
  ON cart_items(buyer_masked_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id BIGSERIAL PRIMARY KEY,
  buyer_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id) ON DELETE CASCADE,
  catalog_item_id BIGINT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(buyer_masked_id, catalog_item_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_buyer
  ON wishlist_items(buyer_masked_id, created_at DESC);

CREATE TABLE IF NOT EXISTS seller_ratings (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  buyer_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id),
  seller_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id, buyer_masked_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_ratings_seller
  ON seller_ratings(seller_masked_id, created_at DESC);

CREATE TABLE IF NOT EXISTS loyalty_wallets (
  buyer_masked_id VARCHAR(5) PRIMARY KEY REFERENCES platform_users(masked_id) ON DELETE CASCADE,
  points_balance INT NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_points_ledger (
  id BIGSERIAL PRIMARY KEY,
  buyer_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id) ON DELETE CASCADE,
  points_delta INT NOT NULL,
  reason TEXT NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_buyer
  ON loyalty_points_ledger(buyer_masked_id, created_at DESC);

CREATE TABLE IF NOT EXISTS referral_codes (
  owner_masked_id VARCHAR(5) PRIMARY KEY REFERENCES platform_users(masked_id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id),
  referred_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id),
  reward_points_granted INT NOT NULL DEFAULT 0 CHECK (reward_points_granted >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(referred_masked_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON referrals(referrer_masked_id, created_at DESC);

CREATE TABLE IF NOT EXISTS seller_payout_requests (
  id BIGSERIAL PRIMARY KEY,
  seller_masked_id VARCHAR(5) NOT NULL REFERENCES platform_users(masked_id),
  amount_kes NUMERIC(12, 2) NOT NULL CHECK (amount_kes > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'FAILED')
  ),
  approved_by_phone TEXT,
  disbursement_reference TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_payout_requests_status
  ON seller_payout_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS promo_broadcasts (
  id BIGSERIAL PRIMARY KEY,
  created_by_phone TEXT NOT NULL,
  target_role TEXT NOT NULL CHECK (
    target_role IN ('BUYER', 'SUPPLIER', 'TRANSPORTER', 'ALL')
  ),
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (
    status IN ('QUEUED', 'SENT', 'FAILED')
  ),
  sent_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_progress_status
  ON orders(order_progress_status, payment_status, created_at DESC);
