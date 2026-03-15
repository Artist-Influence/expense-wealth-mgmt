

# Phase 2: Reimbursement & Transfer Red-Team Correction Pass

## Current Bugs Found

### Transfer Detection (`transfer-detector.ts`)
1. **`ONLINE PAYMENT` matches real bill payments** — e.g., "ONLINE PAYMENT TO CON EDISON" is a real utility expense, not a transfer
2. **`ACH PAYMENT` is over-broad** — ACH is a transport method, not a transfer indicator. "ACH PAYMENT GEICO" is real insurance
3. **`CARD PAYMENT` matches real purchases** — some banks label debit card purchases as "CARD PAYMENT STARBUCKS"
4. **`FROM CHECKING` is context-dependent** — "FROM CHECKING" on a credit card statement = payment (transfer), but on a brokerage = investment contribution
5. **`WIRE TRANSFER` is always flagged** — wire to a vendor (law firm, contractor) is a real expense
6. **`FUNDS TRANSFER` is always flagged** — Zelle "FUNDS TRANSFER TO JOHN" could be rent split or real payment
7. **No confidence scoring** — binary yes/no means all matches get equally silently excluded

### Reimbursement Logic (`Reimbursements.tsx`, `Income.tsx`, `Expenses.tsx`)
8. **Partial reimbursements have no status** — if a group is $500 expected and $300 received, it stays "pending" with no "partially_reimbursed" state
9. **No cascade for partial reimbursement** — linked expenses stay "pending" even when partial money arrives
10. **Reimbursement inflows counted in Allocations income** — `Allocations.tsx` line 50-54 queries ALL `income_transactions` with no filter excluding reimbursement type, inflating "free cash"
11. **Reimbursement inflows counted in Insights income** — `Insights.tsx` loads ALL income, savings rate treats reimbursement money as earnings
12. **Reimbursement inflows counted in Tax income** — Tax page queries income_transactions for taxable income but doesn't verify that `income_type='reimbursement'` rows are excluded from taxable totals (they're set `non_taxable` by classifier, but if user changes taxable_status manually, no guard)
13. **No "reimbursable_to" required field** — you can mark something reimbursable without specifying who owes you
14. **Income match dialog shows no amounts** — when matching income to a group, user can't see if the amounts align

### Reporting/Math
15. **Allocations free cash includes reimbursement income** — inflates investable cash
16. **Insights savings rate mixes reimbursement inflows with real earnings** — overstates savings
17. **Accountant export `income_ledger` includes reimbursement inflows** without a clear flag — accountant may treat as taxable
18. **Accountant year-end summary includes reimbursement income in "Total Income"**

---

## Plan

### A. Transfer Detection — Add Confidence Tiers

**File: `src/lib/transfer-detector.ts`**

Replace the binary model with a 3-tier system:

```
export interface TransferDetectionResult {
  isTransfer: boolean;
  transferType: '...' | null;
  transferConfidence: 'high' | 'medium' | 'low' | null;
}
```

- **High confidence** (auto-flag, exclude from totals): `PAYMENT - THANK YOU`, `INTERNAL TRANSFER`, `SAVE AS YOU GO`, `AUTOPAY PAYMENT`, patterns that are unambiguously between owned accounts
- **Medium confidence** (flag as `possible_transfer`, keep in totals, surface for review): `WIRE TRANSFER`, `FUNDS TRANSFER`, `ACH PAYMENT`, `ONLINE PAYMENT` — these CAN be real expenses
- **Low confidence** (no auto-flag, just add a note): `XFER`, `FROM CHECKING` on non-credit-card contexts

Remove `CARD PAYMENT` entirely (too ambiguous). Tighten `ONLINE PAYMENT` to only match `ONLINE PAYMENT -? THANK YOU` or `ONLINE BILL PAY` patterns.

The import pipeline in `Expenses.tsx` will then:
- High confidence → `is_transfer: true`, `exclude_from_expense_totals: true`
- Medium confidence → `is_transfer: false`, `transfer_type: 'possible_transfer'`, add a `match_explanation` note, keep in totals but surface in the "possible transfer" filter
- Low confidence → no flag, just informational

### B. Reimbursement Logic — Partial Support & Guards

**File: `src/pages/Income.tsx` — `matchToGroup`**

- After updating `total_received`, compute status properly:
  - `total_received >= total_expected` → `reimbursed`
  - `total_received > 0 && total_received < total_expected` → `partially_reimbursed`
  - Cascade to linked expenses: set `reimbursement_status` to `partially_reimbursed` or `reimbursed` accordingly
- Show amount comparison in the match dialog: "This payment: $300 | Group expects: $500 | Already received: $0 | Remaining: $500"
- Warn if match would cause overpayment

**File: `src/pages/Reimbursements.tsx`**

- Add `partially_reimbursed` to the "Reimbursed" tab filter
- Show received/expected ratio on group cards: "$300 / $500 received"
- Add "Overdue" badge: if status is pending/submitted and oldest transaction date > 30 days ago
- Require `reimbursable_to` when creating a group (already required) — also validate when marking individual transactions as reimbursable via drawer

**File: `src/components/TransactionDetailDrawer.tsx`**

- When toggling `is_reimbursable` on, prompt for `reimbursable_to` if empty

### C. Reporting Math — Exclude Reimbursement Inflows

**File: `src/pages/Allocations.tsx`**

- Filter income query to exclude `income_type = 'reimbursement'` and `income_type = 'transfer'` and `income_type = 'refund'` — these are not real earnings that should drive allocation math
- Or: only sum where `taxable_status = 'taxable'` — but this is too narrow (some non-taxable income like Roth distributions is real income)
- Better approach: exclude specific non-earning types: `reimbursement`, `transfer`, `refund`, `loan_proceeds`, `owner_contribution`

**File: `src/pages/Insights.tsx`**

- In savings rate calculation, exclude `income_type IN ('reimbursement', 'transfer', 'refund')` from income totals
- Add a label: "Income excludes reimbursements, transfers, and refunds"

**File: `src/pages/Accountant.tsx`**

- Add `income_type` column to income ledger export
- Year-end summary: separate "Total Earned Income" from "Total Inflows" — the latter includes reimbursements, the former excludes them
- Net position should use earned income, not total inflows

### D. Expense Badges & Status Display

**File: `src/pages/Expenses.tsx` table rendering**

- Add a small transfer badge for `transfer_type = 'possible_transfer'` (amber "Transfer?" pill) distinct from confirmed transfers (muted "Transfer" pill)
- Show reimbursement status badge inline: pending (amber), submitted (blue), reimbursed (green), partial (amber with fraction)

**File: `src/pages/Reimbursements.tsx`**

- Group cards show progress bar: received/expected
- "Partially Reimbursed" tab or badge within the Reimbursed tab

### E. Income Match Dialog Enhancement

**File: `src/pages/Income.tsx` match dialog**

- Show for each group: title, expected, received so far, remaining
- Highlight if payment amount > remaining (overpayment warning)
- Highlight if payment amount < remaining (will result in partial)
- After match, show confirmation of new group status

---

## Summary of Changes

| Area | Files Modified |
|------|---------------|
| Transfer detection tiers | `transfer-detector.ts` |
| Import pipeline transfer handling | `Expenses.tsx` (import section) |
| Partial reimbursement support | `Income.tsx`, `Reimbursements.tsx` |
| Reporting math corrections | `Allocations.tsx`, `Insights.tsx`, `Accountant.tsx` |
| Badge/status UX | `Expenses.tsx` (table), `Reimbursements.tsx` |
| Drawer reimbursable guard | `TransactionDetailDrawer.tsx` |
| Income match dialog | `Income.tsx` |

Total: 7 files, focused on logic correctness over cosmetics.

