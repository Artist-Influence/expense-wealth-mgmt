// Vercel cron target: pings the Lovable Cloud (Supabase) backend so it never
// pauses for inactivity again. A paused backend loses DNS entirely, which
// broke login outright on 2026-08-19. The anon key is public by design (it
// ships in the frontend bundle), so nothing sensitive lives here.
const BASE = 'https://hqfazvpnthsyxpzytggs.supabase.co';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxZmF6dnBudGhzeXhwenl0Z2dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MzM2NDcsImV4cCI6MjA4ODQwOTY0N30.u4ylCwFpRbcVZqfF75hCmzf7ri3jOnietbK9wnT_VJc';

export default async function handler(req, res) {
  const results = {};
  try {
    const auth = await fetch(`${BASE}/auth/v1/health`, {
      headers: { apikey: ANON },
    });
    results.auth = auth.status;
    // An RLS-protected select counts as real API activity; anon gets [] back.
    const rest = await fetch(`${BASE}/rest/v1/category_options?select=id&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    results.rest = rest.status;
  } catch (err) {
    results.error = String(err);
  }
  const healthy = results.auth === 200;
  res.status(healthy ? 200 : 503).json({ healthy, ...results, at: new Date().toISOString() });
}
