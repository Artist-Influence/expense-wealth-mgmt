

## Plan: CSV Parsing Fix + Duplicates + Transfers + Settings

This is a large, multi-phase implementation. I'll break it into ordered steps, with the CSV parsing bug fix first as requested.

---

### Phase 1: Fix CSV Parsing Bug (Priority)

**Root cause analysis:** The `findColumn` function does exact case-insensitive matching, but may fail on CSVs with BOM characters, extra whitespace, or slight header variations. Additionally, the parser silently returns empty values instead of erroring.

**Changes to `src/lib/csv-parser.ts`:**
- Improve `findColumn` to use 3-tier matching: exact → starts-with → contains (after trimming and lowercasing)
- Strip BOM from file content before parsing
- Add `source_row_json`, `source_file_name`, `parse_status`, `parse_error` to `ParsedTransaction` interface
- Store original raw row JSON on each parsed transaction
- Validate each row: if date, description, or amount is missing/unparseable, mark as `parse_error`
- Block `parse_error` rows from entering categorization

**New: Pre-import validation step in `Workspace.tsx`:**
- After parsing headers but before processing, show a mapping preview dialog:
  - Detected column mappings (e.g., "Short Description → description_raw")
  - Row count
  - Any unmapped required fields (date, description, amount)
  - Block import if required fields missing
- User confirms before proceeding

### Phase 2: Schema Migration — New Fields

Add columns to `transactions_uploaded`:
- `source_row_json` (jsonb, nullable)
- `source_file_name` (text, nullable)
- `parse_status` (text, default 'ok')
- `parse_error` (text, nullable)
- `duplicate_fingerprint` (text, nullable)
- `duplicate_status` (text, default 'unique')
- `duplicate_of_transaction_id` (uuid, nullable, FK to self)
- `is_transfer` (boolean, default false)
- `exclude_from_expense_totals` (boolean, default false)
- `transfer_type` (text, nullable)

Add columns to `app_settings`:
- `prevent_exact_duplicates` (boolean, default true)
- `flag_possible_duplicates` (boolean, default true)
- `exclude_transfers_from_totals` (boolean, default true)

Add columns to `upload_batches`:
- `exact_duplicates_skipped` (integer, default 0)
- `possible_duplicates_flagged` (integer, default 0)
- `transfers_detected` (integer, default 0)
- `parse_errors` (integer, default 0)

### Phase 3: Enhanced Duplicate Detection

**Changes to `Workspace.tsx` processing logic:**
- Generate `duplicate_fingerprint` = hash of `mode|date|amount|normalized_description`
- **Exact duplicate:** same fingerprint in existing rows → auto-skip, increment counter
- **Near duplicate:** same mode + amount + similar normalized description + date within 3 days → insert but mark `duplicate_status = 'possible_duplicate'`, link `duplicate_of_transaction_id`
- Respect `app_settings.prevent_exact_duplicates` and `flag_possible_duplicates` toggles

**Upload summary update:** Show total scanned, imported, exact skipped, possible flagged, transfers detected, parse errors.

### Phase 4: Transfer / Credit Card Payment Detection

**New file: `src/lib/transfer-detector.ts`**
- Function `detectTransfer(description: string): { isTransfer: boolean; transferType: string | null }`
- Pattern matching against: PAYMENT THANK YOU, ONLINE PAYMENT, CREDIT CARD PAYMENT, AUTOPAY, ACH PAYMENT, TRANSFER TO/FROM, PMT, CARD PAYMENT, AMEX/BOA/CHASE PAYMENT, FROM CHECKING, TO CREDIT CARD
- Returns transfer type: `credit_card_payment`, `account_transfer`, or `unknown_transfer`

**Wire into `Workspace.tsx`:**
- After categorization, run transfer detection on each row
- Set `is_transfer`, `exclude_from_expense_totals`, `transfer_type`
- Override category to "Transfer" for detected transfers
- Count transfers in batch summary

### Phase 5: Settings Toggles

**Update `Settings.tsx`:**
- Add three new toggles:
  - Prevent exact duplicate imports (ON by default)
  - Flag possible duplicates (ON by default)
  - Exclude transfers from expense totals (ON by default)

### Phase 6: Review Table Enhancements

**Update `ReviewTable.tsx`:**
- Add columns/badges: Parse Status, Duplicate Status, Transfer Status, Excluded from Totals
- Add filter options: possible duplicates, skipped duplicates, unique rows, transfers
- Add "bulk mark as transfer" action
- Add "override back to expense" action for transfer rows
- Show transfer badge on transfer rows

### Phase 7: FileProgressList & Upload Summary

**Update `FileProgressList.tsx`:**
- Add overall progress bar at top showing total files / completed
- Show expanded per-file summary: rows scanned, imported, dupes skipped, possible dupes, transfers, parse errors
- Expandable/collapsible per-file details

---

### Files Changed
- **Modified:** `src/lib/csv-parser.ts` — robust column mapping, BOM stripping, parse status, source row JSON
- **Modified:** `src/pages/Workspace.tsx` — pre-import validation dialog, enhanced dedup, transfer detection, expanded summary
- **Modified:** `src/pages/ReviewTable.tsx` — new columns, filters, bulk transfer actions
- **Modified:** `src/pages/Settings.tsx` — three new toggles
- **Modified:** `src/components/FileProgressList.tsx` — overall progress bar, expanded summary
- **New:** `src/lib/transfer-detector.ts` — transfer pattern matching
- **New:** `src/components/ImportPreviewDialog.tsx` — column mapping preview before import
- **Migration:** Add new columns to `transactions_uploaded`, `app_settings`, `upload_batches`

### Implementation Order
1. Migration (schema changes)
2. CSV parser fix + pre-import validation
3. Transfer detector
4. Workspace processing pipeline (dedup + transfers + new fields)
5. Settings toggles
6. Review table enhancements
7. FileProgressList summary improvements

