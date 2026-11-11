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

describe('routeTransaction money in on BoA checking (no signal columns)', () => {
  it('routes a positive ACH line to income even with no income keyword', () => {
    expect(routeTransaction({ signedAmount: 8000, description: 'DUB (ECFI) DES:ACH ID:XXXXXXXXXX7229 INDN:JARED R CO' }).route).toBe('income');
    expect(routeTransaction({ signedAmount: 500, description: 'VENMO DES:CASHOUT ID:1050730816122 INDN:JARED R CO' }).route).toBe('income');
  });

  it('keeps the same ACH line as an expense when money goes out', () => {
    expect(routeTransaction({ signedAmount: -2000, description: 'DUB (ECFI) DES:ACH ID:XXXXXXXXXX7229 INDN:JARED R CO' }).route).toBe('expense');
  });

  it('leaves card purchases (no ACH tags) alone', () => {
    expect(routeTransaction({ signedAmount: 275.6, description: 'TCGPLAYER.COM 3155010478 NY' }).route).toBe('expense');
  });
});

// ── 2026-11: card payments and credits that were imported as spending ──────
import { detectCardSign } from '@/lib/transaction-router';
import { detectTransfer as detectTransferNov } from '@/lib/transfer-detector';
import { isStatementArtifact } from '@/lib/csv-parser';

describe('card payments are transfers, not spending', () => {
  const pay = (d: string) => detectTransferNov(d);
  it.each([
    'ORIG CO NAME:AMERICAN EXPRESS ORIG ID:2005032111 DESC DATE:261110 CO ENTRY DESCR:ACH PMT SEC:CCD',
    'ORIG CO NAME:Karat Financial ORIG ID:9814210001 DESC DATE: CO ENTRY DESCR:PAYMENT',
    'AMERICAN EXPRESS DES:RETRY PYMT ID:M1234 INDN:Jared Rapoza CO ID:1133133497 WEB',
    'AMERICAN EXPRESS DES:ACH PMT ID:M4316 INDN:Jared Rapoza CO ID:1133133497 WEB',
    'Mobile Banking payment to CRD 6248 Confirmation# x1fb2qnon',
    'PAYMENT FROM CHK 5373 CONF#x1fb2qnon',
    'MODERN_TREASURY_PAYMENT',
  ])('%s', (d) => {
    const r = pay(d);
    expect(r.isTransfer).toBe(true);
    expect(r.transferType).toBe('credit_card_payment');
    expect(r.transferConfidence).toBe('high');
  });
  it('does not flag an ordinary Amex-branded purchase', () => {
    expect(pay('AMERICAN EXPRESS TVLPHOENIX AZ').isTransfer).toBe(false);
    expect(pay('AMEX TRAVEL PAY WITH POINTS').isTransfer).toBe(false);
  });
});

describe('card files route by their own sign convention', () => {
  it('detects Amex (purchases positive) and BoA/Karat (purchases negative)', () => {
    expect(detectCardSign([{ amount: 19.58, description: 'AMAZON' }, { amount: 12, description: 'UBER' }, { amount: -650, description: 'AMAZON PAY WITH POINTS CREDIT' }])).toBe('charges_positive');
    expect(detectCardSign([{ amount: -212.5, description: 'ANTHROPIC' }, { amount: -212.5, description: 'OPENAI' }, { amount: 425, description: 'MODERN_TREASURY_PAYMENT' }])).toBe('charges_negative');
  });
  it('lets a payment row settle a tiny file', () => {
    expect(detectCardSign([{ amount: 40, description: 'UBER' }, { amount: -40, description: 'MOBILE PAYMENT - THANK YOU' }])).toBe('charges_positive');
    expect(detectCardSign([{ amount: -40, description: 'UBER' }, { amount: 40, description: 'PAYMENT FROM CHK 5373 CONF#abc' }])).toBe('charges_negative');
    expect(detectCardSign([])).toBeNull();
  });
  const route = (d: string, a: number, cardSign: 'charges_positive' | 'charges_negative', row: Record<string, unknown> = {}) =>
    routeTransaction({ signedAmount: a, description: d, sourceRow: { Description: d, Amount: String(a), ...row }, cardSign }).route;
  it('Amex: statement credits are refunds, payments are transfers, purchases stay expenses', () => {
    expect(route('AMAZON PAY WITH POINTS CREDIT', -650, 'charges_positive')).toBe('refund');
    expect(route('Platinum Resy Credit', -100, 'charges_positive')).toBe('refund');
    expect(route('WHOP*CONTENTREWARDSHSAN JOSE', -1026.06, 'charges_positive')).toBe('refund');
    expect(route('MOBILE PAYMENT - THANK YOU', -4362.56, 'charges_positive')).toBe('cc_payment_transfer');
    expect(route('INTEREST CHARGE REFUND DEPOSIT STORE', 25, 'charges_positive')).toBe('expense');
  });
  it('Karat and BoA card: payment received is a transfer, purchases stay expenses', () => {
    expect(route('MODERN_TREASURY_PAYMENT', 425, 'charges_negative')).toBe('cc_payment_transfer');
    expect(route('PAYMENT FROM CHK 5373 CONF#x1fb2qnon', 255.18, 'charges_negative')).toBe('cc_payment_transfer');
    expect(route('ANTHROPIC* CLAUDE SUB CA US', -212.5, 'charges_negative')).toBe('expense');
    expect(route('INTEREST CHARGED ON PURCHASES', -3.9, 'charges_negative')).toBe('expense');
  });
  it('Chase card: a positive Adjustment is a credit, a negative one is a charge', () => {
    expect(route('PADDLE.NET* DECODO', 31.57, 'charges_negative', { Type: 'Adjustment' })).toBe('refund');
    expect(route('PADDLE.NET* DECODO', -31.57, 'charges_negative', { Type: 'Adjustment' })).toBe('expense');
    expect(route('Payment Thank You - Web', 8000, 'charges_negative', { Type: 'Payment' })).toBe('cc_payment_transfer');
  });
});

describe('bank rows that were saved as spending', () => {
  it('a Chase DSLIP deposit is income', () => {
    const r = routeTransaction({ signedAmount: 5000, description: 'ORIG CO NAME:P40682AMIGO RECO ORIG ID:6127740682', sourceRow: { Details: 'DSLIP', Type: 'DEPOSIT', Amount: '5000.00' } });
    expect(r.route).toBe('income');
  });
  it('money back from a brokerage goes down the income path (withdrawal capture)', () => {
    const r = routeTransaction({ signedAmount: 3726, description: 'Transfer WEALTHFRONT BROKERAGE LLC', sourceRow: { Date: '10/09/2026', Amount: '3,726.00' } });
    expect(r.route).toBe('income');
    const out = routeTransaction({ signedAmount: -2000, description: 'Wealthfront DES:EDI PYMNTS ID:9003 INDN:Jared Rapoza', sourceRow: { Date: '09/28/2026', Amount: '-2,000.00' } });
    expect(out.route).toBe('expense');
  });
  it('a real card interest line is not a statement artifact, summary lines still are', () => {
    expect(isStatementArtifact('INTEREST CHARGED ON PURCHASES', -3.9)).toBe(false);
    expect(isStatementArtifact('Interest Charge', 0)).toBe(true);
    expect(isStatementArtifact('Finance Charges', 12)).toBe(true);
  });
});
