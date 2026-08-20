// Vercel cron target: pings the Lovable Cloud (Supabase) backend so it never
// pauses for inactivity again. A paused backend loses DNS entirely, which
// broke login outright on 2026-08-19. The anon key is public by design (it
// ships in the frontend bundle), so nothing sensitive lives here.
const BASE = 'https://syfwesqaicltboztnagf.supabase.co';
const ANON = 'sb_publishable_qJNTRZeAmkyVPHq5SNx18Q_le9h7VM9';

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
