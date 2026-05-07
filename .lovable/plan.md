
## Problem

The new volatility-based bands are producing extreme projections because raw annualized σ values (55% for crypto, 20% for collectibles) applied as rate offsets create unrealistic high/low scenarios over 40 years. Even with the cap (`rate × 1.25 + 2`), the numbers compound to billions.

The core issue: **volatility should scale down for longer horizons**. A 1-year 55% σ does not mean ±55% every year for 40 years — returns mean-revert. This is a well-known problem in long-horizon projections.

## Fix

1. **Apply a horizon-dampening factor** to the volatility offset. The standard approach: divide σ by `√(horizon_years)` for the band width, or more practically, cap the band offset to a reasonable multiple of the base rate:
   - High band: `base_rate + min(vol_offset, base_rate × 0.5)` — at most 50% wider than expected
   - Low band: `base_rate - min(vol_offset, base_rate × 0.6)` — at most 60% narrower, floored at 0%

2. **Use a tighter σ fraction** for the offset. Instead of `1σ` (which covers 68%), use `0.5σ` — this produces a more useful "plausible range" rather than "anything could happen" range. Combined with the horizon dampener, this keeps the bands meaningful but not absurd.

3. **Tighten the high-band cap formula** to `min(adjustedRate, base_rate + 4)` — no account should project more than 4 percentage points above its expected rate for the optimistic scenario. Over 40 years, even +4pp is a massive difference.

### Result
- Collectr (10% base): band of ~6%–14% instead of -10%–14.5%
- Gemini (15% base): band of ~9%–19% instead of -40%–20.75%
- S&P 500 (12% base): band of ~8%–16% instead of -4%–17%

This keeps the bands proportional to actual volatility (crypto wider than equities wider than savings) without producing billions-scale artifacts.
