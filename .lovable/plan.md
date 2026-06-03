# Fix: "Possible duplicates" lumps recurring charges into one group

## What actually happened

You marked one cluster as "Not duplicates," and it looked like it marked everything and the buttons vanished. That's because the cluster you clicked wasn't really a duplicate pair — it was **8 separate $3.00 MTA subway swipes** (May 7–27) that the detector merged into a single "Possible duplicate" card.

Each action button (Not duplicates / Keep oldest, archive) applies to the **entire** cluster at once. So one click acted on all 8 rows ("marked all sections"), and since that emptied the section, the buttons disappeared.

### Why the detector merges them

The near-duplicate scan groups rows that share the same amount + similar description within a **7-day window**, and it chains them transitively. Recurring same-merchant, same-amount charges on consecutive/close days (subway rides, daily coffee, etc.) get linked into one big false-positive group even though they are legitimately separate transactions.

This is a real detection bug, not just a UI issue — these recurring charges should never be flagged as possible duplicates.

## The fix

### 1. `src/lib/duplicate-detector.ts` — `findNearClusters`
- **Tighten the window** from 7 days to 1 day. True re-imports land on the same or an adjacent posting date; 7 days is far too loose.
- **Add a recurring-pattern guard:** after grouping, drop any candidate group whose rows fall on **3 or more distinct dates**. A genuine re-imported duplicate sits on the same date (or two adjacent dates due to posting drift); a group spread across many distinct dates is a recurring charge, not a duplicate.
  - 8 MTA swipes on 8 dates → dropped (correctly not a duplicate).
  - 2 identical rows on the same date → kept (real duplicate).
  - 2 rows one day apart → kept (posting drift).

### 2. `src/pages/Expenses.tsx` — `runDuplicateSweep`
- Exclude rows that already belong to a recurring group (`recurring_group_id` set) from the near-duplicate candidate set, so detected subscriptions/recurring charges are never re-flagged as duplicates.

## Result
- Recurring charges (MTA, subscriptions, repeat same-amount merchants) stop appearing in "Possible duplicates."
- Genuine duplicates (same charge imported twice) still surface.
- Marking one cluster only affects that one cluster, and remaining clusters keep their buttons.

## Technical notes
- The optimistic `dismissedIds` logic in `DuplicateResolverDialog.tsx` already works correctly and stays as-is; the problem was upstream grouping, not the dialog.
- No schema changes. The existing 20 `not_duplicate` and 78 `possible_duplicate` rows are unaffected; the next scan simply won't re-bundle recurring charges.
- After the change I'll re-run the scan logic against the current data to confirm the MTA-type groups no longer appear and any true duplicates remain.
