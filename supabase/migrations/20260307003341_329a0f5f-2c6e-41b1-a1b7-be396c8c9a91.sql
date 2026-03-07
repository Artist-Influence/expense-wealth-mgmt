ALTER TABLE public.upload_batches 
  ADD COLUMN IF NOT EXISTS detected_headers jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mapped_columns jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parse_details jsonb DEFAULT NULL;