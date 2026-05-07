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

// ---- Volatility from snapshot history ------------------------------------
// Returns annualized standard deviation of monthly log-returns.
function monthlyVolatility(snapshots: RateSnap[]): number | null {
  if (snapshots.length < 3) return null;
  const sorted = [...snapshots].sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
  const logReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = Number(sorted[i - 1].balance);
    const cur = Number(sorted[i].balance);
    if (prev > 0 && cur > 0) logReturns.push(Math.log(cur / prev));
  }
  if (logReturns.length < 2) return null;
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
  const monthlyStd = Math.sqrt(variance);
  // Annualize: σ_annual ≈ σ_monthly × √12
  return monthlyStd * Math.sqrt(12) * 100; // as percentage points
}

// Blend realized CAGR with benchmark CAGR based on snapshot window length.
// More history → more weight on realized performance.
function blendRate(
  realized: { cagr_pct: number | null; window_years: number | null },
  benchmarkRate: number | null,
  defaultRate: number,
): number {
  if (realized.cagr_pct == null || realized.window_years == null || realized.window_years < 0.25) {
    return benchmarkRate ?? defaultRate;
  }
  const anchor = benchmarkRate ?? defaultRate;
  // Weight realized more as history grows: 0 at 0yr, 50% at 2yr, 75% at 5yr
  const realizedWeight = Math.min(0.75, realized.window_years / 4);
  return realized.cagr_pct * realizedWeight + anchor * (1 - realizedWeight);
}

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
// Even static/collectible accounts get capped — a "realized +1000%" from a
// short snapshot window shouldn't drive the projection.
function clampSeededRate(acc: ProjAccount, rawRate: number): { rate: number; capped: boolean } {
  const basket = resolveBasket(acc);
  const name = (acc.account_name + ' ' + (acc.platform || '')).toLowerCase();
  let cap = 12; // broad equities default
  if (acc.account_type === 'crypto' || name.includes('gemini') || basket.label.toLowerCase().includes('mix')) {
    cap = 15;
  }
  if (basket.source === 'static') {
    // Static assets: cap at their default static rate + a small margin
    cap = (basket.static_rate ?? 10) + 3;
  }
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

  // Seed the projection rate from live data blended with realized returns.
  // Unless the user has marked this account as manually overridden.
  // Blending: weight realized CAGR more as snapshot history grows (up to 75%).
  // Auto-seeded rates are clamped to a sane long-horizon ceiling.
  useEffect(() => {
    let changed = false;
    const next = { ...assumptions };
    const nextCapped = { ...cappedFrom };
    for (const a of accounts) {
      if (overrides.has(a.id)) continue;
      const live = liveRateByAccount[a.id];
      const cur = next[a.id];
      if (!cur) continue;

      // Compute realized CAGR for blending
      const snapshots = snapshotsByAccount[a.id] || [];
      const contribEstimate = a.contributions_ytd > 0
        ? a.contributions_ytd
        : a.contribution_target_monthly * Math.max(1, snapshots.length - 1);
      const realized = realizedCagr(snapshots, contribEstimate);

      const benchmarkRate = live?.rate != null ? Number(live.rate.toFixed(2)) : null;
      const blended = blendRate(realized, benchmarkRate, defaultRateFor(a));
      const rawRate = Number(blended.toFixed(2));
      const { rate: clamped, capped } = clampSeededRate(a, rawRate);
      if (capped) nextCapped[a.id] = rawRate;
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
  }, [liveRateByAccount, snapshotsByAccount]);

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
  // Run monthly compounding for each account up to age 65.
  // Variance bands use actual snapshot-derived volatility (annualized σ)
  // instead of a fixed ±3% offset. For accounts without enough history,
  // we fall back to asset-class defaults.
  const series = useMemo(() => {
    const yearsToProject = Math.max(1, TARGET_AGE - age);
    const months = yearsToProject * 12;
    const startYear = new Date().getFullYear();

    // Compute per-account annualized volatility from snapshots.
    // Fallback defaults: crypto ~55%, equities ~16%, collectibles ~20%, savings ~1%.
    const volByAccount: Record<string, number> = {};
    for (const a of accounts) {
      const measured = monthlyVolatility(snapshotsByAccount[a.id] || []);
      if (measured != null && measured > 0) {
        volByAccount[a.id] = measured;
      } else {
        const n = (a.account_name + ' ' + (a.platform || '')).toLowerCase();
        if (a.account_type === 'crypto' || n.includes('gemini')) volByAccount[a.id] = 55;
        else if (a.account_type === 'savings') volByAccount[a.id] = 1;
        else if (a.account_type === 'collectibles' || n.includes('pokemon') || n.includes('pokémon')) volByAccount[a.id] = 20;
        else volByAccount[a.id] = 16; // broad equities
      }
    }

    // Simulate at a given confidence-sigma offset.
    // offset = 0 → expected, offset = -0.5/+0.5 → "plausible range"
    // Volatility is dampened for long horizons and hard-capped so 40-year
    // projections stay sane (max ±4pp from the base rate).
    const sim = (sigmaOffset: number) => {
      const balances: Record<string, number[]> = {};
      for (const a of accounts) {
        const ass = assumptions[a.id];
        if (!ass) continue;
        const vol = volByAccount[a.id] || 16;
        const baseRate = ass.annual_rate_pct;

        // Raw offset from volatility (using 0.5σ for a tighter "plausible" band)
        const rawOffset = sigmaOffset * vol * 0.5;

        // Clamp: high band at most +min(vol_offset, base×0.5, 4pp)
        //        low band at most  -min(vol_offset, base×0.6, 4pp), floored at 0%
        let effectiveAnnual: number;
        if (sigmaOffset > 0) {
          const cappedOffset = Math.min(Math.abs(rawOffset), baseRate * 0.5, 4);
          effectiveAnnual = baseRate + cappedOffset;
        } else if (sigmaOffset < 0) {
          const cappedOffset = Math.min(Math.abs(rawOffset), baseRate * 0.6, 4);
          effectiveAnnual = Math.max(0, baseRate - cappedOffset);
        } else {
          effectiveAnnual = baseRate;
        }

        const monthlyRate = (effectiveAnnual / 100) / 12;
        const monthsContributing = Math.max(0, (ass.stop_age - age) * 12);
        let bal = Number(a.current_balance) || 0;
        const arr: number[] = [bal];
        for (let m = 1; m <= months; m++) {
          bal = bal * (1 + monthlyRate);
          if (m <= monthsContributing) bal += ass.monthly_contribution;
          arr.push(Math.max(0, bal));
        }
        balances[a.id] = arr;
      }
      return balances;
    };

    const expected = sim(0);
    const low      = sim(-1);  // dampened low
    const high     = sim(1);   // dampened high

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
  }, [accounts, assumptions, age, hidden, snapshotsByAccount]);

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
                Each account compounds monthly at a <span className="text-foreground">blended rate</span> — your
                realized returns (from snapshot history) weighted with the live benchmark CAGR.
                The more history you have, the more your actual performance drives the projection
                (up to 75% weight at 3+ years). Edit any value in <span className="text-foreground">Settings</span>.
              </p>
              <p className="text-muted-foreground mt-2">
                The shaded band uses each account's <span className="text-foreground">actual volatility</span> (standard
                deviation of monthly returns from your snapshots) instead of a flat ±3%. Crypto
                accounts with wild swings get wider bands; steady accounts get narrow ones. Without
                enough history, asset-class defaults are used (equities ~16%, crypto ~55%).
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
        {/* Hero stat strip */}
        {(() => {
          const startTotal = series[0]?.total || 0;
          const multiplier = startTotal > 0 ? finalTotal / startTotal : 0;
          const yearsAhead = TARGET_AGE - age;
          return (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg border border-border/50 bg-muted/10 p-2.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Today</div>
                <div className="text-lg font-semibold tabular-nums tracking-tight text-foreground mt-0.5">
                  {fmtUsd(startTotal)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {accounts.length} account{accounts.length === 1 ? '' : 's'} · age {age}
                </div>
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/10 p-2.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">At Age {TARGET_AGE}</div>
                <div className="text-lg font-semibold tabular-nums tracking-tight text-foreground mt-0.5">
                  {fmtUsd(finalTotal)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  in {yearsAhead} year{yearsAhead === 1 ? '' : 's'}
                </div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-2.5">
                <div className="text-[9px] uppercase tracking-wider text-primary/80 font-medium">Multiplier</div>
                <div className="text-lg font-semibold tabular-nums tracking-tight text-foreground mt-0.5">
                  {multiplier >= 1000 ? `${(multiplier / 1000).toFixed(1)}k×` : `${multiplier.toFixed(0)}×`} <span className="text-[10px] font-normal text-muted-foreground">your money</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  Range: {fmtUsd(finalLow)}–{fmtUsd(finalHigh)}
                </div>
              </div>
            </div>
          );
        })()}

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
                    ) : liveRate != null || realized.cagr_pct != null ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/5 text-emerald-500/90">
                        <Zap className="h-2.5 w-2.5" />
                        {realized.cagr_pct != null && realized.window_years != null && realized.window_years >= 0.25
                          ? `blended · ${ass.annual_rate_pct.toFixed(1)}% (${Math.round(Math.min(75, realized.window_years / 4 * 100))}% realized)`
                          : `auto · ${ass.annual_rate_pct.toFixed(1)}% (${live?.label} 10y)`
                        }
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

        {(() => {
          // Compute milestones to render: only those between today's total and finalHigh,
          // and only meaningful breakpoints.
          const startTotal = series[0]?.total || 0;
          const allMilestones = [
            { v: 100_000, label: '$100k' },
            { v: 500_000, label: '$500k' },
            { v: 1_000_000, label: '$1M' },
            { v: 5_000_000, label: '$5M' },
            { v: 10_000_000, label: '$10M' },
            { v: 25_000_000, label: '$25M' },
            { v: 100_000_000, label: '$100M' },
          ];
          const yMax = finalHigh || finalTotal || 1;
          const milestones = allMilestones.filter(m => m.v > startTotal * 1.2 && m.v < yMax * 0.95);
          // Find crossover year for each milestone (first year total >= milestone).
          const crossovers = milestones
            .map(m => {
              const row = series.find(r => (r.total || 0) >= m.v);
              return row ? { ...m, year: row.year, age: row.age } : null;
            })
            .filter(Boolean) as Array<{ v: number; label: string; year: number; age: number }>;

          // Build start-anchor for the "Today" reference line label.
          const startYear = series[0]?.year;

          return (
            <div className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 12, right: 56, left: 0, bottom: 0 }}>
                  <defs>
                    {accounts.map(a => (
                      <linearGradient key={a.id} id={`grad-${a.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={colorFor(a.id)} stopOpacity={0.85} />
                        <stop offset="100%" stopColor={colorFor(a.id)} stopOpacity={0.35} />
                      </linearGradient>
                    ))}
                    <linearGradient id="grad-upside" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--foreground))" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="hsl(var(--foreground))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(v) => String(v)}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(v) => fmtUsd(Number(v))}
                    domain={[0, 'auto']}
                    width={60}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ stroke: 'hsl(var(--foreground))', strokeOpacity: 0.2, strokeWidth: 1 }}
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 10,
                      fontSize: 11,
                      boxShadow: '0 8px 24px -8px hsl(0 0% 0% / 0.4)',
                    }}
                    labelFormatter={(year, payload) => {
                      const a = payload?.[0]?.payload?.age;
                      const t = payload?.[0]?.payload?.total;
                      return (
                        <div className="space-y-0.5">
                          <div className="font-semibold text-foreground">{year} · age {a}</div>
                          {t != null && <div className="text-muted-foreground text-[10px]">Total: <span className="text-foreground font-medium">{fmtUsd(Number(t))}</span></div>}
                        </div>
                      ) as any;
                    }}
                    formatter={(value: any, name: any) => {
                      if (value == null) return ['—', name];
                      if (name === 'totalHigh' || name === 'totalLow') return [null, null] as any;
                      const acc = accounts.find(a => a.id === name);
                      return [fmtUsd(Number(value)), acc?.account_name || name];
                    }}
                  />

                  {/* Upside ribbon: from expected total up to optimistic total */}
                  <Area
                    type="monotone"
                    dataKey="totalHigh"
                    stroke="none"
                    fill="url(#grad-upside)"
                    isAnimationActive={false}
                    name="totalHigh"
                    activeDot={false}
                  />

                  {/* Stacked account areas */}
                  {accounts.map(a => (
                    <Area
                      key={a.id}
                      type="monotone"
                      dataKey={a.id}
                      stackId="acc"
                      stroke={colorFor(a.id)}
                      strokeWidth={1.5}
                      fill={`url(#grad-${a.id})`}
                      hide={hidden.has(a.id)}
                      name={a.id}
                      isAnimationActive={false}
                      activeDot={{ r: 3, strokeWidth: 0 }}
                    />
                  ))}

                  {/* Conservative-case line on top of the stack */}
                  <Line
                    type="monotone"
                    dataKey="totalLow"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1}
                    strokeDasharray="3 4"
                    dot={false}
                    name="totalLow"
                    isAnimationActive={false}
                    activeDot={false}
                  />

                  {/* Today anchor */}
                  {startYear != null && (
                    <ReferenceLine
                      x={startYear}
                      stroke="hsl(var(--primary))"
                      strokeOpacity={0.5}
                      strokeDasharray="2 3"
                      label={{
                        value: `Today · ${fmtUsd(startTotal)}`,
                        position: 'insideTopLeft',
                        fill: 'hsl(var(--primary))',
                        fontSize: 9,
                        offset: 8,
                      }}
                    />
                  )}

                  {/* Milestone reference lines */}
                  {milestones.map(m => (
                    <ReferenceLine
                      key={m.v}
                      y={m.v}
                      stroke="hsl(var(--muted-foreground))"
                      strokeOpacity={0.35}
                      strokeDasharray="3 6"
                      label={{
                        value: m.label,
                        position: 'right',
                        fill: 'hsl(var(--muted-foreground))',
                        fontSize: 9,
                        offset: 6,
                      }}
                    />
                  ))}

                  {/* Crossover markers */}
                  {crossovers.map(c => (
                    <ReferenceDot
                      key={`x-${c.v}`}
                      x={c.year}
                      y={c.v}
                      r={4}
                      fill="hsl(var(--background))"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      label={{
                        value: `age ${c.age}`,
                        position: 'top',
                        fill: 'hsl(var(--primary))',
                        fontSize: 9,
                        offset: 6,
                      }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          );
        })()}

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
            const finalForAcc = Number(finalRow?.[a.id] ?? 0);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full border transition-all ${
                  off
                    ? 'border-border/40 text-muted-foreground/60 line-through'
                    : 'border-border/60 text-foreground hover:border-foreground/40 hover:bg-muted/30'
                }`}
                title={off ? 'Click to show' : `Click to hide · ${ass?.annual_rate_pct ?? '?'}%/yr`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: off ? 'hsl(var(--muted))' : colorFor(a.id) }}
                />
                <span className="font-medium">{a.account_name}</span>
                {!off && (
                  <span className="text-muted-foreground tabular-nums">
                    {fmtUsd(finalForAcc)}
                  </span>
                )}
                {ass && <span className="text-muted-foreground/70 text-[9px]">· {ass.annual_rate_pct}%</span>}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
