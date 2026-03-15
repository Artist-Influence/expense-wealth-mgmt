

## Phase 3 — Income Module

### What We're Building

The `/income` page for tracking inflows: payroll, business revenue, reimbursement receipts, refunds, transfers in, and other income. This gives the data needed for tax reserves, allocation decisions, and cash flow visibility.

### Database Changes

**New table: `income_transactions`**

| Column | Type | Default |
|--------|------|---------|
| `id` | uuid | `gen_random_uuid()` |
| `owner_id` | uuid | required |
| `date` | date | null |
| `description_raw` | text | null |
| `description_normalized` | text | null |
| `amount` | numeric | null |
| `income_type` | text | `'other'` |
| `taxable_status` | text | `'unknown'` |
| `source_account_name` | text | null |
| `linked_expense_id` | uuid | null (FK → `transactions_uploaded.id`) |
| `linked_reimbursement_group_id` | uuid | null (FK → `reimbursement_groups.id`) |
| `allocation_month` | text | null |
| `status` | text | `'needs_review'` |
| `notes` | text | null |
| `source_file_name` | text | null |
| `upload_batch_id` | text | null |
| `created_at` | timestamptz | `now()` |

RLS: `auth.uid() = owner_id` for ALL.

Allowed `income_type` values: `payroll`, `business_revenue`, `reimbursement`, `refund`, `interest`, `tax_refund`, `transfer`, `owner_contribution`, `loan_proceeds`, `other`.

Allowed `taxable_status` values: `taxable`, `non_taxable`, `partially_taxable`, `unknown`.

### `/income` Page

**Top summary cards:**
- Total Inflows This Month
- Taxable Inflows
- Non-Taxable Inflows
- Reimbursements Received
- Business Revenue
- Payroll

**Table columns:** Date, Description, Amount, Income Type, Taxable Status, Source Account, Linked Expense/Group, Status, Actions

**Features:**
- CSV upload for income (reuse CsvUploader pattern from Expenses)
- Manual entry form (dialog) for single inflows
- Income type dropdown per row
- Taxable status toggle
- Link to existing reimbursement group or expense (search/select)
- Bulk actions: Set Income Type, Set Taxable Status, Approve, Delete

**Auto-suggestion logic on import:**
- Keywords like "payroll", "salary", "direct deposit" → suggest `payroll`, `taxable`
- Keywords like "reimbursement", "expense repay" → suggest `reimbursement`, `non_taxable`, attempt match against pending reimbursement groups by amount
- Keywords like "refund", "return" → suggest `refund`, `non_taxable`
- Keywords like "transfer", "zelle", "venmo" → suggest `transfer`, `non_taxable`
- Keywords like "interest", "dividend" → suggest `interest`, `taxable`
- Revenue-like patterns → suggest `business_revenue`, `taxable`

**Reimbursement matching:**
- When an inflow is tagged as `reimbursement`, show a "Match to Reimbursement" button
- Opens a picker showing pending reimbursement groups with similar amounts
- On match: link the income row, update the reimbursement group's `total_received` and `status`

### Files Changed

| File | Change |
|------|--------|
| DB migration | Create `income_transactions` table with RLS |
| `src/pages/Income.tsx` | Full page: cards, table, CSV upload, manual entry, auto-suggestions, reimbursement matching |
| `src/lib/income-classifier.ts` | New — keyword-based income type and taxable status suggestion logic |

### Not in Scope (deferred)
- Automatic matching of income to expenses beyond reimbursements (Phase 5/6 territory)
- Tax calculations from income data (Phase 4)

