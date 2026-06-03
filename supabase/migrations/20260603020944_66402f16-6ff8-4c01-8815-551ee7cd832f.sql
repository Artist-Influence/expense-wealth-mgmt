ALTER TABLE public.transactions_uploaded
  DROP CONSTRAINT IF EXISTS transactions_uploaded_review_status_check;

ALTER TABLE public.transactions_uploaded
  ADD CONSTRAINT transactions_uploaded_review_status_check
  CHECK (review_status = ANY (ARRAY[
    'auto_categorized'::text,
    'suggested'::text,
    'ai_suggested'::text,
    'needs_review'::text,
    'approved'::text,
    'edited'::text,
    'archived'::text
  ]));