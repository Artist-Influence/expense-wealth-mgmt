## Issue 1: Contributions YTD is too low

Two root causes:

### A. Pattern `dub (ecfi)` doesn't match after sanitization

The previous fix replaced `(` and `)` with spaces, turning the ILIKE pattern into `%dub  ecfi%`. But the actual description contains `DUB (ECFI)` — the double-space doesn't match the `(` in the original. The fix should split multi-word patterns into separate ILIKE conditions joined by AND-like logic, or better yet, split on whitespace and require each token to match independently.

**Better approach**: Split each pattern token into individual words (e.g. `dub (ecfi)` becomes `dub` and `ecfi`), then require BOTH words to appear via separate ILIKE filters. This avoids false positives from just `%dub%` (which matches "DUBSTEP") while still matching `DUB (ECFI)`.

### B. No Wealthfront account exists

$8,000 in Wealthfront contributions aren't counted because the account was never created. The "Sync from Expenses" button would create it, but the user shouldn't need to know that. Fix: also auto-seed missing default accounts during the live YTD calculation, not just during the manual sync.

### C. False positives from broad patterns

`%dub%` matches "PAYPAL *DUBSTEP FBI" (business expenses) and "MARCADUBE0". The Dub auto_track_pattern should be tightened to `dub ecfi` (both words required) instead of just `dub`.

## Issue 2: April/May numbers look identical in bulk update

When you open the Update Balances dialog and switch between April and May, "Last Known" correctly shows the snapshot for that month (they are different in the DB: e.g. Dub Apr=$15,118, May=$25,864). But the **pre-filled input** also gets set from "Last Known," so this should be working. Most likely the user is seeing the current month (May) default and hasn't switched — or the issue is that the previous save via the dialog updated `current_balance` which the cards now reflect. The cards show `current_balance`, not individual month snapshots. The "Growth YTD" chart on each card does show the correct month-by-month snapshots.

**Fix**: Rename the "Last Known" column header to the actual selected month label (e.g. "Apr 2026 Balance") so the user knows it reflects that specific month's snapshot, not a generic "last known."

## Changes

### `src/pages/Wealth.tsx`

1. **Tighten auto_track_pattern matching**: Instead of a single `ILIKE %pattern%`, split each token on word boundaries. For multi-word tokens like `dub ecfi`, build a filter requiring BOTH `%dub%` AND `%ecfi%` to appear in the same description. This eliminates "DUBSTEP" false positives.

2. **Auto-seed missing default accounts in the live query** (not just in "Sync from Expenses"), so Wealthfront appears automatically.

3. **Update Dub's default pattern** from `dub (ecfi)` to `dub ecfi` in `DEFAULT_AUTO_ACCOUNTS`.

4. **Rename column header** in `BulkBalanceUpdateDialog` from "Last Known" to the selected month name.

### Database

5. **Update existing Dub account pattern** via insert tool: change `auto_track_pattern` from `dub (ecfi)` to `dub ecfi`.
