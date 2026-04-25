-- Add mode column to income_transactions
ALTER TABLE public.income_transactions
  ADD COLUMN mode text NOT NULL DEFAULT 'personal';

-- Backfill: existing business_revenue rows → business
UPDATE public.income_transactions
  SET mode = 'business'
  WHERE income_type = 'business_revenue';

-- Index for fast mode filtering per owner
CREATE INDEX IF NOT EXISTS idx_income_transactions_owner_mode
  ON public.income_transactions(owner_id, mode);