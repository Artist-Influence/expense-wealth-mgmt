ALTER TABLE public.transactions_uploaded ADD COLUMN IF NOT EXISTS match_explanation text;

ALTER TABLE public.transactions_uploaded DROP CONSTRAINT IF EXISTS transactions_uploaded_review_status_check;
ALTER TABLE public.transactions_uploaded ADD CONSTRAINT transactions_uploaded_review_status_check CHECK (review_status = ANY (ARRAY['auto_categorized', 'suggested', 'ai_suggested', 'needs_review', 'approved', 'edited']));