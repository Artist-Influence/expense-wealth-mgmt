-- 1. Invite codes table
CREATE TABLE public.invite_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Only the service_role (edge functions) can touch invite codes. No anon/authenticated grants.
GRANT ALL ON public.invite_codes TO service_role;

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated => deny-by-default for browser clients.

-- 2. Display name on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text;

-- 3. Update new-user routine to persist display name from signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, is_owner, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    true,
    NULLIF(NEW.raw_user_meta_data->>'display_name', '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.app_settings (owner_id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;