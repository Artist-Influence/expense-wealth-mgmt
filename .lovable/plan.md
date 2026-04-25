## Goals

1. **Insights — fix the math.** Charts and modal cards are only counting `approved/auto_categorized/edited` transactions, so months that are mostly still in `suggested` review state (Jan–Apr 2026 = ~415 of 436 personal txns) look almost empty. February's "Spend by Category" only shows Dining + Travel because those are the only two categories the user has manually `edited`. We need to count `suggested` rows in the totals (with a clear visual + warning), and audit every other Insights card for the same bug.
2. **Wealth — accurate monthly balance history + multi-line chart.** Replace the 3-point "Jan 1 → today" chart with a real monthly balance series for each account (Jan–today). Add a top-of-page combined chart showing every account stacked together with a per-account legend you can click on/off.

---

## Diagnosis (why Insights looks wrong)

A query against your data shows:

```
month     status      txns   total
2026-01   suggested    79    $5,516
2026-01   edited        1    $49
2026-02   suggested   106    $10,968
2026-02   edited        8    $415       ← only what Insights currently sees
2026-03   suggested   140    $16,680
2026-03   edited        4    $767
2026-04   suggested    90    $12,484
2026-04   edited        8    $1,070
```

`Insights.tsx` line 262 filters every chart to:
```ts
['approved', 'auto_categorized', 'edited'].includes(t.review_status)
```
So the entire `suggested` bucket — which is 95%+ of your real spend — is invisible in every chart, every modal, and every "top category / top merchant / monthly trend" card. That's the bug.

---

## What it will look like

### Insights — math correctness pass
- **New review-state filter** next to the date filter:
  - `All approved data` (default, current behavior — but include `suggested` too)
  - `Only manually approved` (current behavior, opt-in)
  - `Include needs_review` (opt-in for a "raw cash flow" view)
  - Default changes to **include `suggested`**, since that's where the categorization engine has put real spend that just hasn't been clicked through yet.
- **"Coverage" pill** on every chart card showing `X of Y txns counted · Z still needs review` so you can see at a glance whether a chart is missing data. Clicking the pill deep-links to Expenses with the missing month + status pre-applied (same pattern as the Allocations warning).
- **Audit + fix every card** on the Insights page so the math stays consistent across:
  - Overview row (This Month / Last Month / MoM% / Top Category / Top Merchant / Period Total / Transfers Excluded)
  - Spend by Category (bar)
  - Monthly Trend (line)
  - Top Merchants (table)
  - Recurring Charges (table)
  - Income vs Expenses (12-month chart) and the filter-aware version
  - Savings Rate cards (current month, trailing 3-mo, period totals)
  - YoY comparison
  - Category Trends (multi-line)
  - Method Breakdown (pie)
  - Cash Flow (Money In / Out / Net / Savings %)
  - Suggestions ("Where to Save")
  - Data Quality card
- **Single source of truth helper** (`useEffectiveExpenses`) so we don't have to touch 13 separate filters every time the rule changes.

### Wealth — real monthly balance series
- **New table `account_balance_snapshots`** (date, account_id, balance, owner_id) so we can record month-by-month values and plot them honestly instead of inferring a 2-point line.
- **Seed it now** with the values you provided:
  - Dub: Jan 11,756 · Feb 14,891 · Mar 15,525 · Apr 15,118
  - Gemini: Jan 7,000 · Feb 6,949 · Mar 8,897 · Apr 9,338
  - Collectr: Jan 25,807 · Feb 27,527 · Mar 29,782 · Apr 35,743
  - Wealthfront S&P 500: Jan 5,898 · Feb 6,538 · Mar 6,422 · Apr 8,066
- **Each account card** keeps its mini-chart but pulls from the snapshot table (real shape, not 3 fake points). When current_balance changes, today's snapshot upserts automatically.
- **New "Add monthly balance" inline editor** on each account card so you can keep updating Jan/Feb/Mar/Apr/May going forward. Edit inline → the chart refreshes.
- **New top-of-page Combined Wealth Chart**:
  - X axis: months (Jan → today, will keep extending each month)
  - Y axis: $ balance
  - One colored line per account + a thicker "Total" line on top
  - Legend below the chart with a clickable chip per account: click to hide/show that line. Total auto-recalculates from visible accounts.
  - Scope-aware (respects Personal / Business / All toggle).
  - Tooltip shows each visible account's value on that month + total.

---

## Technical notes

### DB migration
```sql
-- Stores point-in-time balances per account.
create table public.account_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  account_id uuid not null,
  as_of_date date not null,
  balance numeric not null,
  created_at timestamptz not null default now(),
  unique (account_id, as_of_date)
);
alter table public.account_balance_snapshots enable row level security;
create policy "Owner access account_balance_snapshots"
  on public.account_balance_snapshots for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
```
Then seed the rows above with INSERT (Apr value also written to `current_balance` so the existing card top-line stays accurate).

### Insights (`src/pages/Insights.tsx`)
- Replace the inline `['approved','auto_categorized','edited']` filter (line 262, plus everywhere it's reused) with a single helper:
  ```ts
  const COUNTED = new Set(reviewMode === 'manual'
    ? ['approved','auto_categorized','edited']
    : reviewMode === 'all'
      ? ['approved','auto_categorized','edited','suggested','ai_suggested','needs_review']
      : ['approved','auto_categorized','edited','suggested','ai_suggested']);
  ```
- Default `reviewMode = 'suggested'` (i.e. include `suggested` + `ai_suggested`). Persist in localStorage.
- Apply to every `useMemo` that currently filters by review_status (categoryData, monthlyTrend, topMerchants, recurringCharges, savingsRate, yoyComparison, categoryTrends, methodBreakdown, dataQuality, overview's `approvedScoped`, suggestions' baseline filter).
- Add `Coverage` chip component: counts `included / (included + missing)` for the active date range.

### Wealth (`src/pages/Wealth.tsx`)
- Add a `useQuery(['balance_snapshots', user.id])` that pulls all snapshots in one call.
- Per-account mini chart now consumes the snapshot series for that account (sorted by date, fallback to baseline + current if no snapshots exist).
- New `<CombinedWealthChart>` component above the summary cards:
  - Builds a `[{month, [accountId]: bal, ...}]` series merging all snapshots.
  - Recharts `LineChart` with one `<Line>` per scoped account + a derived `total` line.
  - Legend = chip row with `useState<Set<id>>` for visibility toggles.
- Inline editor (popover on each card): list of monthly snapshots editable in place, "Add month" button to insert a new YYYY-MM row.
- When a user updates `current_balance` in the existing edit dialog, also upsert today's snapshot row.

### Files touched
- `supabase/migrations/…_account_balance_snapshots.sql` (new table + RLS + seed)
- `src/pages/Wealth.tsx` (combined chart, snapshot-driven mini charts, inline editor)
- `src/components/CombinedWealthChart.tsx` (new)
- `src/pages/Insights.tsx` (review-state filter, coverage chip, math fixes across all cards)

### Out of scope (call out for next round)
- Auto-pulling balances from Plaid / brokerage APIs — for now we record snapshots manually + auto-snapshot when you edit `current_balance`.
- Reclassifying every `suggested` transaction to `approved` — that's the Allocations review queue; the Insights fix simply stops hiding them.
