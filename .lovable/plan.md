# Show each Bank of America account separately in Payment Methods

## What's wrong now

The `effectiveMethod` helper I added in the previous round collapses every BoA-prefixed method into a single `"Bank of America"` slice. The data actually has four distinct BoA entries that should each be their own slice:

| Method (raw) | Rows |
|---|---|
| Amex Platinum | 387 |
| BoA 5563 | 28 |
| BoA Credit Card | 16 |
| BoA 5592 | 13 |
| BoA 5373 | 5 |
| Amex | 1 |

So the pie should have **5 slices** (1 Amex + 4 BoA accounts), not 2.

## Fix

Update `effectiveMethod` in `src/pages/Insights.tsx` so it preserves per-account detail for BoA while keeping Amex consolidated (only one Amex card):

- `Amex …` → `"Amex"` (single card, keep collapsed)
- `BoA <digits>` (e.g. `BoA 5592`) → `"BoA •5592"` (bullet makes it read like a card last-4)
- `BoA <text>` (e.g. `BoA Credit Card`) → `"BoA Credit Card"` (passthrough)
- Bare `BoA` / `Bank of America` → `"Bank of America"`
- Anything else → unchanged

No other changes — the pie, labels, and Category Trends section stay as they are. The legend will now naturally show 5 slices with their dollar totals.

## Files affected

- `src/pages/Insights.tsx` — only the `effectiveMethod` helper function (~10 lines).
