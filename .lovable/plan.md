

## Plan: Multi-File Historical CSV Seed Import (Expenses + Income per Mode)

### Current State
The Settings page has 2 upload slots: one "Personal CSV" and one "Business CSV". Each accepts a single file. The `handleSeedImport` function processes one file, extracts categories and merchant memory from it.

### Change
Expand to 4 upload slots — for each mode (Personal, Business), allow separate Expenses and Income CSVs. Both files feed into the same mode's `category_options` and `merchant_memory`.

### Implementation

**Settings.tsx changes:**

1. Add two more state variables: `seedingPersonalIncome`, `seedingBusinessIncome`
2. Update the seed import UI grid from 2 columns to a 2×2 layout:
   - Personal Expenses CSV
   - Personal Income CSV
   - Business Expenses CSV
   - Business Income CSV
3. Each input calls the same `handleSeedImport(file, mode)` — the function already merges new categories into existing ones and upserts merchant memory, so uploading multiple files per mode works correctly without logic changes.
4. Add labels clarifying "Expenses" vs "Income" for each slot.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Settings.tsx` | Add 2 more upload inputs + loading states for income CSVs per mode |

