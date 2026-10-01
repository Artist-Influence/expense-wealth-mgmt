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
  // Money taken out (always dated). Counted as negative flows: a withdrawal
  // lowers the balance without being a loss.
  withdrawals: Flow[] = [],
): { deposits: number; withdrawn: number; gain: number; returnPct: number | null } {
  const start = points[0];
  const end = points[points.length - 1];
  const t0 = dayNum(start.date);
  const t1 = dayNum(end.date);
  const span = t1 - t0;
  // A flow dated on the start day is already inside the start balance.
  const inSpan = (f: Flow) => dayNum(f.date) > t0 && dayNum(f.date) <= t1;
  const weight = (f: Flow) => (span > 0 ? (t1 - dayNum(f.date)) / span : 1);

  // [amount, weight] pairs; weight = share of the window the money was invested.
  let inWindow: Array<[number, number]> = [];
  if (flows) {
    inWindow = flows.filter(inSpan).map(f => [f.amount, weight(f)]);
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
  const outs = withdrawals.filter(inSpan);
  const withdrawn = outs.reduce((s, f) => s + f.amount, 0);
  inWindow.push(...outs.map((f): [number, number] => [-f.amount, weight(f)]));

  const gain = end.value - start.value - deposits + withdrawn;
  const investedBase = start.value + inWindow.reduce((s, [amt, w]) => s + amt * w, 0);
  const returnPct = investedBase > 0 ? (gain / investedBase) * 100 : null;
  return { deposits, withdrawn, gain, returnPct };
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

type MatchableTx = Pick<ContributionTx, 'description_normalized' | 'description_raw'> &
  Partial<Pick<ContributionTx, 'client_or_project_tag'>>;

/**
 * Picks the ONE account a bank transfer belongs to, so two accounts on the same
 * platform can't both count it (a "wealthfront" pattern matches transfers to
 * every Wealthfront account). A tag naming an account wins outright; otherwise
 * the most specific (longest) matching pattern token wins.
 */
export function accountMatcher(accounts: TrackedAccount[]): (tx: MatchableTx) => string | null {
  const idByName = new Map(accounts.map(a => [a.account_name.trim().toLowerCase(), a.id]));
  const matchers = accounts.flatMap(a =>
    (a.auto_track_pattern || '')
      .split('|')
      .map(patternWords)
      .filter(words => words.length > 0)
      .map(words => ({ id: a.id, re: tokenRegex(words), specificity: words.join(' ').length })),
  );
  return tx => {
    const tagged = (tx.client_or_project_tag || '')
      .split(',')
      .map(t => idByName.get(t.trim().toLowerCase()))
      .find(Boolean);
    if (tagged) return tagged;
    let id: string | null = null;
    let best = -1;
    for (const m of matchers) {
      if (m.specificity <= best) continue;
      if (m.re.test(tx.description_normalized || '') || m.re.test(tx.description_raw || '')) {
        best = m.specificity;
        id = m.id;
      }
    }
    return id;
  };
}

/** Each transfer into an account, routed by accountMatcher. */
export function assignContributions(
  txs: ContributionTx[],
  accounts: TrackedAccount[],
): Map<string, Flow[]> {
  const match = accountMatcher(accounts);
  const out = new Map<string, Flow[]>();
  for (const tx of txs) {
    const id = match(tx);
    if (!id) continue;
    const list = out.get(id) ?? [];
    list.push({ date: tx.date, amount: Math.abs(Number(tx.amount || 0)) });
    out.set(id, list);
  }
  return out;
}

export type WithdrawalRow = { account_id: string; date: string; amount: number };

/**
 * Withdrawals found in an import that aren't logged yet. Count-aware: the Nth
 * identical (account, date, amount) in this import is new only if fewer than N
 * are already logged, so re-importing a statement (or importing it on both the
 * Expenses and Income pages) never doubles one, while two genuine same-day
 * withdrawals both count. Pass deleted rows in `existing` too, so a withdrawal
 * the user removed isn't resurrected by a re-import.
 */
export function planWithdrawals(found: WithdrawalRow[], existing: WithdrawalRow[]): WithdrawalRow[] {
  const key = (w: WithdrawalRow) => `${w.account_id}|${w.date}|${Number(w.amount).toFixed(2)}`;
  const logged = new Map<string, number>();
  for (const w of existing) logged.set(key(w), (logged.get(key(w)) || 0) + 1);
  const seen = new Map<string, number>();
  return found.filter(w => {
    const n = (seen.get(key(w)) || 0) + 1;
    seen.set(key(w), n);
    return n > (logged.get(key(w)) || 0);
  });
}
