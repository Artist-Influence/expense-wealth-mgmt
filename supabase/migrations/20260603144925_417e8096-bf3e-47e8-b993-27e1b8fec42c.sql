CREATE TABLE public.recurring_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL,
  mode text NOT NULL,
  merchant_key text NOT NULL,
  status text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (owner_id, mode, merchant_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_overrides TO authenticated;
GRANT ALL ON public.recurring_overrides TO service_role;

ALTER TABLE public.recurring_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_all
ON public.recurring_overrides
FOR ALL
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY delegated_accountant_read
ON public.recurring_overrides
FOR SELECT
TO authenticated
USING (has_delegated_access(auth.uid(), owner_id, 'accountant'::app_role));

CREATE TRIGGER update_recurring_overrides_updated_at
BEFORE UPDATE ON public.recurring_overrides
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();