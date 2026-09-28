/**
 * Deposit-adjusted ("real") growth for an investment account card.
 *
 * A balance going from $5,898 to $18,197 isn't +208% growth when $10k of that
 * was new deposits. Real gain = end − start − deposits made inside the window,
 * and the % uses Modified Dietz so money deposited last month isn't treated as
 * if it had been invested since January.
 */

export type Flow = { date: string; amount: number };
export type BalancePoint = { date: string; value: number };

export type ContributionTx = {
  date: string;
  amount: number | string | null;
  description_normalized: string | null;
  description_raw: string | null;
  client_or_project_tag: string | null;
};

export type TrackedAccount = {
  id: string;
  account_name: string;
  auto_track_pattern: string | null;
};

const DAY_MS = 24 * 3600 * 1000;
const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY_MS;

export function realGrowth(
  points: BalancePoint[],
  // Dated deposits (auto-tracked accounts), or null when all we have is an undated YTD total.
  flows: Flow[] | null,
  undatedDepositsYtd = 0,
): { deposits: number; gain: number; returnPct: number | null } {
  const start = points[0];
  const end = points[points.length - 1];
  const t0 = dayNum(start.date);
  const t1 = dayNum(end.date);
  const span = t1 - t0;

  // [amount, weight] pairs; weight = share of the window the money was invested.
  let inWindow: Array<[number, number]> = [];
  if (flows) {
    // A deposit dated on the start day is already inside the start balance.
    inWindow = flows
      .filter(f => dayNum(f.date) > t0 && dayNum(f.date) <= t1)
      .map(f => [f.amount, span > 0 ? (t1 - dayNum(f.date)) / span : 1]);
  } else if (undatedDepositsYtd > 0 && span > 0) {
    // No dates, only a YTD total (invested for ~half the window). From Jan 1 it
    // all counts. A first point mid-year usually means the account was opened
    // then, so its opening balance is mostly this year's deposits: count only
    // what went in beyond it.
    const yearStart = dayNum(`${end.date.slice(0, 4)}-01-01`);
    const after = t0 <= yearStart ? undatedDepositsYtd : Math.max(0, undatedDepositsYtd - start.value);
    inWindow = [[after, 0.5]];
  }

  const deposits = inWindow.reduce((s, [amt]) => s + amt, 0);
  const gain = end.value - start.value - deposits;
  const investedBase = start.value + inWindow.reduce((s, [amt, w]) => s + amt * w, 0);
  const returnPct = investedBase > 0 ? (gain / investedBase) * 100 : null;
  return { deposits, gain, returnPct };
}

/** Words of one auto_track_pattern token, in order: "DUB (ECFI)" → ["DUB", "ECFI"]. */
export function patternWords(token: string): string[] {
  return token
    .replace(/[%,().]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean);
}

// Same semantics as the ILIKE '%word1%word2%' filter the query uses.
function tokenRegex(words: string[]): RegExp {
  const parts = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.'));
  return new RegExp(parts.join('.*'), 'is');
}

/**
 * Routes each bank transfer to exactly ONE account, so two accounts on the same
 * platform can't both count it (a "wealthfront" pattern matches transfers to
 * every Wealthfront account). A tag naming an account wins outright; otherwise
 * the most specific (longest) matching pattern token wins.
 */
export function assignContributions(
  txs: ContributionTx[],
  accounts: TrackedAccount[],
): Map<string, Flow[]> {
  const idByName = new Map(accounts.map(a => [a.account_name.trim().toLowerCase(), a.id]));
  const matchers = accounts.flatMap(a =>
    (a.auto_track_pattern || '')
      .split('|')
      .map(patternWords)
      .filter(words => words.length > 0)
      .map(words => ({ id: a.id, re: tokenRegex(words), specificity: words.join(' ').length })),
  );

  const out = new Map<string, Flow[]>();
  for (const tx of txs) {
    let id = (tx.client_or_project_tag || '')
      .split(',')
      .map(t => idByName.get(t.trim().toLowerCase()))
      .find(Boolean);
    if (!id) {
      let best = -1;
      for (const m of matchers) {
        if (m.specificity <= best) continue;
        if (m.re.test(tx.description_normalized || '') || m.re.test(tx.description_raw || '')) {
          best = m.specificity;
          id = m.id;
        }
      }
    }
    if (!id) continue;
    const list = out.get(id) ?? [];
    list.push({ date: tx.date, amount: Math.abs(Number(tx.amount || 0)) });
    out.set(id, list);
  }
  return out;
}
