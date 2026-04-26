ALTER TABLE public.app_settings 
  ADD COLUMN IF NOT EXISTS last_health_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_health_check_summary jsonb;

ALTER TABLE public.income_transactions 
  ADD COLUMN IF NOT EXISTS duplicate_status text NOT NULL DEFAULT 'unique',
  ADD COLUMN IF NOT EXISTS duplicate_of_income_id uuid;

CREATE INDEX IF NOT EXISTS idx_income_dup_lookup 
  ON public.income_transactions(owner_id, date, amount);