
-- Add V2 fields to transactions_uploaded
ALTER TABLE public.transactions_uploaded
  ADD COLUMN IF NOT EXISTS transaction_mode text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS economic_owner text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS treatment_type text NOT NULL DEFAULT 'expense',
  ADD COLUMN IF NOT EXISTS counts_toward_true_personal_spend boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS counts_toward_true_business_spend boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclude_from_cash_spend_reporting boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_reimbursable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reimbursable_to text,
  ADD COLUMN IF NOT EXISTS reimbursement_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS tax_treatment text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS tax_entity text,
  ADD COLUMN IF NOT EXISTS counts_as_tax_deduction boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_non_expense_cash_movement boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_or_project_tag text,
  ADD COLUMN IF NOT EXISTS business_purpose text,
  ADD COLUMN IF NOT EXISTS receipt_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_attached boolean NOT NULL DEFAULT false;

-- Add V2 fields to merchant_memory
ALTER TABLE public.merchant_memory
  ADD COLUMN IF NOT EXISTS default_transaction_mode text,
  ADD COLUMN IF NOT EXISTS default_tax_treatment text,
  ADD COLUMN IF NOT EXISTS default_reimbursable boolean NOT NULL DEFAULT false;

-- Backfill existing transaction data
UPDATE public.transactions_uploaded SET transaction_mode = mode;

UPDATE public.transactions_uploaded SET
  economic_owner = 'artist_influence',
  counts_toward_true_personal_spend = false,
  counts_toward_true_business_spend = true
WHERE mode = 'business';

UPDATE public.transactions_uploaded SET
  is_non_expense_cash_movement = true,
  counts_toward_true_personal_spend = false,
  counts_toward_true_business_spend = false,
  treatment_type = 'transfer'
WHERE is_transfer = true;
