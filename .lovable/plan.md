

## Plan: Global Category Guardrail — Only Allow Airtable-Seeded Categories

### Problem
The categorization engine, rules engine, transfer detector, and CSV importer can all output arbitrary category strings (e.g., "Transfer", "chase_to_partner", parser-generated labels). These are not validated against the user's approved category list stored in `category_options`.

### Solution
Add a validation layer that ensures every `predicted_category` and `final_category` is either a valid category from `category_options` for that mode, or null (with `needs_review` status).

---

### 1. New Utility: `validateCategory` in `categorization-engine.ts`

Add a function that takes a category string and an allowed set, returns the category if valid or null if not:

```typescript
function validateCategory(
  category: string | null,
  allowedCategories: Set<string>
): { category: string | null; wasRejected: boolean }
```

Case-insensitive matching against the allowed set.

### 2. Modify `categorizeTransactions`

- Accept `allowedCategories: string[]` as a new parameter
- Build a `Set<string>` (case-insensitive) from it
- After each layer (memory, rules, CSV-provided), validate the predicted category against the set
- If rejected: set category to null, confidence to 0, review_status to `needs_review`
- The `remapCategory` output (e.g., "Substances", "Investment") must also be in the allowed list to pass

### 3. Modify `Expenses.tsx` — Pass Categories to Categorizer

In `processFile`, after loading categories, pass them to `categorizeTransactions`:

```typescript
const results = await categorizeTransactions(rowsToInsert, mode, user.id, thresholds, categories);
```

Load categories inside `processFile` (or pass from component state) so each file's categorization is validated.

### 4. Fix Transfer Handling

Currently `processFile` (line 426-429) hardcodes `'Transfer'` as `predicted_category` and `final_category` for transfers. This must also be validated:
- If `'Transfer'` is in the allowed category list, use it
- Otherwise, leave category null and mark `needs_review`, but still set `is_transfer: true` and `exclude_from_expense_totals: true`

The transfer detection fields (`is_transfer`, `transfer_type`, `exclude_from_expense_totals`) remain as internal logic fields — they are not categories.

### 5. Fix `bulkMarkTransfer` 

Line 249 hardcodes `predicted_category: 'Transfer', final_category: 'Transfer'`. Same fix: validate against allowed list first.

### 6. Inline Edit Validation

In `saveEdit` (line 198-216), validate that `editValues.category` is in the allowed list before saving. Show a toast error if not.

### 7. Add UI Badge for Category Validation

In the table row rendering, add a small indicator when a predicted category was rejected (category is null but match_source is not null — meaning the engine had a suggestion but it was rejected). Show a tooltip or badge like "Category suggestion rejected — not in approved list".

### 8. Rule Engine Guard

No change needed to `categorization_rules` table — rules can still store any `category_output`. The validation happens in `categorizeTransactions` after the rule fires. If a rule outputs an invalid category, it gets rejected and the row goes to `needs_review`.

---

### Files Changed

| File | Change |
|------|--------|
| `src/lib/categorization-engine.ts` | Add `allowedCategories` param, validate all category outputs |
| `src/pages/Expenses.tsx` | Pass categories to categorizer, validate transfers and edits |
| `src/lib/normalizer.ts` | No change (remapCategory stays, but its output gets validated downstream) |

### Implementation Order
1. Add validation logic to `categorization-engine.ts`
2. Update `processFile` in Expenses to pass allowed categories
3. Fix transfer category hardcoding
4. Fix bulk actions and inline edit validation
5. Add rejected-category UI indicator

