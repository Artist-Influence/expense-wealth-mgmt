

## Fix: Stale Upload Cards After Deleting Rows

### Problem
When you delete imported CSV rows, the upload cards in the upload panel persist because:
1. The `fileQueue` is purely client-side React state — it's populated during upload and never cleared when rows are deleted
2. The `upload_batches` records in the database are never deleted when their associated transactions are removed
3. There's no reconciliation between the two

### Solution

**`src/pages/Expenses.tsx`** — Two changes:

1. **After `bulkDelete` succeeds, clean up orphaned upload batches.** After deleting transactions, query `upload_batches` for the affected batch IDs, check if any transactions still reference each batch, and delete batches with zero remaining rows. Also remove corresponding items from the `fileQueue` state.

2. **Clear stale `fileQueue` items on mode switch / page load.** When `loadTransactions` runs, also clear any `fileQueue` items whose `batchId` no longer has active rows in the fetched transaction set.

Specifically in `bulkDelete`:
- Collect the unique `upload_batch_id` values from the deleted transactions (before or after delete)
- After deleting rows, for each affected batch ID, count remaining transactions with that `upload_batch_id`
- If count is 0, delete the `upload_batches` record
- Remove matching items from `fileQueue` state

Additionally, clear `fileQueue` when the mode changes (already happens implicitly since it's useState, but completed uploads from a previous session should not reappear — they don't since `fileQueue` starts empty on mount).

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Expenses.tsx` | In `bulkDelete`: collect affected batch IDs, delete orphaned `upload_batches` rows, remove matching `fileQueue` items. On `loadTransactions`: reset `fileQueue` to remove stale completed items. |

