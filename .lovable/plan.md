## Goal
Make wealth projections to age 65 use real-time, per-account live market data — auto-seeded from each account's actual holdings basket, compounding monthly, with a realized-vs-benchmark callout.

## Holdings captured

**Gemini ($11,877.62 total):** BTC 40%, XRP 36%, ETH 12%, SOL 12% (liquid + staked combined).

**Dub ($20,121.51 total, 4 portfolios):**
- Stargate $15,725.69 (78%) — AI/semi infra, 92% Tech (MU/NVDA/AMD/TSM/AVGO/ASML/MSFT)
- Pelosi $3,258.52 (16%) — congressional, 64% Tech / 26% Utilities
- Infinity $843.38 (4%) — space economy, very speculative
- Trump $293.92 (1.5%) — Trump-linked, very speculative

**Collectr (Pokémon):** awaiting category split → defaults to 10%/yr static.

## Changes

### 1. New `src/lib/account-baskets.ts`
Centralized map of account-name/platform → benchmark basket string + per-asset-class static rates.

- `gemini` → `basket:BTC-USD:0.40,XRP-USD:0.36,ETH-USD:0.12,SOL-USD:0.12`
- `dub` → weighted Dub blend: `basket:SMH:0.55,QQQ:0.32,XLU:0.08,ARKX:0.05` (Stargate-dominant semis + Pelosi tech/utilities + Infinity space, Trump folded into QQQ weight)
- `wealthfront` / `s&p` → `^GSPC`
- `collectr` → static 10%/yr (no live feed)
- Resolution: case-insensitive substring match on `account_name` then `platform`

### 2. Expand `LiveRateCalculator.tsx` symbol presets
Add `XRP-USD`, `SMH` (semis ETF), `ARKX` (space ETF), `XLU` (utilities ETF), plus pre-built "Gemini basket (your mix)" and "Dub basket (your mix)" entries.

### 3. Auto-apply live 10y CAGR in `WealthProjectionChart.tsx`
- On account first-render: look up basket → fetch via existing `market-rates` edge function → seed projection rate to **10y CAGR**
- Track `userOverrode` flag per account in local state; once user edits, never auto-overwrite
- Badge in assumptions row:
  - `auto · 14.2% (SMH 10y)` (live-seeded)
  - `manual · 12.0%` (user-locked)
- Realized-vs-benchmark delta row: `realized +47.2%/yr · benchmark +38.1% · +9.1pp ahead` (color-coded)

### 4. Verify allocation + projection use live monthly data (read-only audit)
Confirm `Allocations.tsx` and `WealthProjectionChart.tsx` source current balances from `account_balance_snapshots` (latest per account) and compound monthly to age 65. Fix only if broken. No new DB writes.

## Out of scope (this pass)
- Persisting per-account basket overrides to DB (lives in code map for now; trivial to migrate to a `projection_settings` table later if you want UI-editable baskets)
- Pokémon category-weighted rate (need your sealed/vintage/graded split first)
- Real-time per-symbol holdings tracking inside Dub portfolios (Dub doesn't expose a public API; basket is a defensible proxy)

## Files
- `src/lib/account-baskets.ts` (new)
- `src/components/LiveRateCalculator.tsx`
- `src/components/WealthProjectionChart.tsx`
- `src/pages/Allocations.tsx` (read-only verify; edit only if needed)
