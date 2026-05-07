
## Problem

The Income page CSV parser (`src/pages/Income.tsx`) uses a simple `Papa.parse` with `header: false` and assumes row 0 is the header. Bank of America CSVs prepend a summary block (Beginning Balance, Total Credits, etc.) before the real transaction header. The parser reads "Description,,Summary Amt." as the header, finds no "amount" column, and shows the error.

The Expenses CSV parser already handles this via `trimToTransactionHeader()` in `src/lib/csv-parser.ts`, but the Income page doesn't use it.

## Fix

In `src/pages/Income.tsx`, add the same summary-block trimming before parsing:

1. Import `trimToTransactionHeader` (currently not exported) — export it from `src/lib/csv-parser.ts`
2. In `handleCsvFiles`, apply `trimToTransactionHeader(text)` before passing to `Papa.parse`
3. This reuses the existing, tested logic that scans for a line with Date + Description + Amount tokens

Two small edits, both in existing files.
