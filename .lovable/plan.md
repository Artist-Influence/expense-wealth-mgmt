

## Fix: `transactions_uploaded_match_source_check` Constraint Violation

### Problem
The database has a CHECK constraint on `transactions_uploaded.match_source` that only allows: `exact_history`, `normalized_history`, `rule`, `ai`.

The recent categorization engine improvements added `partial_history` as a new `match_source` value, which violates this constraint on insert.

### Solution

**Database migration**: Drop and recreate the check constraint to include `partial_history`.

```sql
ALTER TABLE public.transactions_uploaded 
  DROP CONSTRAINT transactions_uploaded_match_source_check;

ALTER TABLE public.transactions_uploaded 
  ADD CONSTRAINT transactions_uploaded_match_source_check 
  CHECK (match_source = ANY (ARRAY['exact_history', 'normalized_history', 'partial_history', 'rule', 'ai']));
```

No code changes needed — just the constraint update.

| Change | Detail |
|--------|--------|
| DB migration | Add `partial_history` to `match_source` check constraint |

