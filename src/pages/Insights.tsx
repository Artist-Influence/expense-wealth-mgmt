import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Tag, Store, ArrowLeftRight, RefreshCw } from 'lucide-react';

interface Transaction {
  date: string | null;
  description_raw: string | null;
  description_normalized: string | null;
  amount: number | null;
  final_category: string | null;
  predicted_category: string | null;
  final_method: string | null;
  predicted_method: string | null;
  review_status: string;
  is_transfer: boolean;
  exclude_from_expense_totals: boolean;
  parse_status: string;
}

export default function Insights() {
  const { user } = useAuth();
  const [mode, setMode] = useState<'personal' | 'business'>('personal');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) loadTransactions();
  }, [user, mode]);

  const loadTransactions = async () => {
    setLoading(true);
    let from = 0, pageSize = 1000, allData: Transaction[] = [], hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('transactions_uploaded')
        .select('date, description_raw, description_normalized, amount, final_category, predicted_category, final_method, predicted_method, review_status, is_transfer, exclude_from_expense_totals, parse_status')
        .eq('owner_id', user!.id).eq('mode', mode)
        .neq('parse_status', 'parse_error')
        .range(from, from + pageSize - 1);
      if (data) allData = [...allData, ...(data as Transaction[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    setTransactions(allData);
    setLoading(false);
  };

  const expenses = useMemo(() => transactions.filter(t => !t.exclude_from_expense_totals), [transactions]);

  const overview = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

    const thisMonthTxns = expenses.filter(t => t.date?.startsWith(thisMonth));
    const lastMonthTxns = expenses.filter(t => t.date?.startsWith(lastMonth));

    const thisMonthSpend = thisMonthTxns.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const lastMonthSpend = lastMonthTxns.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const momChange = lastMonthSpend > 0 ? ((thisMonthSpend - lastMonthSpend) / lastMonthSpend) * 100 : 0;

    // Top category
    const catMap = new Map<string, number>();
    expenses.forEach(t => {
      const cat = t.final_category || t.predicted_category || 'Uncategorized';
      catMap.set(cat, (catMap.get(cat) || 0) + Math.abs(t.amount || 0));
    });
    const topCategory = [...catMap.entries()].sort((a, b) => b[1] - a[1])[0];

    // Top merchant
    const merchMap = new Map<string, number>();
    expenses.forEach(t => {
      const desc = (t.description_normalized || t.description_raw || 'Unknown').substring(0, 30);
      merchMap.set(desc, (merchMap.get(desc) || 0) + Math.abs(t.amount || 0));
    });
    const topMerchant = [...merchMap.entries()].sort((a, b) => b[1] - a[1])[0];

    const transfersExcluded = transactions.filter(t => t.exclude_from_expense_totals).reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    return { thisMonthSpend, lastMonthSpend, momChange, topCategory, topMerchant, transfersExcluded };
  }, [expenses, transactions]);

  // Category breakdown
  const categoryData = useMemo(() => {
    const catMap = new Map<string, number>();
    expenses.forEach(t => {
      const cat = t.final_category || t.predicted_category || 'Uncategorized';
      catMap.set(cat, (catMap.get(cat) || 0) + Math.abs(t.amount || 0));
    });
    return [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }));
  }, [expenses]);

  // Monthly trend
  const monthlyTrend = useMemo(() => {
    const monthMap = new Map<string, number>();
    expenses.forEach(t => {
      if (!t.date) return;
      const month = t.date.substring(0, 7);
      monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(t.amount || 0));
    });
    return [...monthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));
  }, [expenses]);

  // Top merchants
  const topMerchants = useMemo(() => {
    const merchMap = new Map<string, { total: number; count: number; category: string }>();
    expenses.forEach(t => {
      const desc = (t.description_normalized || t.description_raw || 'Unknown').substring(0, 40);
      const existing = merchMap.get(desc) || { total: 0, count: 0, category: '' };
      existing.total += Math.abs(t.amount || 0);
      existing.count++;
      existing.category = t.final_category || t.predicted_category || '';
      merchMap.set(desc, existing);
    });
    return [...merchMap.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, data]) => ({ name, ...data }));
  }, [expenses]);

  // Recurring charges (merchants seen 3+ times)
  const recurringCharges = useMemo(() => {
    const merchMap = new Map<string, { amounts: number[]; dates: string[]; category: string }>();
    expenses.forEach(t => {
      if (!t.date) return;
      const desc = (t.description_normalized || t.description_raw || '').substring(0, 40);
      const existing = merchMap.get(desc) || { amounts: [], dates: [], category: '' };
      existing.amounts.push(Math.abs(t.amount || 0));
      existing.dates.push(t.date);
      existing.category = t.final_category || t.predicted_category || '';
      merchMap.set(desc, existing);
    });
    return [...merchMap.entries()]
      .filter(([, data]) => data.amounts.length >= 3)
      .map(([name, data]) => {
        const avg = data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length;
        const sortedDates = data.dates.sort();
        const lastCharged = sortedDates[sortedDates.length - 1];
        // Estimate frequency
        const daySpan = (new Date(sortedDates[sortedDates.length - 1]).getTime() - new Date(sortedDates[0]).getTime()) / (1000 * 60 * 60 * 24);
        const avgDaysBetween = daySpan / (data.amounts.length - 1);
        let frequency = 'irregular';
        if (avgDaysBetween >= 25 && avgDaysBetween <= 35) frequency = 'monthly';
        else if (avgDaysBetween >= 6 && avgDaysBetween <= 8) frequency = 'weekly';
        else if (avgDaysBetween >= 13 && avgDaysBetween <= 16) frequency = 'biweekly';
        else if (avgDaysBetween >= 85 && avgDaysBetween <= 100) frequency = 'quarterly';
        else if (avgDaysBetween >= 350 && avgDaysBetween <= 380) frequency = 'annual';

        const monthlyEstimate = frequency === 'monthly' ? avg : frequency === 'weekly' ? avg * 4.3 : frequency === 'biweekly' ? avg * 2.15 : avg;

        return { name, avg: Math.round(avg * 100) / 100, frequency, category: data.category, lastCharged, monthlyEstimate: Math.round(monthlyEstimate * 100) / 100, count: data.amounts.length };
      })
      .sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
  }, [expenses]);

  const fmt = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-4 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold text-foreground">Insights</h1>
          <div className="flex rounded-lg border border-border/40 overflow-hidden">
            <button onClick={() => setMode('personal')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'personal' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              Personal
            </button>
            <button onClick={() => setMode('business')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'business' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              Business
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Spend Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="glass-panel-sm p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] text-muted-foreground">This Month</span>
                </div>
                <p className="text-lg font-semibold font-mono text-foreground">{fmt(overview.thisMonthSpend)}</p>
              </div>
              <div className="glass-panel-sm p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">Last Month</span>
                </div>
                <p className="text-lg font-semibold font-mono text-foreground">{fmt(overview.lastMonthSpend)}</p>
              </div>
              <div className="glass-panel-sm p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  {overview.momChange >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-destructive" /> : <TrendingDown className="h-3.5 w-3.5 text-success" />}
                  <span className="text-[11px] text-muted-foreground">MoM Change</span>
                </div>
                <p className={`text-lg font-semibold font-mono ${overview.momChange >= 0 ? 'text-destructive' : 'text-success'}`}>
                  {overview.momChange >= 0 ? '+' : ''}{overview.momChange.toFixed(1)}%
                </p>
              </div>
              <div className="glass-panel-sm p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Tag className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] text-muted-foreground">Top Category</span>
                </div>
                <p className="text-sm font-medium text-foreground truncate">{overview.topCategory?.[0] || '—'}</p>
                <p className="text-[11px] font-mono text-muted-foreground">{overview.topCategory ? fmt(overview.topCategory[1]) : ''}</p>
              </div>
              <div className="glass-panel-sm p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Store className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] text-muted-foreground">Top Merchant</span>
                </div>
                <p className="text-sm font-medium text-foreground truncate">{overview.topMerchant?.[0] || '—'}</p>
                <p className="text-[11px] font-mono text-muted-foreground">{overview.topMerchant ? fmt(overview.topMerchant[1]) : ''}</p>
              </div>
              <div className="glass-panel-sm p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">Transfers Excl.</span>
                </div>
                <p className="text-lg font-semibold font-mono text-muted-foreground">{fmt(overview.transfersExcluded)}</p>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Category Breakdown */}
              <div className="glass-panel p-4">
                <h3 className="text-sm font-medium text-foreground mb-3">Spend by Category</h3>
                {categoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={categoryData} layout="vertical" margin={{ left: 80, right: 16 }}>
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'hsl(var(--foreground))' }} width={80} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                        formatter={(value: number) => [fmt(value), 'Spend']}
                      />
                      <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>
                )}
              </div>

              {/* Monthly Trend */}
              <div className="glass-panel p-4">
                <h3 className="text-sm font-medium text-foreground mb-3">Monthly Spend Trend</h3>
                {monthlyTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={monthlyTrend} margin={{ left: 16, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                        formatter={(value: number) => [fmt(value), 'Spend']}
                      />
                      <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>
                )}
              </div>
            </div>

            {/* Top Merchants Table */}
            <div className="glass-panel overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40">
                <h3 className="text-sm font-medium text-foreground">Top Merchants</h3>
              </div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Merchant</th>
                      <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Category</th>
                      <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Total Spend</th>
                      <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMerchants.map((m, i) => (
                      <tr key={i} className="border-b border-border/10 hover:bg-secondary/20">
                        <td className="px-3 py-2 text-foreground">{m.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.category || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">{fmt(m.total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{m.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recurring Charges */}
            {recurringCharges.length > 0 && (
              <div className="glass-panel overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-sm font-medium text-foreground">Recurring Charges</h3>
                </div>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40">
                        <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Merchant</th>
                        <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Avg Amount</th>
                        <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Frequency</th>
                        <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Category</th>
                        <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Last Charged</th>
                        <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Mo. Est.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recurringCharges.map((rc, i) => (
                        <tr key={i} className="border-b border-border/10 hover:bg-secondary/20">
                          <td className="px-3 py-2 text-foreground">{rc.name}</td>
                          <td className="px-3 py-2 text-right font-mono text-foreground">{fmt(rc.avg)}</td>
                          <td className="px-3 py-2">
                            <span className="match-tag bg-primary/10 text-primary/80">{rc.frequency}</span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{rc.category || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground font-mono">{rc.lastCharged}</td>
                          <td className="px-3 py-2 text-right font-mono text-foreground">{fmt(rc.monthlyEstimate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
