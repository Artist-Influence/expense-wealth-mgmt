## Income — split Personal vs Business

### Problem

The Income page treats everything as one undifferentiated stream. There's no `mode` (Personal/Business) column on `income_transactions`, no toggle on the page, and the existing Personal/Business switch on Insights doesn't filter income at all — so business revenue and personal payroll are mixed together everywhere.

Current data: 128 income rows, 79 of them tagged `income_type = business_revenue` ($225K), the rest are mixed personal payroll/refunds/transfers ($73K).

### Fix overview

1. **DB**: add a `mode` column to `income_transactions` and backfill existing rows from `income_type`.
2. **Income page**: add mode toggle (All / Personal / Business), capture mode on CSV import + manual entry, and split summary cards.
3. **Insights**: wire the existing Personal/Business toggle to also filter income.

### 1. Database migration

```sql
-- Add mode column
ALTER TABLE income_transactions
  ADD COLUMN mode text NOT NULL DEFAULT 'personal';

-- Backfill: business_revenue → business; everything else stays personal
UPDATE income_transactions
  SET mode = 'business'
  WHERE income_type = 'business_revenue';

-- Index for fast filtering
CREATE INDEX idx_income_transactions_owner_mode
  ON income_transactions(owner_id, mode);
```

This gives a sensible starting state. The user can re-classify any row that was guessed wrong via the new dropdown.

### 2. Income page (`src/pages/Income.tsx`)

**Mode toggle in header** (next to the existing date filter):
```
[ All ] [ Personal ] [ Business ]
```
- Default: All
- Persists in component state (no URL persistence needed for now)

**Mode column on the table** between Income Type and Taxable, editable via a small badge dropdown — same pattern as the existing Income Type cell. Personal renders muted, Business renders primary-tinted so it's instantly scannable.

**Summary cards**: when filtered to "All", split the existing "Total Inflows" card into two: **Personal Income** + **Business Income**. When filtered to Personal or Business, keep the current 6 cards (Total / Taxable / Non-Taxable / Revenue / Payroll / Other) but scoped to the active mode.

**CSV import**: add a small Mode selector inline in the CSV uploader area (Personal / Business). Whatever's selected gets stamped on every row in the import. Default = whatever the page filter is currently set to (or Personal if "All"). The classifier already detects `business_revenue` from descriptions like "stripe", "invoice", etc., so even Personal-mode imports will still surface a "this looks like business revenue — re-tag?" review state.

**Manual entry dialog**: add a Mode select alongside Income Type. Default = current page filter (or Personal).

**Bulk actions**: add "Set Mode → Personal/Business" to the existing bulk action bar (right next to "Set Type"), so the user can re-classify in batch after the backfill.

**Filter logic**: extend the existing `summaryCards` and `filtered` useMemo to apply the mode filter alongside date/type/status/search.

### 3. Insights page (`src/pages/Insights.tsx`)

The page already has a Personal/Business mode toggle that scopes expenses correctly. Update `loadIncome()` to also filter by `mode`:

```ts
.from('income_transactions')
.select('date, amount, income_type, taxable_status, status, mode')
.eq('owner_id', user!.id)
.eq('mode', mode)   // NEW — tie to the page's existing mode state
```

This single line fixes the mismatch in:
- Cash Flow Money In card
- Savings Rate calculation
- Income vs Expenses chart
- YoY Income comparison
- "Where to Save" tax reserve gap suggestion (which is already business-only)

### 4. Income classifier nudge (`src/lib/income-classifier.ts`)

Extend the return type to also suggest a default mode based on the matched rule:
- `business_revenue`, `owner_contribution`, `loan_proceeds` → suggest `'business'`
- `payroll`, `refund`, `interest`, `tax_refund`, `transfer`, `reimbursement`, `other` → suggest `'personal'`

This way CSV imports auto-tag mode intelligently when the user picks "All" mode at upload time, and the user only has to fix outliers.

### Files

- **DB migration** (new) — add `mode` column + backfill + index
- `src/pages/Income.tsx` — mode toggle, mode column, mode-aware summary cards, CSV/manual mode capture, bulk mode action
- `src/pages/Insights.tsx` — `.eq('mode', mode)` in `loadIncome()`
- `src/lib/income-classifier.ts` — return suggested mode alongside type

### Out of scope (for later)

- The Settings → Historical Income Seed flow already passes mode to merchant_memory; we won't touch that path. (It doesn't write to `income_transactions` anyway.)
- Tax page reads income aggregately for reserve math — leave as-is for now since it only cares about taxable totals; can revisit if user wants strict separation there too.
