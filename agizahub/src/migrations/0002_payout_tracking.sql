CREATE TABLE IF NOT EXISTS mpesa_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  leg_type TEXT NOT NULL CHECK (leg_type IN ('VENDOR', 'DRIVER', 'PLATFORM', 'REFUND')),
  channel TEXT NOT NULL CHECK (channel IN ('B2C', 'B2B')),
  destination_type TEXT NOT NULL CHECK (destination_type IN ('PHONE', 'PAYBILL', 'TILL')),
  destination_identifier TEXT NOT NULL,
  amount_kes NUMERIC(12, 2) NOT NULL CHECK (amount_kes >= 0),
  conversation_id TEXT,
  originator_conversation_id TEXT,
  third_party_trans_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'SUBMITTED', 'SUCCESS', 'FAILED', 'TIMEOUT')
  ),
  result_code TEXT,
  result_desc TEXT,
  raw_request JSONB,
  raw_response JSONB,
  raw_callback JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mpesa_payout_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  leg_kind TEXT NOT NULL CHECK (leg_kind IN ('VENDOR', 'DRIVER', 'PLATFORM', 'REFUND')),
  recipient_name TEXT,
  destination_type TEXT NOT NULL CHECK (destination_type IN ('PHONE', 'PAYBILL', 'TILL')),
  destination_identifier TEXT NOT NULL,
  account_reference TEXT,
  amount_kes NUMERIC(12, 2) NOT NULL CHECK (amount_kes >= 0),
  mpesa_disbursement_id UUID REFERENCES mpesa_disbursements(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'SUBMITTED', 'SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED')
  ),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disbursements_order ON mpesa_disbursements(order_id);
CREATE INDEX IF NOT EXISTS idx_disbursements_status ON mpesa_disbursements(status);
CREATE INDEX IF NOT EXISTS idx_payout_legs_order ON mpesa_payout_legs(order_id);
CREATE INDEX IF NOT EXISTS idx_payout_legs_status ON mpesa_payout_legs(status);
