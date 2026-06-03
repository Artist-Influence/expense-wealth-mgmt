## Problem

Clicking **"Keep oldest, archive N"** in Resolve Duplicates fails with:
`violates check constraint "transactions_uploaded_review_status_check"`

The handler sets `review_status: 'archived'`, and the rest of the app already expects that value (it excludes `review_status = 'archived'` rows from expense totals and health checks). But the database check constraint only permits:
`auto_categorized, suggested, ai_suggested, needs_review, approved, edited` — `'archived'` is missing, so the update is rejected.

## Fix (1 migration, no code changes)

Update the check constraint on `public.transactions_uploaded.review_status` to add `'archived'` to the allowed values:

```text
DROP CONSTRAINT transactions_uploaded_review_status_check
ADD    CONSTRAINT transactions_uploaded_review_status_check
       CHECK (review_status IN (
         'auto_categorized','suggested','ai_suggested',
         'needs_review','approved','edited','archived'
       ))
```

This is a data-integrity constraint change (allowed via migration). No application code needs to change — the archive handler, the `!== 'archived'` filters in `Expenses.tsx`, and `health-check.ts` already align with this value.

## Verify
After the migration, open Resolve Duplicates and click "Keep oldest, archive N" — the losers should move to archived (excluded from totals, preserved in the DB) without error. The income "delete" and "Not duplicates" paths are unaffected (they don't touch `review_status`).

## Out of scope
No changes to duplicate-detection logic, the dialog UI (already fixed), or other tables.