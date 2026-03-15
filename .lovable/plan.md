

## Phase 5 — Wealth & Allocations

Phase 5 covers two pages: **Wealth** (investment account tracking) and **Allocations** (month-end cash distribution planning).

### Database Changes

**New table: `investment_accounts`**

| Column | Type | Default |
|--------|------|---------|
| `id` | uuid | `gen_random_uuid()` |
| `owner_id` | uuid | required |
| `account_name` | text | required |
| `account_type` | text | `'brokerage'` |
| `platform` | text | null |
| `current_balance` | numeric | `0` |
| `contribution_target_monthly` | numeric | `0` |
| `contribution_target_yearly` | numeric | `0` |
| `contributions_ytd` | numeric | `0` |
| `priority` | integer | `0` |
| `is_active` | boolean | `true` |
| `notes` | text | null |
| `created_at` | timestamptz | `now()` |
| `updated_at` | timestamptz | `now()` |

`account_type` values: `roth_ira`, `traditional_ira`, `brokerage`, `crypto`, `collectibles`, `savings`, `other`.

RLS: `auth.uid() = owner_id` for ALL.

**New table: `allocation_plans`**

| Column | Type | Default |
|--------|------|---------|
| `id` | uuid | `gen_random_uuid()` |
| `owner_id` | uuid | required |
| `month` | text | required (e.g. `'2026-03'`) |
| `total_income` | numeric | `0` |
| `total_expenses` | numeric | `0` |
| `tax_reserve_amount` | numeric | `0` |
| `emergency_fund_amount` | numeric | `0` |
| `free_cash` | numeric | `0` |
| `status` | text | `'draft'` |
| `notes` | text | null |
| `created_at` | timestamptz | `now()` |
| `updated_at` | timestamptz | `now()` |

**New table: `allocation_line_items`**

| Column | Type | Default |
|--------|------|---------|
| `id` | uuid | `gen_random_uuid()` |
| `allocation_plan_id` | uuid | FK → `allocation_plans.id` ON DELETE CASCADE |
| `owner_id` | uuid | required |
| `target_account_id` | uuid | FK → `investment_accounts.id` |
| `amount` | numeric | `0` |
| `executed` | boolean | `false` |
| `notes` | text | null |

RLS: `auth.uid() = owner_id` for ALL on both tables.

### `/wealth` Page

- **Account cards**: Each investment account as a card showing name, platform, balance, YTD contributions vs target, progress bar
- **Add/Edit account**: Dialog to create or edit investment accounts
- **Totals row**: Total portfolio balance, total YTD contributions, total monthly/yearly targets
- **Account type grouping**: Group cards by type (Retirement, Brokerage, Crypto, etc.)

### `/allocations` Page

- **Month selector** at top
- **Auto-computed summary**: Pulls total income and expenses for the selected month from `income_transactions` and `transactions_uploaded`, tax reserve from `tax_profiles`
- **Waterfall view**:
  1. Total Income
  2. − Total Expenses
  3. − Tax Reserve
  4. − Emergency Fund contribution
  5. = Free Cash (safe to invest)
- **Distribution table**: Allocate free cash across active investment accounts based on priority/targets
- **Quick-fill**: Button to auto-distribute proportionally based on each account's remaining yearly gap
- **Mark as executed**: Check off individual allocations; lock plan when all done
- **Status**: Draft → Finalized → Executed

### Nav Updates

Set `active: true` for Wealth and Allocations in `AppNav.tsx`. Also activate Income, Reimbursements, and Tax since those are now built.

### Files Changed

| File | Change |
|------|--------|
| DB migration | Create `investment_accounts`, `allocation_plans`, `allocation_line_items` |
| `src/pages/Wealth.tsx` | Full page: account cards, add/edit dialog, grouping, totals |
| `src/pages/Allocations.tsx` | Full page: month selector, waterfall, distribution table, auto-fill, execution tracking |
| `src/components/AppNav.tsx` | Activate Wealth, Allocations, Income, Reimbursements, Tax nav items |

### Not in Scope
- Real-time portfolio value fetching (manual balance entry only)
- Historical allocation trend charts (Phase 6/7 territory)

