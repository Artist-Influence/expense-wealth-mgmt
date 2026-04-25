import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, TrendingDown, Sparkles } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

// ---------------------------------------------------------------
// LiveRateCalculator: a popover that fetches live trailing CAGRs from
// the `market-rates` edge function (Yahoo Finance, no key) and computes
// the user's own realized CAGR from this account's snapshot history.
// User can apply any number to the projection assumption with one click.
// ---------------------------------------------------------------

export type Snapshot = { as_of_date: string; balance: number };

export type RateData = {
  symbol: string;
  as_of: string;
  last_close: number | null;
  cagr_1y: number | null;
  cagr_5y: number | null;
  cagr_10y: number | null;
  cagr_20y: number | null;
  sparkline_5y: number[];
};

export const SYMBOL_PRESETS: Array<{ value: string; label: string; basket?: string }> = [
  { value: '^GSPC', label: 'S&P 500 (^GSPC)' },
  { value: 'QQQ', label: 'Nasdaq 100 (QQQ)' },
  { value: 'VTI', label: 'Total US Market (VTI)' },
  { value: 'BTC-USD', label: 'Bitcoin (BTC)' },
  { value: 'ETH-USD', label: 'Ethereum (ETH)' },
  { value: 'SOL-USD', label: 'Solana (SOL)' },
  { value: 'basket:BTC-USD:0.6,ETH-USD:0.3,SOL-USD:0.1', label: 'Crypto basket 60/30/10' },
  { value: '__none__', label: 'No live benchmark' },
];

// Pick a sensible default symbol for a given account.
export function defaultSymbolFor(opts: {
  account_type: string;
  account_name: string;
  platform: string | null;
}): string {
  const n = (opts.account_name + ' ' + (opts.platform || '')).toLowerCase();
  if (opts.account_type === 'crypto' || n.includes('gemini') || n.includes('coinbase')) {
    return 'BTC-USD';
  }
  if (n.includes('wealthfront') || n.includes('s&p') || n.includes('sp500')) return '^GSPC';
  if (n.includes('nasdaq') || n.includes('qqq')) return 'QQQ';
  if (opts.account_type === 'brokerage') return '^GSPC';
  return '__none__';
}

async function fetchRate(symbolOrBasket: string): Promise<RateData> {
  const params: Record<string, string> = symbolOrBasket.startsWith('basket:')
    ? { basket: symbolOrBasket.slice('basket:'.length) }
    : { symbol: symbolOrBasket };
  // The market-rates edge function takes query params, which supabase.functions.invoke()
  // doesn't expose cleanly — call it directly via the project URL.
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.functions.supabase.co/market-rates?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`market-rates ${res.status}: ${text.slice(0, 120)}`);
  }
  return (await res.json()) as RateData;
}

// Modified-Dietz realized CAGR over the snapshot window for one account.
// Assumes contributions came in roughly uniformly across the window
// (good enough heuristic when we don't have per-snapshot cashflow tags).
export function realizedCagr(
  snapshots: Snapshot[],
  contributionsTotal: number,
): { cagr_pct: number | null; window_years: number | null } {
  if (snapshots.length < 2) return { cagr_pct: null, window_years: null };
  const sorted = [...snapshots].sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const startBal = Number(first.balance);
  const endBal = Number(last.balance);
  const yearsElapsed =
    (new Date(last.as_of_date).getTime() - new Date(first.as_of_date).getTime()) /
    (365.25 * 24 * 3600 * 1000);
  if (yearsElapsed <= 0 || startBal <= 0) return { cagr_pct: null, window_years: null };

  // Dietz: gain / (avg invested capital). Approximation: contributions weighted half-window.
  const gain = endBal - startBal - contributionsTotal;
  const avgInvested = startBal + contributionsTotal / 2;
  if (avgInvested <= 0) return { cagr_pct: null, window_years: yearsElapsed };
  const periodReturn = gain / avgInvested;
  // Annualize: (1 + r)^(1/years) - 1
  const annual = Math.pow(1 + periodReturn, 1 / yearsElapsed) - 1;
  if (!Number.isFinite(annual)) return { cagr_pct: null, window_years: yearsElapsed };
  return { cagr_pct: annual * 100, window_years: yearsElapsed };
}

const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

export function LiveRateCalculator({
  accountName,
  symbol,
  onSymbolChange,
  currentRate,
  onApply,
  snapshots,
  contributionsYtd,
  contributionTargetMonthly,
}: {
  accountName: string;
  symbol: string;
  onSymbolChange: (next: string) => void;
  currentRate: number;
  onApply: (newRate: number) => void;
  snapshots: Snapshot[];
  contributionsYtd: number;
  contributionTargetMonthly: number;
}) {
  const enabled = symbol && symbol !== '__none__';

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['market-rates', symbol],
    queryFn: () => fetchRate(symbol),
    enabled,
    staleTime: 6 * 60 * 60 * 1000, // 6h
    retry: 1,
  });

  // Compute realized rate from this account's snapshot history.
  // Contributions estimate: prefer YTD figure; fall back to (monthly target × months in window).
  const realized = useMemo(() => {
    if (snapshots.length < 2) return realizedCagr(snapshots, 0);
    const sorted = [...snapshots].sort((a, b) => a.as_of_date.localeCompare(b.as_of_date));
    const monthsInWindow = Math.max(
      1,
      Math.round(
        (new Date(sorted[sorted.length - 1].as_of_date).getTime() -
          new Date(sorted[0].as_of_date).getTime()) /
          (30.4 * 24 * 3600 * 1000),
      ),
    );
    const inferredContributions =
      contributionsYtd > 0 ? contributionsYtd : contributionTargetMonthly * monthsInWindow;
    return realizedCagr(snapshots, inferredContributions);
  }, [snapshots, contributionsYtd, contributionTargetMonthly]);

  const realizedDelta =
    realized.cagr_pct != null ? realized.cagr_pct - currentRate : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-primary"
          title="Live rate calculator"
        >
          <Activity className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-3 space-y-3" align="end">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-foreground truncate">
            {accountName} · live rates
          </div>
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
            assumed {currentRate.toFixed(1)}%
          </Badge>
        </div>

        {/* Symbol picker */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Benchmark symbol</label>
          <Select value={symbol} onValueChange={onSymbolChange}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYMBOL_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Live benchmark CAGRs */}
        {enabled && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Trailing CAGR · live
              </div>
              <button
                type="button"
                className="text-[9px] text-muted-foreground hover:text-foreground underline"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? 'refreshing…' : 'refresh'}
              </button>
            </div>
            {isLoading && (
              <div className="text-[10px] text-muted-foreground">Fetching live data…</div>
            )}
            {isError && (
              <div className="text-[10px] text-destructive">
                Couldn't load: {(error as any)?.message?.slice(0, 80) || 'unknown'}
              </div>
            )}
            {data && (
              <>
                <div className="grid grid-cols-4 gap-1 text-center">
                  {([
                    ['1y', data.cagr_1y],
                    ['5y', data.cagr_5y],
                    ['10y', data.cagr_10y],
                    ['20y', data.cagr_20y],
                  ] as Array<[string, number | null]>).map(([k, v]) => (
                    <button
                      key={k}
                      type="button"
                      disabled={v == null}
                      onClick={() => v != null && onApply(Number(v.toFixed(2)))}
                      className="rounded border border-border/60 px-1 py-1 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={v != null ? `Apply ${v.toFixed(2)}% as the projection rate` : 'No data'}
                    >
                      <div className="text-[9px] text-muted-foreground">{k}</div>
                      <div
                        className={`text-[11px] font-semibold tabular-nums ${
                          v == null ? '' : v >= 0 ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        {fmtPct(v)}
                      </div>
                    </button>
                  ))}
                </div>
                {data.sparkline_5y.length > 1 && (
                  <div className="h-10 mt-1.5">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.sparkline_5y.map((v, i) => ({ i, v }))}>
                        <YAxis hide domain={['dataMin', 'dataMax']} />
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke="hsl(var(--primary))"
                          strokeWidth={1.25}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="text-[9px] text-muted-foreground mt-1">
                  {data.symbol} · as of {new Date(data.as_of).toLocaleDateString()}
                </div>
              </>
            )}
          </div>
        )}

        {/* User's realized rate from snapshots */}
        <div className="rounded-md border border-border/60 bg-muted/20 p-2">
          <div className="text-[10px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
            {realizedDelta != null && realizedDelta >= 0 ? (
              <TrendingUp className="h-3 w-3 text-emerald-500" />
            ) : (
              <TrendingDown className="h-3 w-3 text-rose-500" />
            )}
            Your realized rate (from snapshots)
          </div>
          {realized.cagr_pct == null ? (
            <div className="text-[10px] text-muted-foreground italic">
              Need at least 2 monthly snapshots to compute.
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div>
                <div
                  className={`text-sm font-semibold tabular-nums ${
                    realized.cagr_pct >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {fmtPct(realized.cagr_pct)} <span className="text-[9px] text-muted-foreground">/yr</span>
                </div>
                <div className="text-[9px] text-muted-foreground">
                  over {realized.window_years?.toFixed(1)}y window · contribution-adjusted
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                onClick={() => onApply(Number(realized.cagr_pct!.toFixed(2)))}
              >
                Use
              </Button>
            </div>
          )}
        </div>

        {/* Manual override */}
        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
          <label className="text-[10px] text-muted-foreground">Custom %</label>
          <Input
            type="number"
            step="0.5"
            defaultValue={currentRate}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onApply(n);
            }}
            className="h-7 text-xs"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
