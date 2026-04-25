## Fix: BoA CSV import fails on summary block above transaction header

### What's broken

Bank of America (and similar bank/credit card) CSVs include a 5-row **summary block** at the top before the actual transaction table:

```
Description,,Summary Amt.            ← PapaParse reads THIS as headers
Beginning balance as of 01/01/2026,,"5,062.08"
Total credits,,"57,389.88"
Total debits,,"-61,133.48"
Ending balance as of 04/24/2026,,"1,318.48"
                                     ← blank row
Date,Description,Amount,Running Bal. ← REAL header is here on row 7
01/01/2026,Beginning balance...
01/02/2026,Zelle payment to...
```

Because PapaParse takes row 1 as the header, the parser sees columns `Description`, `(blank)`, `Summary Amt.` — no Date column, so the import fails with "Cannot import: missing required columns · Missing: Date."

### The fix

Add a header-detection step in `src/lib/csv-parser.ts` that runs **before** PapaParse:

1. **`findHeaderLineIndex(text)`** — scan the first ~25 lines of the CSV. For each line, do a quick comma-split and check whether the cells contain header-like tokens for **Date + Description** (and ideally Amount). The first line that matches all three is the real transaction header.
2. **`trimToTransactionHeader(text)`** — slice off everything above that line so PapaParse sees the real header as row 1.
3. Apply this trim in all three entry points: `previewCsvFile`, `parseCsvFileWithMapping`, and `parseCsvFile`. It runs right after `stripBom`, so it's transparent to the rest of the pipeline.
4. If no header-like line is found in the first 25 rows (i.e., the CSV is already clean), return the text unchanged. Zero impact on existing well-formed files (Amex, Apple Card, etc.).

### Why this approach

- **One small helper, zero new dependencies.** Reuses the existing `DATE_CANDIDATES`, `DESCRIPTION_CANDIDATES`, `AMOUNT_CANDIDATES` arrays, so when those grow, header detection auto-improves.
- **Generic** — works for any bank that prepends a summary block (BoA, Chase, Wells Fargo all do this in slightly different shapes), not just BoA-specific.
- **Safe fallback** — if detection fails, the file is parsed as-is (current behavior).
- **Belt-and-suspenders** — even after trimming, the existing `isStatementArtifact()` filter still catches any "Beginning balance" rows that appear *inside* the transaction table (BoA repeats it as the first transaction row), so summary text never becomes a transaction.

### Files

- `src/lib/csv-parser.ts` — add `findHeaderLineIndex` + `trimToTransactionHeader` helpers; call `trimToTransactionHeader(stripBom(text))` in all three parse entry points.

No DB changes. No UI changes needed — once parsed correctly, the existing Batch Import Preview dialog will show all required columns mapped (`Date → Date`, `Description → Description`, `Amount → Amount`) and the import button will enable.
