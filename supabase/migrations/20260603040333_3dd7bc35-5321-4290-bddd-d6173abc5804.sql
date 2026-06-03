-- =====================================================================
-- PHASE 4: Append-only audit log
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid,
  owner_id uuid NOT NULL,
  event_type text NOT NULL,
  entity text,
  entity_id uuid,
  summary jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_owner_created ON public.audit_logs (owner_id, created_at DESC);

-- Read-only for clients: SELECT only. Inserts happen exclusively through
-- SECURITY DEFINER functions/triggers, so there is no INSERT/UPDATE/DELETE policy
-- (append-only, tamper-resistant).
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own audit_logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (
  auth.uid() = owner_id
  OR public.has_delegated_access(auth.uid(), owner_id, 'accountant')
);

-- App-driven event logger. Forces actor_id = caller; validates the caller may
-- write events for the given owner (self, or a delegate of that owner).
CREATE OR REPLACE FUNCTION public.log_event(
  _owner uuid,
  _event_type text,
  _entity text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _summary jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _resolved_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Default to self; only allow logging against another owner if delegated.
  IF _owner IS NULL OR _owner = auth.uid() THEN
    _resolved_owner := auth.uid();
  ELSIF public.has_delegated_access(auth.uid(), _owner, 'accountant')
     OR public.has_delegated_access(auth.uid(), _owner, 'investor') THEN
    _resolved_owner := _owner;
  ELSE
    _resolved_owner := auth.uid();
  END IF;

  INSERT INTO public.audit_logs (actor_id, owner_id, event_type, entity, entity_id, summary)
  VALUES (auth.uid(), _resolved_owner, _event_type, _entity, _entity_id, _summary);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_event(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_event(uuid, text, text, uuid, jsonb) TO authenticated;

-- Generic row-change auditor for owner_id-keyed tables. Stores no sensitive content.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _owner uuid; _entity_id uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    _owner := OLD.owner_id; _entity_id := OLD.id;
  ELSE
    _owner := NEW.owner_id; _entity_id := NEW.id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, owner_id, event_type, entity, entity_id, summary)
  VALUES (auth.uid(), _owner, TG_OP, TG_TABLE_NAME, _entity_id, jsonb_build_object('op', lower(TG_OP)));

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

-- Dedicated auditor for permission tables that key on user_id (no owner_id column).
CREATE OR REPLACE FUNCTION public.audit_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _subject uuid; _rolename text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    _subject := OLD.user_id; _rolename := OLD.role::text;
  ELSE
    _subject := NEW.user_id; _rolename := NEW.role::text;
  END IF;

  INSERT INTO public.audit_logs (actor_id, owner_id, event_type, entity, entity_id, summary)
  VALUES (auth.uid(), COALESCE(auth.uid(), _subject), 'ROLE_' || TG_OP, TG_TABLE_NAME, _subject,
          jsonb_build_object('op', lower(TG_OP), 'role', _rolename, 'subject', _subject));

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.audit_role_change() FROM PUBLIC, anon, authenticated;

-- Attach triggers to sensitive owner-keyed financial tables.
DO $$
DECLARE t text;
  audited_tables text[] := ARRAY[
    'transactions_uploaded','income_transactions','reimbursement_groups',
    'allocation_plans','app_settings','delegated_access'
  ];
BEGIN
  FOREACH t IN ARRAY audited_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
      t, t
    );
  END LOOP;
END $$;

-- Permission table (user_roles) uses the role-specific auditor.
DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_role_change();