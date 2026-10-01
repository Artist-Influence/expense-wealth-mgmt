import { describe, it, expect } from 'vitest';
import { isRefund, signedSpend } from '@/lib/spend';

describe('signedSpend', () => {
  it('counts a purchase as positive spend', () => {
    expect(signedSpend({ amount: 209, treatment_type: 'expense' })).toBe(209);
    expect(signedSpend({ amount: '209.00', treatment_type: null })).toBe(209);
  });

  it('counts a refund as negative so it nets against the purchase', () => {
    const rows = [
      { amount: 209, treatment_type: 'expense' }, // CLEAR charge
      { amount: 209, treatment_type: 'refund' }, // BAL ADJ/CLEAR
    ];
    expect(rows.reduce((s, r) => s + signedSpend(r), 0)).toBe(0);
  });

  it('treats stored sign as irrelevant: amounts are magnitudes', () => {
    expect(signedSpend({ amount: -50, treatment_type: 'refund' })).toBe(-50);
    expect(signedSpend({ amount: -50, treatment_type: 'expense' })).toBe(50);
    expect(signedSpend({ amount: null })).toBe(0);
  });

  it('identifies refunds by treatment_type only', () => {
    expect(isRefund({ treatment_type: 'refund' })).toBe(true);
    expect(isRefund({ treatment_type: 'credit_card_payment' })).toBe(false);
    expect(isRefund({})).toBe(false);
  });
});
