

# RED-TEAM CORRECTION PASS — Expense Memory

## Critical Findings by Risk Area

---

### 1. REIMBURSEMENT LOGIC — Multiple Silent Errors

**BUG: Reimbursable expenses inflate "Total Cash Out" and mode-specific spend.**
In `Expenses.tsx` stats (line 192-194), `totalCashOut` excludes `is_non_expense_cash_movement` but NOT `is_reimbursable`. If a reimbursable expense has `is_non_expense_cash_movement: false` (the default for reimbursable_work mode — see line 349), it inflates personal/business cash-out figures. Reimbursable expenses are real spend but should be excluded from "true personal spend" and clearly labeled as "fronted, pending recovery."

**BUG: Reimbursement group `total_received` can exceed `total_expected` with no guard.** In `Income.tsx` line 314, `matchToGroup` blindly adds income amount to `total_received` with no cap or warning. If you match a larger income transaction, the group silently over-reports.

**BUG: Reimbursement group status is never surfaced on the expense side.** If a group moves to `reimbursed`, the individual `transactions_uploaded` rows still show `reimbursement_status: 'pending'` — there's no cascade-back from group status to transaction status.

**FIX PLAN:**
- Exclude reimbursable expenses from "True Personal Spend" / "True Business Spend" stats (already partially done via `counts_toward_true_*_spend: false`, but verify the import pipeline default is correct)
- Add overpayment warning when `total_received > total_expected`
- When group status changes to `reimbursed`, cascade update to all linked `transactions_uploaded` rows

---

### 2. TRANSFER DETECTION — Over-inclusive Patterns

**BUG: `PMT` pattern matches legitimate merchants.** In `transfer-detector.ts`, the regex `/PMT\b/i` will match any description containing "PMT" — including "APPOINTMENT", "EQUIPMENT", legitimate business abbreviations. This silently excludes real expenses from totals.

**BUG: `PYMT` similarly over-matches.** Same issue with `/PYMT\b/i`.

**BUG: "MOBILE PAYMENT" matches Zelle/Venmo payments that ARE real expenses.** A Zelle payment to a plumber is a real expense, not a transfer.

**FIX PLAN:**
- Tighten `PMT` to require it at word start or after PAYMENT context: `/\bPMT\b/i` is already word-bounded but still matches "DEPT" in some bank formats — add negative lookbehind or require preceding whitespace/start
- Remove "MOBILE PAYMENT" as a transfer pattern — it's ambiguous
- Add a `transfer_confidence` score instead of binary yes/no, and only auto-exclude at high confidence

---

### 3. MODE vs OWNERSHIP vs TREATMENT-TYPE — Confused Semantics

**BUG: `mode` column and `transaction_mode` column are redundant and can desync.** The database has both `mode` (used for queries/filtering on Insights, Accountant) and `transaction_mode` (used for Expenses page filtering). When `bulkSwitchMode` runs (line 336), it sets `mode = targetMode === 'reimbursable_work' ? 'personal' : targetMode` — but reimbursable_work transactions are then queried under 'personal' mode in Insights and Accountant, which mixes them into personal spend.

**BUG: Accountant export uses `mode` not `transaction_mode`.** Line 165 of `Accountant.tsx`: `expenses.filter(e => e.mode === modeFilter)`. This means reimbursable_work expenses (stored with `mode: 'personal'`) appear in the "Personal" accountant export with no distinction. An accountant would have no idea these are fronted work expenses.

**FIX PLAN:**
- Add `transaction_mode` to the Accountant export columns
- Add `transaction_mode` filter (not just `mode`) to Accountant page
- Add a "Reimbursable" column or flag to the expense ledger export
- Consider deprecating the `mode` field in favor of `transaction_mode` everywhere

---

### 4. SPLIT TRANSACTION SUPPORT — Completely Missing

**No way to split a $500 Amazon order into $300 personal + $200 business.** A single transaction can only have one mode, one category, one treatment. For merchants like Amazon, Costco, Walmart, this means the entire amount is attributed to one category — guaranteed wrong for mixed purchases.

**FIX PLAN (architecture follow-up):**
- Add a `transaction_splits` table: `parent_id, split_amount, category, mode, treatment_type, notes`
- When a transaction has splits, the parent is excluded from totals and each split line contributes instead
- UI: "Split" button in the drawer → inline rows for amount + category + mode

---

### 5. FILTERED-MODE vs CROSS-MODE REPORTING — Actively Misleading

**BUG: Insights "Savings Rate" compares mode-filtered expenses against ALL income.** In `Insights.tsx` lines 232-236, savings rate uses `expenses` (filtered by mode) but `incomeData` (unfiltered). If you're viewing Personal mode, savings rate = (ALL income - personal expenses) / ALL income. This dramatically overstates savings if you also have significant business expenses.

**BUG: Income summary cards are current-month only, but Insights charts are all-time.** No labels distinguish this. A user looking at $5k income on the Income page and $50k on Insights would be confused.

**BUG: Allocation waterfall uses ALL income but mode-unfiltered expenses.** `Allocations.tsx` line 60-73 queries `transactions_uploaded` with only `exclude_from_expense_totals = false` — no mode filter. This means personal AND business AND reimbursable expenses all subtract from free cash. If you're only allocating personal investments, business expenses shouldn't reduce free cash.

**FIX PLAN:**
- Insights savings rate: either filter income by mode too, or clearly label "Income: All Sources | Expenses: Personal Only"
- Allocation waterfall: add mode filter or clearly label that expenses are cross-mode
- Income page: add period label "This Month" to summary cards

---

### 6. OVER-AGGRESSIVE AUTO-APPROVAL — Dangerous for Ambiguous Merchants

**BUG: Amazon auto-approves as "Shopping" every time.** The merchant key for Amazon collapses ALL Amazon transactions to `AMAZON` via alias mapping (normalizer.ts line 156). After 5 approvals, confidence hits 95+ → auto-approved. But Amazon purchases span: groceries (Whole Foods via Amazon), business supplies, personal electronics, gifts, subscriptions.

**Same issue for:** PayPal (collapses all PayPal transactions), Venmo, Zelle, Uber (only EATS vs TRIP split), Square (any Square merchant), Stripe (any Stripe merchant), Google, Apple.

**FIX PLAN:**
- Add an "ambiguous merchant" list: `AMAZON, PAYPAL, VENMO, ZELLE, SQUARE, STRIPE, WALMART, COSTCO, TARGET`
- For ambiguous merchants, cap auto-approval confidence at 85 regardless of times_seen — force them to `suggested` instead of `auto_categorized`
- In the categorization engine, add a check: if merchant_key is in the ambiguous list, set `review_status = 'suggested'` even if confidence >= auto threshold

---

### 7. TAX PAGE — False Certainty

**BUG: Tax reserve shows a precise dollar figure but it's based on flat-rate estimates.** The page says "Federal Reserve: $12,345.67" with no qualifier. This is not a tax calculation — it's `income × flat_rate`. Real federal tax is progressive with brackets, standard deduction, credits, etc. A 25% flat rate could be off by 30-50% for most incomes.

**BUG: "Adjusted Income" deducts ALL `counts_as_tax_deduction` expenses, but doesn't distinguish above-the-line from below-the-line deductions.** Some deductions (HSA, IRA) reduce AGI. Others (mortgage interest, charitable) only matter if itemizing. Mixing them into one number creates false precision.

**BUG: The page has no "data completeness" indicator.** If only 2 months of income have been imported, the YTD reserve target is meaninglessly low.

**FIX PLAN:**
- Add disclaimer text: "Estimates only — based on flat reserve rates, not progressive tax brackets. Consult your accountant."
- Add a "Data Coverage" indicator: "Income data covers Jan-Mar (3 of 12 months)" 
- Rename "Adjusted Income" to "Estimated Adjusted Income"
- Add a note that deductions are simplified estimates

---

### 8. ALLOCATION / FREE CASH — False Precision

**BUG: Tax reserve in the waterfall uses `monthIncome × combinedRate`.** But tax isn't owed monthly — it's on YTD cumulative income with progressive brackets. This monthly estimate can wildly overshoot or undershoot.

**BUG: If no tax profile exists, defaults to 35.5% — with no warning.** Line 131-132 of `Allocations.tsx`: `taxRate = 0.355`. A user who hasn't set up their tax profile gets a silent 35.5% tax deduction from their free cash.

**BUG: "Free Cash (Safe to Invest)" label suggests certainty.** If expenses are incomplete (mid-month), income is partial, and tax rate is a guess, calling it "safe to invest" is irresponsible.

**FIX PLAN:**
- If no tax profile: show a warning banner "Tax profile not configured — using default 35.5%"
- Rename "Safe to Invest" to "Estimated Available" or "Approximate Free Cash"
- Add a footnote: "Based on recorded data as of [date]. Actual amounts may differ."
- Show data completeness: "3 of 4 weeks of expenses imported this month"

---

### 9. ACCOUNTANT EXPORT — Incomplete and Misleading

**BUG: Expense ledger exports ALL expenses including `needs_review` and unapproved.** `Accountant.tsx` line 176 doesn't filter by `review_status`. An accountant receives uncategorized, unreviewed, possibly-duplicate transactions mixed in with approved ones.

**BUG: Year-end summary "Net Position" = `totalIncome - personalExpenses - businessExpenses`.** This double-counts reimbursable expenses (included in personal totals via `mode: 'personal'`) and doesn't exclude transfers.

**BUG: Tax deductions export doesn't filter by `review_status`.** Unapproved expenses marked `counts_as_tax_deduction` appear in the export.

**BUG: Reimbursement report is not date-filtered.** Line 148-159: reimbursement groups query has no date range filter — it always returns ALL groups regardless of the selected period.

**FIX PLAN:**
- Filter expense ledger to only `review_status IN ('approved', 'auto_categorized', 'edited')`
- Filter tax deductions the same way
- Add `review_status` column to export so accountant can see data quality
- Filter reimbursement groups by `created_at` within date range
- Year-end: exclude transfers and separate reimbursable amounts
- Add `is_transfer` and `is_reimbursable` flags to export

---

### 10. CLOSE MONTH — Just Links, No Action

**BUG: "Mark Done" has no validation.** You can "Mark Done" on Step 1 (Review Exceptions) while 47 transactions still need review. The step completion is entirely self-reported with zero enforcement.

**BUG: Completion state is not persisted.** `completedSteps` is `useState` — refreshing the page resets all progress. There's no database record of which months have been closed.

**BUG: Close Month doesn't check for `suggested` or `ai_suggested` transactions.** Step 1 only queries `needs_review` (line 66). Transactions in `suggested` status — which have a category guess but haven't been confirmed — are invisible to the close workflow.

**FIX PLAN:**
- Step 1: Also count `suggested` and `ai_suggested` transactions as exceptions
- Prevent "Mark Done" on Step 1 if exception count > 0 (or require explicit "I accept N unreviewed transactions")
- Persist close-month state to a `month_close_records` table
- Add inline "Approve All Suggested" button directly in Step 1 instead of just linking to Expenses

---

### Additional Critical Findings

**11. Income CSV dedup has a fatal flaw.** `Income.tsx` line 197: `if (isNaN(rawAmount) || rawAmount <= 0) continue`. This SKIPS negative amounts entirely. But some bank CSVs represent income as negative (credit to account). All negative income rows are silently dropped.

**12. `parseAmount` always returns `Math.abs`.** In `normalizer.ts` line 230, amounts are always made positive. If a CSV has debits as positive and credits as negative (or vice versa), there's no way to distinguish. The sign information is permanently lost at parse time.

**13. Insights uses `predicted_category` as fallback.** Lines 115-116: `const cat = t.final_category || t.predicted_category || 'Uncategorized'`. This means unapproved, unreviewed AI guesses contribute to spending charts as if they were confirmed data. Charts should only use `final_category` for approved/edited transactions.

**14. No audit trail.** There's no record of when a transaction was approved, who approved it (moot for single-user but matters for debugging), or what the previous category was before an edit. If merchant memory corrupts a category, there's no way to trace back.

---

## RED-TEAM CORRECTION SUMMARY

### Logic fixed (proposed):
- Reimbursable expenses excluded from True Spend stats validation
- Transfer detection `PMT`/`PYMT` tightened, `MOBILE PAYMENT` removed
- Savings rate calculation fixed to acknowledge cross-mode income
- Accountant exports filtered to approved transactions only
- Year-end net position excludes transfers and separates reimbursable
- Income CSV parser handles negative amounts
- Close Month exception count includes `suggested` and `ai_suggested`

### UX fixed (proposed):
- Tax page: add "estimate only" disclaimers and data coverage indicator
- Allocation waterfall: rename "Safe to Invest" → "Estimated Available", warn on missing tax profile
- Income summary cards: add "This Month" period label
- Close Month: add inline approve-all in Step 1, persist completion state

### Reporting/math fixed (proposed):
- Insights charts use only `final_category` from approved/edited rows (not `predicted_category` from unreviewed)
- Allocation waterfall clarifies cross-mode expense totals
- Accountant reimbursement export filtered by date range

### Guardrails added (proposed):
- Ambiguous merchant list caps auto-approval at `suggested` regardless of confidence
- Reimbursement group warns on overpayment (`total_received > total_expected`)
- Close Month Step 1 prevents marking done with outstanding exceptions (or requires acknowledgment)
- Category-less saves keep `needs_review` status (already implemented)

### Still needs architecture follow-up:
- **Split transactions** — requires new table and UI, biggest missing feature for correctness
- **Deprecate `mode` column in favor of `transaction_mode`** — requires migration + all query updates
- **Progressive tax bracket estimation** — current flat-rate is fundamentally wrong for tax planning
- **Audit trail / change log** — no history of edits
- **Month close persistence** — needs `month_close_records` table

### Biggest remaining risks:
1. **Amazon/PayPal/Venmo auto-approval** — silently miscategorizes mixed-use merchants at 95%+ confidence
2. **Split transactions** — every mixed-merchant purchase is 100% wrong on at least one dimension
3. **Insights charts using unreviewed predicted categories** — reporting engine treats guesses as facts
4. **Accountant exports including unapproved data** — sends bad data to professionals
5. **Allocation "Safe to Invest" based on incomplete data** — could lead to over-investing real money

