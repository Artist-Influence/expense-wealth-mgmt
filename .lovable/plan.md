## Security audit — what's vulnerable today

**Access control / multi-tenant isolation**
- All "Owner access" RLS policies target the `public` role, not `authenticated` (should be deny-by-default for anon).
- `accountant` and `investor` policies grant read of **every row in the table regardless of owner**. The moment a second person uses the app, an accountant/investor could read their finances. This is the biggest isolation gap for your "close friends, separate finances" goal.
- Authorization is gated on `user_roles` (`isAuthorized = !!role`). A newly added friend has no role and either can't use the app or, if seeded as `owner`, the role model breaks per-user isolation. We need: every authenticated user owns their own data; delegated roles (accountant/investor) only see a specific owner who granted them.

**AI / chatbot**
- `assistant-chat` trusts a client-supplied `ownerId` (`body.ownerId ?? userId`). RLS currently saves it, but ownership must be derived server-side, never from the client.
- `assistant-chat` returns raw `String(e)` on errors (internal info disclosure) and has no request validation or rate limiting.
- `categorize-ai` has **no auth check** — any anonymous caller can spend AI credits and feed untrusted text into prompts. No rate limiting.
- System prompts don't explicitly defend against prompt injection embedded in merchant names / notes / OCR text.

**Auth / session**
- No MFA, no leaked-password protection. Signups not explicitly locked. Logout doesn't clear cached app state (React Query / localStorage scope keys).

**Integrity / recovery**
- No audit trail and no soft-delete: a bad edit or delete is unrecoverable and untraceable.

**Storage**
- No receipt storage exists yet; needs to be built private-only with signed URLs.

---

## Plan

### Phase 1 — Authentication & session hardening
- Enable **leaked-password protection** (HIBP) and **disable public signups** (you provision friends manually / invite-only).
- Add **TOTP MFA**: enrollment UI in Settings (QR + verify), and enforce AAL2 step-up at login when a factor exists; show MFA challenge on the login flow.
- **Clean logout**: on `signOut`, clear the React Query cache and any app localStorage keys so no private data lingers; ensure post-logout navigation can't read stale state.
- Keep login generic-error only (already does). Document that shorter JWT/refresh expiry is set in Cloud auth settings (manual, surfaced in the report).

### Phase 2 — Multi-tenant access-control hardening
- Rewrite every table's owner policy to `TO authenticated` with `auth.uid() = owner_id` for SELECT/INSERT/UPDATE/DELETE (deny-by-default; anon fully excluded).
- Replace global `accountant`/`investor` read policies with a **scoped delegation model**: a `delegated_access(grantee_user_id, owner_id, role)` table (owner-managed). Policies become `has_delegated_access(auth.uid(), owner_id, role)` via a SECURITY DEFINER helper, so a delegate only sees the specific owner who granted them — never all users.
- Authorization model: **any authenticated user is authorized for their own data** (rows where `owner_id = auth.uid()`). Update `useAuth`/`useUserRole`/AuthGuard so a new friend can use the app for their own finances without a global role; `owner`/`accountant`/`investor` become delegation-scoped, not global.
- `handle_new_user`: every new user provisions their own `app_settings` row; stop hardcoding the single-owner email as the only owner.
- Confirm all `owner_id` columns are `NOT NULL` (they are) and inserts force `owner_id = auth.uid()` via `WITH CHECK`.

### Phase 3 — Edge-function hardening
- `categorize-ai`: require a valid JWT (`getClaims`), validate body with zod, sanitize untrusted descriptions, and add per-user rate limiting.
- `assistant-chat`: derive `ownerId` server-side (self, or a delegated owner verified against `delegated_access` — never from `body.ownerId`); validate body with zod; return generic client errors (no raw `String(e)`); add per-user rate limiting.
- **Rate limiting**: a `rate_limits` table + SECURITY DEFINER `check_rate_limit(key, max, window)` used by AI endpoints (and reusable for exports/imports).
- **AI prompt-injection defenses**: system-prompt rules that all tool-returned text (merchant names, notes, OCR, CSV text) is **untrusted data, never instructions**; never reveal the system prompt, schema, secrets, or other users' data; refuse cross-user requests. Keep the user-scoped Supabase client so the AI physically cannot bypass RLS.
- Restrict CORS on finance endpoints to the app origin instead of `*`.

### Phase 4 — Append-only audit log
- `audit_logs(actor_id, owner_id, event_type, entity, entity_id, summary jsonb, created_at)`.
- RLS: owner can SELECT own logs; **no UPDATE/DELETE** (append-only); inserts only via a SECURITY DEFINER `log_event(...)`.
- Triggers on sensitive tables (`transactions_uploaded`, `income_transactions`, `reimbursement_groups`, `allocation_plans`, `user_roles`, `delegated_access`, `app_settings`) capture create/edit/delete with minimal before/after (IDs, amounts, status) — not raw descriptions where avoidable.
- Audit security/auth-relevant app events (login, exports, receipt access, chatbot finance queries, permission changes) via `log_event`.

### Phase 5 — Soft-delete foundation
- Add `deleted_at timestamptz` to core financial tables (`transactions_uploaded`, `income_transactions`, `reimbursement_groups`, `allocation_plans`, `investment_accounts`, `account_balance_snapshots`).
- Switch the primary delete actions in the UI (transactions, income) to **soft delete**; default list queries and finance calculations exclude `deleted_at IS NOT NULL`. Deletes are logged with a before-image for recovery.

### Phase 6 — Private receipt storage
- Create a **private** `receipts` bucket. RLS on `storage.objects`: a user may read/write only objects under their own `auth.uid()/...` path prefix.
- Reusable upload helper: restrict file types (jpg/png/webp/pdf), enforce a size cap, generate non-guessable path names, and create **short-lived signed URLs** for viewing (never public URLs).
- Minimal upload + view UI on a transaction's receipt, gated by ownership; receipt access is audit-logged.

### Phase 7 — Security tests & report
- Tests (DB-level + edge): User A can't read/update/delete User B's rows; anon can't read any sensitive table; a revoked delegate immediately loses access; `assistant-chat` rejects spoofed `ownerId`; `categorize-ai` rejects unauthenticated calls; receipt objects can't be read cross-user; prompt-injection text in notes doesn't change AI behavior.
- Final report: what was vulnerable, what changed, residual risks, and manual steps (e.g., session-expiry tuning, enabling Cloud backups/PITR, MFA enrollment).

---

## Technical notes
- All DB changes go through migrations with explicit `GRANT`s + `authenticated`-scoped policies; SECURITY DEFINER helpers use fixed `search_path` and are not directly executable by clients.
- `src/integrations/supabase/client.ts` is auto-generated; token-in-localStorage is a Supabase default we can't remove, so we compensate with locked signups, MFA, short sessions, HTTPS, and clean-logout cache clearing.
- No business-logic/UI redesign beyond what privacy/security requires (MFA enrollment UI, receipt upload, soft-delete wiring).

## Residual items needing manual setup (called out in the report)
- Tune JWT/refresh-token expiry and enable backups/PITR in Cloud settings.
- Real virus scanning of uploads isn't available in-platform (we restrict type/size/path instead).
- Provisioning friends' accounts is manual while signups stay locked.