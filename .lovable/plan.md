## Three small fixes

### 1. Add BoA 5373 as a payment method

`src/lib/method-detector.ts` — add the regex so any uploaded CSV with "BoA 5373" / "BoA_5373" / "BoA-5373" in its filename auto-tags every row's method column as **BoA 5373**:

```ts
[/bo?a[\s_-]*5373/i, 'BoA 5373'],
```

This sits alongside the existing 5563 / 5573 / 5592 entries. No DB or category changes — it's purely filename → method label. Apply this BoA 5373 card as a personal account (it gets registered in the method column of expense uploads automatically).

### 2. Income summary cards must respect Personal / Business toggle

On the Income page right now, the **Personal Income** and **Business Income** cards always show both totals regardless of the toggle, which is confusing.

Fix in `src/pages/Income.tsx`:

- When toggle = **All** → show both Personal Income + Business Income cards (current behavior).
- When toggle = **Personal** → hide Business Income card; show only Personal Income + the personal-scoped detail cards.
- When toggle = **Business** → hide Personal Income card; show only Business Income + the business-scoped detail cards.

Implementation: change the `cards` array to conditionally include the Personal/Business cards based on `filterMode`, and also scope the totals to the active mode (right now `personalIncome`/`businessIncome` ignore the mode filter — make them respect it).

### 3. Income on the Income page must segment cleanly by view

The table already filters by `filterMode`, but combined with the issue in #2 the segmentation feels broken. After fix #2, verify:

- **Personal view**: table only shows rows where `mode = 'personal'`; all summary cards reflect only personal totals; CSV import default = Personal; manual entry default = Personal.
- **Business view**: same but for business.
- **All view**: shows everything plus the side-by-side Personal vs Business card pair.

Also: the "Total Inflows" card label was already mode-aware ("Personal Total" / "Business Total" when filtered). Keep that, just make sure it sits next to the right single-mode card and not next to the cross-mode one.

### Files

- `src/lib/method-detector.ts` — add BoA 5373 pattern
- `src/pages/Income.tsx` — make summary cards respect the mode toggle (conditional card list + mode-scoped totals)

### Out of scope

- No DB changes. The `mode` column already exists on income, and method is detected on expense CSV import (existing behavior).
- Not touching Insights — its Personal/Business toggle already filters income correctly per the previous fix.
