CREATE TABLE public.ai_usage_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL,
  fn text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_events_lookup
  ON public.ai_usage_events (owner_id, fn, created_at DESC);

GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own ai_usage_events"
ON public.ai_usage_events
FOR SELECT
TO authenticated
USING (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.check_ai_rate_limit(_fn text, _max integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _count integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Trim this caller's stale rows so the table stays bounded.
  DELETE FROM public.ai_usage_events
  WHERE owner_id = _uid
    AND fn = _fn
    AND created_at < now() - make_interval(secs => _window_seconds * 4);

  SELECT count(*) INTO _count
  FROM public.ai_usage_events
  WHERE owner_id = _uid
    AND fn = _fn
    AND created_at > now() - make_interval(secs => _window_seconds);

  IF _count >= _max THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_usage_events (owner_id, fn) VALUES (_uid, _fn);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_ai_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_ai_rate_limit(text, integer, integer) TO authenticated, service_role;