# Migration off Lovable Cloud → self-owned Supabase

Goal: keep Vercel hosting, move the database + auth + edge functions from the
Lovable-managed project `hqfazvpnthsyxpzytggs` to a Supabase project in the
Artist Influence org. Zero app-code rewrite: only `.env` changes at cutover.

## Inputs needed once
- `OLD_SERVICE_KEY`: service_role key of the old project (Lovable → project →
  More → Cloud → Secrets → SUPABASE_SERVICE_ROLE_KEY).
- `LOVABLE_API_KEY`: same Secrets panel; keeps assistant-chat + categorize-ai
  working until swapped to a direct Gemini/Anthropic key.
- Supabase CLI login (`npx supabase login`) for project create / db push /
  functions deploy.

## Runbook
1. `npx supabase projects create expense-memory --org-id <artist-influence-org> --region us-east-2 --db-password <generated>`
2. `npx supabase link --project-ref <new-ref>` then `npx supabase db push`
   (replays the 39 migrations in supabase/migrations on the FRESH project —
   this is safe here, unlike Overture where push would replay onto live prod).
3. Diff live schema vs new (information_schema column compare) and patch gaps.
4. Export data: `OLD_SERVICE_KEY=... node export-data.mjs ./export`
5. Export auth rows (run `auth-export.sql` in the old project's SQL editor,
   save the single JSON cell as `./export/auth.json`).
6. Import: `NEW_DB_URL=<session-pooler-url> NEW_DB_CA=<ca.crt> node import-data.mjs ./export ./export/auth.json`
   (also applies expense-fix.sql: soft-deletes 143 duplicate rows, flips 196
   rows to business — expected result 143/213134/196/160984/2).
7. Deploy functions: `npx supabase functions deploy assistant-chat categorize-ai market-rates signup-with-invite`
   and `npx supabase secrets set LOVABLE_API_KEY=...`
8. Cutover: update `.env` (VITE_SUPABASE_URL / _PUBLISHABLE_KEY / PROJECT_ID),
   update `api/keepalive.mjs` target (or delete it — paid orgs don't pause),
   run `npm test` (16 live RLS probes now hit the new backend), push main.
9. Verify login + data parity (row counts per table old vs new), then leave the
   old Lovable project untouched for two weeks as a fallback before deleting.
