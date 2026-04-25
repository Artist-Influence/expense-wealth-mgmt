## Goals

1. **Wealth — auto-tracked contributions + growth chart**
   - Auto-detect YTD contributions to **Gemini, Dub, Wealthfront, and Pokémon (TCGPlayer / "Pokemon" Zelle)** from Personal expense transactions.
   - Show a **starting value (Jan 1) → current value** chart for each account so you can see how much growth came from contributions vs. natural appreciation (e.g. Pokémon: started $25,773, +$1.5K contributed, rest is appreciation).
2. **Allocations — clickable review warning**
   - Make the "⚠️ N transactions need review this month" banner a link that opens the Expenses page pre-filtered to the offending month + scope + `needs_review/suggested/ai_suggested` status so you can clear them.
3. **Tax — multi-year projection (2025 + 2026)**
   - Add a **year selector** (2025, 2026) to the Tax tab.
   - Add an **"Income vs. Expenses based projection"** card per year that shows: net (income − deductible expenses), implied tax at your current Fed/NYS/NYC rates, and a Personal vs. Business breakdown.
4. **Merchant Memory — sortable columns**
   - Make Merchant Key, Mode, Category, Method, Notes, and Seen columns sortable ascending/descending with click-to-toggle headers.

---

## What it will look like

### Wealth page
- New **"Auto-Tracked Contributions (Personal)"** card on top: rows for Gemini, Dub, Wealthfront, Pokémon — each shows YTD contribution total, txn count, last contribution date, and a **"View transactions"** link.
- Each existing investment account card gets a new **"Growth"** mini-chart (Jan 1 baseline → today). Baseline = either:
  - A **manually-entered** `starting_balance_year` field on the account (you'll set Pokémon = `25773`), OR
  - `current_balance − contributions_ytd` if no baseline is set.
- A **"Sync from expenses"** button auto-fills `contributions_ytd` (and creates the Pokémon / Gemini / Dub / Wealthfront accounts if they don't exist yet), so the math reflects reality.

### Allocations page
- The amber warning row becomes a clickable link: `→ Expenses?month=YYYY-MM&scope=personal&review=needs_review` — Expenses page reads those URL params and applies the filter automatically.

### Tax page
- New **Year selector** next to the Personal/Business/All toggle: `2025 | 2026`.
- New **"Projection — based on actuals"** section with three cards:
  - **Net (income − deductions)** for the selected year.
  - **Estimated tax owed** = net × (Fed + NYS + NYC%).
  - **Personal vs Business split** mini-table (so you can see which side drove the liability).

### Merchant Memory
- Each header (`Merchant Key`, `Mode`, `Category`, `Method`, `Notes`, `Seen`) becomes a sort button with an up/down arrow indicator. Default sort stays `Seen ↓`.

---

## Technical notes

**DB migration**
- `investment_accounts`: add `starting_balance_year numeric default 0`, `auto_track_pattern text` (regex/keyword used to match Personal expenses, e.g. `gemini|dub|wealthfront|tcgplayer|pokemon`).

**Wealth auto-sync logic** (`src/pages/Wealth.tsx`)
```ts
// On click "Sync from expenses":
// 1. Pull personal expenses for current YTD where description matches account.auto_track_pattern.
// 2. Sum amounts → write back as contributions_ytd.
// 3. Default patterns seeded for Gemini, Dub, Wealthfront, Pokémon.
const PATTERNS = {
  Gemini:      /gemini\s*trust/i,
  Dub:         /\bdub\b\s*\(?ecfi/i,
  Wealthfront: /wealthfront/i,
  Pokémon:     /tcgplayer|pokemon/i,
};
```
- Growth chart series = `[{date: yearStart, value: starting_balance_year}, {date: today, value: current_balance}]` plus contribution markers.

**Allocations clickable warning** (`src/pages/Allocations.tsx` + `src/pages/Expenses.tsx`)
- Wrap warning in `<Link to={`/expenses?month=${selectedMonth}&scope=${scope}&review=unreviewed`}>`.
- Expenses reads `useSearchParams()` on mount and pre-applies month + mode + review-status filter.

**Tax multi-year** (`src/pages/Tax.tsx`)
- Replace hard-coded `currentYear` with `selectedYear` state (default = current year). Reload `loadIncome / loadDeductions / loadTaxPayments` when year changes.
- Add projection card: `net = taxableIncome − totalDeductions`, `estTax = net × (fed%+nys%+nyc%)/100`. Compute Personal-only and Business-only side-by-side using two parallel queries when `scope === 'all'`.

**Merchant Memory sortable** (`src/pages/MerchantMemory.tsx`)
- Add `sortKey` + `sortDir` state. Replace `<th>` text with a button that toggles direction. Sort `filtered` with a comparator before render. No DB changes (in-memory sort over the loaded 200 records).

**Files touched**
- `supabase/migrations/…` (new migration adding 2 columns to `investment_accounts`)
- `src/pages/Wealth.tsx` (auto-sync, growth chart, starting balance field)
- `src/pages/Allocations.tsx` (clickable warning)
- `src/pages/Expenses.tsx` (read URL search params)
- `src/pages/Tax.tsx` (year selector + projection card)
- `src/pages/MerchantMemory.tsx` (sortable headers)

**Data confirmed in DB**
- Gemini Personal contributions YTD 2025: **$5,600** (6 txns)
- Dub Personal contributions YTD 2025: **$5,400** (3 txns) + 1 PayPal $31.50
- Wealthfront: not present in 2025 transactions — account will be created with $0 auto-tracked until matching txns appear.
- Pokémon: TCGPlayer $275.60 + Zelle "Pokemon cards" $170 → ~$445 captured; you can edit `starting_balance_year = 25773` so the growth math is accurate.
