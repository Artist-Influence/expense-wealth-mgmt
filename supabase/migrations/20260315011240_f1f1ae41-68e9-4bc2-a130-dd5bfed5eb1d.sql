
-- investment_accounts
CREATE TABLE public.investment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  account_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'brokerage',
  platform text,
  current_balance numeric NOT NULL DEFAULT 0,
  contribution_target_monthly numeric NOT NULL DEFAULT 0,
  contribution_target_yearly numeric NOT NULL DEFAULT 0,
  contributions_ytd numeric NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investment_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner access investment_accounts"
  ON public.investment_accounts FOR ALL TO public
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_investment_accounts_updated_at
  BEFORE UPDATE ON public.investment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- allocation_plans
CREATE TABLE public.allocation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  month text NOT NULL,
  total_income numeric NOT NULL DEFAULT 0,
  total_expenses numeric NOT NULL DEFAULT 0,
  tax_reserve_amount numeric NOT NULL DEFAULT 0,
  emergency_fund_amount numeric NOT NULL DEFAULT 0,
  free_cash numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.allocation_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner access allocation_plans"
  ON public.allocation_plans FOR ALL TO public
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_allocation_plans_updated_at
  BEFORE UPDATE ON public.allocation_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- allocation_line_items
CREATE TABLE public.allocation_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_plan_id uuid NOT NULL REFERENCES public.allocation_plans(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  target_account_id uuid REFERENCES public.investment_accounts(id),
  amount numeric NOT NULL DEFAULT 0,
  executed boolean NOT NULL DEFAULT false,
  notes text
);

ALTER TABLE public.allocation_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner access allocation_line_items"
  ON public.allocation_line_items FOR ALL TO public
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
