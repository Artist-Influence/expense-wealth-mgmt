CREATE TABLE public.tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  filing_status text NOT NULL DEFAULT 'single',
  state text NOT NULL DEFAULT 'NY',
  city text NOT NULL DEFAULT 'NYC',
  resident_city_tax_enabled boolean NOT NULL DEFAULT true,
  w2_income_enabled boolean NOT NULL DEFAULT true,
  self_employment_income_enabled boolean NOT NULL DEFAULT false,
  business_owner_income_enabled boolean NOT NULL DEFAULT false,
  default_federal_reserve_percent numeric NOT NULL DEFAULT 25,
  default_nys_reserve_percent numeric NOT NULL DEFAULT 7,
  default_nyc_reserve_percent numeric NOT NULL DEFAULT 3.5,
  custom_effective_tax_rate_optional numeric,
  estimated_w2_withholding_ytd numeric NOT NULL DEFAULT 0,
  estimated_tax_payments_ytd numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner access tax_profiles"
  ON public.tax_profiles
  FOR ALL
  TO public
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_tax_profiles_updated_at
  BEFORE UPDATE ON public.tax_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();