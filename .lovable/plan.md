## Goal

Two upgrades to the Wealth page:
1. **Trim the historical chart** so the time axis starts at **Jan 2026** (not the older Nov-25 anchor that's currently leaking in from a stray snapshot).
2. **Add a long-term Projection chart** beneath it that shows every investment + the combined total compounded out to **age 65** (Wealthfront-style), with editable per-account growth rates and a clickable legend.

---

## Part 1 — Fix history start date (Jan 2026)

In `src/components/CombinedWealthChart.tsx`, the month series is built from `allDates[0]` (the earliest snapshot of any account). Because there's likely a Today auto-snapshot from when accounts were created on Nov 25, 2025, the X-axis begins there.

Change:
- Add an optional `startDate?: string` prop (defaulting to `'2026-01-01'`).
- Build months from `max(startDate, earliestSnapshot)` instead of unconditionally using the earliest snapshot.
- For each account on the start month, fall back to its earliest known snapshot value if there is no exact Jan-2026 snapshot, so each line still has a valid first point.
- Pass `startDate="2026-01-01"` from `Wealth.tsx`.

Result: history chart begins at **Jan 26** and ends at the **Today** anchor.

---

## Part 2 — New "Projection to Age 65" chart

### New component: `src/components/WealthProjectionChart.tsx`

A separate card placed directly under `CombinedWealthChart`. Features:

- **X-axis**: years from current year through the year the user turns 65.
- **Y-axis**: USD (k/M formatting).
- **Lines**: one per active account + bold **Total** line.
- **Clickable legend**: same toggle UX as the history chart (reuses styling).
- **Tooltip**: shows year, age, each account value, and total.
- **Per-account assumptions panel** (collapsible row above the chart):
  - Annual growth rate (%)
  - Monthly contribution ($) — pre-filled from `contribution_target_monthly`, falling back to `contributions_ytd / months_elapsed` if target is 0.
  - "Stop contributing at age" (default 65)
  - Stored in `localStorage` under `wealth_projection_assumptions_v1` keyed by `account_id`. No DB changes needed.

### Default growth-rate heuristics (editable)

Sensible starting values inferred from `account_type` and `platform`:

| Account type / platform | Default annual rate |
|---|---|
| Wealthfront S&P 500 / brokerage index | 8% |
| Crypto (Gemini) | 12% (high-vol caveat shown in tooltip) |
| Dub (social trading brokerage) | 10% |
| Collectibles (Pokémon) | 7% |
| Roth/Traditional IRA | 8% |
| Savings | 4% |
| Other | 6% |

These are seeded once into the per-account assumptions store; users can edit any value inline.

### Compounding math

For each account, simulate **monthly** then sample at year-end:

```text
balance_{m+1} = balance_m * (1 + annual_rate/12) + monthly_contribution
```

Stops contributions once `current_age + months/12 >= stop_age`. Continues compounding until age 65.

### Age input

There's no birthday field today. Add a single **"Your current age"** input at the top of the projection card, persisted to `localStorage` (`wealth_user_age`). Default 30 if unset; show inline hint "Used to project to age 65". (Avoids adding a DB column for one number.)

### Educated-prediction badge

A small "Methodology" popover next to the title explains:
- Rates are historical-average heuristics, editable per account.
- Crypto and collectibles use wider bands; consider toggling them off to see baseline.
- A dotted **conservative band** (rate − 3%) and **optimistic band** (rate + 3%) is drawn around the Total line as faint area shading so the user sees a range, not a single number.

---

## Files touched

- **Edit** `src/components/CombinedWealthChart.tsx` — add `startDate` prop, clamp series start.
- **New** `src/components/WealthProjectionChart.tsx` — projection card with assumptions panel, compounding sim, range bands, clickable legend.
- **Edit** `src/pages/Wealth.tsx` — pass `startDate="2026-01-01"` to history chart; render `<WealthProjectionChart accounts={scopedAccounts} />` directly underneath.

No DB migration. No new tables. No edge functions.

---

## Out of scope (call out for future)

- Pulling **real-time** market quotes for individualized predictions (would need a market-data API key + edge function). Today's "real-time metric" is the user's own current balance + their editable expected return. Happy to add a live-quote integration in a follow-up if you want.
