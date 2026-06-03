# Finish security hardening: soft-delete coverage + AI abuse guard

Two pieces of residual work from the earlier hardening pass.

## Part 1 — Complete soft-delete (`deleted_at`) filtering (primary)

Several pages and helpers still read soft-deletable financial tables **without** excluding rows where `deleted_at IS NOT NULL`. That means a "deleted" transaction/income/plan can still leak into totals, tax estimates, allocations, reimbursements, and the health check — a correctness and data-integrity issue.

Add `.is('deleted_at', null)` to every **read** query on these soft-deletable tables: `transactions_uploaded`, `income_transactions`, `allocation_plans`, `allocation_line_items`, `reimbursement_groups`, `investment_accounts`, `account_balance_snapshots`. (Writes/updates/inserts are untouched.)

Files and queries to update:

```text
src/pages/Allocations.tsx   income_transactions, transactions_uploaded (x2),
                            investment_accounts, allocation_plans, allocation_line_items (reads)
src/pages/Wealth.tsx        account_balance_snapshots, investment_accounts,
                            transactions_uploaded (read queries only)
src/pages/Tax.tsx           transactions_uploaded, income_transactions (read queries)
src/pages/CloseMonth.tsx    transactions_uploaded, income_transactions, allocation_plans
src/pages/Reimbursements.tsx transactions_uploaded, reimbursement_groups (read queries)
src/lib/health-check.ts     income_transactions, transactions_uploaded (read/count queries)
src/lib/recurrence-detector.ts transactions_uploaded (read query)
```

Approach: for each `select(...)` chain on the tables above, append `.is('deleted_at', null)`. Leave `insert`/`update`/`delete` chains alone. After edits, grep to confirm every read on a soft-deletable table includes the filter.

This is pure frontend/query work — no schema or RLS changes.

## Part 2 — AI endpoint abuse guard (optional, ad-hoc)

You asked for rate limiting on the AI edge functions (`assistant-chat`, `categorize-ai`). Important caveat: the platform has **no first-class rate-limiting primitive**, so anything here is best-effort and ad-hoc, not a hardened guarantee.

Proposed lightweight, DB-backed throttle:

```text
1. New table public.ai_usage_events (owner_id, fn text, created_at)
   - GRANT to authenticated + service_role
   - RLS: owner can SELECT own rows; INSERT via SECURITY DEFINER fn only
2. SECURITY DEFINER fn check_ai_rate_limit(_fn text, _max int, _window interval)
   - counts caller's events in window, inserts one, returns boolean allow/deny
3. assistant-chat + categorize-ai call the fn after auth; on deny return HTTP 429
   with a generic message. Sensible defaults (e.g. ~30 assistant calls / 5 min,
   ~10 categorize batches / min) — tunable.
```

If you'd rather not add this complexity given it's only best-effort, we can **skip Part 2** and rely on the existing JWT-required + per-user RLS as the access boundary. Both edge functions already require auth, so anonymous abuse is already blocked — this only limits an authenticated user's volume.

## Verification

- `rg` to confirm no read on a soft-deletable table is missing `.is('deleted_at', null)`.
- Build passes; spot-check Tax/Allocations/Wealth/Reimbursements totals are unchanged when nothing is soft-deleted.
- (If Part 2) confirm a burst of calls returns 429 and normal usage is unaffected.

## Out of scope / still manual (unchanged)

- JWT/refresh-token expiry tuning (Cloud auth settings UI)
- PITR / backups (Cloud project settings)
- Per-user MFA enrollment
- Real virus scanning on uploads
