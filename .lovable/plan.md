## What's actually broken

### Issue 1 — 404 on the "Review now" warning link

In `src/pages/Allocations.tsx` (line ~369) the warning links to:
```
/expenses?month=...&scope=...&review=unreviewed
```

But the app's router (`src/App.tsx`) mounts the Expenses page at `/`, not `/expenses` — so this path falls through to the NotFound route. Pure typo.

### Issue 2 — Tax deductions stuck at $0

This is a real data-pipeline bug, not a display bug. Verified against your 2026 transactions:

- **0 of ~1,220 transactions** have `counts_as_tax_deduction = true`.
- 205 business rows are properly categorized (`approved` / `edited`) — but every single one was inserted with `counts_as_tax_deduction = false` (the column default).
- 571 business rows are `suggested` and still have NULL category, so they wouldn't count even if the flag were set.

Tracing the code: the `counts_as_tax_deduction` flag is **never** written by the import pipeline (`src/pages/Expenses.tsx` lines 1089-1116) or by the categorization engine. The only place it's ever set is the manual TransactionDetailDrawer toggle. So unless you've individually clicked "tax deduction" on every business expense, the Tax page will always show $0.

The Tax page in turn requires both `counts_as_tax_deduction = true` AND `review_status IN (approved, auto_categorized, edited)` — so unreviewed rows get silently excluded too.

## Fix plan

### Fix 1 — Allocations link (1-line change)

`src/pages/Allocations.tsx` — change `/expenses?...` to `/?...` so the warning link points at the actual Expenses route.

### Fix 2 — Auto-flag tax-deductible business expenses

Three coordinated changes:

#### A. Categorization engine: auto-flag business rows by category

In the import pipeline (`src/pages/Expenses.tsx` ~line 1089-1116, where each row payload is built), set `counts_as_tax_deduction` automatically based on:
- `transaction_mode === 'business'` AND
- the predicted/final category is in a deductible set, AND
- it's not a transfer / CC payment / refund

Deductible business categories (from your actual 2026 data):
```
Vendor Payment, Subscriptions, Equipment, Office Supplies, Software,
Travel, Dining, Meals, Marketing, Advertising, Insurance, Fees,
Commission, Payroll, Contractor, Professional Services, Rent, Utilities,
Phone, Internet, Shipping, Education, Bank Fees, Business
```

Excluded (never deductible even when business-flagged): `CC Payment`, `Transfer`, `Investment`, `Tax Payment`, `Owner Draw`, `Distribution`.

Personal mode stays opt-in (only `Health/Medical`, `Charity`, `Mortgage Interest`, `State Taxes`, `Property Tax` flagged — most personal expenses aren't deductible).

A small helper `isDeductibleCategory(mode, category)` in `src/lib/categorization-engine.ts` keeps the rules in one place. Both the import pipeline and the inline category-edit handler in Expenses call it.

#### B. Inline edits re-flag automatically

In `src/pages/Expenses.tsx`, when a user changes `final_category`, recompute `counts_as_tax_deduction` via the helper and update both fields together. So if you change a business row from "Subscriptions" to "Investment", the deduction flag flips off automatically. User can still override manually in the detail drawer.

#### C. Backfill existing 2026 data

A one-time migration that, for every existing `transactions_uploaded` row:
- If `transaction_mode = 'business'` AND `is_split_parent = false` AND `is_transfer = false` AND `treatment_type = 'expense'` AND `final_category` is in the deductible set → set `counts_as_tax_deduction = true`.
- If `transaction_mode = 'personal'` AND `final_category` is in the personal-deductible set → same.
- Leave everything else untouched.

This unblocks the user's existing data without requiring them to re-import or hand-tag 200+ transactions.

### Fix 3 — Tax page: surface unreviewed business spend honestly

The current `unreviewedDeductionCount` counter only counts rows that already have `counts_as_tax_deduction = true` AND are unreviewed — by definition almost zero, so the warning never fires. Change it to count **all** business unreviewed transactions in the year (since most should be deductible), with a friendlier message:

> ⚠️ 571 business transactions still need categorization for 2026 — your deductions are likely much higher than shown. [Review →]

The link goes to `/?scope=business&review=unreviewed` (the proper Expenses route + the existing Expenses filter).

Also expand the existing "Income data covers 0 of 4 months" warning to be less misleading — it currently fires whenever there's no income recorded yet, even though deductions might be present. Combine both signals into a single data-coverage panel.

### Fix 4 — Tax page: relax the deduction filter (small)

`loadDeductions` and `loadProjection` exclude `suggested` and `ai_suggested` rows. That's defensible (don't promise tax savings on guesses), but at minimum we should also surface a "potential additional deductions: $X" line below the projection table so the user sees what they'd unlock by reviewing. One extra small query, one extra row in the projection card.

## Files touched

- `src/pages/Allocations.tsx` — fix the `/expenses` → `/` link.
- `src/lib/categorization-engine.ts` — add `isDeductibleCategory(mode, category)` helper + exported deductible-category sets.
- `src/pages/Expenses.tsx` — call the helper in the import insert payload and in the inline category-update mutation.
- `src/pages/Tax.tsx` — fix the unreviewed counter to count uncategorized business spend (not deduction-flagged-and-unreviewed), add "potential additional deductions" line, fix the warning link to `/?scope=business&review=unreviewed`.
- New migration `supabase/migrations/<ts>_backfill_tax_deduction_flags.sql` — one-time UPDATE statements for existing data.

No schema changes (the column already exists), no RLS changes.

## What you'll see after

- Click the orange "Review now →" warning in Allocations → goes to the Expenses page filtered to unreviewed transactions for that month/scope, instead of 404.
- Tax page deductions row immediately shows real numbers (~$45k+ from your already-approved business categories like Vendor Payment, Dining, Subscriptions, etc.) once the backfill runs.
- "Est. Tax" drops accordingly — your $80,735 business tax estimate will shrink as your $36k of Vendor Payments + $5k Payroll + $1.8k Subscriptions etc. start counting against it.
- A clear, actionable warning on the Tax page tells you exactly how many business transactions still need review to unlock more deductions.
- Going forward, every newly categorized business expense in a deductible category auto-flags itself — no more silent zero.