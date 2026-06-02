# Add Managed Payment Methods

Today every payment method ("Chase 8886", "BoA 5563", etc.) is hardcoded as a regex in `src/lib/method-detector.ts`, and everywhere else method is just a free-text field. There's no way to register a new credit card or bank account without a code change. This adds a user-managed list of payment methods you control from Settings.

## What you'll be able to do
- Add a new credit card or bank account (personal or business) from Settings, with a name, account type, and an optional filename keyword for auto-detection.
- Have new uploads auto-tag the right method from the CSV filename using your saved keywords.
- Pick methods from a dropdown (instead of typing free text) when editing transactions and when importing.
- Edit or deactivate methods you no longer use.

## 1. Database — new `payment_methods` table
Create `public.payment_methods`:
- `name` (text, e.g. "Chase Sapphire", "BoA Checking 5563")
- `mode` (text: `personal` | `business`)
- `account_type` (text: `credit_card` | `bank_account`)
- `match_pattern` (text, nullable — filename keyword/regex used for auto-detection, e.g. `5563`)
- `is_active` (boolean, default true)
- `sort_order` (int, default 0)
- standard `owner_id`, `id`, `created_at`, `updated_at`

RLS + grants mirror the other tables: owner full access (`auth.uid() = owner_id`), accountant read-only, `service_role` all. Seed it with the existing hardcoded methods so nothing is lost.

## 2. Settings — "Payment Methods" panel
New section in `src/pages/Settings.tsx` (same glass-panel style as Categories):
- Lists current methods grouped/labeled by mode + account type.
- Inline add row: name, mode toggle (personal/business), account type, optional filename keyword.
- Edit and deactivate/delete actions per row.

## 3. Auto-detection becomes data-driven
- Convert `src/lib/method-detector.ts` to accept a list of methods (`{name, match_pattern}`) and match a filename against their patterns, instead of the hardcoded array.
- In `src/pages/Expenses.tsx`, load active payment methods once (alongside categories), and pass them into the detection call used in `previewCsvFile`/preview building so uploads auto-tag using your saved keywords. Keep the old hardcoded list only as an internal fallback for the seed.

## 4. Method selection becomes a dropdown
- `src/components/TransactionDetailDrawer.tsx`: replace the free-text Method `Input` with a `Select` populated from saved methods (filtered by the transaction's mode), with an "Other / custom" escape hatch that still allows typing.
- `src/pages/Expenses.tsx` inline `final_method` edit: same dropdown.
- `src/components/ImportPreviewDialog.tsx`: let you override the auto-detected method per file via a dropdown of saved methods.

## 5. Validation
- Add a method in Settings with a filename keyword → upload a CSV whose name contains that keyword → it auto-tags the new method in the import preview.
- Edit a transaction → Method field shows your saved methods in a dropdown; selecting one saves correctly.
- Existing transactions and previously hardcoded methods still display and filter normally.

## Technical notes
- Detection runs synchronously during file preview, so methods must be loaded into state before the import dialog opens; gate detection on `user && ownerId` (consistent with the recent owner-id fetch fixes).
- `mode` on a transaction (personal/business) is used to filter which methods appear in the dropdown, but custom typing remains allowed for edge cases.
- No changes to financial-integrity logic; method is metadata only.
