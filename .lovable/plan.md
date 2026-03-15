

# Phase 2 Reimbursement & Transfer Red-Team Pass — Focused Corrections

## Already Fixed (from previous passes)
The codebase already has: 3-tier transfer confidence, partial reimbursement status, overpayment warnings in match dialog, NON_EARNING_TYPES exclusion in Allocations/Insights savings rate, reimbursement badges with status variants, cascade from group status to linked expenses.

## Remaining Bugs Found

### 1. Insights YoY uses ALL income, not earned income
`Insights.tsx` lines 262-267: `incomeData.forEach` for year-over-year comparison includes reimbursements, transfers, and refunds. Should use `earnedIncome` (which already filters NON_EARNING_TYPES and is defined on line 230).

### 2. Accountant export lumps reimbursable_work into personal
`Accountant.tsx` line 169: `modeFilter === 'personal' && e.transaction_mode === 'reimbursable_work'` — reimbursable expenses silently appear in the "Personal" export. An accountant has no way to separate fronted work expenses from true personal spend. Fix: add a "Reimbursable" mode filter option and stop merging reimbursable_work into personal.

### 3. `BALANCE PAY` high-confidence transfer pattern is too broad
`transfer-detector.ts` line 12: `/BALANCE\s*PAY(?:MENT)?/i` matches "BALANCE PAYMENT" which some banks use for legitimate vendor payments or loan payments that ARE real expenses. Move to medium confidence.

### 4. No guard when income_type is changed after reimbursement match
In `Income.tsx`, a user can match an income transaction to a reimbursement group, then change its `income_type` from `reimbursement` to `payroll` via inline dropdown. The group link remains but the transaction now looks like taxable earnings. Fix: warn and unlink if type changes away from `reimbursement`.

### 5. Reimbursement group "total_expected" never updates if linked transactions are deleted or mode-switched away
If a user deletes a transaction or switches it from reimbursable_work to personal after it's been linked to a group, the group's `total_expected` stays inflated. No recalculation happens.

### 6. Allocations expense query has no owner_id filter
`Allocations.tsx` lines 70-75: relies entirely on RLS. While RLS protects data, the query also lacks mode filtering — personal allocations subtract business expenses from free cash.

### 7. Income page "Reimbursements" summary card counts ALL reimbursement-type income, not just this month's matched ones
This is already scoped to `thisMonth` (line 130), so this is actually correct. No fix needed.

### 8. Unmatching a reimbursement income transaction is impossible
Once matched, there's no UI to unmatch an income transaction from a group and reverse the `total_received` update. If matched to the wrong group, there's no recourse except manual DB edits.

---

## Plan — 6 Targeted Fixes

### A. Fix Insights YoY to use earned income only
**File:** `src/pages/Insights.tsx` (~line 262-267)
Change `incomeData.forEach` to `earnedIncome.forEach` in the YoY comparison block.

### B. Fix Accountant export mode filter
**File:** `src/pages/Accountant.tsx`
- Add `reimbursable` option to the mode filter dropdown
- Stop merging `reimbursable_work` into `personal` — filter them separately
- When mode is `all`, show everything; when `reimbursable`, show only `transaction_mode === 'reimbursable_work'`

### C. Tighten transfer detection
**File:** `src/lib/transfer-detector.ts`
- Move `BALANCE PAY` from HIGH to MEDIUM confidence (can be real debt/vendor payments)
- Add negative lookahead on `TRANSFER TO|FROM` to exclude patterns followed by a person's name or known vendor word (or simply keep it medium, which it already is — verify)

### D. Guard against reimbursement income type change
**File:** `src/pages/Income.tsx`
- In `updateField`, if changing `income_type` away from `reimbursement` and the transaction has a `linked_reimbursement_group_id`, confirm with user and reverse the group match (subtract amount from `total_received`, unlink).

### E. Add "Unmatch" action for reimbursement-linked income
**File:** `src/pages/Income.tsx`
- Show an "Unlink" button next to income transactions that have `linked_reimbursement_group_id`
- On click: subtract amount from group's `total_received`, recalculate group status, unlink the transaction, set `linked_reimbursement_group_id` to null

### F. Add owner_id to Allocations expense query
**File:** `src/pages/Allocations.tsx`
- Add `.eq('owner_id', user.id)` to expense query for defense-in-depth
- Add comment clarifying that expenses are cross-mode for allocation math (or add mode filter if that's preferred)

---

## Summary

| Fix | File | Risk addressed |
|-----|------|---------------|
| YoY earned income | Insights.tsx | Reimbursements inflating income trends |
| Accountant mode filter | Accountant.tsx | Reimbursable expenses hidden in personal export |
| BALANCE PAY demotion | transfer-detector.ts | Real payments silently excluded |
| Income type change guard | Income.tsx | Matched reimbursement becomes taxable income |
| Unmatch action | Income.tsx | No recourse for wrong reimbursement match |
| Owner_id on allocations | Allocations.tsx | Defense-in-depth |

Total: 4 files, focused on the gaps between previous fixes and complete correctness.

