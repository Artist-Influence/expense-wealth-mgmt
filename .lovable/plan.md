# Fix Duplicate Resolver Behavior

Two bugs in the **Resolve Duplicates** dialog on the Expenses page.

## Problem 1 — Tab jumps away after an action

In `src/components/DuplicateResolverDialog.tsx`, a `useEffect` that auto-selects the active tab depends on the cluster counts (`exactClusters.length`, `nearClusters.length`, `incomeClusters.length`, `crossModePairs.length`). After you click **Keep oldest, archive**, `onResolved()` re-runs the duplicate sweep, the counts change, and the effect fires again — re-picking the "first non-empty" tab and yanking you off the **Possible** tab you were working in.

**Fix:** Only reset the tab when the dialog transitions from closed → open (first render of a session), not when cluster counts change while it's open. Track previous open state with a ref so an in-session refresh leaves the user on their current tab.

## Problem 2 — "Not duplicates" doesn't remove the cluster

Clicking **Not duplicates** sets `duplicate_status = 'not_duplicate'` on the rows, but the duplicate sweep in `src/pages/Expenses.tsx` (`runDuplicateSweep`) re-clusters from `activeRows`, which is filtered only on amount / split / archived — it does **not** exclude rows already marked `not_duplicate`. So after the refresh the same rows re-cluster and the "Possible" entry reappears.

**Fix:** Add `r.duplicate_status !== 'not_duplicate'` to the `activeRows` filter so dismissed pairs are excluded from re-clustering and stay gone. This also prevents the sweep from re-stamping them as `possible_duplicate`.

## Technical changes

- `src/components/DuplicateResolverDialog.tsx`
  - Add a `prevOpen` ref. In the tab-selection `useEffect`, only run the "pick first non-empty tab" logic on the closed→open transition. Reduce/adjust the dependency array so changing counts no longer re-triggers a tab switch.
- `src/pages/Expenses.tsx` (`runDuplicateSweep`, the `activeRows` filter ~lines 316–321)
  - Add `r.duplicate_status !== 'not_duplicate'` to the filter.

No database or schema changes. Income "delete duplicates" and cross-mode paths are unaffected.

## Verification

- Open Resolve Duplicates, go to **Possible**, click **Keep oldest, archive** → stays on **Possible**, archived row drops out.
- Click **Not duplicates** on a possible cluster → cluster disappears and does not return after the silent refresh.