

## Plan: Make Category Optional for Income + Add Clear/Re-upload for Seeded Data

### Changes

**1. `src/components/SeedMappingDialog.tsx` — Make Category optional for income**
- Add `isIncome` prop (boolean)
- When `isIncome` is true, override the Category field's `required` to `false`
- Filter the FIELDS list dynamically based on `isIncome`

**2. `src/pages/Settings.tsx` — Three changes:**

a) **Pass `isIncome` to SeedMappingDialog** — derive from `seedLabel` (if it contains "Income")

b) **Fix loading state bug for income uploads** — `handleSeedConfirm` currently always uses `setSeedingPersonal`/`setSeedingBusiness`. Need to check the label and use `setSeedingPersonalIncome`/`setSeedingBusinessIncome` when appropriate.

c) **Add "Clear Seeded Data" buttons** — Add a button per mode (Personal / Business) that deletes all `merchant_memory` and `category_options` rows for that mode+owner. This lets you wipe and re-upload. Each button gets a confirmation dialog before deleting.

d) **Handle income CSVs without categories in `handleSeedConfirm`** — When category column is unmapped, still process merchants (for merchant memory) but skip category extraction/insertion.

### Files Changed

| File | Change |
|------|--------|
| `src/components/SeedMappingDialog.tsx` | Add `isIncome` prop; make Category optional when true |
| `src/pages/Settings.tsx` | Pass `isIncome`; fix income loading states; add clear buttons with confirmation; handle no-category processing |

