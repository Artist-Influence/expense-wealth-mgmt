# Personal vs Business Scope on Every Section's Insight Cards

## Goal
Every page that shows summary/"insight" cards must have a Personal / Business / All toggle (same UX as Insights and Tax) and the cards' math must filter by that scope.

## Current state audit

| Page | Has scope toggle? | Cards mode-correct? |
|---|---|---|
| Insights | Yes (Personal / Business) | Yes |
| Tax | Yes (Personal / Business / All, persisted) | Yes |
| Allocations | Yes (persisted) | Yes |
| CloseMonth | Yes (persisted) | Yes |
| Income | Yes (All / Personal / Business filterMode) | Yes |
| Expenses | Mode tabs exist (Personal / Business / Reimbursable) but the **summary stats card** (`stats.totalCashOut`, etc.) only reflects the active mode tab — there is no "All" view, and the strip never shows a side-by-side Personal vs Business comparison | Partial |
| Reimbursements | No scope toggle at all | No |
| Wealth | No scope toggle, `investment_accounts` has no `mode` column | No |

## What this plan changes

### 1. Wealth — add Personal / Business / All scope (DB + UI)

Schema migration:
- Add `mode text not null default 'personal'` to `public.investment_accounts` with a CHECK in `('personal','business')`.
- Backfill: leave existing rows as `personal` (current single-user assumption).

UI:
- Add a `ModeScopeToggle` (Personal / Business / All) at the top of the page, persisted to `localStorage` key `wealth_scope` (mirrors Tax pattern).
- Filter `accounts` by scope before computing `totalBalance`, `totalYtd`, `totalYearlyTarget` and the grouped account list.
- Add `mode` (Personal / Business) to the Add/Edit Account dialog as a `Select`, default `personal`.
- Each account card shows a small Personal/Business badge.

### 2. Reimbursements — add scope toggle

- Add `ModeScopeToggle` (Personal / Business / All) above the existing tabs, persisted as `reimbursements_scope`.
- Filter `transactions` and `groups` (groups inherit mode from their member transactions; if mixed, show under "All") by scope before computing the existing pending / submitted / reimbursed counts and totals.
- Show scope badge on each reimbursable row (already has `mode` field on the transaction).

### 3. Expenses — upgrade summary strip to comparative

The mode tabs (Personal / Business / Reimbursable) stay — they drive the spreadsheet. Above them, add a new lightweight summary strip that always shows side-by-side cards regardless of which tab is active:

- Personal Cash Out (mode=personal, !is_transfer, !exclude_from_expense_totals)
- Business Cash Out (mode=business, same filters)
- True Personal Spend (mode=personal && counts_toward_true_personal_spend)
- True Business Spend (mode=business && counts_toward_true_business_spend)
- Pending Reimbursable (unchanged, already cross-mode)

This makes the math comparable at a glance without forcing the user to switch tabs. The existing `stats` object already computes the right per-mode pieces; just add the cross-mode aggregates and render the new strip.

### 4. Shared `ModeScopeToggle` component

Create `src/components/ModeScopeToggle.tsx`:
- Props: `value: 'personal' | 'business' | 'all'`, `onChange`, optional `allowAll` (default true), optional `storageKey` for auto-persistence.
- Same visual style as the existing Insights toggle (segmented buttons in a `bg-secondary/50 border` shell).
- Replace the inline toggles in Insights, Tax, Allocations, CloseMonth, Income with this shared component so they all look and behave identically. No math changes for those pages.

### 5. Math consistency pass (verify only, fix any drift)

Re-confirm each page's scope-filtered aggregates use the post-audit rules already in place:
- Earned income only via `isEarnedIncome` from `src/lib/income-classifier.ts`.
- Expense totals exclude `is_transfer` and `exclude_from_expense_totals`.
- Tax math respects `partially_taxable`.

No new math rules — just confirm Wealth, Reimbursements, and the new Expenses strip plug into the same helpers.

## Out of scope
- No changes to import/parse pipeline.
- No retroactive re-tagging of existing income/expense rows (last audit already did that).
- Investment account historical contributions are not auto-split; user picks mode per account.

## Files touched
- New: `src/components/ModeScopeToggle.tsx`
- DB migration: add `mode` column to `investment_accounts`
- `src/pages/Wealth.tsx` — scope toggle, mode filter, mode field in dialog, badge on cards
- `src/pages/Reimbursements.tsx` — scope toggle + filter
- `src/pages/Expenses.tsx` — new cross-mode summary strip
- `src/pages/Insights.tsx`, `src/pages/Tax.tsx`, `src/pages/Allocations.tsx`, `src/pages/CloseMonth.tsx`, `src/pages/Income.tsx` — swap inline toggle for shared component (no behavior change)
