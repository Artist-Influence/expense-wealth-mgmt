

## QA Pass: Findings and Fix Plan

### Issues Found — Categorized by Severity

---

### Critical / Data Bugs

**1. Allocations page: `setState` called during render (infinite re-render risk)**
Lines 249-251 of `Allocations.tsx` call `setLocalAmounts(existingLoaded)` directly during render when `existingLoaded` is truthy. This is a React anti-pattern that causes re-render loops. Fix: move into a `useEffect`.

**2. Accountant exports: amounts not using `Math.abs` for expenses**
`Accountant.tsx` lines 200-203 — year-end summary uses raw `e.amount` for expenses. If amounts are stored as negatives, this produces wrong totals. Same issue on preview rows (line 176). Fix: wrap expense amounts in `Math.abs()`.

**3. Income CSV import uses naive comma-split parser**
`Income.tsx` lines 158-198 — splits on commas directly instead of using PapaParse. This will silently corrupt data on any CSV with quoted fields containing commas (extremely common in bank exports). Fix: refactor to use the existing `previewCsvFile`/`parseCsvFileWithMapping` pipeline from `csv-parser.ts`, or at minimum use PapaParse.

**4. Income page: no pagination — 1000 row hard limit**
`Income.tsx` line 88-95 — `fetchTransactions` does a single query with no pagination. Supabase caps at 1000 rows. Fix: add the same paginated while-loop pattern used in `Expenses.tsx`.

---

### Missing Safety Guardrails

**5. Settings: category delete has no confirmation**
`Settings.tsx` line 186-188 — `deleteCategory` fires immediately. A mis-click permanently removes a category. Fix: add an AlertDialog confirmation.

**6. Merchant Memory: delete has no confirmation**
`MerchantMemory.tsx` line 71-75 — `deleteMemory` deletes instantly. Fix: add `confirm()` prompt.

**7. Income: bulk delete has no confirmation**
`Income.tsx` line 249-258 — `bulkDelete` deletes without confirmation, unlike Expenses page which uses `confirm()`. Fix: add the same confirm dialog.

**8. Expenses: export gives no feedback on empty result**
`Expenses.tsx` lines 403-431 — `exportCsv` filters for approved/edited rows only. If none exist, it silently creates an empty CSV. Fix: add a toast warning if no exportable rows.

---

### UX / Polish Issues

**9. Nav overflow on mobile**
`AppNav.tsx` — 11 nav items in a horizontal flex container. On small screens, items overflow and clip. Fix: add `overflow-x-auto` with hidden scrollbar for horizontal scrolling.

**10. Merchant Memory: silently capped at 200 records**
`MerchantMemory.tsx` line 39 — `.limit(200)` with no indication to the user. Fix: show a note when the limit is reached.

**11. Insights: income data not filtered by mode**
`Insights.tsx` line 83-96 — Income is loaded without a mode filter, but expenses are filtered by personal/business mode. This means savings rate and income vs expenses charts mix all income sources with only one mode's expenses. The income side can't be easily filtered by mode since `income_transactions` doesn't have a `mode` column — this is by design (income isn't per-mode). Fix: add a note in the UI clarifying that income totals are across all sources. Not a code fix, just UI clarity.

---

### Consistency Issues

**12. Reimbursements page uses `(supabase as any)` casts**
`Reimbursements.tsx` lines 136, 216, 231, 245, 258 — uses `as any` casts for `reimbursement_groups` queries. This is because the auto-generated types may not include this table. Cosmetic/typing issue — functionally correct due to RLS.

**13. Tax page uses `as any` casts for tax_profiles**
Same pattern — `Tax.tsx` lines 94, 160, 162.

---

### What Looks Good (No Issues Found)

- Authentication flow and AuthGuard work correctly
- Login redirect logic is sound
- CSV upload with preview/mapping pipeline is robust
- Duplicate detection (exact + near) is well-implemented
- Statement artifact filtering works
- Category guardrail on save is correctly enforced
- Mode switching (personal/business/reimbursable) correctly updates all downstream fields
- Transaction drawer correctly initializes from current values and mode switch logic is complete
- Bulk actions (approve, transfer, mode-switch, delete) all correctly update state
- Transfer toggle correctly updates all related boolean fields
- Categorization engine 5-layer hierarchy is intact
- Merchant memory updates correctly on approve/save
- All RLS policies are consistent (owner_id-based for all tables)
- Empty/loading states exist on all pages
- Tax reserve calculations are mathematically correct

---

### Implementation Plan

| # | File | Fix |
|---|------|-----|
| 1 | `Allocations.tsx` | Move `setLocalAmounts` into `useEffect` keyed on `lineItems` |
| 2 | `Accountant.tsx` | Wrap expense amounts in `Math.abs()` in year-end summary + preview rows |
| 3 | `Income.tsx` | Replace naive CSV parser with PapaParse; add pagination to fetch |
| 4 | `Income.tsx` | Add `confirm()` to `bulkDelete` |
| 5 | `MerchantMemory.tsx` | Add `confirm()` to `deleteMemory` |
| 6 | `Settings.tsx` | Wrap `deleteCategory` button in AlertDialog |
| 7 | `Expenses.tsx` | Add empty-result toast to `exportCsv` |
| 8 | `AppNav.tsx` | Add `overflow-x-auto scrollbar-hide` to nav items container |
| 9 | `MerchantMemory.tsx` | Show count + limit note |

### Not Changing (Conservative Approach)

- Won't refactor `(supabase as any)` casts — functionally correct, types auto-update
- Won't change financial math unless proven wrong — all verified correct
- Won't redesign visual language — all pages consistent with glass/dark theme
- Won't change Income mode-less design — income is inherently cross-mode
- Won't touch categorization engine logic — all 5 layers verified intact

