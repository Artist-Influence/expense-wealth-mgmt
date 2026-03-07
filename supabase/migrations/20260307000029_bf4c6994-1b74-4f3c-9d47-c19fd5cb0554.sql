
-- Add new columns to transactions_uploaded
ALTER TABLE public.transactions_uploaded
  ADD COLUMN IF NOT EXISTS source_row_json jsonb,
  ADD COLUMN IF NOT EXISTS source_file_name text,
  ADD COLUMN IF NOT EXISTS parse_status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS parse_error text,
  ADD COLUMN IF NOT EXISTS duplicate_fingerprint text,
  ADD COLUMN IF NOT EXISTS duplicate_status text NOT NULL DEFAULT 'unique',
  ADD COLUMN IF NOT EXISTS duplicate_of_transaction_id uuid REFERENCES public.transactions_uploaded(id),
  ADD COLUMN IF NOT EXISTS is_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclude_from_expense_totals boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_type text;

-- Add new columns to app_settings
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS prevent_exact_duplicates boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS flag_possible_duplicates boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exclude_transfers_from_totals boolean NOT NULL DEFAULT true;

-- Add new columns to upload_batches
ALTER TABLE public.upload_batches
  ADD COLUMN IF NOT EXISTS exact_duplicates_skipped integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS possible_duplicates_flagged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfers_detected integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parse_errors integer NOT NULL DEFAULT 0;

-- Index for duplicate fingerprint lookups
CREATE INDEX IF NOT EXISTS idx_transactions_dup_fingerprint ON public.transactions_uploaded(duplicate_fingerprint) WHERE duplicate_fingerprint IS NOT NULL;
