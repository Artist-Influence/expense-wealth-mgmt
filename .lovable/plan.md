## Sync investment card balance when a new snapshot is saved

**Bug:** `upsertSnapshot` only writes to `account_balance_snapshots`. The card displays `investment_accounts.current_balance`, which never updates, so the card stays stale.

### Fix (single file: `src/pages/Wealth.tsx`)

Update the `upsertSnapshot` mutation so, after upserting the snapshot, it also updates `investment_accounts.current_balance` — but **only when the saved snapshot is the latest** for that account (so backfilling an older historical entry doesn't overwrite today's balance with an old number).

Logic:
1. Upsert the snapshot row as today.
2. Query the max `as_of_date` for that `account_id` from `account_balance_snapshots`.
3. If the just-saved `as_of_date >=` that max, update `investment_accounts.current_balance` to the new balance for that account.
4. On success, invalidate both `['account_balance_snapshots', user?.id]` and `['investment_accounts', user?.id]` so the card re-renders.

Apply the same "latest wins" rule to `deleteSnapshot`: after deleting, if the removed date was the latest, refresh `current_balance` to the new latest snapshot's balance (or leave unchanged if no snapshots remain).

No schema changes. No UI changes beyond the card auto-refreshing.

### Validation
- Add a snapshot dated today with a new amount → card total updates immediately.
- Add a snapshot dated 6 months ago with a different amount → card total does NOT change (older history backfill).
- Delete the latest snapshot → card total falls back to the prior latest snapshot.
