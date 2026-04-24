# Fix: Income Summary Cards Ignore the Date Filter

## What's actually happening

The user selected **Year to Date** in the date popover and expected the summary cards (Total Inflows, Business Revenue, Taxable, etc.) to reflect YTD totals. They saw $68,662 and thought that was YTD sales.

It isn't. That's **April 2026 only**. Verified against the database:

| Scope | Total Inflows | Business Revenue |
|---|---|---|
| April 2026 (what the cards show) | **$68,662** | $50,315 |
| YTD 2026 (what the user expected) | **$298,677** | **$225,872** |
| All time | $298,677 | $225,872 |

The cards in `src/pages/Income.tsx` (lines 127-140) are hardcoded to `thisMonth`:
```ts
const monthTxs = transactions.filter(t => t.date?.startsWith(thisMonth));
```
They never read `dateFrom` / `dateTo`, so the date popover only filters the **table**, not the headline numbers. The footer line just says "This month: 2026-04," which is easy to miss when the picker says "Year to Date."

## Fix

Make the summary cards respect the active date filter, and label them so the active range is visible.

### `src/pages/Income.tsx`

1. **Compute cards from the date-filtered set** (matches Expenses' model where the visible numbers reflect the active filter):
   ```ts
   const summaryCards = useMemo(() => {
     const inRange = transactions.filter(t => {
       if (dateFrom && (!t.date || t.date < dateFrom)) return false;
       if (dateTo && (!t.date || t.date > dateTo)) return false;
       // When no date filter is set, default to this month so the
       // dashboard isn't misleading on first load.
       if (!dateFrom && !dateTo) return t.date?.startsWith(thisMonth);
       return true;
     });
     const totalInflows = inRange.reduce(...);
     // ... (same breakdowns as today, but over inRange)
   }, [transactions, dateFrom, dateTo, thisMonth]);
   ```

2. **Label the card section with the active range** so the scope is unambiguous:
   - Add a small caption above the cards: `Summary · {dateActive ? dateLabel : 'This Month'}`.
   - Update the page subtitle (currently says "Summary: This Month") to say `Summary: {dateActive ? dateLabel : 'This Month'}`.

3. **Footer line**: already updated previously to show `dateActive ? dateLabel : 'All Dates'` — leave as-is; it now agrees with the cards.

### Out of scope

- No DB or schema changes. The data is correct; only the UI grouping was wrong.
- Tax, Insights, Wealth pages — not in scope; if any of them have similar "this month vs YTD" confusion, address separately.

## QA

- Open Income with no filter → cards show This Month (~$68k Total Inflows), label says "This Month".
- Click date pill → Year to Date → cards re-compute to ~$298,677 Total Inflows, ~$225,872 Business Revenue, label says "Year to Date".
- Choose Last Month → cards reflect March; label updates.
- Clear filter → cards drop back to This Month.
