
CREATE TABLE public.reimbursement_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL,
  reimbursable_to text NOT NULL DEFAULT 'employer',
  report_id text,
  status text NOT NULL DEFAULT 'pending',
  total_expected numeric NOT NULL DEFAULT 0,
  total_received numeric NOT NULL DEFAULT 0,
  submitted_date date,
  received_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reimbursement_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner access reimbursement_groups"
  ON public.reimbursement_groups
  FOR ALL
  TO public
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

ALTER TABLE public.transactions_uploaded
  ADD COLUMN linked_reimbursement_group_id uuid REFERENCES public.reimbursement_groups(id);
