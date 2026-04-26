## Why the chart looks dead-flat

Three compounding issues are all firing at once:

1. **Crypto is using a 40-year horizon at ~65% annual growth.** Live 10-year CAGRs for the BTC/XRP/ETH/SOL basket are valid as a benchmark *today*, but extrapolating 64.68%/yr over 40 years produces $1+ quadrillion totals that visually annihilate every other account.
2. **The ±3% optimistic band is calculated off that absurd base**, pushing the y-axis ceiling into the trillions. The actual "expected" line then sits at less than 0.1% of the chart height for most of the timeline.
3. **`fmtUsd` is double-stacking suffixes** — values >= 1M get the "M" suffix, but no cap above that, so a $1.04Q balance renders as `$1044859278.38M`. That headline number is meaningless.

## Fix plan

Edit only `src/components/WealthProjectionChart.tsx`.

### 1. Cap unrealistic long-horizon rates (the main fix)

Long-term equity returns mean-revert. Sustained 60%+ annual growth for 40 years is impossible at scale. Add a sanity ceiling **only when seeding rates from live CAGR data**:

- For crypto / volatile baskets: clamp seeded rate to **15%/yr max** for the projection (still aggressive, but defensible long-run).
- For broad equities (S&P, Nasdaq): clamp to **12%/yr max**.
- For static-rate assets (collectibles, HYSA): unchanged.
- The user can still manually override to anything they want — clamp only applies to auto-seeded values.

Show a small "capped from X%" hint in the assumptions panel so the behavior is transparent.

### 2. Fix the headline & axis number formatting

Extend `fmtUsd` to handle billions and trillions:

```ts
const fmtUsd = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
};
```

Apply the same scale to the YAxis tickFormatter so axis labels read `$1.2B` instead of `$1200.0M`.

### 3. Tame the projection band so the line is visible

Change the ±3% rate band to an **asymmetric, capped** band:

- Low scenario: `rate − 3` (floored at 0%)
- High scenario: `min(rate + 3, rate × 1.25)` — prevents the high band from running away on already-aggressive rates.

Also: switch the YAxis to **log scale** (`scale="log"` with `domain={['auto', 'auto']}`) when the max value > 100× the min value. Log scale is the standard fix for long-horizon compound charts — early-year growth becomes visible while still showing the late-year explosion. Add a tiny "Linear / Log" toggle next to the Assumptions button so you can flip if you prefer.

### What you'll see after the fix

- Headline reads something realistic like `At age 65: $4.2M · Range: $1.8M – $9.5M` instead of quadrillions.
- The Gemini line stays steep but no longer flattens every other account into the x-axis.
- With log scale on (default for >100× spread), you'll see actual year-over-year growth from 2026 onward instead of a flatline until 2058.

### Files touched

- `src/components/WealthProjectionChart.tsx` — formatter, rate-clamping in the live-rate seed effect, projection band math, YAxis scale toggle.

No DB or other component changes needed.