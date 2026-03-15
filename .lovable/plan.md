

## Phase 6 — Accountant Exports & Close Month

### What We're Building

Two final pages: **Accountant** (generate downloadable CSV/report packs) and **Close Month** (guided monthly review workflow). No new database tables needed — these pages aggregate and export existing data.

### `/accountant` Page — Export Packs

A page to generate clean, downloadable CSV exports from existing data.

**Export types available:**
1. **Expense Ledger** — All approved `transactions_uploaded` for a date range, with final category/method/notes, filtered by mode (personal/business/all)
2. **Income Ledger** — All `income_transactions` for a date range with type and taxable status
3. **Reimbursement Report** — All `reimbursement_groups` with linked expenses, status, amounts expected vs received
4. **Tax Deductions Summary** — `transactions_uploaded` where `counts_as_tax_deduction = true`, grouped by category
5. **Tax Payments Made** — `transactions_uploaded` where `treatment_type` includes tax payment
6. **Year-End Summary** — Combined view: total income, total expenses by mode, total deductions, tax paid, net position

**UI:**
- Date range picker (month, quarter, year presets + custom)
- Export type selector (cards or list)
- Preview table showing what will be exported
- Download as CSV button
- All client-side CSV generation (no backend needed)

### `/close-month` Page — Guided Monthly Flow

A step-by-step wizard for month-end review. Each step shows relevant data and action buttons.

**Steps:**
1. **Review Exceptions** — Show `transactions_uploaded` with `review_status = 'needs_review'` for the selected month. Quick-approve or edit inline.
2. **Confirm Reimbursements** — Show pending `reimbursement_groups`. Mark submitted/received.
3. **Check Tax Reserves** — Show current tax reserve gap from `tax_profiles` + income/deduction data. Link to /tax for edits.
4. **Review Allocations** — Show or create allocation plan for the month. Link to /allocations.
5. **Generate Exports** — Quick links to generate the month's accountant exports. Link to /accountant with month pre-selected.
6. **Mark Complete** — Summary of what was reviewed. No new table needed — purely a UI flow.

**UI:**
- Month selector at top
- Stepper/progress bar showing steps 1-6
- Each step as a card with summary stats and action buttons
- Step completion is visual only (not persisted) — lightweight

### Nav Updates

Activate the Accountant nav item. Add Close Month to nav with a new `CalendarCheck` icon.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Accountant.tsx` | Full page: date range picker, export type cards, preview table, CSV download |
| `src/pages/CloseMonth.tsx` | Full page: month selector, stepper, 6 review steps with data summaries |
| `src/components/AppNav.tsx` | Activate Accountant, add Close Month nav item |
| `src/App.tsx` | Already has `/close-month` route — no change needed |

### Not in Scope
- PDF generation (CSV only)
- Persisting close-month completion status
- Email/share exports

