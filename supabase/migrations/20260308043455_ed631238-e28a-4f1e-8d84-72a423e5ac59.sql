ALTER TABLE public.transactions_uploaded DROP CONSTRAINT transactions_uploaded_match_source_check;

ALTER TABLE public.transactions_uploaded ADD CONSTRAINT transactions_uploaded_match_source_check CHECK (match_source = ANY (ARRAY['exact_history', 'normalized_history', 'partial_history', 'rule', 'ai']));