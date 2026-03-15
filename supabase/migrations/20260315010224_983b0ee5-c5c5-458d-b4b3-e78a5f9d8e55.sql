CREATE TABLE public.income_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  date date,
  description_raw text,
  description_normalized text,
  amount numeric,
  income_type text NOT NULL DEFAULT 'other',
  taxable_status text NOT NULL DEFAULT 'unknown',
  source_account_name text,
  linked_expense_id uuid REFERENCES public.transactions_uploaded(id),
  linked_reimbursement_group_id uuid REFERENCES public.reimbursement_groups(id),
  allocation_month text,
  status text NOT NULL DEFAULT 'needs_review',
  notes text,
  source_file_name text,
  upload_batch_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.income_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner access income_transactions"
  ON public.income_transactions
  FOR ALL
  TO public
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);