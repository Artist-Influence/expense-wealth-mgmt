# Data Health Check (14h auto-sweep) + Income Duplicate Resolver

## What you'll get

A new **Health Check** system that automatically scans your data for duplicates and integrity issues, and gives you one-click cleanup tools.

### 1. Auto-run every 14 hours
- On app load, if it's been ≥14 hours since the last health check (or it's never run), the app silently runs a sweep in the background.
- A subtle **status pill in the top nav** turns amber/red when issues are found ("3 issues — Review"). Click it to open the Health Check panel.
- A "Run Now" button always available so you can force a sweep on demand.
- Last-run timestamp is stored per-user in `app_settings`.

### 2. What gets checked

**Duplicates**
- **Income duplicates** (the issue you're seeing now — 15 clusters detected, including doubled Deel deposits, Zelle payments from Artist Influence, etc.).
- **Expense duplicates** (exact + near-duplicates, same engine you already have).
- **Cross-mode duplicates** (same charge in both Personal & Business).

**Integrity issues**
- Income rows with `taxable_status = 'unknown'` AND `status = 'needs_review'` (need your review).
- Expenses with no category AND no predicted category (orphan rows).
- Transactions older than 7 days still stuck in `needs_review`.
- Expense rows with `parse_status = 'error'`.

### 3. Income duplicate resolver (NEW)
The existing `DuplicateResolverDialog` only handles expenses. We'll generalize it to also resolve income clusters:
- "Keep oldest, delete others" (income table has no `archived` status — uses hard delete with a confirmation).
- "Mark as not duplicates" (sets a flag so the cluster won't reappear).
- Shows source file, amount, date, type for each row.

### 4. Health Check panel
A new dialog (or `/health` mini-route) with sections:
- **Duplicates** — opens the resolver with all duplicate clusters across income + expenses.
- **Needs Review** — count + jump links to Expenses/Income filtered to those rows.
- **Stale Reviews** — rows untouched >7 days.
- **Parse Errors** — bad CSV imports needing attention.

Each section shows the count, a one-line description, and a primary action button.

## Technical changes

### DB migration (1 small change)
```sql
ALTER TABLE app_settings 
  ADD COLUMN last_health_check_at timestamptz,
  ADD COLUMN last_health_check_summary jsonb;

ALTER TABLE income_transactions 
  ADD COLUMN duplicate_status text NOT NULL DEFAULT 'unique',
  ADD COLUMN duplicate_of_income_id uuid;
```
(The `duplicate_status` mirrors what `transactions_uploaded` already has, so the resolver can mark income pairs as "not duplicates" persistently.)

### New file: `src/lib/health-check.ts`
Pure function that runs all checks and returns a structured summary:
```ts
export interface HealthCheckSummary {
  ranAt: string;
  income: { exactClusters: DuplicateCluster[]; rowIndex: Map<string, ...> };
  expenses: { exactClusters; nearClusters; crossModePairs; rowIndex };
  needsReview: { incomeCount: number; expenseCount: number };
  staleReviews: { count: number; oldestDate: string | null };
  parseErrors: { count: number };
  totalIssues: number;
}
export async function runHealthCheck(userId: string): Promise<HealthCheckSummary>;
```
Reuses `findExactClusters` / `findNearClusters` from `duplicate-detector.ts` — no algorithm changes.

### New file: `src/components/HealthCheckPanel.tsx`
Dialog with the sections above; embeds the duplicate resolver.

### Update: `src/components/DuplicateResolverDialog.tsx`
- Add an `incomeClusters` prop + new tab "Income Duplicates".
- Resolver actions for income: hard-delete losers (income rows are simpler; no archive concept) OR mark all as unique.

### Update: `src/components/AppNav.tsx`
- Add a small `HealthStatusPill` (icon + count badge) that opens the panel.
- Color: green ✓ (no issues), amber ⚠ (1–5), red 🔴 (>5).

### Update: `src/App.tsx` (or a top-level effect)
- On mount, check `app_settings.last_health_check_at`. If `> 14 hours` ago (or null), call `runHealthCheck`, store summary in state + persist `last_health_check_at` and `last_health_check_summary`.
- No background polling — just on-load + manual "Run Now".

### What we will NOT do
- No edge function / pg_cron — the user is single-tenant, so a client-side check on app load is simpler, free, and equally effective.
- No auto-deletion. Cleanup is always one-click but user-initiated, to avoid accidental data loss.

## Files touched
- `src/lib/health-check.ts` (new)
- `src/components/HealthCheckPanel.tsx` (new)
- `src/components/DuplicateResolverDialog.tsx` (extend with income tab)
- `src/components/AppNav.tsx` (add status pill)
- `src/App.tsx` (auto-run hook)
- DB migration: 2 columns on `app_settings`, 2 columns on `income_transactions`
