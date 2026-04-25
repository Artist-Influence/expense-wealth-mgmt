ALTER TABLE public.investment_accounts
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'personal';

ALTER TABLE public.investment_accounts
  DROP CONSTRAINT IF EXISTS investment_accounts_mode_check;

ALTER TABLE public.investment_accounts
  ADD CONSTRAINT investment_accounts_mode_check
  CHECK (mode IN ('personal', 'business'));