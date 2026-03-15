

## Phase 2 — Reimbursements Module

Yes, Phase 2 is Reimbursements. Here's the plan.

### What We're Building

A full `/reimbursements` page that lets you track expenses you fronted for work, group them into reports, match incoming reimbursement payments, and export expense reports.

### Database Changes

**New table: `reimbursement_groups`**

| Column | Type | Default |
|--------|------|---------|
| `id` | uuid | `gen_random_uuid()` |
| `owner_id` | uuid | required |
| `title` | text | required |
| `reimbursable_to` | text | `'employer'` |
| `report_id` | text | null |
| `status` | text | `'pending'` |
| `total_expected` | numeric | `0` |
| `total_received` | numeric | `0` |
| `submitted_date` | date | null |
| `received_date` | date | null |
| `notes` | text | null |
| `created_at` | timestamptz | `now()` |

RLS: `auth.uid() = owner_id` for ALL.

**Extend `transactions_uploaded`**:
- Add `linked_reimbursement_group_id` (uuid, nullable, FK to `reimbursement_groups.id`)

### `/reimbursements` Page

**Summary cards** (top):
- Pending Reimbursement Total
- Submitted Awaiting Repayment
- Reimbursed This Month
- Overdue (submitted > 30 days ago, not reimbursed)

**Tabs**: Pending | Submitted | Reimbursed | All

**Table columns**: Date, Merchant, Amount, Reimbursable To, Business Purpose, Receipt, Report ID, Status, Aging (days since date), Actions

**Row source**: Queries `transactions_uploaded` where `is_reimbursable = true`, joined with `reimbursement_groups` when linked.

**Bulk actions** (when rows selected):
- Mark as Submitted
- Mark as Reimbursed
- Create Report Group (groups selected into a new `reimbursement_groups` row)
- Export Expense Report (CSV)

**Single-row actions**:
- Edit reimbursement status
- Set business purpose
- Link to / create report group
- Open transaction detail drawer

### Reimbursement Group Detail

Clicking a report group shows:
- Group title, status, reimbursable_to
- List of linked transactions
- Total expected vs received
- Mark group as submitted/reimbursed
- Add report ID

### Expense Report Export

CSV export with columns: Date, Merchant, Amount, Business Purpose, Category, Receipt Attached, Report ID, Status.

### Files Changed

| File | Change |
|------|--------|
| DB migration | Create `reimbursement_groups`, add `linked_reimbursement_group_id` to `transactions_uploaded` |
| `src/pages/Reimbursements.tsx` | Full page: summary cards, tabs, table, bulk actions, group management |
| `src/components/TransactionDetailDrawer.tsx` | Wire up "Save + Add to Reimbursements" to set `is_reimbursable` and link group |
| `src/pages/Expenses.tsx` | Minor: "Mark Reimbursable" bulk action should also set `reimbursement_status = 'pending'` if not already set |

