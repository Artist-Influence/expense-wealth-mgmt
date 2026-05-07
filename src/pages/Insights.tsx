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
  RefreshCw, PiggyBank, AlertTriangle, CheckCircle2, CreditCard, Calendar, ChevronDown, X,
  Lightbulb, ArrowUpRight, ArrowDownRight, Wallet, Sparkles
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NON_EARNING_TYPES } from '@/lib/income-classifier';
import { effectiveCategory } from '@/lib/categorization-engine';

// Mirror of effectiveCategory: prefer the user-confirmed value, fall back to the
// engine's prediction. Most rows have predicted_method populated but final_method
// still null, so reading only final_method makes the chart look like "Unknown 100%".
const effectiveMethod = (t: { final_method: string | null; predicted_method: string | null }) => {
  const raw = (t.final_method || t.predicted_method || '').trim();
  if (!raw) return 'Unknown';
  // Amex: collapse "Amex Platinum" / "Amex" — single card
  if (/^amex/i.test(raw)) return 'Amex';
  // Bank of America: keep per-account distinction (last-4 or label) so each card is its own slice
  const boa = raw.match(/^boa\s*(.+)$/i) || raw.match(/^bank of america\s*(.+)$/i);
  if (boa) {
    const tail = boa[1].trim();
    return /^\d{3,}$/.test(tail) ? `BoA •${tail}` : `BoA ${tail}`;
  }
  if (/^boa$|^bank of america$/i.test(raw)) return 'Bank of America';
  return raw;
};

// Personal wealth destinations: outbound transfers that count as "saved into wealth"
// rather than spent. Order matters — first match wins.
const WEALTH_DESTINATIONS: [RegExp, string][] = [
  [/wealthfront/i, 'Wealthfront'],
  [/gemini/i, 'Gemini'],
  [/\bdub\b/i, 'Dub'],
  [/coinbase/i, 'Coinbase'],
  [/robinhood/i, 'Robinhood'],
  [/betterment/i, 'Betterment'],
  [/fidelity/i, 'Fidelity'],
  [/vanguard/i, 'Vanguard'],
  [/(?:charles\s*)?schwab/i, 'Schwab'],
  [/kraken/i, 'Kraken'],
  [/binance/i, 'Binance'],
  [/collectr/i, 'Collectr'],
];
const wealthDestination = (t: { description_normalized: string | null; description_raw: string | null }): string | null => {
  // Check BOTH fields — the normalizer often strips merchant names from ACH descriptions
  // (e.g. "Wealthfront DES:EDI PYMNTS …" normalizes to just "PYMNTS ID:… INDN:…").
  const haystack = `${t.description_raw || ''} ${t.description_normalized || ''}`.trim();
  if (!haystack) return null;
  for (const [pattern, label] of WEALTH_DESTINATIONS) {
    if (pattern.test(haystack)) return label;
  }
  return null;
};

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
  transfer_type: string | null;
  exclude_from_expense_totals: boolean;
  parse_status: string;
  is_split_parent: boolean;
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

// Review-mode → which review_status values we count in totals/charts.
//   manual    = only what's been clicked through (current legacy behavior)
//   suggested = adds rule/AI suggested rows that haven't been clicked yet (NEW DEFAULT)
//   all       = also include needs_review (raw cash-flow view)
type ReviewMode = 'manual' | 'suggested' | 'all';
const REVIEW_MODE_KEY = 'insights_review_mode';
const STATUSES_BY_MODE: Record<ReviewMode, ReadonlyArray<string>> = {
  manual:    ['approved', 'auto_categorized', 'edited'],
  suggested: ['approved', 'auto_categorized', 'edited', 'suggested', 'ai_suggested'],
  all:       ['approved', 'auto_categorized', 'edited', 'suggested', 'ai_suggested', 'needs_review'],
};
const REVIEW_MODE_LABEL: Record<ReviewMode, string> = {
  manual: 'Approved only',
  suggested: 'Approved + suggested',
  all: 'Include needs-review',
};
const readReviewMode = (): ReviewMode => {
  if (typeof window === 'undefined') return 'suggested';
  const v = window.localStorage.getItem(REVIEW_MODE_KEY);
  if (v === 'manual' || v === 'suggested' || v === 'all') return v;
  return 'suggested';
};

export default function Insights() {
  const { user, isInvestor } = useAuth();
  const [mode, setMode] = useState<'personal' | 'business'>(isInvestor ? 'business' : 'personal');
  const [modeAutoSet, setModeAutoSet] = useState(isInvestor ? true : false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [incomeData, setIncomeData] = useState<IncomeTransaction[]>([]);
  const [taxReservePct, setTaxReservePct] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Review-mode filter (drives every chart/card)
  const [reviewMode, setReviewMode] = useState<ReviewMode>(readReviewMode);
  const COUNTED_STATUSES = useMemo(() => new Set(STATUSES_BY_MODE[reviewMode]), [reviewMode]);
  const isCounted = (s: string) => COUNTED_STATUSES.has(s);
  const setReviewModePersisted = (m: ReviewMode) => {
    setReviewMode(m);
    if (typeof window !== 'undefined') window.localStorage.setItem(REVIEW_MODE_KEY, m);
  };

  // ─── Date filter (default: This Year) ───
  const _now = new Date();
  const [dateFrom, setDateFrom] = useState<string | null>(`${_now.getFullYear()}-01-01`);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [dateLabel, setDateLabel] = useState<string>('Year to Date');
  const [hiddenTrendCats, setHiddenTrendCats] = useState<Set<string>>(new Set());

  // Auto-pick the mode that actually has data on first load
  useEffect(() => {
    if (!user || modeAutoSet) return;
    (async () => {
      const [{ count: pCount }, { count: bCount }] = await Promise.all([
        supabase.from('transactions_uploaded').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).eq('mode', 'personal'),
        supabase.from('transactions_uploaded').select('id', { count: 'exact', head: true }).eq('owner_id', user.id).eq('mode', 'business'),
      ]);
      const personalN = pCount || 0;
      const businessN = bCount || 0;
      if (businessN > personalN) setMode('business');
      setModeAutoSet(true);
    })();
  }, [user, modeAutoSet]);

  useEffect(() => {
    if (user) loadData();
  }, [user, mode]);

  const loadData = async () => {
    setLoading(true);
    const [expenseResult, incomeResult, taxResult] = await Promise.all([
      loadExpenses(),
      loadIncome(),
      supabase.from('tax_profiles').select('default_federal_reserve_percent, default_nys_reserve_percent, default_nyc_reserve_percent').eq('owner_id', user!.id).maybeSingle(),
    ]);
    setTransactions(expenseResult);
    setIncomeData(incomeResult);
    if (taxResult.data) {
      setTaxReservePct(
        (Number(taxResult.data.default_federal_reserve_percent) || 0) +
        (Number(taxResult.data.default_nys_reserve_percent) || 0) +
        (Number(taxResult.data.default_nyc_reserve_percent) || 0)
      );
    }
    setLoading(false);
  };

  const loadExpenses = async (): Promise<Transaction[]> => {
    let from = 0, pageSize = 1000, allData: Transaction[] = [], hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('transactions_uploaded')
        .select('date, description_raw, description_normalized, amount, final_category, predicted_category, final_method, predicted_method, review_status, is_transfer, transfer_type, exclude_from_expense_totals, parse_status, is_split_parent')
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
        .select('date, amount, income_type, taxable_status, status, mode')
        .eq('owner_id', user!.id)
        .eq('mode', mode)
        .range(from, from + pageSize - 1);
      if (data) allData = [...allData, ...(data as IncomeTransaction[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    return allData;
  };

  // ─── Date filter helpers ───
  const fmtYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtMonthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  };
  const clearDates = () => { setDateFrom(null); setDateTo(null); setDateLabel('All Dates'); };
  const applyMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    setDateFrom(fmtYMD(new Date(y, m - 1, 1)));
    setDateTo(fmtYMD(new Date(y, m, 0)));
    setDateLabel(fmtMonthLabel(ym));
  };
  const applyThisMonth = () => {
    const n = new Date();
    applyMonth(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`);
    setDateLabel('This Month');
  };
  const applyLastMonth = () => {
    const n = new Date();
    const d = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    applyMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setDateLabel('Last Month');
  };
  const applyLastNDays = (n: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - n);
    setDateFrom(fmtYMD(from));
    setDateTo(fmtYMD(to));
    setDateLabel(`Last ${n} Days`);
  };
  const applyThisQuarter = () => {
    const n = new Date();
    const q = Math.floor(n.getMonth() / 3);
    setDateFrom(fmtYMD(new Date(n.getFullYear(), q * 3, 1)));
    setDateTo(fmtYMD(new Date(n.getFullYear(), q * 3 + 3, 0)));
    setDateLabel('This Quarter');
  };
  const applyYTD = () => {
    const n = new Date();
    setDateFrom(`${n.getFullYear()}-01-01`);
    setDateTo(fmtYMD(n));
    setDateLabel('Year to Date');
  };
  const applyLastYear = () => {
    const y = new Date().getFullYear() - 1;
    setDateFrom(`${y}-01-01`);
    setDateTo(`${y}-12-31`);
    setDateLabel(`${y}`);
  };
  const onCustomFrom = (v: string) => {
    setDateFrom(v || null);
    setDateLabel(v || dateTo ? `${v || '…'} – ${dateTo || '…'}` : 'All Dates');
  };
  const onCustomTo = (v: string) => {
    setDateTo(v || null);
    setDateLabel(dateFrom || v ? `${dateFrom || '…'} – ${v || '…'}` : 'All Dates');
  };
  const dateActive = !!(dateFrom || dateTo);
  const inDateRange = (date: string | null | undefined) => {
    if (!dateActive) return true;
    if (!date) return false;
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    return true;
  };

  // Months derived from transactions
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => { if (t.date) set.add(t.date.slice(0, 7)); });
    incomeData.forEach(t => { if (t.date) set.add(t.date.slice(0, 7)); });
    return Array.from(set).sort().reverse();
  }, [transactions, incomeData]);

  // All expenses (mode-scoped, valid) — NOT date-filtered, used for overview "This Month / Last Month"
  const allExpenses = useMemo(() => transactions.filter(t => !t.exclude_from_expense_totals && !t.is_split_parent), [transactions]);

  // Date-filtered expenses (drives all charts)
  const expenses = useMemo(() => allExpenses.filter(t => inDateRange(t.date)), [allExpenses, dateFrom, dateTo]);

  // ─── SPENDING TAB DATA ───
  const overview = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

    // Calendar-month cards always reflect actual current/prior calendar month (momentum context)
    const thisMonthTxns = allExpenses.filter(t => t.date?.startsWith(thisMonth));
    const lastMonthTxns = allExpenses.filter(t => t.date?.startsWith(lastMonth));
    const thisMonthSpend = thisMonthTxns.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const lastMonthSpend = lastMonthTxns.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const momChange = lastMonthSpend > 0 ? ((thisMonthSpend - lastMonthSpend) / lastMonthSpend) * 100 : 0;

    // Top Cat / Top Merchant respect the active date range
    const approvedScoped = expenses.filter(t => isCounted(t.review_status));
    const catMap = new Map<string, number>();
    approvedScoped.forEach(t => {
      const cat = effectiveCategory(t) || 'Uncategorized';
      catMap.set(cat, (catMap.get(cat) || 0) + Math.abs(t.amount || 0));
    });
    const topCategory = [...catMap.entries()].sort((a, b) => b[1] - a[1])[0];

    const merchMap = new Map<string, number>();
    approvedScoped.forEach(t => {
      const desc = (t.description_normalized || t.description_raw || 'Unknown').substring(0, 30);
      merchMap.set(desc, (merchMap.get(desc) || 0) + Math.abs(t.amount || 0));
    });
    const topMerchant = [...merchMap.entries()].sort((a, b) => b[1] - a[1])[0];

    // Transfers excluded — respect date range
    const transfersExcluded = transactions
      .filter(t => t.exclude_from_expense_totals && inDateRange(t.date))
      .reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    // Period total (drives clarity when filter != "this month")
    const periodSpend = expenses.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    return { thisMonthSpend, lastMonthSpend, momChange, topCategory, topMerchant, transfersExcluded, periodSpend };
  }, [expenses, allExpenses, transactions, dateFrom, dateTo]);

  // Only approved/edited data in charts
  const approvedExpenses = useMemo(() => expenses.filter(t => isCounted(t.review_status)), [expenses, COUNTED_STATUSES]);

  const categoryData = useMemo(() => {
    const catMap = new Map<string, number>();
    approvedExpenses.forEach(t => {
      const cat = effectiveCategory(t) || 'Uncategorized';
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
  const earnedIncomeAll = useMemo(() => incomeData.filter(t => !(NON_EARNING_TYPES as readonly string[]).includes(t.income_type)), [incomeData]);
  // Date-filtered earned income (drives savings rate totals shown to user)
  const earnedIncome = useMemo(() => earnedIncomeAll.filter(t => inDateRange(t.date)), [earnedIncomeAll, dateFrom, dateTo]);

  // ─── INCOME & SAVINGS TAB DATA ───
  // Income vs Expenses chart uses ALL data with its own last-12-months window (independent of filter)
  const incomeVsExpenses = useMemo(() => {
    const monthMap = new Map<string, { income: number; expenses: number }>();
    allExpenses.forEach(t => {
      if (!t.date) return;
      const m = t.date.substring(0, 7);
      const entry = monthMap.get(m) || { income: 0, expenses: 0 };
      entry.expenses += Math.abs(t.amount || 0);
      monthMap.set(m, entry);
    });
    earnedIncomeAll.forEach(t => {
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
  }, [allExpenses, earnedIncomeAll]);

  const savingsRate = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const getMonthKey = (offset: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    // Current/trailing rates always use calendar-current data (not the active filter)
    const calcRate = (months: string[]) => {
      let inc = 0, exp = 0;
      earnedIncomeAll.forEach(t => { if (t.date && months.includes(t.date.substring(0, 7))) inc += Math.abs(t.amount || 0); });
      allExpenses.forEach(t => { if (t.date && months.includes(t.date.substring(0, 7))) exp += Math.abs(t.amount || 0); });
      return inc > 0 ? ((inc - exp) / inc) * 100 : 0;
    };

    const currentRate = calcRate([thisMonth]);
    const trailing3 = calcRate([getMonthKey(0), getMonthKey(1), getMonthKey(2)]);

    // Totals reflect the active date filter
    const totalIncome = earnedIncome.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    return { currentRate, trailing3, totalIncome, totalExpenses };
  }, [expenses, earnedIncome, allExpenses, earnedIncomeAll]);

  // YoY uses calendar-year math, independent of active filter
  const yoyComparison = useMemo(() => {
    const now = new Date();
    const thisYear = now.getFullYear().toString();
    const lastYear = (now.getFullYear() - 1).toString();

    let thisYearIncome = 0, lastYearIncome = 0, thisYearExpenses = 0, lastYearExpenses = 0;
    earnedIncomeAll.forEach(t => {
      if (!t.date) return;
      if (t.date.startsWith(thisYear)) thisYearIncome += Math.abs(t.amount || 0);
      if (t.date.startsWith(lastYear)) lastYearIncome += Math.abs(t.amount || 0);
    });
    allExpenses.forEach(t => {
      if (!t.date) return;
      if (t.date.startsWith(thisYear)) thisYearExpenses += Math.abs(t.amount || 0);
      if (t.date.startsWith(lastYear)) lastYearExpenses += Math.abs(t.amount || 0);
    });

    // Saved-to-Wealth: walk the FULL transactions array (brokerage transfers
    // are excluded from allExpenses, so we have to look at the raw set).
    // Match if (a) it's already flagged as a brokerage_transfer, or
    // (b) the description matches a known wealth destination.
    const thisYearByDest: Record<string, number> = {};
    const lastYearByDest: Record<string, number> = {};
    transactions.forEach(t => {
      if (!t.date) return;
      const dest = wealthDestination(t) || (t.transfer_type === 'brokerage_transfer' ? 'Other Brokerage' : null);
      if (!dest) return;
      const amt = Math.abs(t.amount || 0);
      if (t.date.startsWith(thisYear)) thisYearByDest[dest] = (thisYearByDest[dest] || 0) + amt;
      if (t.date.startsWith(lastYear)) lastYearByDest[dest] = (lastYearByDest[dest] || 0) + amt;
    });
    const thisYearSaved = Object.values(thisYearByDest).reduce((s, v) => s + v, 0);
    const lastYearSaved = Object.values(lastYearByDest).reduce((s, v) => s + v, 0);

    // Sorted destination list (by current-year total desc, then last-year)
    const destNames = Array.from(new Set([...Object.keys(thisYearByDest), ...Object.keys(lastYearByDest)]))
      .sort((a, b) => (thisYearByDest[b] || 0) - (thisYearByDest[a] || 0) || (lastYearByDest[b] || 0) - (lastYearByDest[a] || 0));

    const pctChange = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : 0;

    return {
      thisYear: { income: thisYearIncome, expenses: thisYearExpenses, savedToWealth: thisYearSaved, byDestination: thisYearByDest },
      lastYear: { income: lastYearIncome, expenses: lastYearExpenses, savedToWealth: lastYearSaved, byDestination: lastYearByDest },
      destinations: destNames,
      incomeChange: pctChange(thisYearIncome, lastYearIncome),
      expenseChange: pctChange(thisYearExpenses, lastYearExpenses),
      savedChange: pctChange(thisYearSaved, lastYearSaved),
      trueSavingsRate: {
        thisYear: thisYearIncome > 0 ? (thisYearSaved / thisYearIncome) * 100 : 0,
        lastYear: lastYearIncome > 0 ? (lastYearSaved / lastYearIncome) * 100 : 0,
      },
    };
  }, [allExpenses, earnedIncomeAll, transactions]);

  // ─── TRENDS TAB DATA ───
  const categoryTrends = useMemo(() => {
    const catMonthMap = new Map<string, Map<string, number>>();
    approvedExpenses.forEach(t => {
      if (!t.date) return;
      const cat = effectiveCategory(t) || 'Uncategorized';
      const month = t.date.substring(0, 7);
      if (!catMonthMap.has(cat)) catMonthMap.set(cat, new Map());
      const monthMap = catMonthMap.get(cat)!;
      monthMap.set(month, (monthMap.get(month) || 0) + Math.abs(t.amount || 0));
    });

    // Top 6 categories by total spend
    const catTotals = [...catMonthMap.entries()]
      .map(([cat, months]) => ({
        cat,
        total: [...months.values()].reduce((s, v) => s + v, 0),
        months,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    // Union of months across the top 6, last 12 only
    const allMonths = new Set<string>();
    catTotals.forEach(c => c.months.forEach((_, m) => allMonths.add(m)));
    const sortedMonths = [...allMonths].sort().slice(-12);

    // Reshape into one row per month with one key per category for a multi-line chart
    const rows = sortedMonths.map(m => {
      const [y, mo] = m.split('-').map(Number);
      const label = new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
      const row: Record<string, number | string> = { month: m, label };
      catTotals.forEach(c => {
        row[c.cat] = Math.round((c.months.get(m) || 0) * 100) / 100;
      });
      return row;
    });

    const categories = catTotals.map((c, i) => ({
      name: c.cat,
      total: Math.round(c.total * 100) / 100,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

    return { rows, categories };
  }, [approvedExpenses]);

  const methodBreakdown = useMemo(() => {
    const methodMap = new Map<string, number>();
    approvedExpenses.forEach(t => {
      const method = effectiveMethod(t);
      methodMap.set(method, (methodMap.get(method) || 0) + Math.abs(t.amount || 0));
    });
    return [...methodMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  }, [approvedExpenses]);

  const dataQuality = useMemo(() => {
    const scoped = transactions.filter(t => inDateRange(t.date));
    const total = scoped.length;
    const needsReview = scoped.filter(t => t.review_status === 'needs_review').length;
    const uncategorized = scoped.filter(t => !t.final_category && !t.predicted_category).length;
    const approved = scoped.filter(t => t.review_status === 'approved').length;
    const approvalRate = total > 0 ? (approved / total) * 100 : 0;
    return { total, needsReview, uncategorized, approved, approvalRate };
  }, [transactions, dateFrom, dateTo]);

  // ─── CASH FLOW (Money In vs Out) ───
  // Respects active date filter. Falls back to "all dates" if no filter is active.
  const cashFlow = useMemo(() => {
    const moneyIn = earnedIncome.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const moneyOut = expenses.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const net = moneyIn - moneyOut;
    const savingsPct = moneyIn > 0 ? (net / moneyIn) * 100 : 0;

    // Compute prior equal-length window for comparison
    let priorMoneyIn = 0, priorMoneyOut = 0;
    if (dateActive && dateFrom && dateTo) {
      const fromD = new Date(dateFrom);
      const toD = new Date(dateTo);
      const days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);
      const priorTo = new Date(fromD); priorTo.setDate(priorTo.getDate() - 1);
      const priorFrom = new Date(priorTo); priorFrom.setDate(priorFrom.getDate() - (days - 1));
      const pf = priorFrom.toISOString().slice(0, 10);
      const pt = priorTo.toISOString().slice(0, 10);
      earnedIncomeAll.forEach(t => { if (t.date && t.date >= pf && t.date <= pt) priorMoneyIn += Math.abs(t.amount || 0); });
      allExpenses.forEach(t => { if (t.date && t.date >= pf && t.date <= pt) priorMoneyOut += Math.abs(t.amount || 0); });
    }
    const inChange = priorMoneyIn > 0 ? ((moneyIn - priorMoneyIn) / priorMoneyIn) * 100 : null;
    const outChange = priorMoneyOut > 0 ? ((moneyOut - priorMoneyOut) / priorMoneyOut) * 100 : null;

    // Months covered (for monthly averaging in suggestions)
    const monthSet = new Set<string>();
    [...expenses, ...earnedIncome].forEach(t => { if (t.date) monthSet.add(t.date.slice(0, 7)); });
    const monthsCovered = Math.max(1, monthSet.size);

    return { moneyIn, moneyOut, net, savingsPct, priorMoneyIn, priorMoneyOut, inChange, outChange, monthsCovered };
  }, [expenses, earnedIncome, earnedIncomeAll, allExpenses, dateActive, dateFrom, dateTo]);

  // Filter-aware Income vs Expenses chart (separate from the 12-month one in Income tab)
  const incomeVsExpensesScoped = useMemo(() => {
    const monthMap = new Map<string, { income: number; expenses: number }>();
    expenses.forEach(t => {
      if (!t.date) return;
      const m = t.date.substring(0, 7);
      const e = monthMap.get(m) || { income: 0, expenses: 0 };
      e.expenses += Math.abs(t.amount || 0);
      monthMap.set(m, e);
    });
    earnedIncome.forEach(t => {
      if (!t.date) return;
      const m = t.date.substring(0, 7);
      const e = monthMap.get(m) || { income: 0, expenses: 0 };
      e.income += Math.abs(t.amount || 0);
      monthMap.set(m, e);
    });
    return [...monthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, d]) => ({
        month,
        income: Math.round(d.income * 100) / 100,
        expenses: Math.round(d.expenses * 100) / 100,
        net: Math.round((d.income - d.expenses) * 100) / 100,
      }));
  }, [expenses, earnedIncome]);

  // ─── WHERE TO SAVE (Suggestions) ───
  type Suggestion = {
    id: string;
    title: string;
    impactMonthly: number; // estimated $/mo savings (used for ranking)
    why: string;
    cta?: { label: string; href: string };
    tone?: 'opportunity' | 'warning' | 'positive';
  };

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];
    const months = cashFlow.monthsCovered;

    // Discretionary categories we care about for "trim back" suggestions
    const DISCRETIONARY = new Set([
      'Dining', 'Restaurants', 'Food & Drink', 'Coffee', 'Entertainment',
      'Shopping', 'Substances', 'Rideshare', 'Travel', 'Bars', 'Alcohol',
      'Streaming', 'Hobbies', 'Personal Care',
    ]);

    // 1. Subscription audit (sum of recurring subscription monthly load + unused flags)
    const subs = recurringCharges.filter(rc => (rc.category || '').toLowerCase() === 'subscriptions');
    if (subs.length > 0) {
      const monthlyLoad = subs.reduce((s, rc) => s + rc.monthlyEstimate, 0);
      const today = new Date();
      const stale = subs.filter(rc => {
        if (!rc.lastCharged) return false;
        const last = new Date(rc.lastCharged);
        const daysSince = (today.getTime() - last.getTime()) / 86400000;
        return daysSince > 60;
      });
      if (stale.length > 0) {
        const staleMonthly = stale.reduce((s, rc) => s + rc.monthlyEstimate, 0);
        out.push({
          id: 'stale-subs',
          tone: 'warning',
          title: `${stale.length} subscription${stale.length > 1 ? 's' : ''} look unused — review & cancel`,
          impactMonthly: staleMonthly,
          why: `${stale.map(s => s.name).slice(0, 3).join(', ')}${stale.length > 3 ? '…' : ''} — no charge in 60+ days. Cancelling could save ~${fmt(staleMonthly)}/mo.`,
          cta: { label: 'Open Recurring', href: '/insights' },
        });
      }
      if (monthlyLoad > 0) {
        out.push({
          id: 'sub-load',
          tone: 'opportunity',
          title: `Your subscription load is ${fmt(monthlyLoad)}/mo`,
          impactMonthly: monthlyLoad * 0.2, // assume 20% trimmable
          why: `${subs.length} active subscriptions across ${[...new Set(subs.map(s => s.name))].length} merchants. Trimming the bottom 20% could save ~${fmt(monthlyLoad * 0.2)}/mo.`,
        });
      }
    }

    // 2. Discretionary overspend (top 3 categories above 6mo baseline)
    const catCurrentMonthly = new Map<string, number>();
    approvedExpenses.forEach(t => {
      const cat = effectiveCategory(t) || 'Uncategorized';
      if (!DISCRETIONARY.has(cat)) return;
      catCurrentMonthly.set(cat, (catCurrentMonthly.get(cat) || 0) + Math.abs(t.amount || 0));
    });
    // 6-month baseline from ALL data (not just date-scoped)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const baselineCutoff = sixMonthsAgo.toISOString().slice(0, 10);
    const catBaselineTotals = new Map<string, number>();
    const baselineMonthSet = new Set<string>();
    allExpenses
      .filter(t => isCounted(t.review_status))
      .filter(t => t.date && t.date >= baselineCutoff)
      .forEach(t => {
        const cat = effectiveCategory(t) || 'Uncategorized';
        if (!DISCRETIONARY.has(cat)) return;
        catBaselineTotals.set(cat, (catBaselineTotals.get(cat) || 0) + Math.abs(t.amount || 0));
        if (t.date) baselineMonthSet.add(t.date.slice(0, 7));
      });
    const baselineMonths = Math.max(1, baselineMonthSet.size);
    const overspendCandidates: { cat: string; current: number; baseline: number; over: number }[] = [];
    catCurrentMonthly.forEach((total, cat) => {
      const currentMonthly = total / months;
      const baselineMonthly = (catBaselineTotals.get(cat) || 0) / baselineMonths;
      if (baselineMonthly > 0 && currentMonthly > baselineMonthly * 1.2) {
        overspendCandidates.push({
          cat,
          current: currentMonthly,
          baseline: baselineMonthly,
          over: currentMonthly - baselineMonthly,
        });
      }
    });
    overspendCandidates
      .sort((a, b) => b.over - a.over)
      .slice(0, 3)
      .forEach(c => {
        const pct = ((c.current - c.baseline) / c.baseline) * 100;
        out.push({
          id: `overspend-${c.cat}`,
          tone: 'warning',
          title: `${c.cat} is ${pct.toFixed(0)}% above your baseline`,
          impactMonthly: c.over,
          why: `Currently ~${fmt(c.current)}/mo vs 6-mo baseline of ${fmt(c.baseline)}/mo. Trim back to baseline → save ~${fmt(c.over)}/mo.`,
        });
      });

    // 3. Duplicate-service detection (2+ recurring in same category)
    const recByCat = new Map<string, typeof recurringCharges>();
    recurringCharges.forEach(rc => {
      const cat = rc.category || 'Uncategorized';
      if (!recByCat.has(cat)) recByCat.set(cat, []);
      recByCat.get(cat)!.push(rc);
    });
    recByCat.forEach((list, cat) => {
      if (list.length < 2 || cat === 'Uncategorized') return;
      // Don't flag categories where multiple charges are normal (Utilities, Insurance, etc.)
      if (['Utilities', 'Insurance', 'Rent', 'Mortgage', 'Tax', 'Loans'].includes(cat)) return;
      const sorted = [...list].sort((a, b) => a.monthlyEstimate - b.monthlyEstimate);
      const cheaper = sorted[0];
      out.push({
        id: `duplicate-${cat}`,
        tone: 'opportunity',
        title: `${list.length} ${cat} subscriptions — consider consolidating`,
        impactMonthly: cheaper.monthlyEstimate,
        why: `${list.map(l => l.name).slice(0, 3).join(', ')}. Cancelling the cheapest (${cheaper.name}) saves ~${fmt(cheaper.monthlyEstimate)}/mo.`,
      });
    });

    // 4. High-frequency small charges (8+ txns, avg <$15)
    const merchAgg = new Map<string, { count: number; total: number }>();
    approvedExpenses.forEach(t => {
      const desc = (t.description_normalized || t.description_raw || 'Unknown').substring(0, 40);
      const e = merchAgg.get(desc) || { count: 0, total: 0 };
      e.count++; e.total += Math.abs(t.amount || 0);
      merchAgg.set(desc, e);
    });
    const smallCharges = [...merchAgg.entries()]
      .filter(([, d]) => d.count >= 8 && (d.total / d.count) < 15)
      .map(([name, d]) => ({ name, count: d.count, total: d.total, monthly: d.total / months }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 2);
    smallCharges.forEach(s => {
      out.push({
        id: `small-${s.name}`,
        tone: 'opportunity',
        title: `Small charges at ${s.name} add up`,
        impactMonthly: s.monthly * 0.5,
        why: `${s.count} visits totaling ${fmt(s.total)} (~${fmt(s.monthly)}/mo). Halving the frequency saves ~${fmt(s.monthly * 0.5)}/mo.`,
      });
    });

    // 5. Savings headroom — positive net but low savings rate
    if (cashFlow.net > 0 && cashFlow.savingsPct < 20 && cashFlow.moneyIn > 0) {
      const headroom = cashFlow.net / months;
      out.push({
        id: 'headroom',
        tone: 'positive',
        title: `You have ~${fmt(headroom)}/mo of unused headroom`,
        impactMonthly: headroom,
        why: `Net savings rate is ${cashFlow.savingsPct.toFixed(1)}% (target 20%+). Route surplus to investments via Allocations.`,
        cta: { label: 'Open Allocations', href: '/allocations' },
      });
    }

    // 5b. Negative net warning
    if (cashFlow.net < 0 && cashFlow.moneyIn > 0) {
      out.push({
        id: 'negative-net',
        tone: 'warning',
        title: `Spending exceeded income by ${fmt(Math.abs(cashFlow.net))}`,
        impactMonthly: Math.abs(cashFlow.net) / months,
        why: `Money out (${fmt(cashFlow.moneyOut)}) > money in (${fmt(cashFlow.moneyIn)}) over the selected period. Trim discretionary categories first.`,
      });
    }

    // 6. Tax reserve gap (business mode only)
    if (mode === 'business' && taxReservePct > 0 && cashFlow.net > 0) {
      const recommendedReserve = cashFlow.net * (taxReservePct / 100);
      if (recommendedReserve > 100) {
        out.push({
          id: 'tax-reserve',
          tone: 'warning',
          title: `Set aside ~${fmt(recommendedReserve)} for taxes`,
          impactMonthly: recommendedReserve / months,
          why: `Net business income ${fmt(cashFlow.net)} × ${taxReservePct.toFixed(1)}% combined reserve rate. Move to tax-reserve account.`,
          cta: { label: 'Open Tax', href: '/tax' },
        });
      }
    }

    return out.sort((a, b) => b.impactMonthly - a.impactMonthly).slice(0, 6);
  }, [cashFlow, recurringCharges, approvedExpenses, allExpenses, mode, taxReservePct]);


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
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Insights</h1>
            <p className="text-[10px] text-muted-foreground">
              Showing: <span className="text-foreground/80 font-medium">{dateActive ? dateLabel : 'All Dates'}</span> · {mode === 'business' ? 'Business' : 'Personal'} · <span className="text-foreground/80 font-medium">{REVIEW_MODE_LABEL[reviewMode]}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Date filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={`h-9 gap-1.5 text-xs bg-card border-border ${dateActive ? 'border-primary/40 text-primary' : ''}`}>
                  <Calendar className="h-3.5 w-3.5" />
                  {dateActive ? dateLabel : 'All Dates'}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[340px] p-3 space-y-3" align="end">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Quick presets</div>
                  <div className="grid grid-cols-2 gap-1">
                    <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={clearDates}>All Dates</Button>
                    <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={applyThisMonth}>This Month</Button>
                    <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={applyLastMonth}>Last Month</Button>
                    <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={() => applyLastNDays(30)}>Last 30 Days</Button>
                    <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={() => applyLastNDays(90)}>Last 90 Days</Button>
                    <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={applyThisQuarter}>This Quarter</Button>
                    <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={applyYTD}>Year to Date</Button>
                    <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={applyLastYear}>Last Year</Button>
                  </div>
                </div>

                {availableMonths.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Pick a month</div>
                    <Select value="" onValueChange={(v) => v && applyMonth(v)}>
                      <SelectTrigger className="h-8 bg-card border-border text-xs">
                        <SelectValue placeholder="Select month..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-[260px]">
                        {availableMonths.map(ym => (
                          <SelectItem key={ym} value={ym}>{fmtMonthLabel(ym)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Custom range</div>
                  <div className="flex items-center gap-1.5">
                    <Input type="date" value={dateFrom || ''} onChange={(e) => onCustomFrom(e.target.value)} className="bg-card border-border h-8 text-xs flex-1" />
                    <span className="text-xs text-muted-foreground">→</span>
                    <Input type="date" value={dateTo || ''} onChange={(e) => onCustomTo(e.target.value)} className="bg-card border-border h-8 text-xs flex-1" />
                  </div>
                </div>

                <div className="flex justify-end pt-1 border-t border-border/40">
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={clearDates}>
                    <X className="h-3 w-3" /> Clear
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {dateActive && (
              <button
                onClick={clearDates}
                className="inline-flex items-center gap-1 h-9 px-2 rounded-md bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors"
                title="Clear date filter"
              >
                {dateLabel}
                <X className="h-3 w-3" />
              </button>
            )}

            <div className="flex rounded-lg border border-border/40 overflow-hidden">
              <button onClick={() => setMode('personal')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'personal' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                Personal
              </button>
              <button onClick={() => setMode('business')} className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'business' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                Business
              </button>
            </div>

            <Select value={reviewMode} onValueChange={(v) => setReviewModePersisted(v as ReviewMode)}>
              <SelectTrigger className="h-9 w-[180px] bg-card border-border text-xs" title="Which transactions are counted in totals">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="suggested">Approved + suggested</SelectItem>
                <SelectItem value="manual">Approved only</SelectItem>
                <SelectItem value="all">Include needs-review</SelectItem>
              </SelectContent>
            </Select>
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
              {/* ─── Money In vs Out (Cash Flow) ─── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="glass-panel p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <ArrowDownRight className="h-3.5 w-3.5 text-success" />
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Money In</span>
                  </div>
                  <p className="text-2xl font-semibold font-mono text-success">{fmt(cashFlow.moneyIn)}</p>
                  {cashFlow.inChange !== null && (
                    <p className={`text-[11px] font-mono mt-1 ${cashFlow.inChange >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {cashFlow.inChange >= 0 ? '↑' : '↓'} {Math.abs(cashFlow.inChange).toFixed(1)}% vs prior
                    </p>
                  )}
                </div>
                <div className="glass-panel p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <ArrowUpRight className="h-3.5 w-3.5 text-destructive" />
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Money Out</span>
                  </div>
                  <p className="text-2xl font-semibold font-mono text-destructive">{fmt(cashFlow.moneyOut)}</p>
                  {cashFlow.outChange !== null && (
                    <p className={`text-[11px] font-mono mt-1 ${cashFlow.outChange <= 0 ? 'text-success' : 'text-destructive'}`}>
                      {cashFlow.outChange >= 0 ? '↑' : '↓'} {Math.abs(cashFlow.outChange).toFixed(1)}% vs prior
                    </p>
                  )}
                </div>
                <div className="glass-panel p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Wallet className={`h-3.5 w-3.5 ${cashFlow.net >= 0 ? 'text-success' : 'text-destructive'}`} />
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Net</span>
                  </div>
                  <p className={`text-2xl font-semibold font-mono ${cashFlow.net >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {cashFlow.net >= 0 ? '+' : ''}{fmt(cashFlow.net)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">{cashFlow.monthsCovered} mo · in − out</p>
                </div>
                <div className="glass-panel p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <PiggyBank className={`h-3.5 w-3.5 ${cashFlow.savingsPct >= 20 ? 'text-success' : cashFlow.savingsPct >= 0 ? 'text-warning' : 'text-destructive'}`} />
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Savings %</span>
                  </div>
                  <p className={`text-2xl font-semibold font-mono ${cashFlow.savingsPct >= 20 ? 'text-success' : cashFlow.savingsPct >= 0 ? 'text-warning' : 'text-destructive'}`}>
                    {cashFlow.moneyIn > 0 ? `${cashFlow.savingsPct.toFixed(1)}%` : '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">target 20%+</p>
                </div>
              </div>

              {/* Income vs Expenses chart (filter-aware) */}
              {incomeVsExpensesScoped.length > 0 && (
                <div className="glass-panel p-4">
                  <h3 className="text-sm font-medium text-foreground mb-3">
                    Money In vs Out by Month <span className="text-[10px] text-muted-foreground font-normal">· {dateLabel}</span>
                  </h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={incomeVsExpensesScoped} margin={{ left: 16, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [fmt(value), name.charAt(0).toUpperCase() + name.slice(1)]} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="income" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} barSize={20} name="In" />
                      <Bar dataKey="expenses" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} barSize={20} name="Out" />
                      <Line type="monotone" dataKey="net" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: 'hsl(var(--primary))', r: 3 }} name="Net" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}

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

              {/* ─── Where to Save (Suggestions) ─── */}
              <div className="glass-panel overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-warning" />
                  <h3 className="text-sm font-medium text-foreground">Where to Save</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">Ranked by estimated monthly impact · {dateLabel}</span>
                </div>
                {suggestions.length > 0 ? (
                  <div className="divide-y divide-border/20">
                    {suggestions.map(s => {
                      const toneClass =
                        s.tone === 'warning' ? 'text-warning' :
                        s.tone === 'positive' ? 'text-success' :
                        'text-primary';
                      const Icon = s.tone === 'warning' ? AlertTriangle : s.tone === 'positive' ? Sparkles : Lightbulb;
                      return (
                        <div key={s.id} className="px-4 py-3 hover:bg-secondary/20 transition-colors">
                          <div className="flex items-start gap-3">
                            <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${toneClass}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                <p className="text-sm font-medium text-foreground">{s.title}</p>
                                <p className={`text-sm font-mono font-semibold ${toneClass}`}>
                                  ~{fmt(s.impactMonthly)}/mo
                                </p>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{s.why}</p>
                              {s.cta && (
                                <Link
                                  to={s.cta.href}
                                  className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-primary hover:underline"
                                >
                                  {s.cta.label} →
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground">Looks tight — no obvious cuts to suggest.</p>
                    <p className="text-[11px] text-muted-foreground mt-1">Focus on growing income or routing surplus to <Link to="/allocations" className="text-primary hover:underline">Allocations</Link>.</p>
                  </div>
                )}
              </div>
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
                        {mode === 'personal' && (
                          <>
                            <tr className="border-b border-border/10 bg-primary/5">
                              <td className="px-3 py-2.5 text-foreground font-semibold flex items-center gap-1.5">
                                <PiggyBank className="h-3.5 w-3.5 text-primary" />
                                Invested / Saved to Wealth
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-foreground font-semibold">{fmt(yoyComparison.lastYear.savedToWealth)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-foreground font-semibold">{fmt(yoyComparison.thisYear.savedToWealth)}</td>
                              <td className={`px-3 py-2.5 text-right font-mono font-semibold ${yoyComparison.savedChange >= 0 ? 'text-success' : 'text-destructive'}`}>
                                {yoyComparison.lastYear.savedToWealth > 0 ? `${yoyComparison.savedChange >= 0 ? '+' : ''}${yoyComparison.savedChange.toFixed(1)}%` : '—'}
                              </td>
                            </tr>
                            {yoyComparison.destinations.map(dest => (
                              <tr key={dest} className="border-b border-border/5">
                                <td className="px-3 py-1.5 pl-8 text-[11px] text-muted-foreground">↳ {dest}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-[11px] text-muted-foreground">{fmt(yoyComparison.lastYear.byDestination[dest] || 0)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-[11px] text-muted-foreground">{fmt(yoyComparison.thisYear.byDestination[dest] || 0)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-[11px] text-muted-foreground/60">—</td>
                              </tr>
                            ))}
                          </>
                        )}
                        <tr className="border-b border-border/10">
                          <td className="px-3 py-2.5 text-foreground font-medium">Net Saved (Income − Expenses)</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmt(yoyComparison.lastYear.income - yoyComparison.lastYear.expenses)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmt(yoyComparison.thisYear.income - yoyComparison.thisYear.expenses)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">—</td>
                        </tr>
                        {mode === 'personal' && (
                          <tr>
                            <td className="px-3 py-2.5 text-foreground font-medium">True Savings Rate <span className="text-[10px] text-muted-foreground">(Saved ÷ Income)</span></td>
                            <td className="px-3 py-2.5 text-right font-mono text-foreground">{yoyComparison.lastYear.income > 0 ? `${yoyComparison.trueSavingsRate.lastYear.toFixed(1)}%` : '—'}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-foreground">{yoyComparison.thisYear.income > 0 ? `${yoyComparison.trueSavingsRate.thisYear.toFixed(1)}%` : '—'}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">—</td>
                          </tr>
                        )}
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
                          label={({ name, percent, value }: any) => `${name} · $${Math.round(Number(value) || 0).toLocaleString()} (${(percent * 100).toFixed(0)}%)`}
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

                {/* Category Trends — multi-line chart with totals */}
                <div className="glass-panel p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-foreground">Category Trends (Top 6)</h3>
                    <span className="text-[10px] text-muted-foreground">
                      Total: <span className="text-foreground font-semibold font-mono">
                        {fmt(categoryTrends.categories
                          .filter(c => !hiddenTrendCats.has(c.name))
                          .reduce((s, c) => s + c.total, 0))}
                      </span>
                    </span>
                  </div>
                  {categoryTrends.rows.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={categoryTrends.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" opacity={0.5} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                          <YAxis
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            tickFormatter={(v: number) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
                          />
                          <Tooltip
                            contentStyle={tooltipStyle}
                            formatter={(value: number, name: string) => [fmt(Number(value) || 0), name]}
                          />
                          {categoryTrends.categories.map(c => (
                            <Line
                              key={c.name}
                              type="monotone"
                              dataKey={c.name}
                              stroke={c.color}
                              strokeWidth={2}
                              dot={{ r: 3 }}
                              activeDot={{ r: 5 }}
                              connectNulls
                              hide={hiddenTrendCats.has(c.name)}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
                        {categoryTrends.categories.map(c => {
                          const off = hiddenTrendCats.has(c.name);
                          return (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => setHiddenTrendCats(prev => {
                                const next = new Set(prev);
                                if (next.has(c.name)) next.delete(c.name); else next.add(c.name);
                                return next;
                              })}
                              className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                                off
                                  ? 'border-border/40 text-muted-foreground/60 line-through'
                                  : 'border-border/60 text-foreground hover:border-foreground/40'
                              }`}
                              title={off ? 'Click to show' : 'Click to hide'}
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: off ? 'hsl(var(--muted))' : c.color }}
                              />
                              {c.name}
                              <span className="text-muted-foreground font-mono">{fmt(c.total)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
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
