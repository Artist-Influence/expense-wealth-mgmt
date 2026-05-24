import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';

export type Snapshot = { account_id: string; as_of_date: string; balance: number };
export type AccountLite = { id: string; account_name: string; mode: string; current_balance: number };

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

const fmt = (n: number) => '$' + Math.round(n).toLocaleString();

// Parse YYYY-MM-DD as a LOCAL date (avoid UTC midnight shifting back a day in
// negative-offset timezones, which would mis-label Jan-26 as "Dec 25" etc.).
const parseLocalDate = (yyyymmdd: string) => {
  const [y, mo, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, (mo || 1) - 1, d || 1);
};
const labelForMonth = (yyyymmdd: string) =>
  parseLocalDate(yyyymmdd).toLocaleString('en-US', { month: 'short', year: '2-digit' });
const labelForDate = (yyyymmdd: string) =>
  parseLocalDate(yyyymmdd).toLocaleString('en-US', { month: 'short', day: 'numeric' });
const fullDateLabel = (yyyymmdd: string) =>
  parseLocalDate(yyyymmdd).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function CombinedWealthChart({
  accounts,
  snapshots,
  startDate = '2026-01-01',
}: {
  accounts: AccountLite[];
  snapshots: Snapshot[];
  /** Earliest month to render on the x-axis (YYYY-MM-DD). Defaults to Jan 2026. */
  startDate?: string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const colorFor = (id: string) => {
    const idx = accounts.findIndex(a => a.id === id);
    return PALETTE[idx % PALETTE.length];
  };

  // Build month series from min snapshot date through current month, plus a "today" point.
  const series = useMemo(() => {
    if (accounts.length === 0) return [] as any[];

    // Collect all (account_id -> sorted snapshots)
    const byAcc = new Map<string, Snapshot[]>();
    for (const s of snapshots) {
      if (!byAcc.has(s.account_id)) byAcc.set(s.account_id, []);
      byAcc.get(s.account_id)!.push(s);
    }
    byAcc.forEach(arr => arr.sort((a, b) => a.as_of_date.localeCompare(b.as_of_date)));

    // Build list of month keys (YYYY-MM-01) from earliest snapshot to current month
    const allDates = snapshots.map(s => s.as_of_date).sort();
    if (allDates.length === 0) {
      // No history yet — just plot today's current balances as a single point
      const today = new Date().toISOString().slice(0, 10);
      const row: any = { label: 'Today', _date: today };
      let total = 0;
      accounts.forEach(a => {
        if (hidden.has(a.id)) return;
        row[a.id] = Number(a.current_balance) || 0;
        total += Number(a.current_balance) || 0;
      });
      row.total = total;
      return [row];
    }

    // Clamp the chart's start to max(startDate, earliest snapshot) so old stray
    // auto-snapshots from account-creation day don't shift the x-axis backwards.
    const earliest = allDates[0];
    const effectiveStart = startDate > earliest ? startDate : earliest;
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    // Use the actual set of snapshot dates (deduped, sorted, clamped to effectiveStart)
    // so each entry produces its own dot on the chart.
    const dates = Array.from(new Set(snapshots.map(s => s.as_of_date)))
      .filter(d => d >= effectiveStart && d <= todayKey)
      .sort();

    // Helper: most recent snapshot at-or-before a given date for an account.
    const balanceAt = (accId: string, dateStr: string): number | null => {
      const arr = byAcc.get(accId) || [];
      let last: number | null = null;
      for (const s of arr) {
        if (s.as_of_date <= dateStr) last = Number(s.balance);
        else break;
      }
      return last;
    };

    const rows = dates.map(d => {
      const label = labelForDate(d);
      const row: any = { label, _date: d };
      let total = 0;
      let any = false;
      for (const a of accounts) {
        const v = balanceAt(a.id, d);
        if (v != null) {
          row[a.id] = v;
          if (!hidden.has(a.id)) {
            total += v;
            any = true;
          }
        }
      }
      row.total = any ? total : null;
      return row;
    });

    // Append a "Today" anchor only if today is strictly after the last snapshot date.
    if (dates.length === 0 || todayKey > dates[dates.length - 1]) {
      const todayRow: any = { label: 'Today', _date: todayKey };
      let totalToday = 0;
      let anyToday = false;
      for (const a of accounts) {
        const v = Number(a.current_balance) || balanceAt(a.id, todayKey) || 0;
        todayRow[a.id] = v;
        if (!hidden.has(a.id)) {
          totalToday += v;
          anyToday = true;
        }
      }
      todayRow.total = anyToday ? totalToday : null;
      rows.push(todayRow);
    }


    // Defensive: chronological order regardless of how anchors were added.
    rows.sort((a, b) => a._date.localeCompare(b._date));
    return rows;
  }, [accounts, snapshots, hidden, startDate]);

  const toggle = (id: string) => {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (accounts.length === 0) return null;

  const visibleAccounts = accounts.filter(a => !hidden.has(a.id));
  const grandTotalNow = visibleAccounts.reduce((s, a) => s + (Number(a.current_balance) || 0), 0);

  return (
    <Card>
      <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          <CardTitle className="text-[11px] font-medium text-muted-foreground">
            Wealth Over Time
          </CardTitle>
        </div>
        <div className="text-xs text-muted-foreground">
          Visible total today: <span className="text-foreground font-semibold">{fmt(grandTotalNow)}</span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelFormatter={(_label: any, payload: any) => {
                  const d = payload?.[0]?.payload?._date;
                  if (!d) return _label;
                  const today = new Date().toISOString().slice(0, 10);
                  return d === today ? 'Today' : fullDateLabel(d);
                }}
                formatter={(value: any, name: any) => {
                  if (value == null) return ['—', name];
                  const acc = accounts.find(a => a.id === name);
                  return [fmt(Number(value)), acc?.account_name || (name === 'total' ? 'Total' : name)];
                }}
              />
              {/* Total line on top */}
              <Line
                type="monotone"
                dataKey="total"
                stroke="hsl(var(--foreground))"
                strokeWidth={2.5}
                dot={{ r: 3.5 }}
                activeDot={{ r: 5 }}
                connectNulls
                name="total"
              />
              {accounts.map(a => (
                <Line
                  key={a.id}
                  type="monotone"
                  dataKey={a.id}
                  stroke={colorFor(a.id)}
                  strokeWidth={hidden.has(a.id) ? 0 : 1.75}
                  dot={hidden.has(a.id) ? false : { r: 2 }}
                  activeDot={hidden.has(a.id) ? false : { r: 3.5 }}
                  connectNulls
                  name={a.id}
                  hide={hidden.has(a.id)}
                />
              ))}
            </LineChart>
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
                title={off ? 'Click to show' : 'Click to hide'}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: off ? 'hsl(var(--muted))' : colorFor(a.id) }}
                />
                {a.account_name}
                <span className="text-muted-foreground">{fmt(Number(a.current_balance) || 0)}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
