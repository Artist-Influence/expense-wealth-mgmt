import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line,
  CartesianGrid, PieChart, Pie, Cell, ComposedChart, Legend
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Tag, Store, ArrowLeftRight,
  RefreshCw, PiggyBank, AlertTriangle, CheckCircle2, CreditCard
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

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

interface IncomeTransaction {
  date: string | null;
  amount: number | null;
  income_type: string;
  taxable_status: string;
  status: string;
}

const CHART_COLORS = [
  'hsl(225, 70%, 55%)', 'hsl(145, 40%, 42%)', 'hsl(38, 80%, 55%)',
  'hsl(0, 55%, 50%)', 'hsl(280, 50%, 55%)', 'hsl(180, 50%, 45%)',
  'hsl(330, 50%, 50%)', 'hsl(60, 60%, 45%)'
];

const fmt = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Insights() {
  const { user } = useAuth();
  const [mode, setMode] = useState<'personal' | 'business'>('personal');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [incomeData, setIncomeData] = useState<IncomeTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) loadData();
  }, [user, mode]);

  const loadData = async () => {
    setLoading(true);
    const [expenseResult, incomeResult] = await Promise.all([
      loadExpenses(),
      loadIncome(),
    ]);
    setTransactions(expenseResult);
    setIncomeData(incomeResult);
    setLoading(false);
  };

  const loadExpenses = async (): Promise<Transaction[]> => {
    let from = 0, pageSize = 1000, allData: Transaction[] = [], hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('transactions_uploaded')
        .select('date, description_raw, description_normalized, amount, final_category, predicted_category, final_method, predicted_method, review_status, is_transfer, exclude_from_expense_totals, parse_status')
        .eq('owner_id', user!.id).eq('mode', mode).neq('parse_status', 'parse_error')
        .range(from, from + pageSize - 1);
      if (data) allData = [...allData, ...(data as Transaction[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    return allData;
  };

  const loadIncome = async (): Promise<IncomeTransaction[]> => {
    let from = 0, pageSize = 1000, allData: IncomeTransaction[] = [], hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('income_transactions')
        .select('date, amount, income_type, taxable_status, status')
        .eq('owner_id', user!.id)
        .range(from, from + pageSize - 1);
      if (data) allData = [...allData, ...(data as IncomeTransaction[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    return allData;
  };

  const expenses = useMemo(() => transactions.filter(t => !t.exclude_from_expense_totals), [transactions]);

  // ─── SPENDING TAB DATA ───
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

    // Only use final_category from approved/edited rows for charts
    const approvedExpenses = expenses.filter(t => ['approved', 'auto_categorized', 'edited'].includes(t.review_status));
    const catMap = new Map<string, number>();
    approvedExpenses.forEach(t => {
      const cat = t.final_category || 'Uncategorized';
      catMap.set(cat, (catMap.get(cat) || 0) + Math.abs(t.amount || 0));
    });
    const topCategory = [...catMap.entries()].sort((a, b) => b[1] - a[1])[0];

    const merchMap = new Map<string, number>();
    approvedExpenses.forEach(t => {
      const desc = (t.description_normalized || t.description_raw || 'Unknown').substring(0, 30);
      merchMap.set(desc, (merchMap.get(desc) || 0) + Math.abs(t.amount || 0));
    });
    const topMerchant = [...merchMap.entries()].sort((a, b) => b[1] - a[1])[0];

    const transfersExcluded = transactions.filter(t => t.exclude_from_expense_totals).reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    return { thisMonthSpend, lastMonthSpend, momChange, topCategory, topMerchant, transfersExcluded };
  }, [expenses, transactions]);

  // Only approved/edited data in charts
  const approvedExpenses = useMemo(() => expenses.filter(t => ['approved', 'auto_categorized', 'edited'].includes(t.review_status)), [expenses]);

  const categoryData = useMemo(() => {
    const catMap = new Map<string, number>();
    approvedExpenses.forEach(t => {
      const cat = t.final_category || 'Uncategorized';
      catMap.set(cat, (catMap.get(cat) || 0) + Math.abs(t.amount || 0));
    });
    return [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }));
  }, [approvedExpenses]);

  const monthlyTrend = useMemo(() => {
    const monthMap = new Map<string, number>();
    approvedExpenses.forEach(t => {
      if (!t.date) return;
      const month = t.date.substring(0, 7);
      monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(t.amount || 0));
    });
    return [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));
  }, [approvedExpenses]);

  const topMerchants = useMemo(() => {
    const merchMap = new Map<string, { total: number; count: number; category: string }>();
    approvedExpenses.forEach(t => {
      const desc = (t.description_normalized || t.description_raw || 'Unknown').substring(0, 40);
      const existing = merchMap.get(desc) || { total: 0, count: 0, category: '' };
      existing.total += Math.abs(t.amount || 0);
      existing.count++;
      existing.category = t.final_category || '';
      merchMap.set(desc, existing);
    });
    return [...merchMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([name, data]) => ({ name, ...data }));
  }, [approvedExpenses]);

  const recurringCharges = useMemo(() => {
    const merchMap = new Map<string, { amounts: number[]; dates: string[]; category: string }>();
    approvedExpenses.forEach(t => {
      if (!t.date) return;
      const desc = (t.description_normalized || t.description_raw || '').substring(0, 40);
      const existing = merchMap.get(desc) || { amounts: [], dates: [], category: '' };
      existing.amounts.push(Math.abs(t.amount || 0));
      existing.dates.push(t.date);
      existing.category = t.final_category || '';
      merchMap.set(desc, existing);
    });
    return [...merchMap.entries()]
      .filter(([, data]) => data.amounts.length >= 3)
      .map(([name, data]) => {
        const avg = data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length;
        const sortedDates = data.dates.sort();
        const lastCharged = sortedDates[sortedDates.length - 1];
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
  }, [approvedExpenses]);

  // Exclude non-earning income types from savings rate math
  const NON_EARNING_TYPES = ['reimbursement', 'transfer', 'refund', 'loan_proceeds', 'owner_contribution'];
  const earnedIncome = useMemo(() => incomeData.filter(t => !NON_EARNING_TYPES.includes(t.income_type)), [incomeData]);

  // ─── INCOME & SAVINGS TAB DATA ───
  const incomeVsExpenses = useMemo(() => {
    const monthMap = new Map<string, { income: number; expenses: number }>();
    expenses.forEach(t => {
      if (!t.date) return;
      const m = t.date.substring(0, 7);
      const entry = monthMap.get(m) || { income: 0, expenses: 0 };
      entry.expenses += Math.abs(t.amount || 0);
      monthMap.set(m, entry);
    });
    earnedIncome.forEach(t => {
      if (!t.date) return;
      const m = t.date.substring(0, 7);
      const entry = monthMap.get(m) || { income: 0, expenses: 0 };
      entry.income += Math.abs(t.amount || 0);
      monthMap.set(m, entry);
    });
    return [...monthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, d]) => ({
        month,
        income: Math.round(d.income * 100) / 100,
        expenses: Math.round(d.expenses * 100) / 100,
        net: Math.round((d.income - d.expenses) * 100) / 100,
      }));
  }, [expenses, earnedIncome]);

  const savingsRate = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const getMonthKey = (offset: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const calcRate = (months: string[]) => {
      let inc = 0, exp = 0;
      earnedIncome.forEach(t => { if (t.date && months.includes(t.date.substring(0, 7))) inc += Math.abs(t.amount || 0); });
      expenses.forEach(t => { if (t.date && months.includes(t.date.substring(0, 7))) exp += Math.abs(t.amount || 0); });
      return inc > 0 ? ((inc - exp) / inc) * 100 : 0;
    };

    const currentRate = calcRate([thisMonth]);
    const trailing3 = calcRate([getMonthKey(0), getMonthKey(1), getMonthKey(2)]);

    const totalIncome = earnedIncome.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    return { currentRate, trailing3, totalIncome, totalExpenses };
  }, [expenses, earnedIncome]);

  const yoyComparison = useMemo(() => {
    const now = new Date();
    const thisYear = now.getFullYear().toString();
    const lastYear = (now.getFullYear() - 1).toString();

    let thisYearIncome = 0, lastYearIncome = 0, thisYearExpenses = 0, lastYearExpenses = 0;
    // Use earnedIncome (excludes reimbursements, transfers, refunds) for YoY
    earnedIncome.forEach(t => {
      if (!t.date) return;
      if (t.date.startsWith(thisYear)) thisYearIncome += Math.abs(t.amount || 0);
      if (t.date.startsWith(lastYear)) lastYearIncome += Math.abs(t.amount || 0);
    });
    expenses.forEach(t => {
      if (!t.date) return;
      if (t.date.startsWith(thisYear)) thisYearExpenses += Math.abs(t.amount || 0);
      if (t.date.startsWith(lastYear)) lastYearExpenses += Math.abs(t.amount || 0);
    });

    const pctChange = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : 0;

    return {
      thisYear: { income: thisYearIncome, expenses: thisYearExpenses },
      lastYear: { income: lastYearIncome, expenses: lastYearExpenses },
      incomeChange: pctChange(thisYearIncome, lastYearIncome),
      expenseChange: pctChange(thisYearExpenses, lastYearExpenses),
    };
  }, [expenses, earnedIncome]);

  // ─── TRENDS TAB DATA ───
  const categoryTrends = useMemo(() => {
    const catMonthMap = new Map<string, Map<string, number>>();
    approvedExpenses.forEach(t => {
      if (!t.date) return;
      const cat = t.final_category || 'Uncategorized';
      const month = t.date.substring(0, 7);
      if (!catMonthMap.has(cat)) catMonthMap.set(cat, new Map());
      const monthMap = catMonthMap.get(cat)!;
      monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(t.amount || 0));
    });

    // Get top 6 categories by total
    const catTotals = [...catMonthMap.entries()].map(([cat, months]) => ({
      cat,
      total: [...months.values()].reduce((s, v) => s + v, 0),
      months,
    })).sort((a, b) => b.total - a.total).slice(0, 6);

    // Get all months sorted
    const allMonths = new Set<string>();
    catTotals.forEach(c => c.months.forEach((_, m) => allMonths.add(m)));
    const sortedMonths = [...allMonths].sort().slice(-12);

    return catTotals.map(c => ({
      category: c.cat,
      data: sortedMonths.map(m => ({ month: m, amount: Math.round((c.months.get(m) || 0) * 100) / 100 })),
    }));
  }, [approvedExpenses]);

  const methodBreakdown = useMemo(() => {
    const methodMap = new Map<string, number>();
    approvedExpenses.forEach(t => {
      const method = t.final_method || 'Unknown';
      methodMap.set(method, (methodMap.get(method) || 0) + Math.abs(t.amount || 0));
    });
    return [...methodMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  }, [approvedExpenses]);

  const dataQuality = useMemo(() => {
    const total = transactions.length;
    const needsReview = transactions.filter(t => t.review_status === 'needs_review').length;
    const uncategorized = transactions.filter(t => !t.final_category && !t.predicted_category).length;
    const approved = transactions.filter(t => t.review_status === 'approved').length;
    const approvalRate = total > 0 ? (approved / total) * 100 : 0;
    return { total, needsReview, uncategorized, approved, approvalRate };
  }, [transactions]);

  const tooltipStyle = {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
    color: 'hsl(var(--foreground))',
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-4 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Insights</h1>
            <p className="text-[10px] text-muted-foreground">Charts use approved/edited data only · Income is cross-mode · Expenses are {mode}-filtered</p>
          </div>
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
          <Tabs defaultValue="spending" className="space-y-4">
            <TabsList className="bg-secondary/50 border border-border/30">
              <TabsTrigger value="spending">Spending</TabsTrigger>
              <TabsTrigger value="income-savings">Income & Savings</TabsTrigger>
              <TabsTrigger value="trends">Trends</TabsTrigger>
            </TabsList>

            {/* ═══════════ SPENDING TAB ═══════════ */}
            <TabsContent value="spending" className="space-y-4">
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
                <div className="glass-panel p-4">
                  <h3 className="text-sm font-medium text-foreground mb-3">Spend by Category</h3>
                  {categoryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={categoryData} layout="vertical" margin={{ left: 80, right: 16 }}>
                        <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: 'hsl(var(--foreground))' }} width={80} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [fmt(value), 'Spend']} />
                        <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>}
                </div>

                <div className="glass-panel p-4">
                  <h3 className="text-sm font-medium text-foreground mb-3">Monthly Spend Trend</h3>
                  {monthlyTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={monthlyTrend} margin={{ left: 16, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [fmt(value), 'Spend']} />
                        <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>}
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
                            <td className="px-3 py-2"><span className="match-tag bg-primary/10 text-primary/80">{rc.frequency}</span></td>
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
            </TabsContent>

            {/* ═══════════ INCOME & SAVINGS TAB ═══════════ */}
            <TabsContent value="income-savings" className="space-y-4">
              {/* Net Savings Rate + YoY Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="glass-panel p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <PiggyBank className="h-4 w-4 text-success" />
                    <h3 className="text-sm font-medium text-foreground">Net Savings Rate</h3>
                  </div>
                  <p className="text-[9px] text-muted-foreground mb-2">(Earned Income − {mode} Expenses) / Earned Income · Excludes reimbursements, transfers, refunds</p>
                  <div className="space-y-3" style={{ marginTop: 0 }}>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-0.5">Current Month</p>
                      <p className={`text-2xl font-bold font-mono ${savingsRate.currentRate >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {savingsRate.currentRate.toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-0.5">3-Month Average</p>
                      <p className={`text-lg font-semibold font-mono ${savingsRate.trailing3 >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {savingsRate.trailing3.toFixed(1)}%
                      </p>
                    </div>
                    <div className="pt-2 border-t border-border/30 grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[11px] text-muted-foreground">Total Income</p>
                        <p className="text-sm font-mono text-foreground">{fmt(savingsRate.totalIncome)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground">Total Expenses</p>
                        <p className="text-sm font-mono text-foreground">{fmt(savingsRate.totalExpenses)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* YoY Comparison */}
                <div className="glass-panel p-4 md:col-span-2">
                  <h3 className="text-sm font-medium text-foreground mb-3">Year-over-Year Comparison</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/40">
                          <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Metric</th>
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">{new Date().getFullYear() - 1}</th>
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">{new Date().getFullYear()}</th>
                          <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-border/10">
                          <td className="px-3 py-2.5 text-foreground font-medium">Income</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmt(yoyComparison.lastYear.income)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmt(yoyComparison.thisYear.income)}</td>
                          <td className={`px-3 py-2.5 text-right font-mono font-medium ${yoyComparison.incomeChange >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {yoyComparison.incomeChange >= 0 ? '+' : ''}{yoyComparison.incomeChange.toFixed(1)}%
                          </td>
                        </tr>
                        <tr className="border-b border-border/10">
                          <td className="px-3 py-2.5 text-foreground font-medium">Expenses</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmt(yoyComparison.lastYear.expenses)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmt(yoyComparison.thisYear.expenses)}</td>
                          <td className={`px-3 py-2.5 text-right font-mono font-medium ${yoyComparison.expenseChange <= 0 ? 'text-success' : 'text-destructive'}`}>
                            {yoyComparison.expenseChange >= 0 ? '+' : ''}{yoyComparison.expenseChange.toFixed(1)}%
                          </td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2.5 text-foreground font-medium">Net Saved</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmt(yoyComparison.lastYear.income - yoyComparison.lastYear.expenses)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmt(yoyComparison.thisYear.income - yoyComparison.thisYear.expenses)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Income vs Expenses Chart */}
              <div className="glass-panel p-4">
                <h3 className="text-sm font-medium text-foreground mb-3">Income vs Expenses (Last 12 Months)</h3>
                {incomeVsExpenses.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart data={incomeVsExpenses} margin={{ left: 16, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [fmt(value), name.charAt(0).toUpperCase() + name.slice(1)]} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="income" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} barSize={20} />
                      <Bar dataKey="expenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} barSize={20} />
                      <Line type="monotone" dataKey="net" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', r: 3 }} name="net" />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>}
              </div>
            </TabsContent>

            {/* ═══════════ TRENDS TAB ═══════════ */}
            <TabsContent value="trends" className="space-y-4">
              {/* Data Quality Card */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="glass-panel-sm p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    <span className="text-[11px] text-muted-foreground">Approval Rate</span>
                  </div>
                  <p className="text-lg font-semibold font-mono text-foreground">{dataQuality.approvalRate.toFixed(1)}%</p>
                  <p className="text-[11px] text-muted-foreground">{dataQuality.approved} / {dataQuality.total}</p>
                </div>
                <div className="glass-panel-sm p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    <span className="text-[11px] text-muted-foreground">Needs Review</span>
                  </div>
                  <p className="text-lg font-semibold font-mono text-warning">{dataQuality.needsReview}</p>
                </div>
                <div className="glass-panel-sm p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">Uncategorized</span>
                  </div>
                  <p className="text-lg font-semibold font-mono text-foreground">{dataQuality.uncategorized}</p>
                </div>
                <div className="glass-panel-sm p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <DollarSign className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] text-muted-foreground">Total Transactions</span>
                  </div>
                  <p className="text-lg font-semibold font-mono text-foreground">{dataQuality.total}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Payment Method Breakdown */}
                <div className="glass-panel p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CreditCard className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-medium text-foreground">Payment Methods</h3>
                  </div>
                  {methodBreakdown.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={methodBreakdown}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                          labelLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                          fontSize={10}
                        >
                          {methodBreakdown.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [fmt(value), 'Spend']} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>}
                </div>

                {/* Category Sparklines */}
                <div className="glass-panel p-4">
                  <h3 className="text-sm font-medium text-foreground mb-3">Category Trends (Top 6)</h3>
                  {categoryTrends.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {categoryTrends.map((ct, idx) => (
                        <div key={ct.category} className="p-2 rounded-lg bg-secondary/30 border border-border/20">
                          <p className="text-[11px] font-medium text-foreground truncate mb-1">{ct.category}</p>
                          <ResponsiveContainer width="100%" height={50}>
                            <LineChart data={ct.data}>
                              <Line
                                type="monotone"
                                dataKey="amount"
                                stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                                strokeWidth={1.5}
                                dot={false}
                              />
                              <Tooltip
                                contentStyle={tooltipStyle}
                                formatter={(value: number) => [fmt(value), ct.category]}
                                labelFormatter={(label) => label}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground text-center py-10">No data yet</p>}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
