
ALTER TABLE public.transactions_uploaded 
  ADD COLUMN IF NOT EXISTS is_split_parent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_transaction_id uuid REFERENCES public.transactions_uploaded(id) ON DELETE CASCADE;
