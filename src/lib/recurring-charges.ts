/**
 * Recurring-charge candidate computation.
 *
 * Pure, shared logic used by both the Insights "Recurring Charges" section and the
 * dedicated Subscriptions page so they always produce the exact same candidate list.
 *
 * A merchant qualifies as a candidate when it has ≥ 3 approved charges. The cadence is
 * inferred from the average gap between the first and last charge. The `merchantKey` is
 * the stable grouping key (first 40 chars of the normalized/raw description) and is also
 * what `recurring_overrides.merchant_key` stores.
 */

export interface RecurringExpenseInput {
  date: string | null;
  amount: number | null;
  description_normalized: string | null;
  description_raw: string | null;
  final_category: string | null;
}

export interface RecurringCharge {
  /** Stable grouping key, also the value stored in recurring_overrides.merchant_key */
  merchantKey: string;
  /** Display name (same as merchantKey today, kept separate for future divergence) */
  name: string;
  avg: number;
  frequency: string;
  category: string;
  lastCharged: string;
  monthlyEstimate: number;
  count: number;
}

export function computeRecurringCharges(expenses: RecurringExpenseInput[]): RecurringCharge[] {
  const merchMap = new Map<string, { amounts: number[]; dates: string[]; category: string }>();
  expenses.forEach((t) => {
    if (!t.date) return;
    const desc = (t.description_normalized || t.description_raw || '').substring(0, 40);
    if (!desc) return;
    const existing = merchMap.get(desc) || { amounts: [], dates: [], category: '' };
    existing.amounts.push(Math.abs(t.amount || 0));
    existing.dates.push(t.date);
    existing.category = t.final_category || existing.category;
    merchMap.set(desc, existing);
  });

  return [...merchMap.entries()]
    .filter(([, data]) => data.amounts.length >= 3)
    .map(([name, data]) => {
      const avg = data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length;
      const sortedDates = [...data.dates].sort();
      const lastCharged = sortedDates[sortedDates.length - 1];
      const daySpan =
        (new Date(sortedDates[sortedDates.length - 1]).getTime() - new Date(sortedDates[0]).getTime()) /
        (1000 * 60 * 60 * 24);
      const avgDaysBetween = daySpan / (data.amounts.length - 1);
      let frequency = 'irregular';
      if (avgDaysBetween >= 25 && avgDaysBetween <= 35) frequency = 'monthly';
      else if (avgDaysBetween >= 6 && avgDaysBetween <= 8) frequency = 'weekly';
      else if (avgDaysBetween >= 13 && avgDaysBetween <= 16) frequency = 'biweekly';
      else if (avgDaysBetween >= 85 && avgDaysBetween <= 100) frequency = 'quarterly';
      else if (avgDaysBetween >= 350 && avgDaysBetween <= 380) frequency = 'annual';
      const monthlyEstimate =
        frequency === 'monthly'
          ? avg
          : frequency === 'weekly'
          ? avg * 4.3
          : frequency === 'biweekly'
          ? avg * 2.15
          : avg;
      return {
        merchantKey: name,
        name,
        avg: Math.round(avg * 100) / 100,
        frequency,
        category: data.category,
        lastCharged,
        monthlyEstimate: Math.round(monthlyEstimate * 100) / 100,
        count: data.amounts.length,
      };
    })
    .sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
}
