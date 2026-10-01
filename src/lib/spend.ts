/**
 * Every expense row is stored as a positive amount, refunds included. A refund
 * is money coming back, so it SUBTRACTS from spend and deductions: a $500
 * purchase plus its $500 refund nets to $0. Dropping refunds left the refunded
 * charge in every total, and the Tax page was adding them as extra deductions.
 */
export function isRefund(r: { treatment_type?: string | null }): boolean {
  return r.treatment_type === 'refund';
}

/** Signed contribution of one expense row to spend: refunds count negative. */
export function signedSpend(r: { amount: number | string | null; treatment_type?: string | null }): number {
  const amt = Math.abs(Number(r.amount) || 0);
  return isRefund(r) ? -amt : amt;
}
