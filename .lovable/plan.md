## Insights — Money In vs Out + Savings Suggestions

Add a clear cash-flow view (money in vs money out, with net) plus a smart "Where to save" panel that gives actionable suggestions based on actual spending patterns. Both will respect the existing date filter, mode toggle, and approved-transaction rules.

### 1. New "Cash Flow" section (top of Spending tab)

A 4-card strip + a stacked chart, scoped to the active date filter:

```text
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Money In    │ Money Out   │ Net         │ Savings %   │
│ $24,310.00  │ $18,772.41  │ +$5,537.59  │ 22.8%       │
│ ↑ vs prior  │ ↓ vs prior  │  green/red  │  vs target  │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

- **Money In**: sum of `earned income` in the selected window (excludes reimbursements, transfers, refunds, loan proceeds, owner contributions — same rule already used for `earnedIncome`).
- **Money Out**: sum of approved expenses in the selected window (already computed as `expenses`).
- **Net**: In − Out, color-coded green/red.
- **Savings %**: Net / In, with comparison vs prior equal-length window.

Below the cards: a **monthly Income vs Expenses bar+line chart** scoped to the active filter (currently this chart lives in the Income tab and is hard-coded to last 12 months — we'll add a filter-aware version here, keep the 12-month one in place on the Income tab as the long-term reference).

### 2. New "Where to Save" suggestions panel (Spending tab, below Recurring Charges)

A ranked list of concrete, data-driven suggestions. Each row shows the suggestion, the estimated monthly savings, and a one-line "why."

Suggestion engine rules (all derived client-side from already-loaded data):

1. **Subscription audit** — list every charge categorized as `Subscriptions` from the Recurring Charges detector. Flag any that haven't been charged in 60+ days as "possibly unused — cancel?"; sum the rest as "your monthly subscription load."
2. **Top-3 discretionary categories** — for categories like Dining, Entertainment, Shopping, Substances, Coffee, Rideshare, etc., compare the period's monthly average to the trailing 6-month average. If current is 20%+ above baseline, suggest "trim back to baseline → save ~$X/mo."
3. **Duplicate-service detection** — if 2+ recurring charges share a category (e.g. two streaming services, two gym memberships), flag the cheaper one as a "consider consolidating."
4. **High-frequency small charges** — merchants with 8+ transactions in the period and avg transaction < $15 (typical coffee/snack pattern). Show total monthly spend and frame as "small charges add up to $X/mo."
5. **Savings headroom** — if Net is positive and Savings % is below 20%, suggest "you have $X/mo of unused headroom — route to investments." Link to the Allocations page.
6. **Tax reserve gap** *(business mode only)* — pull from `tax_profiles` reserve %; if business net income × reserve % is greater than what's been allocated YTD, surface "You're under-reserved by ~$X for taxes."

Each suggestion shows:
- Title (one line)
- Estimated impact ($/mo or one-time)
- Why (one sentence with the underlying numbers)
- Optional CTA link (e.g., "Open Allocations", "Open Recurring")

### 3. Hide-or-defer behavior

- All suggestions cap at top 6, sorted by estimated monthly impact descending.
- Empty state: "Looks tight — no obvious cuts. Focus on growing income or routing surplus to Allocations."
- Suggestions are read-only for now (no dismiss/snooze persistence) — keeps scope contained. Can add a `suggestion_dismissals` table later if useful.

### Files

- `src/pages/Insights.tsx` — add Cash Flow card strip + filter-aware Income vs Expenses chart at top of Spending tab; add "Where to Save" panel below Recurring Charges; add a `suggestions` `useMemo` + a `cashFlow` `useMemo`.

No database changes. No new dependencies. Pure client-side computation off existing fetched data.

### Technical notes

- `cashFlow` memo: `{ moneyIn, moneyOut, net, savingsPct, priorMoneyIn, priorMoneyOut, priorNet }` — prior window = same length immediately before active window (e.g. if active = Jan-Mar, prior = Oct-Dec).
- `suggestions` memo: returns `{ id, title, impactMonthly, why, cta?: { label, href } }[]`. Each rule is a small pure function over `expenses`, `earnedIncome`, `recurringCharges`, and (optionally) `taxProfile`.
- Reuse existing `inDateRange`, `expenses`, `earnedIncome`, `recurringCharges`, and `monthlyTrend` so totals stay consistent with the rest of the page.
- Tax-reserve rule fetches `tax_profiles` once on mount (cached in state), only used when `mode === 'business'`.
