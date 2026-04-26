import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, ReferenceDot,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Telescope, Settings2, Info, ChevronDown, ChevronUp, Lock, Zap } from 'lucide-react';
import { LiveRateCalculator, defaultSymbolFor, type Snapshot as RateSnap, realizedCagr } from '@/components/LiveRateCalculator';
import { resolveBasket } from '@/lib/account-baskets';
import { useQueries } from '@tanstack/react-query';

// ---------------------------------------------------------------
// Long-horizon compounding projection ("to age 65"). Lives next to the
// historical CombinedWealthChart on /wealth. Pure client-side: assumptions
// + age are persisted to localStorage so we don't need DB columns for
// one-off personal numbers.
// ---------------------------------------------------------------

export type ProjAccount = {
  id: string;
  account_name: string;
  account_type: string;
  platform: string | null;
  current_balance: number;
  contribution_target_monthly: number;
  contributions_ytd: number;
};

const PALETTE = [
  'hsl(225, 70%, 60%)',
  'hsl(145, 50%, 50%)',
  'hsl(38, 85%, 58%)',
  'hsl(280, 55%, 60%)',
  'hsl(0, 60%, 58%)',
  'hsl(180, 55%, 50%)',
  'hsl(330, 55%, 58%)',
  'hsl(60, 65%, 50%)',
];

const AGE_KEY = 'wealth_user_age';
const ASSUMP_KEY = 'wealth_projection_assumptions_v1';
const OVERRIDE_KEY = 'wealth_projection_user_overrides_v1';
const TARGET_AGE = 65;

type Assumption = {
  annual_rate_pct: number; // e.g. 8 = 8%
  monthly_contribution: number; // dollars
  stop_age: number;
  benchmark_symbol?: string; // e.g. ^GSPC, BTC-USD, basket:..., or __none__
};
type AssumptionMap = Record<string, Assumption>;

// ---- Heuristic defaults --------------------------------------------------
function defaultRateFor(acc: ProjAccount): number {
  // Prefer the static rate from the basket resolver when it's a no-live-feed asset.
  const basket = resolveBasket(acc);
  if (basket.source === 'static' && basket.static_rate != null) return basket.static_rate;

  const name = (acc.account_name + ' ' + (acc.platform || '')).toLowerCase();
  if (acc.account_type === 'crypto' || name.includes('gemini')) return 12;
  if (acc.account_type === 'collectibles' || name.includes('pokemon') || name.includes('pokémon')) return 7;
  if (acc.account_type === 'savings') return 4;
  if (name.includes('wealthfront') || name.includes('s&p')) return 8;
  if (name.includes('dub')) return 10;
  if (acc.account_type === 'roth_ira' || acc.account_type === 'traditional_ira') return 8;
  if (acc.account_type === 'brokerage') return 8;
  return 6;
}

function defaultMonthlyContribution(acc: ProjAccount): number {
  if (Number(acc.contribution_target_monthly) > 0) return Number(acc.contribution_target_monthly);
  // Fall back to YTD avg.
  const monthsElapsed = Math.max(1, new Date().getMonth() + 1);
  const ytdAvg = Number(acc.contributions_ytd || 0) / monthsElapsed;
  return Math.round(ytdAvg);
}

function loadAssumptions(): AssumptionMap {
  try {
    const raw = localStorage.getItem(ASSUMP_KEY);
    return raw ? (JSON.parse(raw) as AssumptionMap) : {};
  } catch {
    return {};
  }
}
function saveAssumptions(map: AssumptionMap) {
  try { localStorage.setItem(ASSUMP_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function loadOverrides(): Set<string> {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    return raw ? new Set<string>(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function saveOverrides(s: Set<string>) {
  try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

// Direct call to the market-rates edge function (mirrors LiveRateCalculator's fetcher).
async function fetchLiveRate(symbolOrBasket: string): Promise<{ cagr_10y: number | null; cagr_5y: number | null } | null> {
  if (!symbolOrBasket || symbolOrBasket === '__none__') return null;
  const params: Record<string, string> = symbolOrBasket.startsWith('basket:')
    ? { basket: symbolOrBasket.slice('basket:'.length) }
    : { symbol: symbolOrBasket };
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.functions.supabase.co/market-rates?${new URLSearchParams(params)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return { cagr_10y: data.cagr_10y, cagr_5y: data.cagr_5y };
  } catch {
    return null;
  }
}

const fmtUsd = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3)  return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
};

// Cap unrealistically high auto-seeded rates for long-horizon projections.
// Live 10y CAGR for crypto can be 60%+ — extrapolating that for 40 years is
// nonsensical. User can still manually override to anything.
function clampSeededRate(acc: ProjAccount, rawRate: number): { rate: number; capped: boolean } {
  const basket = resolveBasket(acc);
  const name = (acc.account_name + ' ' + (acc.platform || '')).toLowerCase();
  let cap = 12; // broad equities default
  if (acc.account_type === 'crypto' || name.includes('gemini') || basket.label.toLowerCase().includes('mix')) {
    cap = 15;
  }
  if (basket.source === 'static') return { rate: rawRate, capped: false };
  if (rawRate > cap) return { rate: cap, capped: true };
  return { rate: rawRate, capped: false };
}

export function WealthProjectionChart({
  accounts,
  snapshotsByAccount = {},
}: {
  accounts: ProjAccount[];
  /** Map of account id -> sorted snapshot history. Powers realized-rate calc. */
  snapshotsByAccount?: Record<string, RateSnap[]>;
}) {
  const [age, setAge] = useState<number>(() => {
    const v = Number(localStorage.getItem(AGE_KEY));
    return Number.isFinite(v) && v > 0 ? v : 30;
  });
  const [assumptions, setAssumptions] = useState<AssumptionMap>(() => loadAssumptions());
  const [overrides, setOverrides] = useState<Set<string>>(() => loadOverrides());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [yScale, setYScale] = useState<'linear' | 'log'>('log');
  // Track which auto-seeded rates were clamped down from a higher live value,
  // purely for transparency in the assumptions panel.
  const [cappedFrom, setCappedFrom] = useState<Record<string, number>>({});

  // Seed defaults for any account that's missing assumptions.
  // Use the basket resolver so Gemini/Dub/etc start on the right symbol.
  useEffect(() => {
    let changed = false;
    const next = { ...assumptions };
    for (const a of accounts) {
      const basket = resolveBasket(a);
      const seedSymbol = basket.source === 'live' ? basket.symbol : defaultSymbolFor(a);
      if (!next[a.id]) {
        next[a.id] = {
          annual_rate_pct: defaultRateFor(a),
          monthly_contribution: defaultMonthlyContribution(a),
          stop_age: TARGET_AGE,
          benchmark_symbol: seedSymbol,
        };
        changed = true;
      } else if (!next[a.id].benchmark_symbol) {
        next[a.id] = { ...next[a.id], benchmark_symbol: seedSymbol };
        changed = true;
      }
    }
    if (changed) {
      setAssumptions(next);
      saveAssumptions(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Auto-apply: fetch live 10y CAGR per account.
  // If the user has marked this account as overridden, we still fetch (to show
  // the badge / realized-vs-benchmark delta) but won't overwrite the rate.
  const liveQueries = useQueries({
    queries: accounts.map((a) => {
      const basket = resolveBasket(a);
      const symbol = assumptions[a.id]?.benchmark_symbol || basket.symbol;
      const enabled = basket.source === 'live' && symbol !== '__none__';
      return {
        queryKey: ['proj-live-rate', a.id, symbol],
        queryFn: () => fetchLiveRate(symbol),
        enabled,
        staleTime: 6 * 60 * 60 * 1000,
        retry: 1,
      };
    }),
  });

  const liveCagrFingerprint = liveQueries.map((q) => q.data?.cagr_10y ?? 'x').join('|');
  const liveRateByAccount = useMemo(() => {
    const m: Record<string, { rate: number | null; label: string }> = {};
    accounts.forEach((a, i) => {
      const basket = resolveBasket(a);
      const data = liveQueries[i]?.data ?? null;
      m[a.id] = { rate: data?.cagr_10y ?? null, label: basket.label };
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, liveCagrFingerprint]);

  // Seed the projection rate from live data when it arrives,
  // unless the user has marked this account as manually overridden.
  // Auto-seeded rates are clamped to a sane long-horizon ceiling
  // (crypto 15%, equities 12%) so a 60%+ 10y CAGR doesn't compound the
  // chart into the quadrillions over a 40-year horizon.
  useEffect(() => {
    let changed = false;
    const next = { ...assumptions };
    const nextCapped = { ...cappedFrom };
    for (const a of accounts) {
      if (overrides.has(a.id)) continue;
      const live = liveRateByAccount[a.id];
      if (live?.rate == null) continue;
      const cur = next[a.id];
      if (!cur) continue;
      const rawLive = Number(live.rate.toFixed(2));
      const { rate: clamped, capped } = clampSeededRate(a, rawLive);
      if (capped) nextCapped[a.id] = rawLive;
      else delete nextCapped[a.id];
      if (Math.abs(cur.annual_rate_pct - clamped) > 0.01) {
        next[a.id] = { ...cur, annual_rate_pct: clamped };
        changed = true;
      }
    }
    if (changed) {
      setAssumptions(next);
      saveAssumptions(next);
    }
    setCappedFrom(nextCapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRateByAccount]);

  useEffect(() => {
    localStorage.setItem(AGE_KEY, String(age));
  }, [age]);

  const colorFor = (id: string) => {
    const idx = accounts.findIndex(a => a.id === id);
    return PALETTE[idx % PALETTE.length];
  };

  const markOverride = (id: string) => {
    if (overrides.has(id)) return;
    const n = new Set(overrides); n.add(id);
    setOverrides(n); saveOverrides(n);
  };
  const clearOverride = (id: string) => {
    if (!overrides.has(id)) return;
    const n = new Set(overrides); n.delete(id);
    setOverrides(n); saveOverrides(n);
  };

  const updateAssumption = (id: string, patch: Partial<Assumption>, opts?: { manual?: boolean }) => {
    const next = { ...assumptions, [id]: { ...assumptions[id], ...patch } };
    setAssumptions(next);
    saveAssumptions(next);
    if (opts?.manual) markOverride(id);
  };

  // ---- Simulation -------------------------------------------------------
  // Run monthly compounding for each account up to age 65. We also build a
  // total trajectory plus a conservative (rate-3%) and optimistic (rate+3%)
  // band on the total so the user sees a realistic range.
  const series = useMemo(() => {
    const yearsToProject = Math.max(1, TARGET_AGE - age);
    const months = yearsToProject * 12;
    const startYear = new Date().getFullYear();

    // Per-account month-by-month balances at three rate scenarios.
    // rateOffsetFn lets us asymmetrically cap the high band so already-aggressive
    // rates (e.g. 15% crypto) don't run away to absurd values.
    const sim = (rateOffsetFn: (baseRate: number) => number) => {
      const balances: Record<string, number[]> = {};
      for (const a of accounts) {
        const ass = assumptions[a.id];
        if (!ass) continue;
        const effectiveAnnual = rateOffsetFn(ass.annual_rate_pct);
        const monthlyRate = (effectiveAnnual / 100) / 12;
        const monthsContributing = Math.max(0, (ass.stop_age - age) * 12);
        let bal = Number(a.current_balance) || 0;
        const arr: number[] = [bal];
        for (let m = 1; m <= months; m++) {
          bal = bal * (1 + monthlyRate);
          if (m <= monthsContributing) bal += ass.monthly_contribution;
          arr.push(bal);
        }
        balances[a.id] = arr;
      }
      return balances;
    };

    const expected = sim((r) => r);
    const low      = sim((r) => Math.max(0, r - 3));
    // Cap the optimistic band so a 15% rate can't balloon to 18% (which over
    // 40 years is the difference between $5M and $20M+).
    const high     = sim((r) => Math.min(r + 3, r * 1.25));

    // Sample at year boundaries for a clean axis.
    const rows: any[] = [];
    for (let y = 0; y <= yearsToProject; y++) {
      const m = y * 12;
      const row: any = {
        year: startYear + y,
        age: age + y,
      };
      let total = 0;
      let totalLow = 0;
      let totalHigh = 0;
      for (const a of accounts) {
        const v = expected[a.id]?.[m];
        if (v != null) {
          row[a.id] = v;
          if (!hidden.has(a.id)) {
            total += v;
            totalLow += low[a.id]?.[m] ?? 0;
            totalHigh += high[a.id]?.[m] ?? 0;
          }
        }
      }
      row.total = total;
      row.totalLow = totalLow;
      row.totalHigh = totalHigh;
      // Recharts Area expects [low, high] tuples for ranged shading.
      row.totalBand = [totalLow, totalHigh];
      rows.push(row);
    }
    return rows;
  }, [accounts, assumptions, age, hidden]);

  const finalRow = series[series.length - 1];
  const finalTotal = finalRow?.total || 0;
  const finalLow = finalRow?.totalLow || 0;
  const finalHigh = finalRow?.totalHigh || 0;

  const toggle = (id: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (accounts.length === 0) return null;

  return (
    <Card>
      <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between space-y-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Telescope className="h-3.5 w-3.5 text-primary shrink-0" />
          <CardTitle className="text-[11px] font-medium text-muted-foreground truncate">
            Projection to Age {TARGET_AGE}
          </CardTitle>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-foreground">
                <Info className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3 text-[11px] leading-relaxed" align="start">
              <div className="font-semibold text-foreground mb-1">Methodology</div>
              <p className="text-muted-foreground">
                Each account compounds monthly at its assumed annual rate, with monthly contributions
                added until the configured stop age. Defaults are historical-average heuristics
                (S&P ~8%, crypto ~12%, collectibles ~7%) — edit any value in <span className="text-foreground">Settings</span>.
              </p>
              <p className="text-muted-foreground mt-2">
                The shaded band around <span className="text-foreground">Total</span> shows a ±3% rate range
                (conservative vs optimistic). Crypto and collectibles carry wider real-world variance —
                toggle them off to see the baseline trajectory.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="proj-age" className="text-[10px] text-muted-foreground">Age</Label>
            <Input
              id="proj-age"
              type="number"
              min={18}
              max={64}
              value={age}
              onChange={e => setAge(Math.max(18, Math.min(64, Number(e.target.value) || 30)))}
              className="h-6 w-14 text-xs px-1.5"
            />
          </div>
          <div className="inline-flex items-center rounded-md border border-border/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setYScale('linear')}
              className={`text-[10px] px-2 py-1 transition-colors ${yScale === 'linear' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title="Linear scale — emphasizes late-year totals"
            >Linear</button>
            <button
              type="button"
              onClick={() => setYScale('log')}
              className={`text-[10px] px-2 py-1 transition-colors border-l border-border/60 ${yScale === 'log' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title="Log scale — makes early-year growth visible across long horizons"
            >Log</button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2 gap-1"
            onClick={() => setShowSettings(v => !v)}
          >
            <Settings2 className="h-3 w-3" />
            Assumptions
            {showSettings ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        {/* Headline */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2">
          <div className="text-xs text-muted-foreground">
            At age {TARGET_AGE}: <span className="text-foreground font-semibold text-sm">{fmtUsd(finalTotal)}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Range: <span className="text-foreground/80">{fmtUsd(finalLow)}</span> – <span className="text-foreground/80">{fmtUsd(finalHigh)}</span>
          </div>
        </div>

        {/* Assumptions panel */}
        {showSettings && (
          <div className="mb-3 rounded-md border border-border/60 bg-muted/20 p-2 space-y-0.5 max-h-96 overflow-y-auto">
            <div className="grid grid-cols-12 gap-2 text-[10px] font-medium text-muted-foreground px-1">
              <div className="col-span-4">Account</div>
              <div className="col-span-3">Annual rate %</div>
              <div className="col-span-3">Monthly $</div>
              <div className="col-span-2">Stop age</div>
            </div>
            {accounts.map(a => {
              const ass = assumptions[a.id];
              if (!ass) return null;
              const live = liveRateByAccount[a.id];
              const isOverride = overrides.has(a.id);
              const realized = realizedCagr(
                snapshotsByAccount[a.id] || [],
                a.contributions_ytd > 0
                  ? a.contributions_ytd
                  : a.contribution_target_monthly * Math.max(
                      1,
                      (snapshotsByAccount[a.id]?.length || 1) - 1,
                    ),
              );
              const liveRate = live?.rate;
              const realizedDelta =
                realized.cagr_pct != null && liveRate != null
                  ? realized.cagr_pct - liveRate
                  : null;
              return (
                <div key={a.id} className="px-1 py-1 border-b border-border/30 last:border-b-0">
                  <div className="grid grid-cols-12 gap-2 items-center text-[11px]">
                    <div className="col-span-4 flex items-center gap-1.5 truncate">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorFor(a.id) }} />
                      <span className="truncate">{a.account_name}</span>
                    </div>
                    <div className="col-span-3 flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.5"
                        value={ass.annual_rate_pct}
                        onChange={e => updateAssumption(a.id, { annual_rate_pct: Number(e.target.value) || 0 }, { manual: true })}
                        className="h-6 text-[11px] px-1.5"
                      />
                      <LiveRateCalculator
                        accountName={a.account_name}
                        symbol={ass.benchmark_symbol || defaultSymbolFor(a)}
                        onSymbolChange={(sym) => updateAssumption(a.id, { benchmark_symbol: sym })}
                        currentRate={ass.annual_rate_pct}
                        onApply={(r) => updateAssumption(a.id, { annual_rate_pct: r }, { manual: true })}
                        snapshots={snapshotsByAccount[a.id] || []}
                        contributionsYtd={a.contributions_ytd}
                        contributionTargetMonthly={a.contribution_target_monthly}
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        type="number"
                        step="50"
                        value={ass.monthly_contribution}
                        onChange={e => updateAssumption(a.id, { monthly_contribution: Number(e.target.value) || 0 }, { manual: true })}
                        className="h-6 text-[11px] px-1.5"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        min={age}
                        max={TARGET_AGE}
                        value={ass.stop_age}
                        onChange={e => updateAssumption(a.id, { stop_age: Math.max(age, Math.min(TARGET_AGE, Number(e.target.value) || TARGET_AGE)) }, { manual: true })}
                        className="h-6 text-[11px] px-1.5"
                      />
                    </div>
                  </div>
                  {/* Status row: live/manual badge + realized-vs-benchmark delta */}
                  <div className="flex items-center gap-2 flex-wrap mt-1 pl-3.5 text-[9.5px] text-muted-foreground">
                    {isOverride ? (
                      <button
                        type="button"
                        onClick={() => clearOverride(a.id)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/60 hover:border-primary/60 hover:text-foreground transition-colors"
                        title="Click to unlock — live data will overwrite this rate"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        manual · {ass.annual_rate_pct.toFixed(1)}%
                      </button>
                    ) : liveRate != null ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/5 text-emerald-500/90">
                        <Zap className="h-2.5 w-2.5" />
                        auto · {ass.annual_rate_pct.toFixed(1)}% ({live.label} 10y)
                        {cappedFrom[a.id] != null && (
                          <span
                            className="ml-1 text-amber-500/90"
                            title={`Live 10y CAGR is ${cappedFrom[a.id].toFixed(1)}% — capped to a sane long-horizon ceiling so 40-year projections stay realistic. Click the rate field to override.`}
                          >
                            (capped from {cappedFrom[a.id].toFixed(1)}%)
                          </span>
                        )}
                      </span>
                    ) : live?.label ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/40">
                        {live.label} (no live data)
                      </span>
                    ) : null}
                    {realized.cagr_pct != null && (
                      <span className="inline-flex items-center gap-1">
                        realized
                        <span className={realized.cagr_pct >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                          {realized.cagr_pct >= 0 ? '+' : ''}{realized.cagr_pct.toFixed(1)}%
                        </span>
                        {realizedDelta != null && (
                          <>
                            ·
                            <span className={realizedDelta >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                              {realizedDelta >= 0 ? '+' : ''}{realizedDelta.toFixed(1)}pp vs benchmark
                            </span>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v) => String(v)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v) => fmtUsd(Number(v))}
                scale={yScale === 'log' ? 'log' : 'auto'}
                domain={yScale === 'log' ? [1, 'auto'] : [0, 'auto']}
                allowDataOverflow={false}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelFormatter={(year, payload) => {
                  const a = payload?.[0]?.payload?.age;
                  return a != null ? `${year} · age ${a}` : String(year);
                }}
                formatter={(value: any, name: any) => {
                  if (value == null) return ['—', name];
                  if (name === 'totalBand') return [null, null] as any;
                  if (name === 'total') return [fmtUsd(Number(value)), 'Total'];
                  const acc = accounts.find(a => a.id === name);
                  return [fmtUsd(Number(value)), acc?.account_name || name];
                }}
              />
              {/* Range band behind the lines */}
              <Area
                type="monotone"
                dataKey="totalBand"
                stroke="none"
                fill="hsl(var(--foreground))"
                fillOpacity={0.07}
                isAnimationActive={false}
                name="totalBand"
              />
              {accounts.map(a => (
                <Line
                  key={a.id}
                  type="monotone"
                  dataKey={a.id}
                  stroke={colorFor(a.id)}
                  strokeWidth={1.75}
                  dot={false}
                  hide={hidden.has(a.id)}
                  name={a.id}
                  isAnimationActive={false}
                />
              ))}
              <Line
                type="monotone"
                dataKey="total"
                stroke="hsl(var(--foreground))"
                strokeWidth={2.5}
                dot={false}
                name="total"
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Clickable legend */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
          <button
            type="button"
            onClick={() => setHidden(new Set())}
            className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
          >
            Show all
          </button>
          {accounts.map(a => {
            const off = hidden.has(a.id);
            const ass = assumptions[a.id];
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                  off
                    ? 'border-border/40 text-muted-foreground/60 line-through'
                    : 'border-border/60 text-foreground hover:border-foreground/40'
                }`}
                title={off ? 'Click to show' : `Click to hide · ${ass?.annual_rate_pct ?? '?'}%/yr`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: off ? 'hsl(var(--muted))' : colorFor(a.id) }}
                />
                {a.account_name}
                {ass && <span className="text-muted-foreground">{ass.annual_rate_pct}%</span>}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
