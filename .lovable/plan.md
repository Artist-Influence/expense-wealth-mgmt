

## Phase 7 — Enhanced Insights Dashboard

### What We're Building

A major upgrade to `/insights` that adds income data, net savings analysis, year-over-year comparisons, and category trend lines. Currently the page only shows expense-side data. Phase 7 makes it a full financial health dashboard.

### No Database Changes

All data already exists in `transactions_uploaded` and `income_transactions`. This is purely a frontend enhancement.

### New Sections Added to `/insights`

**1. Income vs Expenses (Stacked/Grouped Bar Chart)**
- Monthly bars showing income (from `income_transactions`) and expenses side by side
- Net line overlay showing income minus expenses per month
- Last 12 months

**2. Net Savings Rate Card**
- Formula: `(Total Income - Total Expenses) / Total Income * 100`
- Show current month and trailing 3-month average
- Color-coded: green if positive, red if negative

**3. Year-over-Year Comparison**
- Compare current year totals vs prior year (expenses and income)
- Show YoY change percentages for total spend, total income, and savings rate
- Simple table or side-by-side cards

**4. Category Trend Lines (Small Multiples)**
- For top 5-6 categories, show a sparkline of monthly spend over time
- Helps spot categories trending up or down
- Uses Recharts `LineChart` in compact form

**5. Payment Method Breakdown (Pie/Donut or horizontal bar)**
- Aggregate expenses by `final_method` or `predicted_method`
- Shows which payment methods are used most

**6. Data Quality Summary Card**
- Count of `needs_review` transactions
- Count of `Uncategorized` transactions
- Approval rate: `approved / total * 100`

### Data Loading Changes

- Add a parallel fetch for `income_transactions` (same paginated pattern as expenses)
- All new computations are `useMemo` derived from existing + new income data

### UI Organization

- Add a tabbed or sectioned layout: **Spending** | **Income & Savings** | **Trends**
- Spending tab: existing cards + category bar chart + top merchants + recurring (what's there now)
- Income & Savings tab: income vs expenses chart, net savings rate, YoY comparison
- Trends tab: category sparklines, payment method breakdown, data quality

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Insights.tsx` | Full overhaul: add income data fetch, tabbed layout, 6 new visualization sections |

