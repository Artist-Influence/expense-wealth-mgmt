## Three issues, one root cause for two of them

### Issue 1 — Top summary cards ignore the date filter

The "Personal Cash Out / Business Cash Out / True Personal / True Business / Pending Reimbursable" strip and the secondary stats row in `src/pages/Expenses.tsx` are computed from `transactions` (all-time), not `filtered`. So you can pick "Year to Date" or "March 2026" and the numbers above don't move at all. That's the bug.

### Issue 2 — "Spend by Category" shows a huge Uncategorized slice that doesn't exist on Expenses

Verified in your data: 415 personal 2026 transactions are in `review_status = 'suggested'` with a confident `predicted_category` (Dining, Travel, Apartment/Office, Health & Personal Care, etc., 78–96% confidence). The Expenses table happily renders them as categorized (it falls back to `predicted_category`). But Insights and Tax both insist on `final_category` and the `approved/auto_categorized/edited` review status — so 415 categorized-looking rows get either filtered out completely or bucketed into "Uncategorized". Same root cause as Issue 3.

### Issue 3 — Tax deductions still feel anemic

Two reasons:

1. **The deductible category list is too narrow** — your account is "hella creative" (your words), but the helper I built last round didn't include several legit Schedule C lines that match your actual categories: `Entertainment` (50% meals & entertainment), `Apartment/Office` (rent / home office under §280A), `Charity` (when paid by an LLC/sole-prop it's a deductible business expense, not an itemized personal deduction), `Label Royalties`, plus your custom client categories (`Clipscale`, `CURE97`, `ddi`).

2. **The Tax page only counts `approved/auto_categorized/edited`** — same `final_category`-and-`review_status` problem as Issue 2. Your 571 business `suggested` rows ($235k of high-confidence predictions) are completely excluded from the deduction total, even when their predicted category is something obviously deductible like "Vendor Payment".

## Fix plan

### Fix A — Wire the date filter into the summary cards

`src/pages/Expenses.tsx`:

- Compute `crossModeTotals` (the 5-card strip) from a derived `dateScopedAll` set — same logic as today but constrained by `dateFrom/dateTo`. Currently it loads all rows once into state; rebuild it as a `useMemo` over `transactions` + the date range. Drop the `loadCrossModeTotals` paginated fetch entirely (the data's already loaded by `loadTransactions`, the duplicate fetch is wasteful).
- Update `stats` to also respect `dateFrom/dateTo` and the active `categoryFilter / extraFilter / search` — basically use `filtered` (or a slimmer "active in current view" set) instead of the raw `transactions` array.
- Add a small "(filtered)" badge next to the cards when a date or other filter is active, so it's obvious the numbers reflect the current view.
- Add two new cards/numbers since you asked for "more info":
  - **Avg/day** for the period (period total ÷ days in range)
  - **Largest single expense** in the period (description + amount, click to scroll-to)
  - **Number of unique merchants** in the period

### Fix B — Treat predicted-but-not-yet-approved as categorized everywhere

Introduce one tiny helper in `src/lib/categorization-engine.ts`:

```ts
export function effectiveCategory(tx: { final_category?: string | null; predicted_category?: string | null }): string | null {
  return tx.final_category || tx.predicted_category || null;
}
export const COUNTED_FOR_REPORTING_STATUSES = new Set([
  'approved', 'auto_categorized', 'edited', 'suggested', 'ai_suggested'
]);
```

Then rewire:
- `src/pages/Insights.tsx` — every place that does `t.final_category || 'Uncategorized'` becomes `effectiveCategory(t) || 'Uncategorized'`. The `isCounted(...)` filter expands to include `suggested/ai_suggested` so they're not silently dropped from the chart.
- `src/pages/Tax.tsx` — `loadDeductions` and `loadProjection` switch from `.in('review_status', ['approved','auto_categorized','edited'])` to including the suggested statuses too, and the deduction-flag check becomes "if `counts_as_tax_deduction = true` OR (`final_category IS NULL` AND `predicted_category` is in deductible set)".
- Add a soft visual distinction: in the Insights category bar chart, the part of each bar from `suggested` rows gets a slightly more transparent fill so power users can see "these are predicted, not confirmed". Hover tooltip: "X of Y predicted, Z confirmed."

### Fix C — Expand the deductible-category set (NY-aware, creative-friendly)

Update `BUSINESS_DEDUCTIBLE_CATEGORIES` in `src/lib/categorization-engine.ts` to match your actual chart of accounts and Schedule C / NY ordinary-and-necessary standards:

Add: `entertainment`, `apartment/office`, `charity`, `label royalties`, `taxes` (state/local taxes are deductible business expenses on Sch C line 23 if not federal income tax), and treat unknown user-defined custom client categories (`clipscale`, `cure97`, `ddi`) as deductible-by-default since these are clearly client/project tags for an active business.

Keep blocked (never deductible): `cc payment`, `transfer`, `investment`, `owner draw`, `distribution`, `refund`, `debit` (these are cash movements / capital, not P&L).

Personal mode stays narrow but expand slightly to NY-relevant itemizables:
- Add: `health & personal care` (medical portion may itemize over 7.5% AGI), `apartment/office` (only the home-office portion if business use — flagged for review, not auto-deducted at 100%), `taxes` (SALT cap $10k — partially deductible).
- Note: most personal deductions are subject to AGI thresholds. Auto-flag them but visually mark in the Tax page as "Itemizable — subject to limits" rather than treating as full Schedule C dollar-for-dollar.

A refined helper signature:
```ts
export type DeductibilityHint = 'full' | 'partial' | 'requires_review' | 'none';
export function deductibilityHint(mode, category): DeductibilityHint
```

Tax page uses this to show a third number alongside "Estimated Deductions YTD":
- **Confirmed deductions** (`full` matches in approved rows)
- **Predicted deductions** (`full` matches in suggested rows — counted but flagged)
- **Needs review** (`partial`/`requires_review` matches — shown but with caveat)

### Fix D — One-shot backfill for the new categories

Re-run an UPDATE on `transactions_uploaded` that sets `counts_as_tax_deduction = true` for the newly-included deductible categories (entertainment, apartment/office, charity, label royalties, taxes, the user-custom client tags). Same guardrails as last time (not transfers/CC/investments/refunds).

## What you'll see after

**Expenses page**: pick "March 2026" or "Year to Date" — the top 5 cards and the secondary stats row reflect that range. Three new fields appear (avg/day, largest expense, unique merchants).

**Insights "Spend by Category"**: the Uncategorized slice shrinks dramatically because your 415 high-confidence personal predictions now show up under Dining / Travel / Apartment/Office / Health & Personal Care etc. A tooltip badge tells you which slices are confirmed vs predicted.

**Tax page**: business deductions jump from $51,708 to roughly $80k–$100k+ once entertainment, apartment/office, charity, label royalties, and your custom client categories are folded in — plus another big jump when the 571 suggested business rows ($235k potential) start counting at their predicted category. The Reserve Gap drops accordingly. A new line shows "Predicted (not yet reviewed)" so you know exactly how much is high-confidence-but-unconfirmed.

## Files touched

- `src/lib/categorization-engine.ts` — expand category sets, add `effectiveCategory()` and `deductibilityHint()` helpers, export `COUNTED_FOR_REPORTING_STATUSES`.
- `src/pages/Expenses.tsx` — replace stale `crossModeTotals` fetch with a date-aware `useMemo`, rewire `stats` to respect filters, add three new metric tiles.
- `src/pages/Insights.tsx` — use `effectiveCategory()` and the expanded counted-statuses everywhere a category map is built; tooltip badge for predicted slices.
- `src/pages/Tax.tsx` — relaxed review-status filter, "Confirmed / Predicted / Needs Review" deduction breakdown, hint-aware footnotes.
- One-time data backfill (insert tool) — flip `counts_as_tax_deduction` for newly-included categories.

No schema changes, no RLS changes.