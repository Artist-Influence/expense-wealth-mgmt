## Goal

Make sure that when you import a new statement that overlaps with one you've already uploaded, those rows either get **skipped automatically** or get **flagged for one-click resolution** — and give you a way to clean up duplicates that are already sitting in the database from past overlapping uploads.

## What's there today

- On every import the pipeline already:
  - Builds a fingerprint `mode|date|amount|normalized_description` per row.
  - Loads existing rows in the new file's date window and skips any row whose fingerprint already exists (when `prevent_exact_duplicates` is on — default on).
  - Runs a "near duplicate" check (same amount, dates within 3 days, ≥70% prefix similarity) and flags matches as `possible_duplicate` (when `flag_possible_duplicates` is on — default on).
- Settings has the two toggles. The Expenses table has a "Possible duplicates" filter and the detail drawer shows a yellow "Possible Duplicate" badge.

**Gaps we're fixing:**
1. Date window is `[minDate, maxDate]` of the new file. If your new file has a row dated outside that window (or NULL date), it can sneak through. We expand the lookup window by ±3 days and also pull rows with NULL dates so nothing slips by.
2. Near-duplicate check only compares descriptions by **shared prefix** — banks often prepend reference numbers so two true duplicates score 0%. We add a token-overlap (Jaccard) fallback and a normalized-merchant-key match.
3. No way to find duplicates that are already in the database from before. We add a "Find duplicates" sweep on the Expenses page.
4. No bulk action — today you'd have to delete duplicates one row at a time. We add a duplicate review modal that lets you keep one / delete the other / mark the pair as not-a-duplicate.
5. Import summary doesn't tell you which rows were skipped. We log the skipped row descriptions in the batch's `parse_details` so the file progress card can list them.

## Plan

### 1. Tighten the import-time dedup (`src/pages/Expenses.tsx` + `src/lib/duplicate-detector.ts`)

- **Wider lookup window**: query existing rows for `[minDate − 3 days, maxDate + 3 days]` instead of the exact span, plus a separate query for rows where `date IS NULL` (limited to the same `mode` + owner). Catches edge-of-window matches.
- **Better near-duplicate scoring** in `isNearDuplicate`:
  - Keep the current prefix check.
  - Add a token-overlap check: split both descriptions on whitespace/punctuation, drop tokens shorter than 3 chars, return true if Jaccard ≥ 0.6.
  - Add a merchant-key short-circuit: if `generateMerchantKey(a) === generateMerchantKey(b)` AND amounts match AND dates within range → duplicate.
- **In-file dedup**: also dedupe rows against each other within the same import (currently relies on `existingFingerprints.add(fp)` mid-loop, which works for exact but not near). Track a per-import "seen near-dup signatures" set.
- **Skipped-rows log**: include `[{date, amount, description_normalized, matched_id}]` for skipped exact dups in `upload_batches.parse_details.exact_duplicates_detail` (capped at 50 entries to keep the column small).

### 2. Show what was skipped in the file progress card (`src/components/FileProgressList.tsx`)

When `result.skipped > 0`, expand the existing summary section with a "View skipped rows" link that opens a small dialog listing date / amount / description for the rows that were dropped as exact duplicates. Pulled from `upload_batches.parse_details.exact_duplicates_detail` so we don't bloat client state.

### 3. Add a "Find Duplicates" sweep on the Expenses page (`src/pages/Expenses.tsx`)

New toolbar button next to the existing filters. Clicking it:
1. Loads all transactions in the current mode (paged, 1000 at a time).
2. Groups them by fingerprint → any group with >1 row is an **exact duplicate cluster**.
3. For remaining rows, runs the upgraded `isNearDuplicate` pairwise within ±7-day windows (bucketed by amount to keep it fast) → **possible duplicate clusters**.
4. Marks all involved rows with `duplicate_status` (`exact_duplicate` / `possible_duplicate`) and `duplicate_of_transaction_id` pointing to the oldest row in the cluster.
5. Shows a count toast: "Found N exact + M possible duplicate clusters".

### 4. Duplicate Resolver dialog (new `src/components/DuplicateResolverDialog.tsx`)

Triggered by:
- Clicking the new "Resolve duplicates" badge that appears in the toolbar when any cluster exists.
- Clicking a "Possible Duplicate" badge in the detail drawer.

Behaviour:
- Lists each cluster as a side-by-side comparison (date, amount, source_file, description, category, method).
- Per cluster, three actions:
  - **Keep one, delete the other(s)** — soft action: set `review_status = 'archived'` and `exclude_from_expense_totals = true` on the loser(s) (keeps audit trail; you can still see them with the existing "Excluded" filter). A small "Hard delete" link does an actual delete for users who want it gone.
  - **Mark as not duplicates** — sets `duplicate_status = 'unique'` on all rows in the cluster so they stop being flagged.
  - **Skip** — closes that cluster, comes back next sweep.
- Pagination of clusters (10 per page) so a big sweep doesn't crash the dialog.

### 5. Cross-mode duplicate awareness (lightweight)

The fingerprint includes `mode`, so a charge that lives once in Personal and once in Business never gets flagged today. Add a separate, **read-only** "Cross-mode possible duplicates" tab inside the resolver dialog: same date + same amount + matching merchant key, regardless of mode. No auto action — just shows you the pair so you can decide if one was miscategorized. (Common case: business reimbursable expense accidentally uploaded under Personal too.)

## Technical details

**Files touched (no DB schema changes):**
- `src/lib/duplicate-detector.ts` — extend `isNearDuplicate` with token-overlap + merchant-key paths; export new helpers `findExactClusters(rows)` and `findNearClusters(rows)`.
- `src/pages/Expenses.tsx`
  - Replace the lookup query (~line 1026) with a `[minDate−3, maxDate+3]` range + a second query for `date IS NULL`.
  - Add `runDuplicateSweep()` function (uses the new helpers, batches updates via `update().in('id', […])`).
  - Add toolbar button + state (`duplicateClusters`, `resolverOpen`).
- `src/components/FileProgressList.tsx` — expand the "skipped" line into a clickable disclosure that fetches and shows `parse_details.exact_duplicates_detail`.
- `src/components/DuplicateResolverDialog.tsx` — new dialog component as described.
- `src/components/TransactionDetailDrawer.tsx` — make the existing "Possible Duplicate" badge clickable, opens the resolver scoped to that one cluster.

**No edge function changes. No RLS changes. No migration required** — every column we use already exists (`duplicate_status`, `duplicate_fingerprint`, `duplicate_of_transaction_id`, `parse_details` JSON).

## Why this is enough

- **Re-importing the exact same statement** → all rows skipped silently, you see "N skipped" with a list to verify.
- **Importing a partly-overlapping statement** (common: a fresh CSV that includes the last 7 days of the previous one) → overlapping rows skipped exactly, edge-of-window rows flagged for one-click confirm.
- **Already-duplicated data from past imports** → "Find duplicates" sweep + resolver dialog cleans it up in minutes instead of clicking 200 rows.
- **Different mode same charge** → surfaced in the cross-mode tab without auto-touching anything (since intent is sometimes deliberate).

