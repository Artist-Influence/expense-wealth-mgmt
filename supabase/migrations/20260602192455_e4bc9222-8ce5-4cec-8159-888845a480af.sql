CREATE TABLE public.payment_methods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'personal',
  account_type TEXT NOT NULL DEFAULT 'credit_card',
  match_pattern TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner access payment_methods"
ON public.payment_methods
FOR ALL
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Accountant read payment_methods"
ON public.payment_methods
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'accountant'::app_role));

CREATE TRIGGER update_payment_methods_updated_at
BEFORE UPDATE ON public.payment_methods
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.payment_methods (owner_id, name, mode, account_type, match_pattern, sort_order) VALUES
('1762c9cd-5da1-4091-a1bc-1f7e751e7fb8', 'Amex Platinum', 'personal', 'credit_card', 'amex[\s_-]*platinum', 1),
('1762c9cd-5da1-4091-a1bc-1f7e751e7fb8', 'BoA 5563', 'personal', 'bank_account', 'bo?a[\s_-]*5563', 2),
('1762c9cd-5da1-4091-a1bc-1f7e751e7fb8', 'BoA 5592', 'personal', 'bank_account', 'bo?a[\s_-]*5592', 3),
('1762c9cd-5da1-4091-a1bc-1f7e751e7fb8', 'BoA 5573', 'personal', 'bank_account', 'bo?a[\s_-]*5573', 4),
('1762c9cd-5da1-4091-a1bc-1f7e751e7fb8', 'BoA 5373', 'personal', 'bank_account', 'bo?a[\s_-]*5373', 5),
('1762c9cd-5da1-4091-a1bc-1f7e751e7fb8', 'BoA Credit Card', 'personal', 'credit_card', 'bo?a[\s_-]*credit', 6),
('1762c9cd-5da1-4091-a1bc-1f7e751e7fb8', 'Chase Credit Card', 'personal', 'credit_card', 'chase[\s_-]*2662', 7),
('1762c9cd-5da1-4091-a1bc-1f7e751e7fb8', 'Chase Checking/Debit', 'personal', 'bank_account', 'chase[\s_-]*8886', 8);