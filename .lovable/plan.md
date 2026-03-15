

## Expense Memory V2 — Implementation Plan

### Scope Assessment

This is a massive product evolution spanning 7 new pages, 10+ new tables, and fundamental changes to the transaction data model. The spec itself recommends a 6-phase build. I agree with that phasing and will detail **Phase 1** for immediate implementation, with a summary of subsequent phases.

---

### Phase 1 — Schema + Core Mode Switching (First Build Pass)

This phase introduces the new transaction architecture without breaking V1 behavior.

#### 1. Database Migration — Extend `transactions_uploaded`

Add these columns to the existing table:

| Column | Type | Default |
|--------|------|---------|
| `transaction_mode` | text | `'personal'` |
| `economic_owner` | text | `'personal'` |
| `treatment_type` | text | `'expense'` |
| `counts_toward_true_personal_spend` | boolean | `true` |
| `counts_toward_true_business_spend` | boolean | `false` |
| `exclude_from_cash_spend_reporting` | boolean | `false` |
| `is_reimbursable` | boolean | `false` |
| `reimbursable_to` | text | `null` |
| `reimbursement_status` | text | `'none'` |
| `tax_treatment` | text | `'unknown'` |
| `tax_entity` | text | `null` |
| `counts_as_tax_deduction` | boolean | `false` |
| `is_non_expense_cash_movement` | boolean | `false` |
| `client_or_project_tag` | text | `null` |
| `business_purpose` | text | `null` |
| `receipt_required` | boolean | `false` |
| `receipt_attached` | boolean | `false` |

**Data migration**: Backfill existing rows:
- `transaction_mode` = existing `mode` column value
- If `mode = 'personal'`: `economic_owner = 'personal'`, `counts_toward_true_personal_spend = true`, `counts_toward_true_business_spend = false`
- If `mode = 'business'`: `economic_owner = 'artist_influence'`, `counts_toward_true_personal_spend = false`, `counts_toward_true_business_spend = true`
- Transfers get `is_non_expense_cash_movement = true`, `counts_toward_true_personal_spend = false`, `counts_toward_true_business_spend = false`
- `treatment_type = 'transfer'` where `is_transfer = true`, else `'expense'`
- `tax_treatment = 'unknown'` for all

#### 2. Navigation Update — `src/components/AppNav.tsx`

Expand nav items to include future pages (disabled/placeholder for now):
- Expenses, Income (placeholder), Insights, Reimbursements (placeholder), Wealth (placeholder), Tax (placeholder), Memory, Accountant (placeholder), Settings

Only Expenses, Insights, Memory, Settings are active for Phase 1. Others show as disabled nav items so the structure is in place.

#### 3. Expenses Page Updates — `src/pages/Expenses.tsx`

**Mode toggle**: Replace the 2-button Personal/Business toggle with a 3-way segmented control:
- Personal (slate)
- Business (blue)  
- Reimbursable/Work (amber)

**Stats row**: Replace current chips with:
- Total Cash Out
- True Personal Spend
- True Business Spend
- Pending Reimbursable Fronted
- Needs Review
- Transfers Excluded

**Table columns**: Add `Mode` and `Economic Owner` columns. Keep existing columns.

**New bulk actions** (when rows selected):
- Switch to Personal
- Switch to Business
- Switch to Reimbursable/Work
- Mark Reimbursable

**Mode switching behavior**:
- Personal → set `transaction_mode`, `economic_owner = 'personal'`, `counts_toward_true_personal_spend = true`, `counts_toward_true_business_spend = false`, hide reimbursement fields
- Business → set `transaction_mode`, `economic_owner = 'artist_influence'`, `counts_toward_true_personal_spend = false`, `counts_toward_true_business_spend = true`
- Reimbursable/Work → set `is_reimbursable = true`, `counts_toward_true_personal_spend = false`, `counts_toward_true_business_spend = false`

#### 4. Transaction Detail Drawer V2 — `src/components/TransactionDetailDrawer.tsx`

Add new sections to existing drawer:

**Section A — Summary**: Add mode segmented control pill (Personal / Business / Reimbursable/Work)

**Section D — Financial Treatment** (new):
- Economic owner dropdown
- Treatment type dropdown
- Tax treatment dropdown
- "Counts toward true spend?" toggle
- "Exclude from totals?" toggle
- Client/project tag input

**Section E — Reimbursement** (conditional, shown when reimbursable):
- Reimbursable to dropdown
- Reimbursement status
- Business purpose textarea
- Receipt attached indicator

Keep all existing sections (identity, match reasoning, flags, actions).

#### 5. Categorization Engine Update — `src/lib/categorization-engine.ts`

Update `categorizeTransactions` to also suggest:
- `suggested_mode` (based on merchant memory defaults)
- `suggested_tax_treatment`

This requires extending `merchant_memory` table with:
- `default_transaction_mode` text
- `default_tax_treatment` text
- `default_reimbursable` boolean default false

And extending `CategorizationResult` interface to include these new suggestion fields.

#### 6. AI Edge Function Update — `supabase/functions/categorize-ai/index.ts`

Extend the AI prompt to also return:
- `suggested_mode`
- `suggested_tax_treatment`
- `likely_reimbursable` boolean

Extend the tool calling schema accordingly.

---

### Files Changed (Phase 1)

| File | Change |
|------|--------|
| DB migration | Add ~16 columns to `transactions_uploaded`, 3 to `merchant_memory`, backfill existing data |
| `src/components/AppNav.tsx` | Expand nav with placeholder items for future pages |
| `src/pages/Expenses.tsx` | 3-way mode toggle, new stats cards, mode column, bulk switch actions, mode-switching logic |
| `src/components/TransactionDetailDrawer.tsx` | Mode segmented control, financial treatment section, reimbursement section |
| `src/lib/categorization-engine.ts` | Extended result interface with mode/tax suggestions |
| `supabase/functions/categorize-ai/index.ts` | Extended AI output schema |
| Placeholder page stubs | `/income`, `/reimbursements`, `/allocations`, `/wealth`, `/tax`, `/accountant`, `/close-month` — minimal "Coming Soon" pages with nav working |

---

### Subsequent Phases (Summary)

| Phase | Scope | Key Deliverables |
|-------|-------|-----------------|
| 2 | Reimbursements | `/reimbursements` page, reimbursement fields, matching logic, bulk actions, export |
| 3 | Income | `/income` page, inflow import/classification, reimbursement/refund matching |
| 4 | Tax Dashboard | `tax_profiles` table, `/tax` page, federal + NYS + NYC reserve estimates |
| 5 | Wealth + Allocations | `investment_accounts`, `investment_snapshots`, `/wealth`, `/allocations`, screenshot OCR, contribution suggestions |
| 6 | Accountant + Month Close | `/accountant`, `/close-month`, export presets, guided close flow |

Each phase builds on the previous and will be planned in detail when reached.

---

### Risk Notes

- The `transactions_uploaded` table will grow significantly in column count. This is acceptable for a single-user app.
- The existing `mode` column (personal/business) stays as-is for backward compatibility. The new `transaction_mode` field adds the third option. Over time, `transaction_mode` becomes the source of truth.
- No existing CSV import flow breaks — new fields get conservative defaults on insert.

