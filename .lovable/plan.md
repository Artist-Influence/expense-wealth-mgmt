# Fix Insights → Payment Methods + upgrade Category Trends

## Root cause: Payment Methods pie

The pie reads only `final_method`, but on the personal dataset almost every approved row has `final_method = NULL` (the categorizer fills `predicted_method` instead). Confirmed via DB:

| final_method | predicted_method | rows | spend |
|---|---|---|---|
| `NULL` | Amex Platinum | 387 | $26,505 |
| `NULL` | BoA 5592 | 13 | $14,898 |
| `NULL` | BoA 5563 | 27 | $1,993 |
| `NULL` | BoA Credit Card | 16 | $875 |
| `NULL` | BoA 5373 | 5 | $540 |
| Amex | Amex Platinum | 1 | $34 |

So the chart effectively renders a single "Unknown" slice. This is the same `final_* vs predicted_*` pattern that `effectiveCategory()` already solves for categories.

## Fix #1 — Payment Methods chart

In `src/pages/Insights.tsx`:

1. Add a small helper `effectiveMethod(t) = t.final_method || t.predicted_method || 'Unknown'` (mirrors `effectiveCategory`).
2. Update the `methodBreakdown` memo to use `effectiveMethod(t)` instead of `t.final_method`.
3. Normalize obvious aliases so the pie isn't fragmented:
   - Any method matching `/^Amex/i` → `"Amex"`
   - Any method matching `/^BoA/i` → `"Bank of America"`
   - Anything else → keep as-is, falling back to `"Unknown"` only when both fields are null.
4. Keep the pie, but add the dollar amount next to each label so the user can read totals at a glance:
   - `label={({ name, percent, value }) => \`${name} · $${Math.round(value).toLocaleString()} (${(percent*100).toFixed(0)}%)\`}`

## Fix #2 — Category Trends section

Today this is six tiny sparklines with no axes, no totals, no dots — hard to read. Replace it with a single combined chart that shows every top-6 category as its own line, plus a category legend with dollar totals.

In `src/pages/Insights.tsx`:

1. Reshape `categoryTrends` into a single rows array suitable for one Recharts `LineChart`:
   ```ts
   // [{ month: 'Jan 26', Groceries: 412, Dining: 183, ... }, ...]
   ```
   Keep the existing top-6-by-total selection. Compute and expose `categoryTotals: { name, total, color }[]` for the legend.
2. Replace the 2-column sparkline grid with:
   - One `ResponsiveContainer` (height 300) holding a `LineChart` with `CartesianGrid`, `XAxis` (formatted `MMM YY`), `YAxis` (`$Nk`), one `<Line>` per category (`type="monotone"`, `strokeWidth={2}`, `dot={{ r: 3 }}`, `activeDot={{ r: 5 }}`), and a styled `Tooltip` showing all six categories for the hovered month.
   - A clickable legend below the chart (same pattern as `CombinedWealthChart`) where each chip shows the category name, its color dot, **its period total** (e.g. `Groceries · $1,842`), and toggling hides/shows that line.
3. Reuse `CHART_COLORS` and the existing tooltip styling (`tooltipStyle`) so it matches the rest of the page.

## Files affected

- `src/pages/Insights.tsx` — add `effectiveMethod` helper, fix `methodBreakdown`, restructure `categoryTrends` memo, replace the Category Trends JSX block (~lines 1310–1338) with the new combined LineChart + clickable legend.

## Out of scope

No DB changes. No edits to other pages or to the categorization engine — the underlying data is already correct, only the Insights presentation is fixed.
