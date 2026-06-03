-- =====================================================================
-- FIX 1: Privilege escalation on user_roles (defense in depth)
-- Block any user from assigning/modifying their own roles. Role grants
-- can only be performed by an existing owner FOR OTHER users. Combined
-- with the already-seeded owner, this closes any self-escalation path.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.prevent_self_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow server-side / migration operations that run without an auth context
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Users may never create, modify, or delete their OWN role rows.
  IF (TG_OP = 'DELETE') THEN
    IF OLD.user_id = auth.uid() THEN
      RAISE EXCEPTION 'Users cannot modify their own role assignments';
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.user_id = auth.uid() THEN
      RAISE EXCEPTION 'Users cannot assign roles to themselves';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_self_role_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_self_role_assignment ON public.user_roles;
CREATE TRIGGER trg_prevent_self_role_assignment
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_self_role_assignment();

-- =====================================================================
-- FIX 2: Passcode hash exposed to the accountant role.
-- Move passcode_hash into a dedicated owner-only table that has NO
-- accountant read policy, then drop the column from app_settings.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.owner_secrets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL UNIQUE,
  passcode_hash text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_secrets TO authenticated;
GRANT ALL ON public.owner_secrets TO service_role;

ALTER TABLE public.owner_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner access owner_secrets"
ON public.owner_secrets
FOR ALL
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE TRIGGER update_owner_secrets_updated_at
BEFORE UPDATE ON public.owner_secrets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate any existing passcode hashes
INSERT INTO public.owner_secrets (owner_id, passcode_hash)
SELECT owner_id, passcode_hash
FROM public.app_settings
WHERE passcode_hash IS NOT NULL
ON CONFLICT (owner_id) DO UPDATE SET passcode_hash = EXCLUDED.passcode_hash;

ALTER TABLE public.app_settings DROP COLUMN IF EXISTS passcode_hash;

-- =====================================================================
-- FIX 3: SECURITY DEFINER trigger function callable by signed-in users.
-- handle_new_user is a trigger-only SECURITY DEFINER function; it never
-- needs to be invoked directly by clients. Revoke EXECUTE so signed-in
-- users cannot call it. (has_role intentionally remains executable by
-- authenticated because RLS policies depend on it.)
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;