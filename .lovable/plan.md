

## Phase 4 — Tax Reserve Dashboard

### What We're Building

The `/tax` page becomes a practical tax reserve planning dashboard for Federal, NYS, and NYC taxes. Not a tax filing engine — a reserve tracker that answers "how much should I be setting aside?"

### Database Changes

**New table: `tax_profiles`**

| Column | Type | Default |
|--------|------|---------|
| `id` | uuid | `gen_random_uuid()` |
| `owner_id` | uuid | required |
| `filing_status` | text | `'single'` |
| `state` | text | `'NY'` |
| `city` | text | `'NYC'` |
| `resident_city_tax_enabled` | boolean | `true` |
| `w2_income_enabled` | boolean | `true` |
| `self_employment_income_enabled` | boolean | `false` |
| `business_owner_income_enabled` | boolean | `false` |
| `default_federal_reserve_percent` | numeric | `25` |
| `default_nys_reserve_percent` | numeric | `7` |
| `default_nyc_reserve_percent` | numeric | `3.5` |
| `custom_effective_tax_rate_optional` | numeric | null |
| `estimated_w2_withholding_ytd` | numeric | `0` |
| `estimated_tax_payments_ytd` | numeric | `0` |
| `notes` | text | null |
| `created_at` | timestamptz | `now()` |
| `updated_at` | timestamptz | `now()` |

RLS: `auth.uid() = owner_id` for ALL.

### `/tax` Page Layout

**Setup section** (if no tax profile exists): Quick inline form to set filing status, residency, income types, and reserve percentages. Saves to `tax_profiles`.

**Top summary cards:**
- Estimated Federal Reserve Needed
- Estimated NYS Reserve Needed
- Estimated NYC Reserve Needed
- Total Tax Reserve Target
- Tax Paid / Withheld YTD
- Remaining Reserve Gap

**Calculation logic:**
- Query `income_transactions` for taxable inflows in current year
- Query `transactions_uploaded` where `treatment_type = 'tax_payment'` for payments made
- Apply reserve percentages from `tax_profiles` to taxable income
- Subtract withholding + estimated payments from reserve target = gap

**Supporting tables:**

1. **Taxable Income Breakdown** — aggregates from `income_transactions` grouped by `income_type`, showing taxable vs excluded
2. **Deduction Summary** — aggregates from `transactions_uploaded` where `counts_as_tax_deduction = true`, grouped by category
3. **Tax Payments Made** — list of `transactions_uploaded` where `treatment_type = 'tax_payment'` or `treatment_type = 'estimated_tax_payment'`

**Tax profile editor** — inline or dialog to edit filing status, reserve percentages, withholding estimates

### Files Changed

| File | Change |
|------|--------|
| DB migration | Create `tax_profiles` table with RLS |
| `src/pages/Tax.tsx` | Full page: setup flow, summary cards, income breakdown, deduction summary, tax payments, profile editor |

### Not in Scope
- Actual tax bracket calculations (uses simple reserve percentages)
- Tax filing or form generation
- Quarterly estimated payment scheduling

