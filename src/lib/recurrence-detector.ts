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
