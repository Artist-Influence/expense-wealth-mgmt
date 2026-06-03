-- =====================================================================
-- PHASE 5: Soft-delete foundation
-- =====================================================================
ALTER TABLE public.transactions_uploaded   ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE public.income_transactions     ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE public.reimbursement_groups    ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE public.allocation_plans        ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE public.investment_accounts     ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE public.account_balance_snapshots ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_txn_not_deleted     ON public.transactions_uploaded (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_income_not_deleted  ON public.income_transactions (owner_id) WHERE deleted_at IS NULL;