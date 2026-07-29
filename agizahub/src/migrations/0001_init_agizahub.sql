CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS industries (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  industry_id BIGINT NOT NULL REFERENCES industries(id),
  name TEXT NOT NULL,
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(industry_id, name)
);

CREATE TABLE IF NOT EXISTS product_slang (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  wallet_type TEXT NOT NULL DEFAULT 'PHONE' CHECK (wallet_type IN ('PHONE', 'PAYBILL', 'TILL')),
  mpesa_identifier TEXT,
  account_reference TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  price_kes NUMERIC(12, 2) NOT NULL CHECK (price_kes >= 0),
  quantity_available NUMERIC(12, 2) NOT NULL DEFAULT 0,
  location_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transporters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  vehicle_type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  buyer_phone TEXT NOT NULL,
  buyer_name TEXT,
  raw_message TEXT NOT NULL,
  parsed_payload JSONB,
  product_id BIGINT REFERENCES products(id),
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  delivery_location TEXT,
  vendor_id UUID REFERENCES vendors(id),
  transporter_id UUID REFERENCES transporters(id),
  total_amount_kes NUMERIC(12, 2) NOT NULL DEFAULT 0,
  platform_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0,
  vendor_amount_kes NUMERIC(12, 2) NOT NULL DEFAULT 0,
  driver_amount_kes NUMERIC(12, 2) NOT NULL DEFAULT 0,
  otp_code_hash TEXT,
  otp_expires_at TIMESTAMPTZ,
  payment_status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (
    payment_status IN (
      'PENDING_PAYMENT',
      'PAID_HELD',
      'PAYMENT_FAILED',
      'REFUNDED'
    )
  ),
  settlement_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (
    settlement_status IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'COMPLETED',
      'FAILED'
    )
  ),
  distribution_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (
    distribution_status IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'COMPLETED',
      'FAILED'
    )
  ),
  collected_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  delivery_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0,
  mpesa_checkout_request_id TEXT UNIQUE,
  mpesa_receipt_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mpesa_stk_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  checkout_request_id TEXT NOT NULL UNIQUE,
  merchant_request_id TEXT,
  amount_kes NUMERIC(12, 2) NOT NULL,
  msisdn TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (
    status IN ('REQUESTED', 'SUCCESS', 'FAILED')
  ),
  result_code TEXT,
  result_desc TEXT,
  mpesa_receipt_number TEXT,
  raw_response JSONB,
  raw_callback JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(payment_status, settlement_status, distribution_status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_phone ON orders(buyer_phone);
CREATE INDEX IF NOT EXISTS idx_inventory_product_active ON vendor_inventory(product_id, is_active);
