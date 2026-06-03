ALTER TABLE public.app_settings
ADD COLUMN IF NOT EXISTS usage_profile text NOT NULL DEFAULT 'both';

CREATE OR REPLACE FUNCTION public.validate_usage_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.usage_profile NOT IN ('personal', 'business', 'both') THEN
    RAISE EXCEPTION 'Invalid usage_profile: %, must be personal, business, or both', NEW.usage_profile;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_usage_profile_trigger ON public.app_settings;
CREATE TRIGGER validate_usage_profile_trigger
BEFORE INSERT OR UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.validate_usage_profile();