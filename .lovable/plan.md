## Problem

The two summary cards show $0 even though the data is there:

- **Contributions YTD**: shows $0 because `contributions_ytd` in the DB is 0 for every account. The card reads stored values instead of calculating live. The "Sync from Expenses" button writes those values, but you've never clicked it (and shouldn't have to).

  Confirmed in the DB — your real 2026 contributions are sitting in `transactions_uploaded`:
  - Gemini: **$5,600** (6 transfers)
  - Wealthfront: **$6,600** (7 transfers)
  - Dub: **$5,400** (3 transfers)
  - Pokémon/TCGPlayer: **$445.60** (2 transfers)
  - **Total YTD: ~$18,045.60**

- **Yearly Target**: shows $0 because no per-account `contribution_target_yearly` is set, and there is no place to set a portfolio-wide end-of-year target. The number it shows today is just the sum of empty per-account fields.

## Fix

### 1. Contributions YTD — make it always live, no button required

In `src/pages/Wealth.tsx`, replace the stored-field calculation with a live SQL aggregation that runs on page load:

- New `useQuery` keyed `['contributions_ytd_live', user.id, year]` that runs the same logic as the "Sync from Expenses" button: for each account with an `auto_track_pattern`, sum `ABS(amount)` from `transactions_uploaded` where `mode='personal'`, `date BETWEEN <year>-01-01 AND <year>-12-31`, and description matches any of the `|`-split tokens.
- Returns a `Map<account_id, number>`.
- Card reads `Array.from(map.values()).reduce(...)` for the total, scope-filtered by which accounts are visible.
- Per-account cards also read from this map so the "$X contributed" line under each account is live too.
- Keep the "Sync from Expenses" button — it now just persists the live values to `contributions_ytd` (so the projection chart, which reads the stored field for monthly-pace estimation, stays accurate). Auto-call it once on load if the stored values are stale (>$1 drift) so the projection chart self-heals without a click.

Tooltip on the card: "Sum of personal expenses YTD matching each account's auto-track pattern. Updates live."

### 2. Yearly Target — clickable card → end-of-2026 portfolio target

The card currently sums per-account `contribution_target_yearly`. We'll keep that as a fallback, but add a portfolio-level override stored in a new lightweight settings row.

- **Schema (migration)**: add two columns to `app_settings`:
  - `wealth_target_amount NUMERIC NOT NULL DEFAULT 0`
  - `wealth_target_year INTEGER NOT NULL DEFAULT 2026`
  
  (Reusing `app_settings` since it's already per-owner with RLS — no new table needed.)

- **Card behavior**:
  - Whole card becomes clickable (cursor-pointer + hover ring).
  - Shows `$X target by EOY 2026` when set, or `Set 2026 target` ghost text when unset.
  - Below the number, a thin progress bar: `YTD / target` with `$X to go · Y months left` caption.

- **Click → modal** (`SetWealthTargetDialog`):
  - "End-of-year target" amount input.
  - Year selector (default 2026, allow 2027+ for forward planning).
  - Shows live math: "You're at $X YTD. To hit $Y by Dec 2026, contribute ~$Z/month for the next N months."
  - Save button writes to `app_settings.wealth_target_amount` + `wealth_target_year`.

- **Display logic**:
  - If `wealth_target_amount > 0`: show that number, label as "EOY {year} Target".
  - Else: fall back to summed per-account targets, label "Yearly Target (per-account)".

### 3. Per-account "Contributions YTD" field in the edit modal

Becomes read-only / informational, since it's now derived. Replaces with a small caption: "Auto-calculated from expenses matching `{auto_track_pattern}`. Edit the pattern to adjust." (Keeps the field editable as a manual override only when no pattern is set.)

## Out of scope

- Changing the per-account `contribution_target_yearly` UX (still editable in the per-account modal for fine-grained planning).
- Any change to projection chart logic — it still uses `contributions_ytd` from the DB, which the auto-sync keeps fresh.

## Files

- `src/pages/Wealth.tsx` — live YTD query, clickable target card, fallback logic, edit-modal copy tweak
- `src/components/SetWealthTargetDialog.tsx` (new) — target-setting modal with monthly-pace math
- Migration: add `wealth_target_amount` + `wealth_target_year` to `app_settings`
