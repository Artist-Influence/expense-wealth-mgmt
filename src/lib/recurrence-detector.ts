/**
 * Recurring-charge detection.
 *
 * A merchant qualifies as "recurring" when:
 *   - We've seen ≥ 3 prior charges for that merchant_key in the lookback window
 *   - Amounts are stable (within ±$1 of the median OR coefficient of variation < 10%)
 *   - Average gap between consecutive charges falls inside a known cadence band
 *   - The new transaction's amount is also within ±10% of the recurring median
 *
 * Pure function — no DB access. The caller pre-loads history.
 */

export type RecurrenceCadence =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'annual';

export interface RecurrenceResult {
  isRecurring: boolean;
  cadence?: RecurrenceCadence;
  median: number;
  count: number;
  confidence: number;
  explanation: string;
  avgDaysBetween?: number;
}

interface HistoryItem {
  date: string; // 'YYYY-MM-DD'
  amount: number;
}

const CADENCE_BANDS: Array<{ name: RecurrenceCadence; min: number; max: number; days: number }> = [
  { name: 'weekly',    min: 6,   max: 8,   days: 7   },
  { name: 'biweekly',  min: 13,  max: 16,  days: 14  },
  { name: 'monthly',   min: 25,  max: 35,  days: 30  },
  { name: 'quarterly', min: 85,  max: 100, days: 90  },
  { name: 'annual',    min: 350, max: 380, days: 365 },
];

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
  const variance = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

const NOT_RECURRING: RecurrenceResult = {
  isRecurring: false,
  median: 0,
  count: 0,
  confidence: 0,
  explanation: '',
};

export function detectRecurrence(
  newAmount: number | null | undefined,
  history: HistoryItem[],
): RecurrenceResult {
  if (newAmount == null || !isFinite(newAmount) || newAmount === 0) return NOT_RECURRING;
  if (!history || history.length < 3) return NOT_RECURRING;

  // Use absolute amounts so debits/credits both work consistently
  const amounts = history.map(h => Math.abs(h.amount)).filter(n => n > 0);
  if (amounts.length < 3) return NOT_RECURRING;

  const med = median(amounts);
  if (med === 0) return NOT_RECURRING;

  // Amount stability check
  const allWithinDollar = amounts.every(a => Math.abs(a - med) <= 1.0);
  const cv = stdev(amounts) / (amounts.reduce((s, n) => s + n, 0) / amounts.length);
  const stableAmount = allWithinDollar || cv < 0.10;
  if (!stableAmount) return NOT_RECURRING;

  // New tx must be within ±10% of median (avoids one-off large charge from same merchant)
  const newAbs = Math.abs(newAmount);
  if (Math.abs(newAbs - med) / med > 0.10) return NOT_RECURRING;

  // Cadence check
  const sortedDates = history
    .map(h => h.date)
    .filter(Boolean)
    .sort();
  if (sortedDates.length < 3) return NOT_RECURRING;

  const gaps: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    gaps.push(daysBetween(sortedDates[i - 1], sortedDates[i]));
  }
  const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;

  const band = CADENCE_BANDS.find(b => avgGap >= b.min && avgGap <= b.max);
  if (!band) return NOT_RECURRING;

  const count = amounts.length;
  // Base 88, +2 per charge over 3, capped at 96
  const confidence = Math.min(88 + Math.max(0, count - 3) * 2, 96);

  const tolerance = allWithinDollar ? '±$0.00' : `±${(cv * 100).toFixed(1)}%`;
  const explanation =
    `Recurring ${band.name} @ $${med.toFixed(2)} ` +
    `(${count} prior charges, ${tolerance}, ~${Math.round(avgGap)}d cadence)`;

  return {
    isRecurring: true,
    cadence: band.name,
    median: med,
    count,
    confidence,
    explanation,
    avgDaysBetween: avgGap,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backfill: scan existing rows and tag eligible ones as Subscriptions
// ─────────────────────────────────────────────────────────────────────────────

import { supabase as defaultClient } from '@/integrations/supabase/client';
import { generateMerchantKey, normalizeDescription } from './normalizer';

const AMBIGUOUS_MERCHANTS = new Set([
  'AMAZON', 'PAYPAL', 'VENMO', 'ZELLE', 'SQUARE', 'STRIPE',
  'WALMART', 'COSTCO', 'TARGET', 'APPLE', 'GOOGLE',
]);
function isAmbiguousMerchant(merchantKey: string): boolean {
  const upper = merchantKey.toUpperCase();
  return [...AMBIGUOUS_MERCHANTS].some(m => upper.includes(m));
}

export interface BackfillSummary {
  scanned: number;       // bucket count
  eligible: number;      // rows that matched recurrence
  updated: number;       // rows actually written
  skippedApproved: number;
  skippedAlreadyTagged: number;
  skippedNoSubsCategory: number;
}

interface BackfillRow {
  id: string;
  date: string | null;
  amount: number | null;
  description_normalized: string | null;
  description_raw: string | null;
  predicted_category: string | null;
  final_category: string | null;
  review_status: string;
  match_source: string | null;
  is_transfer: boolean;
  is_split_parent: boolean;
  parent_transaction_id: string | null;
  exclude_from_expense_totals: boolean;
}

/**
 * Re-scan the owner's transactions in the last 180 days and tag recurring
 * charges as Subscriptions. Idempotent — re-running won't double-tag.
 */
export async function backfillRecurringForOwner(
  ownerId: string,
  mode: 'personal' | 'business',
  client = defaultClient,
): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    scanned: 0, eligible: 0, updated: 0,
    skippedApproved: 0, skippedAlreadyTagged: 0, skippedNoSubsCategory: 0,
  };

  // 1) Allowed categories for this mode
  const { data: cats } = await client
    .from('category_options')
    .select('category_name')
    .eq('owner_id', ownerId)
    .eq('mode', mode)
    .eq('is_active', true);
  const allowedSet = new Set((cats || []).map(c => c.category_name));
  if (!allowedSet.has('Subscriptions')) {
    summary.skippedNoSubsCategory = -1; // signal: nothing tagged because cat missing
    return summary;
  }

  // 2) Auto threshold
  const { data: settings } = await client
    .from('app_settings')
    .select('business_auto_threshold, personal_auto_threshold')
    .eq('owner_id', ownerId)
    .maybeSingle();
  const autoT = mode === 'business'
    ? Number(settings?.business_auto_threshold) || 90
    : Number(settings?.personal_auto_threshold) || 90;

  // 3) Pull all rows in the window (paged)
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const all: BackfillRow[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from('transactions_uploaded')
      .select('id, date, amount, description_normalized, description_raw, predicted_category, final_category, review_status, match_source, is_transfer, is_split_parent, parent_transaction_id, exclude_from_expense_totals')
      .eq('owner_id', ownerId)
      .eq('mode', mode)
      .gte('date', since)
      .not('amount', 'is', null)
      .is('deleted_at', null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as BackfillRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // 4) Group by merchant_key
  const buckets = new Map<string, BackfillRow[]>();
  for (const r of all) {
    const desc = r.description_normalized || normalizeDescription(r.description_raw || '');
    const key = generateMerchantKey(desc);
    if (!key) continue;
    if (isAmbiguousMerchant(key)) continue;
    const list = buckets.get(key) || [];
    list.push(r);
    buckets.set(key, list);
  }
  summary.scanned = buckets.size;

  // 5) For each bucket, walk chronologically and detect per-row
  type Update = {
    id: string;
    predicted_category: string;
    match_source: string;
    match_explanation: string;
    confidence: number;
    review_status: string;
  };
  const updates: Update[] = [];

  for (const rows of buckets.values()) {
    if (rows.length < 3) continue;
    const sorted = [...rows]
      .filter(r => r.date && r.amount != null)
      .sort((a, b) => (a.date! < b.date! ? -1 : 1));
    if (sorted.length < 3) continue;

    for (let i = 3; i < sorted.length; i++) {
      const cur = sorted[i];
      // Skip rows we shouldn't touch
      if (cur.is_transfer || cur.is_split_parent || cur.parent_transaction_id) continue;
      if (cur.exclude_from_expense_totals) continue;
      if (cur.review_status === 'approved' || cur.review_status === 'edited' || cur.final_category) {
        summary.skippedApproved++;
        continue;
      }

      const history = sorted.slice(0, i).map(r => ({ date: r.date!, amount: r.amount! }));
      const result = detectRecurrence(cur.amount!, history);
      if (!result.isRecurring) continue;

      summary.eligible++;

      if (cur.predicted_category === 'Subscriptions' && cur.match_source === 'recurring_pattern') {
        summary.skippedAlreadyTagged++;
        continue;
      }

      updates.push({
        id: cur.id,
        predicted_category: 'Subscriptions',
        match_source: 'recurring_pattern',
        match_explanation: result.explanation,
        confidence: result.confidence,
        review_status: result.confidence >= autoT ? 'auto_categorized' : 'suggested',
      });
    }
  }

  // 6) Apply in chunks of 50 in parallel
  const chunkSize = 50;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const batch = updates.slice(i, i + chunkSize);
    await Promise.all(batch.map(u =>
      client.from('transactions_uploaded').update({
        predicted_category: u.predicted_category,
        match_source: u.match_source,
        match_explanation: u.match_explanation,
        confidence: u.confidence,
        review_status: u.review_status,
      }).eq('id', u.id)
    ));
    summary.updated += batch.length;
  }

  return summary;
}

