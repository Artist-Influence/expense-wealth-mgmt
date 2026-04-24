# Add Date Range Filter to Expenses

Add a date filter next to the existing Status / Filter / Category dropdowns so you can scope the table to a single month, the current/last month, year-to-date, or any custom date range.

## What you'll see

A new **Date** button in the toolbar showing the active range (e.g. "All Dates", "Apr 2026", "Apr 1 – Apr 24"). Clicking it opens a popover with:

- **Quick presets** (one click): All Dates, This Month, Last Month, Last 30 Days, Last 90 Days, Year to Date, Last Year
- **Month picker**: a dropdown of every month that has transactions (e.g. "Apr 2026", "Mar 2026", …) — pick one to scope to that month
- **Custom range**: two date inputs (From / To) with a Calendar popover, plus a Clear button

The selected range combines with the existing Status, Filter, Category, and Search controls. The active range is also shown as a small chip with an × to clear quickly.

## Technical changes (single file: `src/pages/Expenses.tsx`)

1. **State**
   ```ts
   const [dateFrom, setDateFrom] = useState<string | null>(null); // 'YYYY-MM-DD'
   const [dateTo, setDateTo]     = useState<string | null>(null);
   const [dateLabel, setDateLabel] = useState<string>('All Dates');
   ```

2. **Filter logic** — extend the existing `filtered` useMemo (around line 155):
   ```ts
   if (dateFrom && tx.date < dateFrom) return false;
   if (dateTo   && tx.date > dateTo)   return false;
   ```
   Add `dateFrom`, `dateTo` to the dependency array (line 201).

3. **Available months** — derive once from `transactions`:
   ```ts
   const availableMonths = useMemo(() => {
     const set = new Set<string>();
     transactions.forEach(t => t.date && set.add(t.date.slice(0, 7))); // 'YYYY-MM'
     return Array.from(set).sort().reverse();
   }, [transactions]);
   ```

4. **Preset helpers** (pure functions, no new deps — use existing `date-fns` already imported elsewhere in the file, or plain `Date` math):
   - `applyMonth(ym)` → first/last day of `YYYY-MM`
   - `applyThisMonth()`, `applyLastMonth()`, `applyLastNDays(n)`, `applyYTD()`, `applyLastYear()`
   - `clearDates()` → resets all three state values

5. **UI** — insert after the Category Select (line 1097) using existing shadcn primitives:
   - `Popover` + `PopoverTrigger` button (`h-8 glass-input text-xs`, `CalendarIcon` from lucide-react)
   - `PopoverContent` (`w-[320px] p-3`) with three sections:
     - Preset buttons in a 2-col grid (`Button variant="ghost" size="sm"`)
     - Month `Select` populated from `availableMonths` (formatted "MMM YYYY")
     - Two `Input type="date"` controls bound to `dateFrom`/`dateTo` with a Clear button
   - Chip rendered conditionally next to the trigger when a range is active, with an × button calling `clearDates()`

6. **Reset hook** — when "Clear filters" / reset behavior already exists, also call `clearDates()` there for consistency (only if such a handler exists; otherwise skip).

No database changes, no new components, no new dependencies. Calendar/Popover/Select/Input/Button shadcn components are already in the project.

## Out of scope

- Persisting the selected range across reloads
- Cross-page sync (Income / Insights keep their own filters)
- Timezone handling beyond the existing `tx.date` string comparison (dates are already stored as `YYYY-MM-DD`)
