

## Plan: Duplicate Detection on CSV Upload

### Problem
When uploading CSVs month-to-month, overlapping date ranges can result in duplicate transactions being inserted.

### Approach
Add duplicate detection during the upload flow in `Workspace.tsx`. Before inserting new rows, check for existing transactions with matching `date + description_raw + amount + mode` for the same owner. Skip duplicates and report how many were filtered.

### Implementation Steps

1. **Add deduplication logic in `Workspace.tsx` `handleFileUpload`** (between parsing and inserting):
   - Query `transactions_uploaded` for existing rows matching the mode + owner
   - Filter by the date range of the incoming CSV to limit the query
   - Build a composite key (`date|description_raw|amount`) for each existing row
   - Filter out parsed rows whose composite key already exists
   - Show a toast reporting how many duplicates were skipped (e.g., "Skipped 12 duplicate rows")
   - Adjust batch counts to reflect only the non-duplicate rows

2. **Update batch summary** to reflect the actual inserted count (excluding duplicates)

3. **No schema changes needed** — this is purely client-side filtering before insert

### Duplicate Key Definition
A transaction is a duplicate if ALL of these match an existing row:
- `date`
- `description_raw` (exact)
- `amount`
- `mode`
- `owner_id`

This is conservative enough to avoid false positives while catching re-uploaded rows.

