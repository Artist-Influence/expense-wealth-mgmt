// Import exported JSON into the NEW self-owned Supabase project over a direct
// pg connection (session pooler), then apply the Aug-2 wrong-tab-import fix.
// Requires: NEW_DB_URL env var (postgresql://... session pooler URL).
// Usage: NEW_DB_URL=... node import-data.mjs <export-dir> <auth-users.json>
//
// auth-users.json = [{ users: [...auth.users rows...], identities: [...] }]
// exported separately (auth schema is not reachable over PostgREST).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DB_URL = process.env.NEW_DB_URL;
if (!DB_URL) { console.error('NEW_DB_URL not set'); process.exit(1); }
// Pin the Supabase CA (download from the new project's Database → SSL settings)
// so TLS is actually verified — never disable verification.
const CA_PATH = process.env.NEW_DB_CA;
if (!CA_PATH || !existsSync(CA_PATH)) { console.error('NEW_DB_CA (path to Supabase CA cert) not set or missing'); process.exit(1); }
const DIR = process.argv[2] || './export';
const AUTH_FILE = process.argv[3];

// FK-safe order: parents before children.
const TABLES = [
  'profiles', 'user_roles', 'app_settings', 'tax_profiles', 'payment_methods',
  'category_options', 'categorization_rules', 'merchant_memory', 'invite_codes',
  'delegated_access', 'owner_secrets', 'investment_accounts',
  'account_balance_snapshots', 'upload_batches', 'reimbursement_groups',
  'transactions_uploaded', 'income_transactions', 'recurring_overrides',
  'allocation_plans', 'allocation_line_items', 'chat_threads', 'chat_messages',
  'audit_logs', 'ai_usage_events',
];

const client = new pg.Client({ connectionString: DB_URL, ssl: { ca: readFileSync(CA_PATH, 'utf8') } });
await client.connect();

async function insertRows(table, rows, schema = 'public') {
  if (!rows.length) { console.log(`${schema}.${table}: 0 rows (skipped)`); return; }
  const cols = Object.keys(rows[0]);
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((row, r) => {
      const ph = cols.map((c, j) => `$${r * cols.length + j + 1}`);
      values.push(`(${ph.join(',')})`);
      cols.forEach(c => {
        const v = row[c];
        params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
      });
    });
    await client.query(
      `INSERT INTO ${schema}.${table} (${cols.map(c => `"${c}"`).join(',')}) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`,
      params,
    );
  }
  console.log(`${schema}.${table}: ${rows.length} rows`);
}

try {
  // Auth first — every owner_id FK points at auth.users.
  if (AUTH_FILE && existsSync(AUTH_FILE)) {
    const auth = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
    await insertRows('users', auth.users, 'auth');
    await insertRows('identities', auth.identities || [], 'auth');
  } else {
    console.warn('No auth file provided — users must already exist with matching UUIDs.');
  }

  // Session-replication role skips triggers (audit triggers would re-log every
  // historical row) but NOT constraints validation on insert; FK order still matters.
  await client.query(`SET session_replication_role = replica`);
  for (const table of TABLES) {
    const file = join(DIR, `${table}.json`);
    if (!existsSync(file)) { console.warn(`${table}: no export file, skipped`); continue; }
    await insertRows(table, JSON.parse(readFileSync(file, 'utf8')));
  }
  await client.query(`SET session_replication_role = DEFAULT`);

  // ── Apply the Aug-2 wrong-tab-import fix ──
  const fix = readFileSync(new URL('./expense-fix.sql', import.meta.url), 'utf8');
  const res = await client.query(fix);
  const last = Array.isArray(res) ? res[res.length - 1] : res;
  console.log('mixed-import fix applied:', last.rows?.[0]);

  console.log('import complete');
} finally {
  await client.end();
}
