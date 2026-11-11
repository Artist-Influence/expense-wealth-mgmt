/**
 * Sign-aware transaction router.
 *
 * Decides where a parsed CSV row really belongs based on the SIGNED amount
 * and any source-CSV signal columns (Details, Type) that the bank kept in
 * source_row_json. Used at import time and in the backfill migration script.
 */

import { classifyIncome, type IncomeClassification } from './income-classifier';
import { detectTransfer } from './transfer-detector';

export type TransactionRoute =
  | { route: 'expense'; signedAmount: number }
  | { route: 'income'; signedAmount: number; income: IncomeClassification }
  | { route: 'cc_payment_transfer'; signedAmount: number }
  | { route: 'refund'; signedAmount: number };

/**
 * Which way a CREDIT CARD file signs its purchases. Amex exports purchases as
 * positive numbers and credits as negative; BoA and Karat do the opposite.
 * The importer stores absolute amounts, so without this every Amex statement
 * credit and every Karat "payment received" line was saved as a purchase.
 */
export type CardSign = 'charges_positive' | 'charges_negative';

interface RouterInput {
  signedAmount: number;
  description: string;
  sourceRow?: Record<string, unknown> | null;
  /** Set only when the file belongs to a credit-card payment method. */
  cardSign?: CardSign | null;
}

/**
 * Decide a card file's sign convention from its rows.
 *  1. A recognizable card PAYMENT is always a credit, so its sign settles it
 *     (matters for tiny files: one purchase + one payment).
 *  2. Otherwise purchases outnumber credits on a statement, so the majority
 *     sign is the purchase sign.
 * Returns null when the file has no signed rows to judge.
 */
export function detectCardSign(rows: { amount: number; description: string }[]): CardSign | null {
  let pos = 0, neg = 0, payPos = 0, payNeg = 0;
  for (const r of rows) {
    if (r.amount > 0) pos++; else if (r.amount < 0) neg++; else continue;
    if (detectTransfer(r.description || '').transferType === 'credit_card_payment') {
      if (r.amount > 0) payPos++; else payNeg++;
    }
  }
  if (pos === 0 && neg === 0) return null;
  if (payPos !== payNeg) return payPos > payNeg ? 'charges_negative' : 'charges_positive';
  return pos > neg ? 'charges_positive' : 'charges_negative';
}

/**
 * Heuristic: sender-like description signals an inflow even when no
 * Details/Type column exists in the source CSV.
 */
const INCOME_DESCRIPTION_HINTS = /\b(deposit|payroll|direct\s*deposit|salary|wages|paycheck|payment\s*from|received\s*from|zelle\s*from|venmo\s*from|paypal\s*from|refund|return|reimburs\w*|interest|dividend|cashback|cash\s*back|stripe\s*payout|square\s*deposit|tax\s*refund|deel|gusto|adp|paychex|justworks|rippling|trinet|oasis|onpay|bamboohr)\b|SALARY[-\s]|PAYMENTS\s*ID:/i;

const BALANCE_ADJUSTMENT = /^\s*BAL(ANCE)?\s*ADJ\b/i;
const ACH_LINE = /\bDES:.*\bINDN:/i;

function readField(row: Record<string, unknown> | null | undefined, key: string): string {
  if (!row) return '';
  const v = row[key];
  return v == null ? '' : String(v).trim();
}

export function routeTransaction(input: RouterInput): TransactionRoute {
  const { signedAmount, description, sourceRow, cardSign } = input;
  const details = readField(sourceRow, 'Details').toUpperCase(); // CREDIT | DEBIT | DSLIP (checking)
  const type = readField(sourceRow, 'Type'); // Sale | Return | Payment (CC) or ACH_CREDIT (checking)

  // DSLIP = a deposit slip line on a Chase checking export. It is money in,
  // same as CREDIT; treating it as "not a checking row" saved deposits as spend.
  const isCheckingCsv = details === 'CREDIT' || details === 'DEBIT' || details === 'DSLIP';
  const isCcCsv = ['Sale', 'Return', 'Payment', 'Adjustment', 'Fee'].includes(type);

  // 1. Credit-card "Payment Thank You" → transfer (paying the card from another account).
  if (isCcCsv && type === 'Payment') {
    return { route: 'cc_payment_transfer', signedAmount };
  }

  // 2. Credit-card "Return" → refund (reduces spend, not income).
  if (isCcCsv && type === 'Return') {
    return { route: 'refund', signedAmount };
  }

  // 2b. Card balance adjustments ("BAL ADJ/CLEAR *CLEARME.COM") are merchant
  // credits. BoA card exports have no Type column, so these were imported as a
  // second purchase instead of a refund.
  if (!isCheckingCsv && BALANCE_ADJUSTMENT.test(description)) {
    return { route: 'refund', signedAmount };
  }

  // 2c. Credit-card files, judged by the file's own sign convention. A row
  // signed the opposite way from purchases is money coming back to the card:
  // a payment (transfer) or a statement credit / merchant refund. Card rows
  // never fall through to the income heuristics below.
  if (cardSign && !isCheckingCsv) {
    const isCredit = cardSign === 'charges_positive' ? signedAmount < 0 : signedAmount > 0;
    if (isCredit) {
      const t = detectTransfer(description);
      const isPayment = t.transferType === 'credit_card_payment' || /\bPAYMENT\b.*\b(THANK|RECEIVED)\b/i.test(description);
      return { route: isPayment ? 'cc_payment_transfer' : 'refund', signedAmount };
    }
    return { route: 'expense', signedAmount };
  }

  // 3. Checking deposit → income.
  if (isCheckingCsv && (details === 'CREDIT' || details === 'DSLIP') && signedAmount > 0) {
    return {
      route: 'income',
      signedAmount,
      income: classifyIncome(description),
    };
  }

  // 3b. A positive ACH line ("... DES:... INDN:...", BoA checking format; card
  // lines never carry these tags) is money IN even without an income keyword.
  // Without this, a Venmo cash-out or a Dub withdrawal was saved as spending,
  // and the Wealth page then counted the Dub one as a deposit.
  if (!isCheckingCsv && !isCcCsv && signedAmount > 0 && ACH_LINE.test(description)) {
    return {
      route: 'income',
      signedAmount,
      income: classifyIncome(description),
    };
  }

  // 3c. Money coming BACK from a brokerage into a bank account with no
  // Details column (BoA: "Transfer WEALTHFRONT BROKERAGE LLC", positive). Sent
  // down the income path so the withdrawal capture logs it on Wealth; as an
  // expense row it was stored as a brokerage transfer and counted as a deposit.
  if (!isCheckingCsv && !isCcCsv && signedAmount > 0 && detectTransfer(description).transferType === 'brokerage_transfer') {
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
