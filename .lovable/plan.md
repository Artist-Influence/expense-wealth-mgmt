

## Plan: Fix Multi-CSV Upload — Isolated Per-File Parsing

### Root Cause

In `handleFilesSelect` (line 466-474), only `files[0]` is previewed. The resulting `mapping` from that single file is then reused for ALL files in `handlePreviewConfirm` → `processQueue`. If file 2+ has different headers or column order, parsing fails silently.

### Fix

**Each file gets its own independent preview + mapping + parse pipeline.**

### 1. Schema Migration — Add debug JSON to `upload_batches`

Add two nullable columns:
- `detected_headers` (jsonb) — array of detected CSV headers
- `mapped_columns` (jsonb) — the ColumnMapping used
- `parse_details` (jsonb) — detailed debug info (raw row count, filtered count, error details)

### 2. Refactor `ImportPreviewDialog` → Batch Precheck

Change the dialog to accept an array of file previews instead of a single one. It will show:
- A list of all files with their detected mappings
- Per-file status: green check if all required fields mapped, red X if missing
- Per-file row count and detected method
- Block import only if ALL files have errors; allow partial import if some files are valid
- "Import N valid files" button (skip files with missing required columns)

New prop interface:
```typescript
interface FilePreviewInfo {
  file: File;
  preview: ParsePreview | null;
  error: string | null;
  method: string | null;
}
```

### 3. Refactor `handleFilesSelect` in `Expenses.tsx`

Instead of previewing only `files[0]`, preview ALL files independently:
```
for each file:
  try previewCsvFile(file) → store per-file preview
  catch → store per-file error
```
Then show the batch precheck dialog with all results.

### 4. Refactor `handlePreviewConfirm` + `processQueue`

- Each file carries its own `ColumnMapping` from its own preview
- `processFile` receives the file's own mapping (not a shared one)
- Files with preview errors are pre-marked as `error` in the queue and skipped

### 5. Refactor `processFile` for Full Isolation

Each call to `processFile` already reads the file fresh and parses independently — this is correct. The only bug is the shared mapping. With per-file mappings, parsing is fully isolated.

Add: store `detected_headers`, `mapped_columns`, and `parse_details` JSON in `upload_batches` on insert.

### 6. Better Error Messages

In `processFile`, wrap errors with specific messages:
- "Missing required columns: Date, Description" (from preview)
- "No valid transaction rows after filtering N artifacts"
- "CSV parse error: [papa parse message]"
- "Empty file"

### Files Changed

| File | Action |
|------|--------|
| `src/pages/Expenses.tsx` | Refactor `handleFilesSelect`, `handlePreviewConfirm`, `processQueue` for per-file isolation |
| `src/components/ImportPreviewDialog.tsx` | Rewrite to batch precheck showing all files |
| `src/components/FileProgressList.tsx` | Minor — no structural changes needed |
| Migration | Add `detected_headers`, `mapped_columns`, `parse_details` jsonb columns to `upload_batches` |

### Key Changes Summary

1. **Preview all files independently** before showing dialog
2. **Each file gets its own ColumnMapping** — never shared
3. **Batch precheck dialog** shows per-file mapping status
4. **Files with errors are skipped**, not poison the batch
5. **Per-file debug JSON** stored in `upload_batches`

