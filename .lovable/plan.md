## Problem

Adding monthly balance updates for each account currently requires: open the tiny popover on each card → pick a month → type a balance → click Save → repeat for every account. For 4-5 accounts this is tedious, especially when you do it at the start of each month.

## Solution: "Quick Update" Panel

Add a single "Update Balances" button in the Wealth page header (next to "Sync from Expenses"). Clicking it opens a dialog/sheet that shows **all active accounts in one form** so you can type each account's current balance in a single pass and save them all at once.

### UX Details

1. **Trigger**: New "Update Balances" button (calendar + pencil icon) in the top action bar.
2. **Dialog content**:
   - Month selector at the top (defaults to current month, e.g. "May 2026").
   - A compact table/list of all active accounts (scope-filtered), each row showing:
     - Account name + platform badge
     - Last recorded balance (greyed out for reference)
     - Editable number input for the new balance (pre-filled with the last known balance so you only change what moved)
   - A "Save All" button that upserts snapshot rows for every account whose value changed.
3. **Behavior**:
   - Only accounts with a changed value get written (no unnecessary DB calls).
   - After save, invalidates snapshot + account queries so charts update immediately.
   - Also updates `current_balance` on each account to keep the card totals in sync.
   - Toast confirms how many accounts were updated.

### Technical Changes

**File: `src/pages/Wealth.tsx`**
- Add a `BulkBalanceUpdateDialog` component (inline or extracted).
- State: `bulkUpdateOpen`, `bulkMonth`, `bulkValues` (map of account_id → new balance).
- On save: loop through changed values, call `upsertSnapshot` + update `current_balance` on `investment_accounts`.
- Add the trigger button to the header action bar.

No database changes needed — uses existing `account_balance_snapshots` upsert and `investment_accounts` update.
