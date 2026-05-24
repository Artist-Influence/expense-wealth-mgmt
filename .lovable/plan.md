## Goal
Render a dot on the wealth chart at every actual snapshot entry (not just month buckets), with larger dots on the Total line and smaller dots on each per-account line.

## Changes — `src/components/CombinedWealthChart.tsx`

1. **Replace month-bucketed x-axis with snapshot-date x-axis**
   - Build the `series` from the union of every `snapshots[].as_of_date` (deduped, sorted) instead of synthesized month-firsts.
   - Keep clamping to `startDate` (default Jan 2026) so pre-2026 stray snapshots don't drag the axis back.
   - For each date row, fill every account's value using the existing "most recent snapshot at-or-before this date" carry-forward, so lines stay continuous even on dates where only one account had an entry.
   - Keep the "Today" anchor (uses `current_balance`) appended only if today is after the last snapshot date.

2. **Dot sizing**
   - Total line: `dot={{ r: 3.5 }}`, `activeDot={{ r: 5 }}` (slightly bigger than today).
   - Per-account lines: `dot={{ r: 2 }}`, `activeDot={{ r: 3.5 }}` (smaller).
   - Hidden accounts: `dot={false}` (unchanged).

3. **X-axis label formatting**
   - Since ticks are now arbitrary dates, format as `MMM D` (e.g. `Jan 26`) using `parseLocalDate`. For the "Today" row keep the label `Today`.
   - Add `interval="preserveStartEnd"` and `minTickGap={24}` so dense entry days don't overlap labels.

4. **Tooltip**
   - Update label formatter to show the full `MMM D, YYYY` for the hovered date (or `Today`).

No backend, query, or other-file changes.

## Validation
- Add a snapshot mid-month → a new dot appears on that exact date on both the total and that account's line.
- Multiple snapshots in one month → multiple dots, not a single monthly average.
- Toggling an account off → its dots disappear and the Total line recomputes (already handled).
