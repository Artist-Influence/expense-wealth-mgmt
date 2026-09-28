import { describe, it, expect } from 'vitest';
import { assignContributions, realGrowth, type ContributionTx } from '@/lib/account-growth';

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
