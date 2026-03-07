import type { ParsedTransaction } from './csv-parser';

/**
 * Generate a fingerprint for duplicate detection.
 * Uses mode + date + amount + normalized description.
 */
export function generateFingerprint(mode: string, date: string | null, amount: number, normalizedDescription: string): string {
  return `${mode}|${date || ''}|${amount}|${normalizedDescription}`.toLowerCase();
}

/**
 * Check for near-duplicate: same mode + amount + similar description + date within dayRange days.
 */
export function isNearDuplicate(
  tx: { date: string | null; amount: number; description_normalized: string },
  existing: { date: string | null; amount: number; description_normalized: string; id: string },
  dayRange: number = 3
): boolean {
  if (Math.abs(tx.amount - existing.amount) > 0.01) return false;
  
  // Check date proximity
  if (tx.date && existing.date) {
    const d1 = new Date(tx.date).getTime();
    const d2 = new Date(existing.date).getTime();
    const diffDays = Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
    if (diffDays > dayRange) return false;
  }
  
  // Check description similarity (simple: shared prefix of 80%+)
  const a = tx.description_normalized.toUpperCase();
  const b = existing.description_normalized.toUpperCase();
  if (a === b) return true;
  
  const minLen = Math.min(a.length, b.length);
  if (minLen === 0) return false;
  
  let shared = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) shared++;
    else break;
  }
  
  return shared / minLen >= 0.7;
}
