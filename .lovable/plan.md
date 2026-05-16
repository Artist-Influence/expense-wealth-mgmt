## Fix query-key mismatch so cards refresh after a snapshot save

**Root cause (verified in DB):** Gemini and S&P 500 `current_balance` are correctly set to the new amounts ($13,493.58 and $15,403.52) in the database — the writes are working. But the card stays stale because of a React Query key mismatch:

- Query (line 397): `queryKey: ['investment_accounts']`
- Invalidations in `upsertSnapshot` / `deleteSnapshot` (lines 569, 588): `['investment_accounts', user?.id]`

These don't match, so the cache never refetches and the UI shows the old value until a full page reload.

### Fix (single file: `src/pages/Wealth.tsx`)

1. Change both invalidations in `upsertSnapshot.onSuccess` and `deleteSnapshot.onSuccess` from `['investment_accounts', user?.id]` to `['investment_accounts']` to match the query key.
2. Do the same audit pass on the `account_balance_snapshots` queries — confirm key and invalidations match (they currently use `['account_balance_snapshots', user?.id]` on both sides, which is fine).

### Guardrail to prevent recurrence

Add a short top-of-file comment block near the query definitions documenting the convention: "Invalidation keys MUST exactly match query keys. When in doubt, omit `user?.id` since RLS already scopes results."

No schema, no UI changes.

### Validation
- Save a new snapshot for any investment → card total updates immediately (no reload).
- Delete the latest snapshot → card total falls back without reload.
