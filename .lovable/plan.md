

# Phase 4: Reporting Math Red-Team Correction Pass

## Bugs Found

### Insights.tsx

**1. `incomeVsExpenses` chart uses ALL income (line 210-215).** The bar chart and net line include reimbursements, transfers, refunds in the income bars. The savings rate correctly uses `earnedIncome`, but the chart next to it contradicts — showing inflated income. User sees two different income numbers in the same tab.

**2. `yoyComparison` dependency array says `incomeData` (line 283) but body uses `earnedIncome` (line 264).** The memo won't recompute when `earnedIncome` changes independently — though in practice `earnedIncome` derives from `incomeData` so it's not a runtime bug, it's a stale-dep lint issue that should be cleaned up.

**3. `topMerchants` and `recurringCharges` use `expenses` (all review statuses) not `approvedExpenses`.** Lines 158 and 171 — merchant category falls back to `predicted_category` for unapproved rows. These tables mix confirmed and unconfirmed data while the pie/bar charts correctly use `approvedExpenses` only. Inconsistent.

**4. `monthlyTrend` uses `expenses` (all statuses) not `approvedExpenses`.** Line 148. The spend trend chart includes unapproved data while the category chart filters it out. Two charts on the same tab use different data quality standards.

**5. `methodBreakdown` falls back to `predicted_method` (line 318).** Unapproved predictions leak into the payment method pie chart.

**6. No label distinguishing mode-filtered expenses vs cross-mode income.** The savings rate compares personal-only expenses against all-mode earned income. If you have significant business expenses, your personal savings rate looks artificially high. The subtitle says "Income is cross-mode" but doesn't say "Expenses are {mode}-filtered."

### Tax.tsx

**7. Data coverage indicator is broken.** Line 291: `incomeRows.map(() => '').filter(Boolean)` always returns empty — it maps every row to `''` then filters for truthy, getting `size = 0`. Falls through to the `||` branch which works, but the first expression is dead code that confuses the logic.

**8. Deductions query has no `review_status` filter (line 114-122).** Unapproved, unreviewed transactions marked `counts_as_tax_deduction` contribute to deduction totals. An AI-suggested deduction that was never confirmed reduces the tax reserve target — dangerous.

**9. Tax page shows no "unapproved data" warning.** If 40% of deductions come from unreviewed transactions, the adjusted income figure has low confidence, but no indicator shows this.

**10. Reimbursement income with manually-changed `taxable_status='taxable'` inflates taxable income.** The income classifier sets reimbursements to `non_taxable`, but users can override. No guard or warning exists.

### Allocations.tsx

**11. Expense query includes `treatment_type = 'tax_payment'` and `treatment_type = 'investment_contribution'`.** Lines 70-77 filter only on `exclude_from_expense_totals = false`. If a tax payment or investment contribution wasn't flagged `exclude_from_expense_totals`, it inflates expenses and deflates free cash. These are not consumption expenses.

**12. No unreviewed-data warning.** If the month has 50 `needs_review` transactions, the free cash figure is based on incomplete categorization. No signal to the user.

**13. Income query has no `owner_id` filter (line 51-55).** RLS protects it, but defense-in-depth is missing (expense query correctly has it).

### Cross-page

**14. Expenses page `totalCashOut` includes tax payments and investment contributions.** Lines 193-195 only exclude `is_non_expense_cash_movement`. A tax payment with `is_non_expense_cash_movement = false` counts toward cash out.

**15. Savings rate definition is never explained.** "Net Savings Rate" is `(earnedIncome - modeFilteredExpenses) / earnedIncome`. This is not a real savings rate — it's a mode-specific surplus ratio. No tooltip or footnote defines it.

---

## Plan — 11 Targeted Fixes

### A. Insights — use `earnedIncome` in chart & fix data consistency (Insights.tsx)

1. **`incomeVsExpenses` chart**: filter income by `earnedIncome` instead of `incomeData` so chart matches savings rate math
2. **`topMerchants` and `recurringCharges`**: switch from `expenses` to `approvedExpenses`, use only `final_category` (no `predicted_category` fallback)
3. **`monthlyTrend`**: switch from `expenses` to `approvedExpenses`
4. **`methodBreakdown`**: switch from `expenses` to `approvedExpenses`, use only `final_method` (no `predicted_method` fallback)
5. **`yoyComparison`**: fix dependency array to `[expenses, earnedIncome]`
6. **Savings rate label**: add footnote "Savings = (Earned Income − {mode} Expenses) / Earned Income · Excludes reimbursements, transfers, refunds from income"

### B. Tax — filter deductions to approved, fix data coverage (Tax.tsx)

7. **Deductions query**: add `.in('review_status', ['approved', 'auto_categorized', 'edited'])` filter
8. **Data coverage indicator**: fix the broken first expression (remove dead code)
9. **Add unapproved-data warning**: if any deduction rows exist that are unreviewed, show "N deductions from unreviewed transactions" warning
10. **Reimbursement income guard**: in income breakdown table, add a warning icon next to reimbursement-type income that has `taxable_status = 'taxable'`

### C. Allocations — add owner_id, add data quality warning (Allocations.tsx)

11. **Income query**: add `.eq('owner_id', user!.id)` for defense-in-depth
12. **Data quality warning**: fetch count of `needs_review` + `suggested` transactions for the month, show warning if > 0: "N transactions need review — free cash estimate may change"

### D. Expenses stats label (Expenses.tsx)

13. **`totalCashOut` label**: rename or add subtitle "Includes all non-excluded outflows" to set expectations

---

## Summary

| Area | Fix | Risk |
|------|-----|------|
| Insights chart | Use earnedIncome in income vs expenses | Inflated income bars |
| Insights merchants/trends | Use approvedExpenses only | Unapproved data in charts |
| Insights method chart | Drop predicted_method fallback | Guesses in reports |
| Insights savings label | Add formula explanation | User misinterprets rate |
| Tax deductions | Filter to approved only | Unreviewed deductions reduce reserves |
| Tax data coverage | Fix broken indicator | Always shows warning |
| Tax unapproved warning | Surface unreviewed deduction count | False precision |
| Allocations owner_id | Add to income query | Defense-in-depth |
| Allocations data quality | Show unreviewed count | Uninformed decisions |
| YoY deps | Fix memo dependency | Correctness |
| Cross-page labels | Clarify what each number means | Misinterpretation |

Total: 4 files, 13 corrections. All logic-focused, no cosmetic changes.

