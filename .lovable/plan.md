

## Problem

The "Seeded 0 merchants and 0 categories" result for the Personal Expenses CSV means the column auto-detection failed -- the Airtable export likely has column names that don't match the hardcoded candidates (e.g., `CATEGORY_CANDIDATES` only checks `['category', 'type', 'expense type', 'expense category']`). The seed import uses `parseCsvFile` which silently returns empty results when columns aren't found, giving no feedback about what went wrong.

The Income CSV worked (441 merchants, 15 categories) because its column names happened to match. The Expenses CSV's column names didn't match, so nothing was extracted.

## Fix: Add Column Mapping Preview to Seed Import

Instead of silently auto-detecting and failing, the seed import should use the same preview+mapping approach as the main CSV import flow -- show detected columns, let you confirm or correct mappings before processing.

### Changes

**1. `src/pages/Settings.tsx` -- Add seed preview/mapping dialog**

- Replace the direct `parseCsvFile` call with `previewCsvFile` first
- Show a small dialog/inline preview displaying: detected headers, auto-mapped columns, and any unmapped required fields (Description, Amount, Category)
- Let the user correct mappings via dropdowns (select which CSV column maps to Description, Category, etc.)
- Only after confirmation, run `parseCsvFileWithMapping` with the corrected mapping
- Show the actual detected column names in error/success toasts so it's clear what happened

**2. `src/lib/csv-parser.ts` -- Expand column candidates**

- Remove `'type'` from `CATEGORY_CANDIDATES` (Chase "Type" column contains bank codes like ACH_DEBIT, not expense categories)
- Add common Airtable field names: `'expense category'`, `'sub-category'`, `'tags'`
- Add `'merchant'`, `'vendor'`, `'store'` to description candidates
- Add `'card used'`, `'paid with'` to method candidates

**3. New component: `src/components/SeedMappingDialog.tsx`**

A lightweight dialog that shows:
- The CSV headers that were found
- Which columns were auto-mapped (Description → ?, Category → ?, Amount → ?)
- Dropdowns to override each mapping
- "Confirm & Seed" button
- Clear error state if required columns (Description + Category) aren't mapped

### Files Changed

| File | Change |
|------|--------|
| `src/components/SeedMappingDialog.tsx` | New dialog for confirming/correcting column mappings before seeding |
| `src/pages/Settings.tsx` | Use preview flow instead of direct parse; show mapping dialog before processing |
| `src/lib/csv-parser.ts` | Remove `'type'` from category candidates; add more Airtable-friendly column names |

### Result

When you upload an Airtable CSV, you'll see exactly which columns were detected and can fix any mismatches before processing. No more silent "0 merchants" failures.

