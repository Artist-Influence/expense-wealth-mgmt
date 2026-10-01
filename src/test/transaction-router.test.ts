import { describe, it, expect } from 'vitest';
import { routeTransaction } from '@/lib/transaction-router';

describe('routeTransaction refunds', () => {
  it('routes a BoA card balance adjustment (no Type column) to refund', () => {
    expect(routeTransaction({ signedAmount: 209, description: 'BAL ADJ/CLEAR *CLEARME.COM' }).route).toBe('refund');
    expect(routeTransaction({ signedAmount: -209, description: 'BAL ADJ/CLEAR *CLEARME.C OM' }).route).toBe('refund');
  });

  it('keeps the original CLEAR charge an expense', () => {
    expect(routeTransaction({ signedAmount: -209, description: 'CLEAR *CLEARME.COM NEW YORK NY' }).route).toBe('expense');
  });

  it('still routes a Chase card Return to refund', () => {
    const r = routeTransaction({ signedAmount: 50, description: 'AMAZON MKTPL', sourceRow: { Type: 'Return' } });
    expect(r.route).toBe('refund');
  });

  it('does not treat a checking-account line as a card adjustment', () => {
    const r = routeTransaction({ signedAmount: -20, description: 'BAL ADJ FEE', sourceRow: { Details: 'DEBIT' } });
    expect(r.route).toBe('expense');
  });
});
