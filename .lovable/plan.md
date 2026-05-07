## Problem

The "Last Known" column in the Update Balances dialog shows the most recent **snapshot** balance (e.g. April: $15,118 for Dub), while the account cards show `current_balance` ($21,129 for Dub). This creates a confusing discrepancy — you expect to see the same number that's on the card.

## Root Cause

`getLastBalance()` prioritizes the latest snapshot over `current_balance`. But `current_balance` on the account is often more up-to-date (set via the account edit dialog or auto-sync), while snapshots are only recorded on specific dates.

## Fix

In `BulkBalanceUpdateDialog.getLastBalance()`:

- Always use the account's `current_balance` as the primary reference for "Last Known" and for pre-filling the input.
- Only fall back to a snapshot if the selected month already has one recorded (so you see what was previously saved for that month).
- Pre-fill the input with `current_balance` so you just need to type the new number for accounts that changed.

This aligns the dialog with what you see on each account card.

One function change in `src/pages/Wealth.tsx`, ~5 lines.
