-- Layer 1: classification helper columns on transactions_uploaded
ALTER TABLE public.transactions_uploaded
  ADD COLUMN IF NOT EXISTS is_internal_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS recurring_group_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence_frequency text,
  ADD COLUMN IF NOT EXISTS expected_next_date date;

CREATE INDEX IF NOT EXISTS idx_txn_treatment_type ON public.transactions_uploaded (owner_id, treatment_type);
CREATE INDEX IF NOT EXISTS idx_txn_direction ON public.transactions_uploaded (owner_id, direction);

-- Finance preferences for affordability / runway / tax tooling (single owner row in app_settings)
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS min_personal_cash_buffer numeric NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS min_business_cash_buffer numeric NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS tax_reserve_percent numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS monthly_savings_goal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_personal_spend_limit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_business_expense_target numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_basis text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS report_excluded_categories text[] NOT NULL DEFAULT '{}';