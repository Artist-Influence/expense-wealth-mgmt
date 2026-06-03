Plan:

1. Make the dialog remove resolved clusters immediately
- In `DuplicateResolverDialog`, track locally dismissed cluster row IDs after a successful “Not duplicates” update.
- Filter the active cluster list against that local dismissed set, so the clicked cluster disappears instantly instead of waiting for the full refresh/sweep cycle.
- Clear the dismissed set only when the dialog is opened fresh.

2. Make the parent refresh stop reopening/re-surfacing the same result
- Keep the existing `not_duplicate` exclusion in the Expenses duplicate sweep.
- Adjust the `onResolved` refresh path so marking a cluster does not visually re-show stale props while the sweep reloads.

3. Fix the health-check duplicate source too
- In `src/lib/health-check.ts`, exclude `duplicate_status = 'not_duplicate'` from expense exact clusters, near clusters, cross-mode pairs, and row index input.
- This prevents dismissed duplicates from coming back when the duplicate resolver is opened from the health-check panel.

4. Validate
- Confirm the update still writes `duplicate_status: 'not_duplicate'` and clears the duplicate link.
- Confirm the clicked cluster disappears from the Possible section immediately and does not return on the next duplicate scan.