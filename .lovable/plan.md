## Problem

Looking at the screenshot, the x-axis shows `Nov 25` and `Dec 25` even though every snapshot in the database starts on `2026-01-01` (verified via DB query — earliest snapshot is Jan 2026, 16 rows total spanning Jan→Apr 2026).

The chart isn't actually plotting Nov/Dec 2025 data — it's a **timezone bug in the label formatter**. The month keys (`'2026-01-01'`, `'2026-02-01'`, …) are passed to `new Date(m)`, which parses bare `YYYY-MM-DD` strings as **UTC midnight**. When `toLocaleString('en-US', { month: 'short', year: '2-digit' })` then renders in the browser's local timezone (UTC-5/-8 in the Americas), it shifts back by hours and lands on the previous day:

- `new Date('2026-01-01')` → UTC midnight Jan 1 → local Dec 31 2025 → label `"Dec 25"`
- `new Date('2026-02-01')` → UTC midnight Feb 1 → local Jan 31 2026 → label `"Jan 26"`
- …and so on

So every month label is off by one. The Jan 2026 data point is mis-labeled `Dec 25`, the Feb point reads `Jan 26`, etc. There is no real Nov/Dec data to remove — we just need to fix the labels.

## Fix

**File: `src/components/CombinedWealthChart.tsx`**

Parse the `YYYY-MM-DD` month keys as **local dates** so the label matches the actual month. Replace any `new Date(m).toLocaleString(...)` calls with a small helper:

```ts
const labelForMonth = (yyyymmdd: string) => {
  const [y, mo] = yyyymmdd.split('-').map(Number);
  // Construct in local TZ (month is 0-indexed)
  return new Date(y, mo - 1, 1).toLocaleString('en-US', {
    month: 'short',
    year: '2-digit',
  });
};
```

Apply it where the row label is built (currently line 94):
```ts
const label = labelForMonth(m);
```

Same treatment for any other place that does `new Date(<YYYY-MM-DD>)` for display in this file (verify line 71's `new Date(effectiveStart)` — that one is used only for month iteration arithmetic, not display, but switch it to `new Date(y, mo-1, 1)` too so the loop isn't off-by-a-day either).

After the fix, the x-axis will read `Jan 26, Feb 26, Mar 26, Apr 26, Today` — starting at January as expected, with no phantom Nov/Dec 2025 ticks.

## Out of scope

- No DB changes (no Nov/Dec snapshots exist).
- No changes to `WealthProjectionChart` (separate component, separate axis).
- No change to the `startDate="2026-01-01"` prop — it's already correct; only the label rendering was wrong.

## Files

- `src/components/CombinedWealthChart.tsx` — fix `new Date(YYYY-MM-DD)` parsing for month labels and the iteration cursor.
