# Expense Memory

Private finance control portal for Artist Influence: CSV import with learned auto-categorization, income tracking, subscriptions, tax estimates, wealth projections, and an AI assistant.

Full product documentation lives in [docs/APP_GUIDE.md](docs/APP_GUIDE.md).

## Stack

- Vite + React + TypeScript, shadcn/ui, Tailwind CSS
- Supabase (Postgres + RLS, Auth with TOTP MFA, Edge Functions)
- TanStack Query, Recharts, PapaParse

## Development

```sh
npm install
npm run dev     # local dev server on :8080
npm test        # vitest (includes live RLS security probes)
npm run build   # production build to dist/
```

Supabase connection values are read from `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). The publishable anon key is public by design; all data access is enforced by Row Level Security.

## Deployment

Hosted on Vercel (SPA rewrites configured in `vercel.json`). Deploy with:

```sh
npx vercel deploy --prod --yes
```

Backend (database, auth, edge functions) runs on Supabase project `hqfazvpnthsyxpzytggs`.
