import { describe, it, expect } from "vitest";

/**
 * Security boundary tests — verify Row Level Security denies anonymous access
 * to every sensitive table. These run against the live backend using ONLY the
 * public anon key (no session), proving that frontend hiding is backed by
 * server-side enforcement.
 *
 * A correctly-secured table returns an empty array (RLS filters all rows) — never
 * actual financial data — to an unauthenticated caller.
 */
const SUPABASE_URL = "https://hqfazvpnthsyxpzytggs.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxZmF6dnBudGhzeXhwenl0Z2dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MzM2NDcsImV4cCI6MjA4ODQwOTY0N30.u4ylCwFpRbcVZqfF75hCmzf7ri3jOnietbK9wnT_VJc";

const SENSITIVE_TABLES = [
  "transactions_uploaded",
  "income_transactions",
  "app_settings",
  "owner_secrets",
  "audit_logs",
  "delegated_access",
  "profiles",
  "reimbursement_groups",
  "investment_accounts",
  "account_balance_snapshots",
  "tax_profiles",
  "categorization_rules",
  "merchant_memory",
  "payment_methods",
  "chat_messages",
  "chat_threads",
];

async function anonSelect(table: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=5`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
  );
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

describe("RLS: anonymous users cannot read sensitive data", () => {
  for (const table of SENSITIVE_TABLES) {
    it(`returns no rows from ${table} for an anonymous caller`, async () => {
      const { body } = await anonSelect(table);
      // RLS-protected tables return an empty array to anon (never real rows).
      if (Array.isArray(body)) {
        expect(body.length).toBe(0);
      } else {
        // A permission error object is also acceptable (definitely not data).
        expect(Array.isArray(body)).toBe(false);
      }
    }, 15000);
  }
});
