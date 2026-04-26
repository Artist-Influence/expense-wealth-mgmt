## Goal

Surface money routed to brokerage / investment accounts (Wealthfront, Gemini, Dub, Coinbase, Robinhood, Fidelity, Vanguard, Schwab, Betterment, Kraken, Binance, Collectr) as **true savings** in the Year-over-Year Comparison on the Income & Savings tab — so personal "Net Saved" reflects what actually moved into wealth, not just income minus expenses.

## What's wrong now

The YoY table currently shows:

| Metric | 2025 | 2026 | Change |
|---|---|---|---|
| Income | … | … | % |
| Expenses | … | … | % |
| Net Saved | income − expenses | income − expenses | — |

Brokerage transfers (currently 7 Wealthfront, 6 Gemini, 3 Dub rows = ~$17.6K in 2026) are correctly excluded from expenses (`is_transfer=true`, `transfer_type='brokerage_transfer'`) — but they're invisible. There's no row that shows "you actually moved $X into wealth this year."

## Fix

Add an **"Invested / Saved to Wealth"** row to the YoY Comparison table (personal mode only, since the data only matters there), with a per-destination breakdown shown inline.

### New YoY table layout (personal mode)

| Metric | 2025 | 2026 | Change |
|---|---|---|---|
| Income | … | … | % |
| Expenses | … | … | % |
| **Invested / Saved to Wealth** | $X | $Y | % |
|   ↳ Wealthfront | $… | $… | |
|   ↳ Gemini | $… | $… | |
|   ↳ Dub | $… | $… | |
|   ↳ (other detected destinations) | $… | $… | |
| Net Saved (Income − Expenses) | … | … | — |
| **True Savings Rate** | (Saved to Wealth ÷ Income)% | … | — |

Sub-rows render as small indented entries under the parent row. Only destinations with non-zero totals in either year show.

In **business mode**, the new rows are hidden — table stays as-is.

## Technical changes (single file: `src/pages/Insights.tsx`)

1. **Extend `loadExpenses` SELECT**: add `transfer_type` to the column list so we can filter brokerage transfers without re-querying.

2. **Add destination detector** alongside `effectiveMethod`:
   ```ts
   const WEALTH_DESTINATIONS: [RegExp, string][] = [
     [/wealthfront/i, 'Wealthfront'],
     [/gemini/i, 'Gemini'],
     [/\bdub\b/i, 'Dub'],
     [/coinbase/i, 'Coinbase'],
     [/robinhood/i, 'Robinhood'],
     [/fidelity/i, 'Fidelity'],
     [/vanguard/i, 'Vanguard'],
     [/schwab/i, 'Schwab'],
     [/betterment/i, 'Betterment'],
     [/kraken/i, 'Kraken'],
     [/binance/i, 'Binance'],
     [/collectr/i, 'Collectr'],
   ];
   const wealthDestination = (desc: string): string | null => { … };
   ```
   Source description from `description_normalized || description_raw`.

3. **Extend `yoyComparison` useMemo**: walk the raw `transactions` array (not `allExpenses`, since brokerage transfers are excluded there), match rows where `transfer_type === 'brokerage_transfer'` OR description matches `wealthDestination`, bucket by year + destination. Output:
   ```ts
   {
     thisYear: { income, expenses, savedToWealth, byDestination: { Wealthfront: $, Gemini: $, … } },
     lastYear: { … same shape },
     incomeChange, expenseChange, savedChange,
     trueSavingsRate: { thisYear: %, lastYear: % }
   }
   ```

4. **Render**: insert new rows in the YoY `<table>` between Expenses and Net Saved, gated on `mode === 'personal'`. Sub-rows use a smaller font + left padding (`pl-6`) and a `↳` glyph; sort destinations by current-year total descending.

5. **No schema / no backend changes**. Rule of thumb: rely on existing `transfer_type` flag first, fall back to description regex for any brokerage transfers that weren't auto-tagged.

## Out of scope

- No change to the Net Savings Rate card to its left (keeps existing income−expenses math).
- No change to Expenses calculation, charts, or any other tab.
- Business mode stays unchanged.