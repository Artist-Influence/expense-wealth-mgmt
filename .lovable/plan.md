## Problem

The nav badge correctly shows 663 issues (from the persisted `totalIssues` in `app_settings`). But when the Health Check dialog opens, it displays all zeros because the persisted summary only stores `totalIssues` and a `breakdown` object — while the reconstructed `HealthCheckSummary` in AppNav (lines 62-70) **hardcodes all detail fields to zero**:

```
staleReviews: { count: 0, oldestDate: null }
needsReview: { incomeCount: 0, expenseCount: 0 }
parseErrors: { count: 0 }
```

So the dialog shows "No stale items", "0 expenses · 0 income", etc. despite 611 stale + 52 near-duplicates.

## Fix

**Reconstruct the detail fields from the persisted `breakdown`** when loading from `app_settings` in AppNav:

1. **AppNav.tsx (lines 62-70)**: Map `breakdown.stale` → `staleReviews.count`, `breakdown.parseErrors` → `parseErrors.count`, `breakdown.expenseNear` → use for near cluster count display, etc. Also compute `needsReview` counts from the breakdown or re-query them.

2. **health-check.ts**: Expand the persisted `breakdown` to also include `needsReviewExpenses` and `needsReviewIncome` so the dialog can show those without re-running.

3. **HealthCheckPanel**: The dialog already auto-runs when opened with no summary — but `initialSummary` is set (with zeros), so it skips the auto-run. Fix: if the summary came from persistence (no clusters loaded), auto-run on open to get fresh data.

**Recommended approach**: Option 3 is simplest and most accurate — always re-run the health check when the dialog opens, regardless of whether a persisted summary exists. This ensures the dialog always shows fresh data. The persisted summary is only used for the nav badge between dialog opens.

## Changes

- **`src/components/AppNav.tsx`**: When setting `healthSummary` from persistence, mark it as `persisted: true` (or simply don't set cluster data). Then in the dialog open handler, always trigger a refresh.
- **`src/components/HealthCheckPanel.tsx`**: Change the auto-run condition from `!summary` to always run on open (or run when summary has no cluster data).

This is a 2-file, ~10-line change.
