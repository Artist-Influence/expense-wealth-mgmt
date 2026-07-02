import { generateMerchantKey } from './normalizer';

/**
 * Generate a fingerprint for duplicate detection.
 * Uses mode + date + amount + normalized description.
 */
export function generateFingerprint(mode: string, date: string | null, amount: number, normalizedDescription: string): string {
  return `${mode}|${date || ''}|${amount}|${normalizedDescription}`.toLowerCase();
}

type DupRow = { date: string | null; amount: number; description_normalized: string };
type DupExisting = DupRow & { id: string };

function tokenize(s: string): Set<string> {
  return new Set(
    (s || '')
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(t => t.length >= 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function daysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

/**
 * Check for near-duplicate. Returns true if rows are likely the same charge.
 * Strategy:
 *   1. Same amount (within 1¢) AND date within `dayRange` days
 *   2. Then ANY of: identical description, ≥70% shared prefix, ≥0.6 Jaccard token overlap,
 *      or matching merchant key.
 */
export function isNearDuplicate(
  tx: DupRow,
  existing: DupExisting,
  dayRange: number = 3
): boolean {
  if (Math.abs(tx.amount - existing.amount) > 0.01) return false;

  const dDays = daysBetween(tx.date, existing.date);
  // If both dates exist, enforce window. If one is null, allow but require stronger desc match.
  if (tx.date && existing.date && dDays > dayRange) return false;

  const a = (tx.description_normalized || '').toUpperCase().trim();
  const b = (existing.description_normalized || '').toUpperCase().trim();
  if (!a && !b) return true; // both blank, same date+amount → call it a dup
  if (a === b) return true;

  // Prefix overlap
  const minLen = Math.min(a.length, b.length);
  if (minLen > 0) {
    let shared = 0;
    for (let i = 0; i < minLen; i++) {
      if (a[i] === b[i]) shared++;
      else break;
    }
    if (shared / minLen >= 0.7) return true;
  }

  // Token overlap
  if (jaccard(tokenize(a), tokenize(b)) >= 0.6) return true;

  // Merchant key match (catches "JPMORGAN CHASE 12345 STARBUCKS" vs "STARBUCKS #4421")
  const ka = generateMerchantKey(a);
  const kb = generateMerchantKey(b);
  if (ka && kb && ka === kb && ka.length >= 4) return true;

  return false;
}

export type DuplicateCluster = {
  kind: 'exact' | 'near';
  rowIds: string[]; // sorted: oldest (kept) first
};

type ClusterRow = DupExisting & { fingerprint: string; created_at?: string | null };

/**
 * Find groups of rows sharing the exact same fingerprint.
 */
export function findExactClusters(rows: ClusterRow[]): DuplicateCluster[] {
  const byFp = new Map<string, ClusterRow[]>();
  for (const r of rows) {
    if (!r.fingerprint) continue;
    const list = byFp.get(r.fingerprint) || [];
    list.push(r);
    byFp.set(r.fingerprint, list);
  }
  const clusters: DuplicateCluster[] = [];
  for (const list of byFp.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    clusters.push({ kind: 'exact', rowIds: list.map(r => r.id) });
  }
  return clusters;
}

/**
 * Find pairs/clusters of likely-duplicate rows (excluding already-exact clusters).
 * Buckets by amount to avoid O(n²) blow-up.
 */
export function findNearClusters(
  rows: ClusterRow[],
  excludeIds: Set<string>,
  dayRange: number = 1
): DuplicateCluster[] {
  const candidates = rows.filter(r => !excludeIds.has(r.id));
  // Bucket by rounded amount (cents) for cheap pruning
  const buckets = new Map<number, ClusterRow[]>();
  for (const r of candidates) {
    const k = Math.round(r.amount * 100);
    const list = buckets.get(k) || [];
    list.push(r);
    buckets.set(k, list);
  }

  // Union-find for clustering
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) || x;
    while (p !== (parent.get(p) || p)) p = parent.get(p) || p;
    parent.set(x, p);
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const compare = (a: ClusterRow, b: ClusterRow) => {
    if (isNearDuplicate(a, b, dayRange)) {
      parent.set(a.id, parent.get(a.id) || a.id);
      parent.set(b.id, parent.get(b.id) || b.id);
      union(a.id, b.id);
    }
  };

  for (const [cents, list] of buckets.entries()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        compare(list[i], list[j]);
      }
    }
    // isNearDuplicate tolerates a 1-cent difference, which always lands in the
    // neighboring bucket — probe it or 12.00 vs 12.01 never get compared.
    const next = buckets.get(cents + 1);
    if (next) {
      for (const a of list) {
        for (const b of next) {
          compare(a, b);
        }
      }
    }
  }

  // Collect groups
  const groups = new Map<string, ClusterRow[]>();
  const idToRow = new Map(candidates.map(r => [r.id, r]));
  for (const id of parent.keys()) {
    const root = find(id);
    const list = groups.get(root) || [];
    const row = idToRow.get(id);
    if (row) list.push(row);
    groups.set(root, list);
  }
  const clusters: DuplicateCluster[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Recurring-pattern guard: a genuine re-imported duplicate lands on the SAME
    // date (same charge captured twice from overlapping statements). If every row
    // in the group is on a different date, it's a recurring charge (daily transit,
    // repeat same-amount merchant), not a duplicate — drop it. We require at least
    // one date to be shared by 2+ rows.
    const dateCounts = new Map<string, number>();
    for (const r of list) {
      const d = r.date || '';
      dateCounts.set(d, (dateCounts.get(d) || 0) + 1);
    }
    const hasSharedDate = [...dateCounts.values()].some(c => c >= 2);
    if (!hasSharedDate) continue;
    list.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || ''));
    clusters.push({ kind: 'near', rowIds: list.map(r => r.id) });
  }
  return clusters;
}
