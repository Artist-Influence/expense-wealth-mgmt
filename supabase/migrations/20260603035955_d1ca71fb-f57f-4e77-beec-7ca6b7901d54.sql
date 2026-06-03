-- =====================================================================
-- PHASE 2: Multi-tenant access-control hardening
-- =====================================================================

-- 1. Delegation table: an owner grants a specific user read access to THEIR data.
CREATE TABLE IF NOT EXISTS public.delegated_access (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  grantee_user_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (grantee_user_id, owner_id, role)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delegated_access TO authenticated;
GRANT ALL ON public.delegated_access TO service_role;

ALTER TABLE public.delegated_access ENABLE ROW LEVEL SECURITY;

-- Owner manages grants on their own data; grantee may read grants pointing at them.
CREATE POLICY "Owner manages delegated_access"
ON public.delegated_access FOR ALL TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Grantee reads own delegated_access"
ON public.delegated_access FOR SELECT TO authenticated
USING (auth.uid() = grantee_user_id);

-- 2. Security-definer helper: does grantee have a given delegated role on owner's data?
CREATE OR REPLACE FUNCTION public.has_delegated_access(_grantee uuid, _owner uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delegated_access
    WHERE grantee_user_id = _grantee
      AND owner_id = _owner
      AND role = _role
  )
$$;
REVOKE EXECUTE ON FUNCTION public.has_delegated_access(uuid, uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_delegated_access(uuid, uuid, app_role) TO authenticated;

-- 3. Seed delegated_access from existing accountant/investor roles -> current primary owner.
INSERT INTO public.delegated_access (grantee_user_id, owner_id, role)
SELECT ur.user_id, p.user_id, ur.role
FROM public.user_roles ur
CROSS JOIN LATERAL (SELECT user_id FROM public.profiles WHERE is_owner = true ORDER BY created_at LIMIT 1) p
WHERE ur.role IN ('accountant','investor')
ON CONFLICT DO NOTHING;

-- 4. Reset and rebuild policies on all owner-scoped finance tables.
DO $$
DECLARE
  t text;
  pol record;
  owned_tables text[] := ARRAY[
    'account_balance_snapshots','allocation_line_items','allocation_plans','app_settings',
    'categorization_rules','category_options','chat_messages','chat_threads','income_transactions',
    'investment_accounts','merchant_memory','payment_methods','reimbursement_groups','tax_profiles',
    'transactions_uploaded','upload_batches','owner_secrets'
  ];
  investor_tables text[] := ARRAY[
    'transactions_uploaded','income_transactions','category_options','merchant_memory','payment_methods'
  ];
BEGIN
  FOREACH t IN ARRAY owned_tables LOOP
    -- Drop every existing policy for a clean, deny-by-default slate.
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- Owner full access, authenticated only.
    EXECUTE format(
      'CREATE POLICY "owner_all" ON public.%I FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id)',
      t
    );

    -- Accountant delegated full read (owner_secrets excluded: secrets stay owner-only).
    IF t <> 'owner_secrets' THEN
      EXECUTE format(
        'CREATE POLICY "delegated_accountant_read" ON public.%I FOR SELECT TO authenticated USING (public.has_delegated_access(auth.uid(), owner_id, ''accountant''))',
        t
      );
    END IF;

    -- Investor delegated read, business scope only.
    IF t = ANY (investor_tables) THEN
      EXECUTE format(
        'CREATE POLICY "delegated_investor_read" ON public.%I FOR SELECT TO authenticated USING (public.has_delegated_access(auth.uid(), owner_id, ''investor'') AND mode = ''business'')',
        t
      );
    END IF;
  END LOOP;
END $$;

-- 5. profiles: rebuild (keyed on user_id, the owning user).
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Users read own profile"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Delegated read profile"
ON public.profiles FOR SELECT TO authenticated
USING (
  public.has_delegated_access(auth.uid(), user_id, 'accountant')
  OR public.has_delegated_access(auth.uid(), user_id, 'investor')
);

-- 6. New users provision their own data and own it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, is_owner)
  VALUES (NEW.id, NEW.email, true)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.app_settings (owner_id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;