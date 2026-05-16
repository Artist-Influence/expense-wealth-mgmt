## Backfill stale current_balance + harden the sync

**Findings (from DB):** Collectr has a snapshot for `2026-05-16 = $41,511.21` (the latest), but `investment_accounts.current_balance` is still `$40,561.32`. The new snapshot was saved before the auto-sync fix deployed, so it never updated `current_balance`.

### Two-part fix

1. **Backfill — one-time data update.** For every investment account, set `current_balance` to the `balance` of its most recent `account_balance_snapshots` row. This brings Collectr (and any other account with the same drift) into sync immediately. Run via `supabase--migration` so it's applied with elevated privileges.

   ```sql
   UPDATE public.investment_accounts a
   SET current_balance = s.balance,
       updated_at = now()
   FROM (
     SELECT DISTINCT ON (account_id) account_id, balance, as_of_date
     FROM public.account_balance_snapshots
     ORDER BY account_id, as_of_date DESC
   ) s
   WHERE s.account_id = a.id
     AND a.current_balance <> s.balance;
   ```

2. **Harden `upsertSnapshot` and `deleteSnapshot` in `src/pages/Wealth.tsx`.** After mutating snapshots, always recompute the latest snapshot for that account and set `investment_accounts.current_balance` to that value (or leave alone only if no snapshots remain). Simpler and resilient to ordering issues — no `as_of_date` comparison branch needed.

### Validation
- Reload `/wealth` → Collectr card shows `$41,511.21`.
- Add a new snapshot dated earlier than today → card still reflects the actual latest snapshot.
- Delete the latest snapshot → card falls back to the previous latest.
