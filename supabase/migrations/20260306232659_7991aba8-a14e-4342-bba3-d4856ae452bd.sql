
-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 1. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  is_owner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can read own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, is_owner)
  VALUES (NEW.id, NEW.email, NEW.email = 'jared@artistinfluence.com');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Upload batches
CREATE TABLE public.upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('personal', 'business')),
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_rows INTEGER NOT NULL DEFAULT 0,
  auto_categorized_count INTEGER NOT NULL DEFAULT 0,
  suggested_count INTEGER NOT NULL DEFAULT 0,
  needs_review_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access batches" ON public.upload_batches FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- 3. Transactions uploaded
CREATE TABLE public.transactions_uploaded (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_id UUID REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('personal', 'business')),
  date DATE,
  description_raw TEXT,
  description_normalized TEXT,
  amount NUMERIC(12,2),
  predicted_category TEXT,
  predicted_method TEXT,
  predicted_notes TEXT,
  final_category TEXT,
  final_method TEXT,
  final_notes TEXT,
  confidence NUMERIC(5,2),
  match_source TEXT CHECK (match_source IN ('exact_history', 'normalized_history', 'rule', 'ai')),
  review_status TEXT NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('auto_categorized', 'suggested', 'needs_review', 'approved', 'edited')),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions_uploaded ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access transactions" ON public.transactions_uploaded FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX idx_transactions_mode ON public.transactions_uploaded(mode);
CREATE INDEX idx_transactions_review ON public.transactions_uploaded(review_status);
CREATE INDEX idx_transactions_batch ON public.transactions_uploaded(upload_batch_id);

-- 4. Merchant memory
CREATE TABLE public.merchant_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('personal', 'business')),
  merchant_key TEXT NOT NULL,
  raw_example TEXT,
  most_common_category TEXT,
  most_common_method TEXT,
  default_note_template TEXT,
  times_seen INTEGER NOT NULL DEFAULT 1,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence_weight NUMERIC(5,2) NOT NULL DEFAULT 80,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access merchant_memory" ON public.merchant_memory FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX idx_merchant_key ON public.merchant_memory(merchant_key, mode);

CREATE TRIGGER update_merchant_memory_updated_at
  BEFORE UPDATE ON public.merchant_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Categorization rules
CREATE TABLE public.categorization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('personal', 'business', 'both')),
  rule_name TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('contains', 'equals', 'regex')),
  pattern TEXT NOT NULL,
  category_output TEXT,
  method_output TEXT,
  notes_output TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.categorization_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access rules" ON public.categorization_rules FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- 6. Category options
CREATE TABLE public.category_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('personal', 'business')),
  category_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.category_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access categories" ON public.category_options FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- 7. App settings
CREATE TABLE public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  personal_auto_threshold NUMERIC(5,2) NOT NULL DEFAULT 90,
  business_auto_threshold NUMERIC(5,2) NOT NULL DEFAULT 90,
  personal_suggest_threshold NUMERIC(5,2) NOT NULL DEFAULT 70,
  business_suggest_threshold NUMERIC(5,2) NOT NULL DEFAULT 70,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  passcode_enabled BOOLEAN NOT NULL DEFAULT false,
  passcode_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner access settings" ON public.app_settings FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
