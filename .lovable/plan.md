

## Plan: Multi-File Upload with Progress Bars & Filename-Based Payment Method

### Overview
Rework the upload flow to accept multiple CSVs simultaneously, process them in parallel with individual progress bars, and auto-detect payment method from filename patterns.

### Filename → Payment Method Mapping

```text
Filename contains        →  Method assigned
─────────────────────────────────────────
"amex platinum"          →  "Amex Platinum"
"boa 5563" / "boa_5563" →  "BoA 5563"
"boa 5592" / "boa_5592" →  "BoA 5592"
"boa 5573" / "boa_5573" →  "BoA 5573"
"boa credit"             →  "BoA Credit Card"
"chase 2662"             →  "Chase Credit Card"
"chase 8886"             →  "Chase Checking/Debit"
(no match)               →  null (falls back to existing logic)
```

### Implementation Steps

#### 1. Create `src/lib/method-detector.ts`
A small utility function `detectMethodFromFilename(filename: string): string | null` that checks the filename (case-insensitive) against the patterns above and returns the mapped method.

#### 2. Rewrite `CsvUploader` for multi-file support
- Change `multiple: false` → `multiple: true` in dropzone config
- Change callback signature to `onFilesSelect: (files: File[]) => void`
- Show list of queued files instead of single file name
- Remove the single-file state; parent manages file queue

#### 3. Add per-file progress tracking in `Workspace.tsx`
- New state: `fileQueue: { file: File, status: 'queued' | 'parsing' | 'deduplicating' | 'categorizing' | 'inserting' | 'done' | 'error', progress: number, result?: BatchSummary, error?: string, method: string | null }[]`
- On files dropped: detect method per file via `detectMethodFromFilename`, populate queue, start processing all files concurrently (or sequentially to avoid DB contention — sequential is safer)
- Update each file's `status` and `progress` as it moves through stages (parse → dedup → categorize → insert → done)
- Pass the detected `method` into the transaction insert as `predicted_method` and `final_method` (overriding the categorization engine's method)

#### 4. New `FileProgressList` component
- Renders below the dropzone
- Each file shows: filename, detected method badge, progress bar (using existing `Progress` component), status text, and result summary when done
- Files with errors show error message in red

#### 5. Wire method into transaction inserts
In the processing loop, after categorization, override `predicted_method` and `final_method` with the detected method from the filename (when not null). This ensures every row from that file gets the correct payment method.

### Files Changed
- **New**: `src/lib/method-detector.ts` — filename → method mapping
- **Modified**: `src/components/CsvUploader.tsx` — multi-file dropzone
- **Modified**: `src/pages/Workspace.tsx` — file queue state, per-file processing with progress, method override

