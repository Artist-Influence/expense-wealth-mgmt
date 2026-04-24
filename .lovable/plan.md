# Bring Expenses-style Filtering to Income

The Income page currently has only Search, Type, and Status dropdowns — no date filter and a thinner status list. The Expenses table has a much richer filter bar: a date popover with presets/quick months/custom range, an active-filter chip, and stats reflecting the filtered view. This plan ports that experience to Income.

## What to add to `src/pages/Income.tsx`

### 1. Date range filter (mirroring Expenses lines 98-293, 1241-1306)
- New state: `dateFrom`, `dateTo`, `dateLabel`.
- Helpers: `fmtYMD`, `fmtMonthLabel`, `clearDates`, `applyMonth`, `applyThisMonth`, `applyLastMonth`, `applyLastNDays(30|90)`, `applyYTD`, `applyLastYear`, `onCustomFrom`, `onCustomTo`, plus `dateActive` flag.
- `availableMonths` derived from `transactions[].date` for the "Pick a month" select.
- Wire into the existing `filtered` memo: skip rows whose `date` is outside the selected range.
- New `Popover` button in the filter bar showing `<Calendar />` + current `dateLabel` + `<ChevronDown />`, opening a panel with:
  - Quick presets grid (All Dates / This Month / Last Month / Last 30 / Last 90 / YTD / Last Year)
  - Pick-a-month `Select` populated from `availableMonths`
  - Custom range two `Input type="date"` fields
  - Footer Clear button
- Active-state pill chip next to the popover trigger that clears the filter on click (same pattern as Expenses).

### 2. Status filter — full set
Income has its own status vocabulary, but the dropdown should mirror the Expenses pattern (every real status + "All"). Replace the current 4 options with the full set actually used by income rows:
- All Statuses
- Needs Review (`needs_review`)
- Auto-Classified (`auto_classified`)
- Approved (`approved`)
- Edited (`edited`)  ← added for parity if/when income rows get edited

(If `edited` isn't yet emitted, keep the option visible — selecting it just shows zero rows, same as Expenses behavior. No DB changes.)

### 3. Imports
Add `Popover`, `PopoverContent`, `PopoverTrigger` from `@/components/ui/popover`; add `Calendar`, `ChevronDown`, `X` to the lucide import group.

### 4. Layout
Wrap the filter bar in `flex flex-wrap items-center gap-2` (same as Expenses) so the date control sits inline and wraps cleanly on narrow viewports. Existing Search / Type / Status / bulk action controls stay where they are; Date pops in right after Status.

### 5. Footer counts
Change the footer line from `Showing X of Y income transactions · This month: …` to `Showing {filtered.length} of {transactions.length} · {dateActive ? dateLabel : 'All Dates'}` — same vocabulary as Expenses.

## Out of scope

- Category filter — Income has no per-row category, so no analog to add.
- "Extra filter" (Transfers / Duplicates / Splits / Parse Errors / Excluded) — these flags don't exist on `income_transactions`. Skipped.
- Summary cards stay anchored to "this month" as today; only the **table** respects the date filter, matching Expenses' model where stats are global and the table is filtered.
- Tax / Reimbursements / Wealth pages — not in scope of this request.

## QA

- Open Income, click date pill → choose This Month → table narrows; pill turns primary; "X of Y" reflects filter.
- Choose Last 90 Days → CSV export (already wired to `filtered`) downloads only those rows.
- Status filter set to "Approved" + date "Last Month" + a search term → all three combine correctly.
- Click the active-state chip → filter clears, full list returns.
