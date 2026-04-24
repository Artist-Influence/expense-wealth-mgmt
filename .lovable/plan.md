# Backfill recurring detection on existing transactions

Run the recurrence detector against all already-imported rows (last 180 days) and tag eligible ones as **Subscriptions**, exactly like the import flow does for new rows.

## Current state of the data
- 781 rows in last 180 days
- 780 unapproved, 0 approved
- → essentially the entire dataset is fair game for backfill

## What the user sees

1. A new **"Re-scan recurring"** button in the Expenses toolbar (next to "Approve All Suggested"). One click → progress toast → updated rows refresh in place with the 🔁 badge.
2. Rows that the detector confirms get:
   - `predicted_category` = "Subscriptions"
   - `match_source` = "recurring_pattern"
   - `match_explanation` = e.g. *"Recurring monthly @ $14.99 (5 prior charges, ±$0.00, ~30d cadence)"*
   - `confidence` = 88–96
   - `review_status` = "auto_categorized" if conf ≥ user's auto threshold, else "suggested"
3. **Untouched**:
   - Rows already approved/edited (`review_status` in `approved`/`edited`)
   - Rows with a `final_category` already set
   - Transfers, split parents, child rows of splits, excluded rows
   - Ambiguous merchants (PayPal, Venmo, Amazon, etc.)
   - Buckets where "Subscriptions" isn't in the user's allowed category list (it is, in both modes — confirmed)

## Technical implementation

### 1. New function in `src/lib/recurrence-detector.ts`
Add `backfillRecurringForOwner(ownerId, mode, supabaseClient)` that:
- Loads the owner's last 180 days of transactions filtered by mode.
- Loads the owner's allowed `category_options` for that mode.
- Loads `app_settings` for the owner to get `business_auto_threshold` / `personal_auto_threshold`.
- Groups rows by `merchant_key` (computed via existing `generateMerchantKey(normalizeDescription(...))`).
- For each merchant-bucket with ≥3 charges, walks chronologically and for each row treats prior rows as history, calling existing `detectRecurrence(amount, history)`.
- Skips ambiguous merchants, transfers, split parents/children, excluded rows, already-approved rows, rows with final_category.
- Skips rows already correctly tagged (`predicted_category='Subscriptions' AND match_source='recurring_pattern'`) so re-running is idempotent.
- Returns `{ scanned, eligible, updated, skipped }` and a list of update payloads.
- Applies updates in chunks of 50 in parallel.

### 2. UI hook in `src/pages/Expenses.tsx`
- Add a `Re-scan recurring` Button near the existing "Approve All Suggested" cluster. Visible only when `selectedIds.size === 0` to keep the toolbar clean.
- On click: call the backfill function with the current `categoryMode`, show a `toast.loading` → `toast.success(\`Tagged ${updated} recurring charges (${eligible} matches found)\`)`, then `loadTransactions()` to refresh.
- Spinner state via `const [scanning, setScanning] = useState(false)`.

### 3. Run it once now (after merge)
Once the button exists, the user clicks it once for `personal` and once for `business`. Same code path that future imports will use, so no drift between backfill and runtime logic.

## Why a button (not a one-off script)
- Reuses the live detector — no second copy of the math to keep in sync.
- Re-runnable any time (after deleting bad data, importing historical CSVs, changing thresholds).
- Same RLS / auth path — no service-key script needed.
- Lives in the codebase as a feature, not a forgotten admin script.

## Out of scope
- Backfilling rows older than 180 days (not enough history before that to be reliable).
- Auto-running on app load (would surprise the user).
