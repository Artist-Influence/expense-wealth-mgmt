import { describe, it, expect } from 'vitest';
import { accountMatcher, assignContributions, planWithdrawals, realGrowth, type ContributionTx } from '@/lib/account-growth';

const tx = (date: string, amount: number, desc: string, tag: string | null = null): ContributionTx => ({
  date,
  amount,
  description_normalized: desc.toLowerCase(),
  description_raw: desc,
  client_or_project_tag: tag,
});

describe('realGrowth', () => {
  it('does not count deposits as growth', () => {
    // S&P 500 card: $5,898 on Jan 1, $18,197 today, $10,150 deposited in between.
    const g = realGrowth(
      [{ date: '2026-01-01', value: 5898 }, { date: '2026-09-28', value: 18197 }],
      [{ date: '2026-03-03', amount: 2000 }, { date: '2026-04-06', amount: 3500 }, { date: '2026-06-22', amount: 4650 }],
    );
    expect(g.deposits).toBe(10150);
    expect(g.gain).toBe(2149);
    // Modified Dietz: late deposits count for less invested capital than the Jan 1 balance.
    expect(g.returnPct!).toBeGreaterThan((2149 / (5898 + 10150)) * 100);
    expect(g.returnPct!).toBeLessThan((2149 / 5898) * 100);
  });

  it('treats a deposit on the start date as already in the start balance', () => {
    // Wealthfront HSA: funded 7/31 and first snapshot taken 7/31.
    const g = realGrowth(
      [{ date: '2026-07-31', value: 1715.88 }, { date: '2026-09-28', value: 1721 }],
      [{ date: '2026-07-31', amount: 1705 }],
    );
    expect(g.deposits).toBe(0);
    expect(g.gain).toBeCloseTo(5.12, 2);
  });

  it('ignores deposits after the latest point', () => {
    const g = realGrowth(
      [{ date: '2026-01-01', value: 1000 }, { date: '2026-06-01', value: 1100 }],
      [{ date: '2026-07-01', amount: 500 }],
    );
    expect(g.gain).toBe(100);
    expect(g.returnPct).toBeCloseTo(10, 5);
  });

  it('weights a mid-window deposit at half', () => {
    const g = realGrowth(
      [{ date: '2026-01-01', value: 1000 }, { date: '2026-01-21', value: 1300 }],
      [{ date: '2026-01-11', amount: 200 }],
    );
    expect(g.gain).toBe(100);
    expect(g.returnPct).toBeCloseTo((100 / 1100) * 100, 5);
  });

  it('subtracts an undated YTD total in full when the window starts Jan 1', () => {
    const g = realGrowth([{ date: '2026-01-01', value: 1000 }, { date: '2026-12-31', value: 2500 }], null, 1200);
    expect(g.deposits).toBe(1200);
    expect(g.gain).toBe(300);
  });

  it('counts only undated deposits beyond the opening balance when the window starts mid-year', () => {
    const g = realGrowth([{ date: '2026-07-02', value: 1000 }, { date: '2026-12-31', value: 1700 }], null, 1200);
    expect(g.deposits).toBe(200);
    expect(g.gain).toBe(500);
  });

  it('does not invent deposits for an account opened mid-year with no dated transfers', () => {
    // Wealthfront HSA before its transfer is tagged: $1,705 YTD, opened with it on 7/31.
    const g = realGrowth([{ date: '2026-07-31', value: 1715.88 }, { date: '2026-09-28', value: 1721 }], null, 1705);
    expect(g.deposits).toBe(0);
    expect(g.gain).toBeCloseTo(5.12, 2);
  });

  it('does not count a withdrawal as a loss', () => {
    // Dub: $11,756 on Jan 1, $7,900 deposited, $8,000 pulled out 9/30 for the move.
    const points = [{ date: '2026-01-01', value: 11756 }, { date: '2026-10-01', value: 31945 - 8000 }];
    const deposits = [{ date: '2026-02-03', amount: 2000 }, { date: '2026-04-07', amount: 5900 }];
    const g = realGrowth(points, deposits, 0, [{ date: '2026-09-30', amount: 8000 }]);
    expect(g.withdrawn).toBe(8000);
    expect(g.gain).toBe(31945 - 11756 - 7900); // same gain as if nothing was withdrawn
    expect(g.returnPct!).toBeGreaterThan(0);
  });

  it('only nets withdrawals inside the window', () => {
    const points = [{ date: '2026-07-31', value: 1000 }, { date: '2026-09-01', value: 900 }];
    const g = realGrowth(points, [], 0, [
      { date: '2026-07-31', amount: 50 }, // already reflected in the start balance
      { date: '2026-08-15', amount: 100 },
      { date: '2026-09-15', amount: 75 }, // after the latest point
    ]);
    expect(g.withdrawn).toBe(100);
    expect(g.gain).toBe(0);
  });

  it('nets withdrawals for manual accounts with an undated YTD total', () => {
    const g = realGrowth(
      [{ date: '2026-01-01', value: 1000 }, { date: '2026-12-31', value: 1700 }],
      null,
      1200,
      [{ date: '2026-06-01', amount: 600 }],
    );
    expect(g.gain).toBe(1700 - 1000 - 1200 + 600);
  });

  it('shows zero with a single point', () => {
    const g = realGrowth([{ date: '2026-09-28', value: 1865 }], null, 0);
    expect(g.gain).toBe(0);
    expect(g.returnPct).toBe(0);
  });
});

describe('assignContributions', () => {
  const accounts = [
    { id: 'sp', account_name: 'S&P 500', auto_track_pattern: 'wealthfront' },
    { id: 'hsa', account_name: 'Wealthfront HSA', auto_track_pattern: null },
    { id: 'dub', account_name: 'Dub (Custom ETFs)', auto_track_pattern: 'dub ecfi' },
    { id: 'poke', account_name: 'Collectr', auto_track_pattern: 'tcgplayer|pokemon' },
  ];

  it('matches multi-word tokens like the ILIKE filter does', () => {
    const flows = assignContributions([tx('2026-02-03', 2000, 'DUB (ECFI) DES:ACH ID:XXXX INDN:JARED')], accounts);
    expect(flows.get('dub')).toEqual([{ date: '2026-02-03', amount: 2000 }]);
  });

  it('routes a transfer tagged with an account name to that account only', () => {
    const flows = assignContributions(
      [
        tx('2026-07-06', 900, 'Wealthfront DES:EDI PYMNTS ID:4F74'),
        tx('2026-07-31', 1705, 'Wealthfront DES:EDI PYMNTS ID:807E', 'Wealthfront HSA'),
      ],
      accounts,
    );
    expect(flows.get('sp')).toEqual([{ date: '2026-07-06', amount: 900 }]);
    expect(flows.get('hsa')).toEqual([{ date: '2026-07-31', amount: 1705 }]);
  });

  it('counts each transfer once even when two patterns match, most specific wins', () => {
    const accts = [
      { id: 'broad', account_name: 'Dub', auto_track_pattern: 'dub' },
      { id: 'exact', account_name: 'Dub ETFs', auto_track_pattern: 'dub ecfi' },
    ];
    const flows = assignContributions([tx('2026-05-05', 1000, 'DUB (ECFI) DES:ACH')], accts);
    expect(flows.get('exact')).toHaveLength(1);
    expect(flows.has('broad')).toBe(false);
  });

  it('ignores tags that are not account names and unmatched rows', () => {
    const flows = assignContributions(
      [tx('2026-05-08', 490, 'Zelle payment to CHUI WONG for "Pokemon Sealed"', 'tulum'), tx('2026-05-09', 60, 'CHIPOTLE')],
      accounts,
    );
    expect(flows.get('poke')).toEqual([{ date: '2026-05-08', amount: 490 }]);
    expect([...flows.values()].flat()).toHaveLength(1);
  });
});

describe('accountMatcher', () => {
  const match = accountMatcher([
    { id: 'dub', account_name: 'Dub (Custom ETFs)', auto_track_pattern: 'dub ecfi' },
    { id: 'gem', account_name: 'Gemini', auto_track_pattern: 'gemini' },
  ]);

  it('finds the account a Dub withdrawal came out of', () => {
    expect(match({ description_raw: 'DUB (ECFI) DES:ACH ID:XXXX INDN:JARED R CO', description_normalized: null })).toBe('dub');
  });

  it('returns null for unrelated credits', () => {
    expect(match({ description_raw: 'VENMO DES:CASHOUT ID:1050 INDN:JARED R CO', description_normalized: null })).toBeNull();
  });
});

describe('planWithdrawals', () => {
  const w = (date: string, amount: number, account_id = 'dub') => ({ account_id, date, amount });

  it('skips withdrawals already logged (re-import, or the same file on both pages)', () => {
    expect(planWithdrawals([w('2026-09-30', 8000)], [w('2026-09-30', 8000)])).toEqual([]);
  });

  it('keeps a second identical same-day withdrawal that is not logged yet', () => {
    expect(planWithdrawals([w('2026-09-30', 500), w('2026-09-30', 500)], [w('2026-09-30', 500)])).toEqual([w('2026-09-30', 500)]);
  });

  it('treats amounts at cent precision and accounts separately', () => {
    expect(planWithdrawals([w('2026-09-30', 8000.004), w('2026-09-30', 8000, 'gem')], [w('2026-09-30', 8000)])).toEqual([w('2026-09-30', 8000, 'gem')]);
  });
});
