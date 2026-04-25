## Full math + logic audit

I read every aggregation site in the app (Income, Expenses, Insights, Tax, Allocations, CloseMonth, Accountant, Wealth, Reimbursements). Most of the math is correct, but there's a **cluster of related bugs** that all stem from two root issues. Fix those and the cards become trustworthy.

The screenshot itself is no longer wrong, by the way — that was stale from before the Chase 8886 backfill ($58,134 personal + $69,223 mis-tagged business = the $127,357 you saw). After a refresh, Personal Income = $58,134.41. ✓

### Bugs found (ordered by tax/financial impact)

**1. CRITICAL — Income classifier silently demotes real revenue to "transfer / non-taxable"**
File: `src/lib/income-classifier.ts`. Rule order means *any* description containing the word `zelle`, `venmo`, `paypal`, `wire`, or `transfer` matches **before** the business-revenue check. So:
- "Zelle payment from RULE FITNESS LLC" → `transfer` / `non_taxable` (it's $10K of real revenue)
- "Zelle payment from ARTIST INFLUENCE LLC" → `transfer` (intercompany, but still taxable to you)
- "FEDWIRE CREDIT … BNF=ARTIST INFLUENCE LLC" → `transfer` ($1,975+ of real B2B revenue)
- "CHIPS CREDIT VIA: …" → `transfer`
- "Stripe TRANSFER" → `transfer`

These rows then get **excluded from `taxableIncome` on the Tax page** and from `earnedIncome` on Insights — you'd under-reserve taxes and see deflated income totals.

**Fix:** Reorder rules so `business_revenue` runs first when the description contains a known **counterparty / payment-rail revenue marker** (FEDWIRE CREDIT, CHIPS CREDIT, Currency Cloud, Stripe TRANSFER as a Stripe payout is revenue, plus the merchant list we already added). Tighten the `transfer` rule so it only fires on **own-account language** ("Online Banking transfer", "internal transfer", "from CHK XXXX", "to SAV XXXX") rather than any Zelle/Venmo/wire. For a person-to-person Zelle/Venmo with no business marker, leave it `other` / `unknown` taxable status (forces user review) rather than auto-marking non-taxable.

**2. HIGH — Tax page sums income across ALL modes**
File: `src/pages/Tax.tsx`, `loadIncome()` and `loadDeductions()` have no `mode` filter. If you have both personal payroll and business revenue, both flow into the same federal/state/city reserve calculation. That's incorrect for an LLC owner — business revenue belongs to the business's tax return, personal taxable income belongs to yours.

**Fix:** Add a Personal / Business / Both toggle at the top of Tax (mirror Income's view picker) and filter `loadIncome` + `loadDeductions` by `mode`. Default the picker to a setting on `tax_profiles` (e.g. `default_view='personal'`).

**3. HIGH — Allocations and CloseMonth ignore mode**
Files: `src/pages/Allocations.tsx`, `src/pages/CloseMonth.tsx`. Both fetch *all* income and *all* expenses for the month with no mode filter. Allocation plan would think you have $X to allocate when really $X includes business revenue you can't personally allocate.

**Fix:** Add a mode picker on Allocations (default personal) and CloseMonth — wire it into the queries' `eq('mode', selectedMode)` and into `eq('transaction_mode', selectedMode)` for expenses. Persist last-used choice in localStorage.

**4. MEDIUM — Insights "Transfers excluded" and "Total Cash Out" leak**
- `src/pages/Insights.tsx` `transfersExcluded` sums by `exclude_from_expense_totals` AND date — but only inside the date filter. That's actually correct. ✓
- `src/pages/Expenses.tsx` `totalCashOut` (line 303) excludes only `is_non_expense_cash_movement` but **does not exclude `is_transfer` or `exclude_from_expense_totals`**. So your "Total Cash Out" on Expenses page double-counts CC payments and tagged transfers.

**Fix:** Add `&& !t.is_transfer && !t.exclude_from_expense_totals` to the `totalCashOut` filter.

**5. MEDIUM — Income page "Other" card double-counts transfers**
`src/pages/Income.tsx` line 139 — `other = sum where income_type NOT IN (business_revenue, payroll)`. That includes `transfer`, `refund`, `reimbursement`, `loan_proceeds`, `owner_contribution`, `interest`, `tax_refund`. So "Other" on the screenshot ($99,496) is actually a kitchen sink, not "miscellaneous earned income." It can be larger than the "Personal Total" itself when there are big transfers in.

**Fix:** Two cleaner card layouts:
- Either rename to "Non-Earning Income" and explicitly sum the NON_EARNING_TYPES list (matches Insights/Allocations definition);
- Or split into 4 narrow cards: Revenue / Payroll / Transfers / Other-earned. Recommend the second — it's more honest.

**6. MEDIUM — `NON_EARNING_TYPES` is duplicated in 3 files with risk of drift**
`Insights.tsx`, `Allocations.tsx`, `Accountant.tsx` each define their own copy. If we add a new income type later (e.g. "gift", "rebate"), we'd have to update 3 places. Already the `Accountant.tsx` list is **missing `reimbursement`** that the other two have.

**Fix:** Move `NON_EARNING_TYPES` (and a helper `isEarnedIncome(t)`) into `src/lib/income-classifier.ts` and import everywhere.

**7. MEDIUM — Income summary "Personal Total" is identical to "Personal Income"**
Screenshot shows both as $127,357.62. That's because when `filterMode='personal'`, `totalInflows === personalIncome` by definition. Confusing and wasteful card.

**Fix:** When mode filter is `personal`, drop the redundant "Personal Total" card. Same for business. Only show both when filter = "All".

**8. LOW — Tax page treats `partially_taxable` as 100% taxable**
Line 193: `r.taxable_status === 'taxable' || r.taxable_status === 'partially_taxable'` then sums full amount. If a row is partially taxable, the whole amount counts.

**Fix:** Either drop "partially_taxable" from the option list (it's never used safely without a percentage column) or default it to 50% with a note. Recommend dropping it from `TAXABLE_STATUS_OPTIONS` and migrating any existing rows to "taxable" or "unknown".

**9. LOW — CloseMonth reserve suggestion uses raw `totalMonthIncome`**
Line 121-125: `suggestedReserve = totalMonthIncome * rate`. `totalMonthIncome` includes transfers, refunds, owner contributions — same bug as #5. Inflates suggested reserve.

**Fix:** Filter to earned income types using the shared helper from #6.

**10. LOW — Wealth has no Personal/Business segregation**
`investment_accounts` table has no `mode` column, so personal Roth IRA and business SEP-IRA both roll into the same totals.

**Fix:** Add `mode TEXT NOT NULL DEFAULT 'personal'` to `investment_accounts`, surface a Personal/Business filter on Wealth. (Schema change → requires migration.)

### Sanity-check audit results (no fixes needed, just verified)

- **Expenses page** loads transactions filtered by `transaction_mode`, so per-mode totals are clean except for #4. ✓
- **Reimbursements** uses `Math.abs()` consistently. ✓
- **Insights** `earnedIncomeAll` correctly filters by mode (`.eq('mode', mode)` at fetch time) + NON_EARNING_TYPES. ✓
- **Accountant** export correctly excludes split parents. ✓
- **Split parent / child** handling — every aggregation correctly skips parents. ✓
- **Date filters** — consistent `>= dateFrom AND <= dateTo` semantics across pages. ✓

### Implementation plan (when you approve)

I'll do this in two passes so you can review checkpoint:

**Pass 1 (no schema changes — cards & math get accurate immediately):**
- Reorder + tighten income classifier rules (fix #1).
- Centralize `NON_EARNING_TYPES` + `isEarnedIncome()` in `income-classifier.ts`, import in 4 pages (fix #6, #5, #9).
- Fix `totalCashOut` filter on Expenses (fix #4).
- Drop redundant "Personal/Business Total" card when mode filter is set; split "Other" into Revenue / Payroll / Transfers / Other-earned (fix #5, #7).
- Add mode picker to Tax page + filter loaders (fix #2).
- Add mode picker to Allocations + CloseMonth + filter queries (fix #3).
- Drop `partially_taxable` from option list, treat any existing as `taxable` in math (fix #8).
- Backfill: re-run the classifier across `income_transactions` to re-tag the rows currently mistagged as `transfer` (mostly Zelle/wire revenue from #1).

**Pass 2 (schema migration — only if you want investment-account separation):**
- Add `mode` column to `investment_accounts`, default existing rows to `personal`, add filter UI on Wealth (fix #10).

### Out of scope

- No changes to the categorization engine for expenses (working correctly).
- No changes to RLS or auth.
- No UI redesign — just card slot adjustments and filter pickers.
- Not touching anything in the wealth account-type taxonomy beyond adding a mode dimension.
