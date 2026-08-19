// Export every public table from the OLD (Lovable-managed) backend as JSON.
// Requires: OLD_SERVICE_KEY env var (service_role key of hqfazvpnthsyxpzytggs).
// Ordered, paginated reads — unordered pagination silently drops rows.
// Usage: OLD_SERVICE_KEY=... node export-data.mjs <out-dir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://hqfazvpnthsyxpzytggs.supabase.co';
const KEY = process.env.OLD_SERVICE_KEY;
if (!KEY) { console.error('OLD_SERVICE_KEY not set'); process.exit(1); }
const OUT = process.argv[2] || './export';
mkdirSync(OUT, { recursive: true });

const TABLES = [
  'profiles', 'user_roles', 'app_settings', 'tax_profiles', 'payment_methods',
  'category_options', 'categorization_rules', 'merchant_memory', 'invite_codes',
  'delegated_access', 'owner_secrets', 'investment_accounts',
  'account_balance_snapshots', 'upload_batches', 'transactions_uploaded',
  'income_transactions', 'reimbursement_groups', 'recurring_overrides',
  'allocation_plans', 'allocation_line_items', 'chat_threads', 'chat_messages',
  'audit_logs', 'ai_usage_events',
];

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const PAGE = 1000;

async function orderCol(table) {
  // Prefer id; fall back to created_at for tables without one.
  const probe = await fetch(`${BASE}/rest/v1/${table}?select=id&limit=1`, { headers });
  return probe.ok ? 'id' : 'created_at';
}

for (const table of TABLES) {
  const col = await orderCol(table);
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const url = `${BASE}/rest/v1/${table}?select=*&order=${col}.asc&limit=${PAGE}&offset=${from}`;
    const res = await fetch(url, { headers });
    if (!res.ok) { console.error(`${table}: HTTP ${res.status} ${await res.text()}`); process.exit(1); }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  writeFileSync(join(OUT, `${table}.json`), JSON.stringify(rows));
  console.log(`${table}: ${rows.length} rows`);
}
console.log('export complete →', OUT);
