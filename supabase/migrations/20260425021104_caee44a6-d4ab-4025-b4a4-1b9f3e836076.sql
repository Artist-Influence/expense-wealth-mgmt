ALTER TABLE public.investment_accounts
  ADD COLUMN IF NOT EXISTS starting_balance_year numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_track_pattern text;