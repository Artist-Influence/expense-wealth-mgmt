## Three fixes for /wealth

### 1. Wealth Over Time — kill the Nov/Dec ghost points

Today the chart appends a hard-coded **"Today"** anchor (Nov 25, 2025) using `current_balance`. Because today's date is *before* Jan 2026, the Today point lands to the **left** of the Jan-26 snapshot, dragging the line back into Nov/Dec 2025.

**Fix in `src/components/CombinedWealthChart.tsx`:**
- Only append the Today anchor when `today >= startDate`. Otherwise, the chart ends at the most recent monthly snapshot (Apr 2026 for now).
- Sort the final rows by `_date` defensively so any future anchor is always chronological.
- Result: chart cleanly spans **Jan 26 → Apr 26** with no Nov/Dec ghost.

### 2. Move S&P 500 (Wealthfront) into the Brokerage group

Currently the **S&P 500** account has `account_type = 'savings'`, which is why it renders under the "Other" section. Brokerage index funds are stocks — move it.

**Fix:**
- Run a one-line UPDATE: set `account_type = 'brokerage'` (and platform to `'Wealthfront'` if blank) for the existing `S&P 500` row.
- No code changes needed — the existing `TYPE_GROUPS.brokerage` already includes `brokerage`, and the projection chart already uses `brokerage → 8% S&P-style default`.

### 3. Live market-rate calculation for the projection

Today the projection uses static heuristic rates (S&P 8%, crypto 12%, etc.). Make these **live and historical** by adding a small calculator component.

**New edge function: `market-rates`**
- Pulls free, no-key public data:
  - **S&P 500 (^GSPC)** — Yahoo Finance `query1.finance.yahoo.com/v8/finance/chart/^GSPC?range=20y&interval=1mo` → compute 1y, 5y, 10y, 20y CAGR.
  - **BTC-USD** — same Yahoo endpoint with `BTC-USD`. (Default crypto basket; user can swap to ETH-USD or a custom mix from a dropdown.)
  - **Pokémon TCG index** — no clean free feed; use a configurable static "PSA Card Index" 5y CAGR (~12%) the user can override per-account, with a citation link.
  - **Dub** — no public quote feed. Best we can do: let the user paste their **Dub yearly performance** (or we infer it from their actual snapshot history → see below).
- Returns `{ symbol, cagr_1y, cagr_5y, cagr_10y, cagr_20y, as_of }`.
- Cached client-side via React Query (`staleTime: 6h`) so we don't hammer Yahoo.

**New component: `LiveRateCalculator` (modal/popover on each assumption row)**
- Click the "rate %" cell → popover opens showing:
  - **Live benchmarks** for the relevant symbol: 1y / 5y / 10y / 20y CAGR with sparkline.
  - **Your actual realized rate** computed from this account's `account_balance_snapshots` history (annualized, contributions-adjusted via Modified Dietz). Falls back to "Need 2+ snapshots" if too sparse.
  - Buttons: "Use 10y avg", "Use 20y avg", "Use my realized rate", or type a custom value.
- Symbol mapping per account (editable, persisted to localStorage with the existing assumptions):
  - `brokerage` + Wealthfront/S&P → `^GSPC`
  - `crypto` + Gemini → `BTC-USD` by default; dropdown for `ETH-USD`, `SOL-USD`, or weighted mix
  - `collectibles` → no live symbol; show static PSA index + manual override
  - `brokerage` + Dub → realized-rate only (no public symbol)

**New "Realized vs Assumed" badge on each legend chip**
- Small caret showing how the user's actual snapshot CAGR compares to their assumed rate (e.g. `assumed 8% · realized 14%`). Helps spot stale assumptions.

**Optional inputs from you (nice but not required to ship):**
- Specific crypto holdings split (e.g. 60% BTC / 30% ETH / 10% SOL) → I'll wire a weighted-CAGR mix.
- Dub historical monthly P&L statements → I'll backfill snapshots so the realized-rate calc works there too.

---

## Files touched

- **Edit** `src/components/CombinedWealthChart.tsx` — guard the Today anchor with `today >= startDate`, sort rows.
- **Data update** — `UPDATE investment_accounts SET account_type='brokerage', platform=COALESCE(platform,'Wealthfront') WHERE account_name='S&P 500'`.
- **New** `supabase/functions/market-rates/index.ts` — fetches Yahoo Finance monthly history, returns CAGRs (no API key needed).
- **New** `src/components/LiveRateCalculator.tsx` — popover with live benchmarks + realized-rate calc + apply buttons.
- **Edit** `src/components/WealthProjectionChart.tsx` — pass snapshots in, render `<LiveRateCalculator>` next to each rate input, show realized-vs-assumed delta on legend chips, add per-account symbol mapping to the assumptions store.
- **Edit** `src/pages/Wealth.tsx` — pass `snapshots` to `WealthProjectionChart`.

No DB migration. No new tables. No new secrets (Yahoo Finance v8 chart endpoint is free and key-less).

---

## Out of scope unless you ask

- Pulling Dub-specific or Collectr-specific live quotes (no public APIs). Realized-rate from your snapshots is the substitute.
- Tax-adjusted / inflation-adjusted projections.
