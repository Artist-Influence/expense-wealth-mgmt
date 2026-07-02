import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from './fetch-all';
import {
  findExactClusters,
  findNearClusters,
  generateFingerprint,
  type DuplicateCluster,
} from './duplicate-detector';
import type { DupClusterRow } from '@/components/DuplicateResolverDialog';

export const HEALTH_CHECK_INTERVAL_HOURS = 14;

export interface HealthCheckSummary {
  ranAt: string;
  income: {
    exactClusters: DuplicateCluster[];
    rowIndex: Record<string, DupClusterRow>;
  };
  expenses: {
    exactClusters: DuplicateCluster[];
    nearClusters: DuplicateCluster[];
    crossModePairs: { rowIds: string[] }[];
    rowIndex: Record<string, DupClusterRow>;
  };
  needsReview: { incomeCount: number; expenseCount: number };
  staleReviews: { count: number; oldestDate: string | null };
  parseErrors: { count: number };
  totalIssues: number;
}

function staleCutoffISO(days = 7): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function runHealthCheck(userId: string): Promise<HealthCheckSummary> {
  // ---- INCOME ----
  // Paginated: an unpaginated select caps at 1000 rows and the duplicate scan
  // silently goes blind past that.
  const incomeRows = await fetchAllRows<any>((from, to) => supabase
    .from('income_transactions')
    .select('id, date, amount, description_raw, description_normalized, mode, source_file_name, source_account_name, income_type, taxable_status, status, duplicate_status, created_at')
    .eq('owner_id', userId)
    .is('deleted_at', null)
    .neq('duplicate_status', 'not_duplicate') // honor user "not duplicates" marker
    .order('id')
    .range(from, to));

  const incomeRowsTyped = (incomeRows || []).map((r: any) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount || 0),
    description_normalized: r.description_normalized || r.description_raw || '',
    fingerprint: generateFingerprint(r.mode || 'personal', r.date, Number(r.amount || 0), r.description_normalized || r.description_raw || ''),
    created_at: r.created_at,
  }));
  const incomeExact = findExactClusters(incomeRowsTyped);
  const incomeRowIndex: Record<string, DupClusterRow> = {};
  for (const r of incomeRows || []) {
    incomeRowIndex[r.id] = {
      id: r.id,
      date: r.date,
      description_raw: r.description_raw,
      description_normalized: r.description_normalized,
      amount: Number(r.amount || 0),
      final_category: r.income_type || null,
      predicted_category: null,
      final_method: null,
      predicted_method: null,
      source_file_name: r.source_file_name,
      source_account_name: r.source_account_name,
      mode: r.mode || 'personal',
      duplicate_status: r.duplicate_status || 'unique',
    };
  }

  // ---- EXPENSES ----
  const expRows = await fetchAllRows<any>((from, to) => supabase
    .from('transactions_uploaded')
    .select('id, date, amount, description_raw, description_normalized, mode, source_file_name, final_category, predicted_category, final_method, predicted_method, duplicate_status, duplicate_fingerprint, created_at, review_status')
    .eq('owner_id', userId)
    .is('deleted_at', null)
    .neq('review_status', 'archived')
    .order('id')
    .range(from, to));

  // Honor the user's "not duplicates" marker everywhere — dismissed rows must
  // never resurface as exact, near, or cross-mode duplicates.
  const expRowsActive = (expRows || []).filter((r: any) => r.duplicate_status !== 'not_duplicate');

  const expRowsTyped = expRowsActive.map((r: any) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount || 0),
    description_normalized: r.description_normalized || r.description_raw || '',
    fingerprint: r.duplicate_fingerprint || generateFingerprint(r.mode, r.date, Number(r.amount || 0), r.description_normalized || r.description_raw || ''),
    created_at: r.created_at,
  }));
  const expExact = findExactClusters(expRowsTyped);
  const exactIds = new Set<string>();
  for (const c of expExact) for (const id of c.rowIds) exactIds.add(id);
  const expNear = findNearClusters(
    expRowsTyped,
    exactIds,
    7,
  );

  // Cross-mode: same date+amount+normalized desc but mode differs
  const byKey = new Map<string, any[]>();
  for (const r of expRowsActive) {
    const k = `${r.date || ''}|${Number(r.amount || 0)}|${(r.description_normalized || r.description_raw || '').toUpperCase().trim()}`;
    if (!k.replace(/\|/g, '')) continue;
    const list = byKey.get(k) || [];
    list.push(r);
    byKey.set(k, list);
  }
  const crossModePairs: { rowIds: string[] }[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const modes = new Set(list.map((r: any) => r.mode));
    if (modes.size > 1) crossModePairs.push({ rowIds: list.map((r: any) => r.id) });
  }

  const expRowIndex: Record<string, DupClusterRow> = {};
  for (const r of expRows || []) {
    expRowIndex[r.id] = {
      id: r.id,
      date: r.date,
      description_raw: r.description_raw,
      description_normalized: r.description_normalized,
      amount: Number(r.amount || 0),
      final_category: r.final_category,
      predicted_category: r.predicted_category,
      final_method: r.final_method,
      predicted_method: r.predicted_method,
      source_file_name: r.source_file_name,
      mode: r.mode,
      duplicate_status: r.duplicate_status || 'unique',
    };
  }

  // ---- NEEDS REVIEW ----
  const [{ count: incomeReviewCount }, { count: expReviewCount }] = await Promise.all([
    supabase.from('income_transactions').select('id', { count: 'exact', head: true }).eq('owner_id', userId).eq('status', 'needs_review').is('deleted_at', null),
    supabase.from('transactions_uploaded').select('id', { count: 'exact', head: true }).eq('owner_id', userId).in('review_status', ['needs_review', 'suggested', 'ai_suggested']).is('deleted_at', null),
  ]);

  // ---- STALE REVIEWS (>7 days old still in needs_review) ----
  // Exact count (the old limit(1000) capped the reported number) + oldest date.
  const cutoff = staleCutoffISO(7);
  const [{ count: staleCount }, { data: oldestStale }] = await Promise.all([
    supabase
      .from('transactions_uploaded')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .in('review_status', ['needs_review', 'suggested', 'ai_suggested'])
      .lt('date', cutoff)
      .is('deleted_at', null),
    supabase
      .from('transactions_uploaded')
      .select('date')
      .eq('owner_id', userId)
      .in('review_status', ['needs_review', 'suggested', 'ai_suggested'])
      .lt('date', cutoff)
      .is('deleted_at', null)
      .order('date', { ascending: true })
      .limit(1),
  ]);

  // ---- PARSE ERRORS ----
  // The writer stores 'parse_error' (never 'error') — the old literal made
  // this counter permanently zero.
  const { count: parseErrCount } = await supabase
    .from('transactions_uploaded')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .eq('parse_status', 'parse_error')
    .is('deleted_at', null);

  const totalIssues =
    incomeExact.length +
    expExact.length +
    expNear.length +
    crossModePairs.length +
    (staleCount || 0) +
    (parseErrCount || 0);

  const summary: HealthCheckSummary = {
    ranAt: new Date().toISOString(),
    income: { exactClusters: incomeExact, rowIndex: incomeRowIndex },
    expenses: { exactClusters: expExact, nearClusters: expNear, crossModePairs, rowIndex: expRowIndex },
    needsReview: { incomeCount: incomeReviewCount || 0, expenseCount: expReviewCount || 0 },
    staleReviews: { count: staleCount || 0, oldestDate: oldestStale?.[0]?.date || null },
    parseErrors: { count: parseErrCount || 0 },
    totalIssues,
  };

  // Persist last-run (best-effort, doesn't block)
  try {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('id')
      .eq('owner_id', userId)
      .maybeSingle();
    const persistSummary = {
      ranAt: summary.ranAt,
      totalIssues: summary.totalIssues,
      breakdown: {
        incomeExact: incomeExact.length,
        expenseExact: expExact.length,
        expenseNear: expNear.length,
        crossMode: crossModePairs.length,
        stale: summary.staleReviews.count,
        parseErrors: summary.parseErrors.count,
      },
    };
    if (settings?.id) {
      await supabase
        .from('app_settings')
        .update({ last_health_check_at: summary.ranAt, last_health_check_summary: persistSummary as any })
        .eq('id', settings.id);
    } else {
      await supabase
        .from('app_settings')
        .insert({ owner_id: userId, last_health_check_at: summary.ranAt, last_health_check_summary: persistSummary as any });
    }
  } catch {
    // silent — health check still useful in-memory
  }

  return summary;
}

export async function shouldAutoRun(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('app_settings')
    .select('last_health_check_at')
    .eq('owner_id', userId)
    .maybeSingle();
  if (!data?.last_health_check_at) return true;
  const last = new Date(data.last_health_check_at).getTime();
  return Date.now() - last >= HEALTH_CHECK_INTERVAL_HOURS * 3600_000;
}
