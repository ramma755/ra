CREATE TABLE IF NOT EXISTS wallet_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_name TEXT NOT NULL UNIQUE,
  current_balance_kes NUMERIC(14, 2) NOT NULL DEFAULT 0,
  available_balance_kes NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS treasury_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_name TEXT NOT NULL UNIQUE,
  policy_value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS treasury_sweeps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_kes NUMERIC(14, 2) NOT NULL CHECK (amount_kes > 0),
  status TEXT NOT NULL CHECK (
    status IN ('REQUESTED', 'APPROVED', 'SUBMITTED', 'FAILED', 'COMPLETED')
  ),
  requested_by TEXT,
  approved_by TEXT,
  provider_reference TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('DAILY', 'ON_DEMAND')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  exceptions_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL,
  reference_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS treasury_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  event_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO wallet_balances (wallet_name, current_balance_kes, available_balance_kes)
VALUES ('platform_commission', 0, 0)
ON CONFLICT (wallet_name) DO NOTHING;

INSERT INTO treasury_policy (policy_name, policy_value)
VALUES (
  'default',
  '{"require_dual_approval_above_kes": 250000, "auto_sweep_enabled": true}'
)
ON CONFLICT (policy_name) DO NOTHING;
