/**
 * Sign-aware transaction router.
 *
 * Decides where a parsed CSV row really belongs based on the SIGNED amount
 * and any source-CSV signal columns (Details, Type) that the bank kept in
 * source_row_json. Used at import time and in the backfill migration script.
 */

import { classifyIncome, type IncomeClassification } from './income-classifier';

export type TransactionRoute =
  | { route: 'expense'; signedAmount: number }
  | { route: 'income'; signedAmount: number; income: IncomeClassification }
  | { route: 'cc_payment_transfer'; signedAmount: number }
  | { route: 'refund'; signedAmount: number };

interface RouterInput {
  signedAmount: number;
  description: string;
  sourceRow?: Record<string, unknown> | null;
}

/**
 * Heuristic: sender-like description signals an inflow even when no
 * Details/Type column exists in the source CSV.
 */
const INCOME_DESCRIPTION_HINTS = /\b(deposit|payroll|direct deposit|payment from|received from|zelle from|venmo from|paypal from|refund|return|reimburs|interest|dividend|cashback|cash back|stripe payout|square deposit|tax refund)\b/i;

function readField(row: Record<string, unknown> | null | undefined, key: string): string {
  if (!row) return '';
  const v = row[key];
  return v == null ? '' : String(v).trim();
}

export function routeTransaction(input: RouterInput): TransactionRoute {
  const { signedAmount, description, sourceRow } = input;
  const details = readField(sourceRow, 'Details').toUpperCase(); // CREDIT | DEBIT (checking)
  const type = readField(sourceRow, 'Type'); // Sale | Return | Payment (CC) or ACH_CREDIT (checking)

  const isCheckingCsv = details === 'CREDIT' || details === 'DEBIT';
  const isCcCsv = ['Sale', 'Return', 'Payment'].includes(type);

  // 1. Credit-card "Payment Thank You" → transfer (paying the card from another account).
  if (isCcCsv && type === 'Payment') {
    return { route: 'cc_payment_transfer', signedAmount };
  }

  // 2. Credit-card "Return" → refund (reduces spend, not income).
  if (isCcCsv && type === 'Return') {
    return { route: 'refund', signedAmount };
  }

  // 3. Checking deposit → income.
  if (isCheckingCsv && details === 'CREDIT' && signedAmount > 0) {
    return {
      route: 'income',
      signedAmount,
      income: classifyIncome(description),
    };
  }

  // 4. Heuristic fallback: positive amount + sender-like description, no signal columns.
  if (!isCheckingCsv && !isCcCsv && signedAmount > 0 && INCOME_DESCRIPTION_HINTS.test(description)) {
    return {
      route: 'income',
      signedAmount,
      income: classifyIncome(description),
    };
  }

  // Default → expense (debit).
  return { route: 'expense', signedAmount };
}
