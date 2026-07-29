ALTER TABLE mpesa_payout_legs
  ADD COLUMN IF NOT EXISTS gross_amount_kes NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (gross_amount_kes >= 0);

ALTER TABLE mpesa_payout_legs
  ADD COLUMN IF NOT EXISTS processing_fee_kes NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (processing_fee_kes >= 0);

UPDATE mpesa_payout_legs
SET gross_amount_kes = amount_kes
WHERE gross_amount_kes = 0
  AND amount_kes > 0;

CREATE INDEX IF NOT EXISTS idx_payout_legs_fee_audit
  ON mpesa_payout_legs(order_id, leg_kind, processing_fee_kes);
