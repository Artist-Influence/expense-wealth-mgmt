import { useEffect, useState, useMemo } from 'react';
import { AppNav } from '@/components/AppNav';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { DollarSign, TrendingUp, Shield, AlertTriangle, Settings, Landmark, Building2, Building, Briefcase } from 'lucide-react';
import { fetchAllRows } from '@/lib/fetch-all';
import { effectiveCategory, deductibilityHint, type DeductibilityHint } from '@/lib/categorization-engine';

interface TaxProfile {
  id: string;
  owner_id: string;
  filing_status: string;
  state: string;
  city: string;
  resident_city_tax_enabled: boolean;
  w2_income_enabled: boolean;
  self_employment_income_enabled: boolean;
  business_owner_income_enabled: boolean;
  default_federal_reserve_percent: number;
  default_nys_reserve_percent: number;
  default_nyc_reserve_percent: number;
  custom_effective_tax_rate_optional: number | null;
  estimated_w2_withholding_ytd: number;
  estimated_tax_payments_ytd: number;
  notes: string | null;
}

interface IncomeRow {
  income_type: string;
  taxable_status: string;
  amount: number | null;
  date: string | null;
}

interface DeductionRow {
  final_category: string | null;
  predicted_category: string | null;
  amount: number | null;
  review_status: string;
  transaction_mode: string | null;
  counts_as_tax_deduction: boolean | null;
}

interface TaxPaymentRow {
  date: string | null;
  description_normalized: string | null;
  amount: number | null;
  treatment_type: string;
}

const FILING_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'married_filing_jointly', label: 'Married Filing Jointly' },
  { value: 'married_filing_separately', label: 'Married Filing Separately' },
  { value: 'head_of_household', label: 'Head of Household' },
];

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

export default function Tax() {
  const { user, ownerId, isAccountant } = useAuth();
  // toast imported from sonner at top
  const [profile, setProfile] = useState<TaxProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([]);
  const [taxPayments, setTaxPayments] = useState<TaxPaymentRow[]>([]);
  const [unreviewedDeductionCount, setUnreviewedDeductionCount] = useState(0);
  // Total dollars of unreviewed business spend that COULD become deductions
  // once categorized. Lets us tell the user "you're potentially leaving $X on
  // the table" instead of just showing $0.
  const [potentialDeductions, setPotentialDeductions] = useState<{ count: number; total: number }>({ count: 0, total: 0 });
  // Projection split: per-mode taxable income & deductions, regardless of active scope.
  const [projection, setProjection] = useState<{
    personal: { taxable: number; deductions: number };
    business: { taxable: number; deductions: number };
  }>({ personal: { taxable: 0, deductions: 0 }, business: { taxable: 0, deductions: 0 } });
  // Personal vs Business scope. Persisted across sessions.
  const [scope, setScope] = useState<'personal' | 'business' | 'all'>(() => {
    if (typeof window === 'undefined') return 'personal';
    return (localStorage.getItem('tax_scope') as 'personal' | 'business' | 'all') || 'personal';
  });
  // Year selector (default current year). Allow viewing past + projecting next year.
  const nowYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(nowYear);
  const YEAR_OPTIONS = useMemo(() => {
    const set = new Set<number>([2025, 2026, nowYear, nowYear + 1]);
    return Array.from(set).sort((a, b) => a - b);
  }, [nowYear]);

  // Draft for setup/edit form
  const [draft, setDraft] = useState<Partial<TaxProfile>>({});

  const yearStart = `${selectedYear}-01-01`;
  const yearEnd = `${selectedYear}-12-31`;

  useEffect(() => {
    if (!user || !ownerId) return;
    loadAll();
  }, [user, ownerId, scope, selectedYear]);

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('tax_scope', scope);
  }, [scope]);

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([loadProfile(), loadIncome(), loadDeductions(), loadTaxPayments(), loadProjection()]);
    } catch (e: any) {
      toast.error(`Failed to load tax data: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Projection always pulls personal+business splits independent of `scope` so the
  // "Income vs Expenses" projection card can show side-by-side personal vs business.
  //
  // We no longer require `counts_as_tax_deduction = true` — instead we pull every
  // categorized expense in the year and decide deductibility client-side via
  // `deductibilityHint`, so high-confidence predicted-but-not-yet-approved rows
  // count toward the projection (matches what the user sees on Expenses).
  async function loadProjection() {
    // Financial-integrity rule: only approved/edited rows count toward totals.
    // Unreviewed "suggested"/"ai_suggested" rows are surfaced separately as
    // "potential additional deductions" rather than baked into the projection.
    const reportingStatuses = ['approved', 'auto_categorized', 'edited'];
    const fetchAll = async (m: 'personal' | 'business') => {
      let from = 0;
      const pageSize = 1000;
      let all: any[] = [];
      let hasMore = true;
      while (hasMore) {
        const { data } = await supabase
          .from('transactions_uploaded')
          .select('amount, final_category, predicted_category, counts_as_tax_deduction, review_status')
          .eq('owner_id', ownerId!)
          .eq('transaction_mode', m)
          .eq('is_split_parent', false)
          .in('review_status', reportingStatuses)
          .gte('date', yearStart)
          .lte('date', yearEnd)
          .is('deleted_at', null)
          .order('id')
          .range(from, from + pageSize - 1);
        if (data) all = [...all, ...data];
        hasMore = (data?.length ?? 0) === pageSize;
        from += pageSize;
      }
      return all;
    };
    const fetchAllIncome = (m: 'personal' | 'business') =>
      fetchAllRows((from, to) =>
        supabase.from('income_transactions').select('amount, taxable_status').eq('owner_id', ownerId!).eq('mode', m).gte('date', yearStart).lte('date', yearEnd).is('deleted_at', null).order('id').range(from, to),
      );
    const [incPersonal, incBusiness, txPersonal, txBusiness] = await Promise.all([
      fetchAllIncome('personal'),
      fetchAllIncome('business'),
      fetchAll('personal'),
      fetchAll('business'),
    ]);
    const sumTaxable = (rows: any[] | null) => (rows || []).filter(r => r.taxable_status === 'taxable').reduce((s, r) => s + Number(r.amount || 0), 0);
    // Deductible if explicitly flagged OR effective category is in the
    // deductible set for the row's mode. Partial categories (meals, entertainment)
    // get the standard 50% Schedule C haircut. requires_review still counts at full
    // for the projection but is surfaced separately in the breakdown.
    const sumDeductible = (rows: any[], mode: 'personal' | 'business') => {
      let total = 0;
      for (const r of rows) {
        const cat = (r.final_category || r.predicted_category || '') as string;
        const hint = deductibilityHint(mode, cat);
        if (hint === 'none' && !r.counts_as_tax_deduction) continue;
        const amt = Math.abs(Number(r.amount || 0));
        if (hint === 'partial') total += amt * 0.5;
        else total += amt;
      }
      return total;
    };
    setProjection({
      personal: { taxable: sumTaxable(incPersonal), deductions: sumDeductible(txPersonal, 'personal') },
      business: { taxable: sumTaxable(incBusiness), deductions: sumDeductible(txBusiness, 'business') },
    });
  }

  async function loadProfile() {
    const { data } = await supabase
      .from('tax_profiles' as any)
      .select('*')
      .eq('owner_id', ownerId!)
      .maybeSingle();
    if (data) {
      setProfile(data as any);
      setDraft(data as any);
    }
  }

  async function loadIncome() {
    const rows = await fetchAllRows((from, to) => {
      let q = supabase
        .from('income_transactions')
        .select('income_type, taxable_status, amount, date')
        .eq('owner_id', ownerId!)
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .is('deleted_at', null);
      if (scope !== 'all') q = q.eq('mode', scope);
      return q.order('id').range(from, to);
    });
    setIncomeRows(rows as IncomeRow[]);
  }

  async function loadDeductions() {
    // Pull every categorized expense in scope (broad statuses), decide
    // deductibility client-side. This way confirmed AND high-confidence
    // predicted rows both surface in the breakdown.
    const reportingStatuses = ['approved', 'auto_categorized', 'edited', 'suggested', 'ai_suggested'];
    let from = 0;
    const pageSize = 1000;
    let all: any[] = [];
    let hasMore = true;
    while (hasMore) {
      let q = supabase
        .from('transactions_uploaded')
        .select('final_category, predicted_category, amount, review_status, transaction_mode, counts_as_tax_deduction')
        .eq('owner_id', ownerId!)
        .eq('is_split_parent', false)
        .in('review_status', reportingStatuses)
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .is('deleted_at', null)
        .order('id')
        .range(from, from + pageSize - 1);
      if (scope !== 'all') q = q.eq('transaction_mode', scope);
      const { data } = await q;
      if (data) all = [...all, ...data];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    // Keep only rows that look deductible (flag set OR category is in the
    // deductible set for the row's mode).
    const filtered: DeductionRow[] = all.filter(r => {
      if (r.counts_as_tax_deduction) return true;
      const cat = r.final_category || r.predicted_category || '';
      return deductibilityHint(r.transaction_mode, cat) !== 'none';
    });
    setDeductionRows(filtered);

    // Count + sum truly unreviewed business spend (still un-categorized).
    // Paginated so the dollar total covers ALL rows, not just the first 1000.
    const unreviewedRows = await fetchAllRows((from, to) => {
      let cq = supabase
        .from('transactions_uploaded')
        .select('amount')
        .eq('owner_id', ownerId!)
        .eq('is_split_parent', false)
        .eq('is_transfer', false)
        .eq('review_status', 'needs_review')
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .is('deleted_at', null);
      if (scope === 'business' || scope === 'all') {
        cq = cq.eq('transaction_mode', 'business');
      } else {
        cq = cq.eq('transaction_mode', 'personal');
      }
      return cq.order('id').range(from, to);
    });
    setUnreviewedDeductionCount(unreviewedRows.length);
    const total = unreviewedRows.reduce(
      (s: number, r: any) => s + Math.abs(Number(r.amount || 0)),
      0,
    );
    setPotentialDeductions({ count: unreviewedRows.length, total });
  }

  async function loadTaxPayments() {
    const rows = await fetchAllRows((from, to) =>
      supabase
        .from('transactions_uploaded')
        .select('date, description_normalized, amount, treatment_type')
        .eq('owner_id', ownerId!)
        .in('treatment_type', ['tax_payment', 'estimated_tax_payment'])
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .order('id')
        .range(from, to),
    );
    setTaxPayments(rows as TaxPaymentRow[]);
  }

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    const payload = {
      owner_id: user.id,
      filing_status: draft.filing_status || 'single',
      state: draft.state || 'NY',
      city: draft.city || 'NYC',
      resident_city_tax_enabled: draft.resident_city_tax_enabled ?? true,
      w2_income_enabled: draft.w2_income_enabled ?? true,
      self_employment_income_enabled: draft.self_employment_income_enabled ?? false,
      business_owner_income_enabled: draft.business_owner_income_enabled ?? false,
      default_federal_reserve_percent: draft.default_federal_reserve_percent ?? 25,
      default_nys_reserve_percent: draft.default_nys_reserve_percent ?? 7,
      default_nyc_reserve_percent: draft.default_nyc_reserve_percent ?? 3.5,
      custom_effective_tax_rate_optional: draft.custom_effective_tax_rate_optional ?? null,
      estimated_w2_withholding_ytd: draft.estimated_w2_withholding_ytd ?? 0,
      estimated_tax_payments_ytd: draft.estimated_tax_payments_ytd ?? 0,
      notes: draft.notes ?? null,
    };

    let error;
    if (profile) {
      ({ error } = await supabase.from('tax_profiles' as any).update(payload).eq('id', profile.id));
    } else {
      ({ error } = await supabase.from('tax_profiles' as any).insert(payload));
    }

    if (error) {
      toast.error(`Error saving: ${error.message}`);
    } else {
      toast.success('Tax profile saved');
      setEditOpen(false);
      await loadProfile();
    }
    setSaving(false);
  }

  // --- Calculations ---
  const taxableIncome = useMemo(() => {
    return incomeRows
      .filter(r => r.taxable_status === 'taxable')
      .reduce((s, r) => s + (r.amount || 0), 0);
  }, [incomeRows]);

  // Per-row deductible amount with NY/Schedule C-aware haircut.
  // Meals & entertainment → 50% (§274). Everything else → 100% of the
  // expense. `requires_review` (e.g. personal Schedule A items) is
  // counted at full but visually flagged in the breakdown.
  const deductibleAmount = (r: DeductionRow): { amount: number; hint: DeductibilityHint; bucket: 'confirmed' | 'predicted' | 'review' } => {
    const cat = r.final_category || r.predicted_category || '';
    const hint = deductibilityHint(r.transaction_mode, cat);
    const raw = Math.abs(r.amount || 0);
    const amount = hint === 'partial' ? raw * 0.5 : raw;
    const isConfirmed = ['approved', 'edited', 'auto_categorized'].includes(r.review_status) && !!r.final_category;
    const bucket: 'confirmed' | 'predicted' | 'review' =
      hint === 'requires_review' ? 'review' : isConfirmed ? 'confirmed' : 'predicted';
    return { amount, hint, bucket };
  };

  const deductionBreakdown = useMemo(() => {
    let confirmed = 0, predicted = 0, review = 0;
    for (const r of deductionRows) {
      const { amount, bucket } = deductibleAmount(r);
      if (bucket === 'confirmed') confirmed += amount;
      else if (bucket === 'predicted') predicted += amount;
      else review += amount;
    }
    return { confirmed, predicted, review, total: confirmed + predicted + review };
  }, [deductionRows]);

  const totalDeductions = deductionBreakdown.total;

  const taxPaymentsTotal = useMemo(() => {
    return taxPayments.reduce((s, r) => s + Math.abs(r.amount || 0), 0);
  }, [taxPayments]);

  const federalPercent = profile?.default_federal_reserve_percent ?? 25;
  const nysPercent = profile?.default_nys_reserve_percent ?? 7;
  const nycPercent = profile?.default_nyc_reserve_percent ?? 3.5;
  const cityEnabled = profile?.resident_city_tax_enabled ?? true;

  const adjustedIncome = Math.max(0, taxableIncome - totalDeductions);
  const federalReserve = adjustedIncome * (federalPercent / 100);
  const nysReserve = adjustedIncome * (nysPercent / 100);
  const nycReserve = cityEnabled ? adjustedIncome * (nycPercent / 100) : 0;

  // Self-employment tax (Schedule SE): a sole prop / single-member LLC owes
  // 15.3% (12.4% Social Security up to the wage base + 2.9% Medicare) on
  // 92.35% of net business profit — SEPARATE from and on TOP of income tax.
  // Without this the reserve badly under-states what a self-employed filer
  // owes. Applied only to BUSINESS net profit, and only when the profile flag
  // is on. 2025 Social Security wage base.
  const SS_WAGE_BASE_2025 = 176100;
  const seEnabled = profile?.self_employment_income_enabled ?? false;
  const businessNetProfit = Math.max(0, projection.business.taxable - projection.business.deductions);
  const seTaxBase = businessNetProfit * 0.9235;
  const selfEmploymentTax = seEnabled
    ? Math.min(seTaxBase, SS_WAGE_BASE_2025) * 0.124 + seTaxBase * 0.029
    : 0;

  const totalReserve = federalReserve + nysReserve + nycReserve + selfEmploymentTax;
  const withholding = (profile?.estimated_w2_withholding_ytd ?? 0) + (profile?.estimated_tax_payments_ytd ?? 0);
  const paidYtd = taxPaymentsTotal + withholding;
  const reserveGap = Math.max(0, totalReserve - paidYtd);

  // Income breakdown grouped by type
  const incomeByType = useMemo(() => {
    const map: Record<string, { taxable: number; excluded: number }> = {};
    incomeRows.forEach(r => {
      const key = r.income_type || 'other';
      if (!map[key]) map[key] = { taxable: 0, excluded: 0 };
      const amt = r.amount || 0;
      if (r.taxable_status === 'taxable') {
        map[key].taxable += amt;
      } else {
        map[key].excluded += amt;
      }
    });
    return Object.entries(map).sort((a, b) => (b[1].taxable + b[1].excluded) - (a[1].taxable + a[1].excluded));
  }, [incomeRows]);

  // Deductions grouped by effective category (final_category preferred, else predicted)
  // Each row contributes its haircut-adjusted amount.
  const deductionsByCategory = useMemo(() => {
    const map: Record<string, { amount: number; hint: DeductibilityHint }> = {};
    deductionRows.forEach(r => {
      const key = effectiveCategory(r) || 'Uncategorized';
      const { amount, hint } = deductibleAmount(r);
      if (!map[key]) map[key] = { amount: 0, hint };
      map[key].amount += amount;
      // promote hint priority: full > partial > requires_review > none
      const rank = (h: DeductibilityHint) => h === 'full' ? 3 : h === 'partial' ? 2 : h === 'requires_review' ? 1 : 0;
      if (rank(hint) > rank(map[key].hint)) map[key].hint = hint;
    });
    return Object.entries(map).sort((a, b) => b[1].amount - a[1].amount);
  }, [deductionRows]);

  // --- Quarterly estimated-tax schedule ---
  // The IRS/NY estimated-tax year is split into 4 UNEVEN periods. We apportion
  // the annual reserve target across them by WHEN taxable income actually landed
  // (quarterTaxableIncome × the effective rate the annual reserve implies), then
  // compare that against payments made from each window's start through its due
  // date. Local date construction only — never new Date('YYYY-MM-DD'), which
  // parses as UTC midnight and can shift to the prior day in negative-offset zones.
  type QuarterStatus = 'paid' | 'overdue' | 'due-soon' | 'upcoming';
  const quarters = useMemo(() => {
    const y = selectedYear;
    const parseLocal = (s: string | null): Date | null => {
      if (!s) return null;
      const [yy, mm, dd] = s.substring(0, 10).split('-').map(Number);
      if (!yy || !mm || !dd) return null;
      return new Date(yy, mm - 1, dd);
    };
    // Effective rate the annual reserve implies. Guarded so a 0 adjusted income
    // yields 0 targets rather than smearing the whole reserve onto gross income.
    const effectiveRate = adjustedIncome > 0 ? totalReserve / adjustedIncome : 0;
    const defs = [
      { label: 'Q1', incomeStart: new Date(y, 0, 1), incomeEnd: new Date(y, 2, 31), due: new Date(y, 3, 15) },
      { label: 'Q2', incomeStart: new Date(y, 3, 1), incomeEnd: new Date(y, 4, 31), due: new Date(y, 5, 15) },
      { label: 'Q3', incomeStart: new Date(y, 5, 1), incomeEnd: new Date(y, 7, 31), due: new Date(y, 8, 15) },
      { label: 'Q4', incomeStart: new Date(y, 8, 1), incomeEnd: new Date(y, 11, 31), due: new Date(y + 1, 0, 15) },
    ];
    const today = new Date();
    const MS_PER_DAY = 86_400_000;
    // Only the current or a past year should surface overdue / due-soon coloring;
    // future years are informational (their targets may not exist yet).
    const nagOk = y <= nowYear;
    return defs.map(q => {
      const quarterTaxableIncome = incomeRows.reduce((s, r) => {
        if (r.taxable_status !== 'taxable') return s;
        const d = parseLocal(r.date);
        return d && d >= q.incomeStart && d <= q.incomeEnd ? s + (r.amount || 0) : s;
      }, 0);
      const target = quarterTaxableIncome * effectiveRate;
      // Payments for a quarter are typically made by its due date, so count any
      // payment landing from the income-window start through the due date.
      const paid = taxPayments.reduce((s, p) => {
        const d = parseLocal(p.date);
        return d && d >= q.incomeStart && d <= q.due ? s + Math.abs(p.amount || 0) : s;
      }, 0);
      const remaining = Math.max(0, target - paid);
      const daysUntilDue = Math.ceil((q.due.getTime() - today.getTime()) / MS_PER_DAY);
      let status: QuarterStatus;
      if (remaining <= 0 && target > 0) status = 'paid';
      else if (nagOk && daysUntilDue < 0 && remaining > 0) status = 'overdue';
      else if (nagOk && daysUntilDue >= 0 && daysUntilDue <= 30) status = 'due-soon';
      else status = 'upcoming';
      return { label: q.label, due: q.due, quarterTaxableIncome, target, paid, remaining, status };
    });
  }, [incomeRows, taxPayments, selectedYear, nowYear, totalReserve, adjustedIncome]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppNav />
        <div className="container py-12 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }

  // Setup flow if no profile
  if (!profile) {
    return (
      <div className="min-h-screen bg-background">
        <AppNav />
        <div className="container py-12 max-w-2xl">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Tax Reserve Setup</h1>
          <p className="text-muted-foreground text-sm mb-8">Configure your tax profile to start tracking reserve targets for Federal, NYS, and NYC.</p>
          <ProfileForm draft={draft} setDraft={setDraft} onSave={saveProfile} saving={saving} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Tax Reserves — {selectedYear}</h1>
            <p className="text-sm text-muted-foreground">
              {profile.filing_status.replace(/_/g, ' ')} · {profile.city}, {profile.state}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-md border border-border/40 p-0.5 bg-secondary/40 text-xs">
              {YEAR_OPTIONS.map(y => (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`px-3 py-1 rounded-sm transition-colors ${selectedYear === y ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {y}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-md border border-border/40 p-0.5 bg-secondary/40 text-xs">
              {(['personal', 'business', 'all'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1 rounded-sm capitalize transition-colors ${scope === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {s === 'all' ? 'All' : s}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => { setDraft(profile); setEditOpen(true); }}>
              <Settings className="h-4 w-4 mr-1" /> Edit Profile
            </Button>
          </div>
        </div>

        {/* Income vs Expenses Projection — actuals-driven, P/B side-by-side */}
        {(() => {
          const combinedRate = (federalPercent + nysPercent + (cityEnabled ? nycPercent : 0)) / 100;
          const pNet = Math.max(0, projection.personal.taxable - projection.personal.deductions);
          const bNet = Math.max(0, projection.business.taxable - projection.business.deductions);
          const pTax = pNet * combinedRate;
          const bTax = bNet * combinedRate;
          const showPersonal = scope === 'personal' || scope === 'all';
          const showBusiness = scope === 'business' || scope === 'all';
          const totalTaxable =
            (showPersonal ? projection.personal.taxable : 0) +
            (showBusiness ? projection.business.taxable : 0);
          const totalDeductionsProj =
            (showPersonal ? projection.personal.deductions : 0) +
            (showBusiness ? projection.business.deductions : 0);
          const totalNet = (showPersonal ? pNet : 0) + (showBusiness ? bNet : 0);
          const totalTax = (showPersonal ? pTax : 0) + (showBusiness ? bTax : 0);
          const scopeLabel = scope === 'all' ? 'All' : scope === 'business' ? 'Business' : 'Personal';
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{selectedYear} Projection — {scopeLabel}</CardTitle>
                <CardDescription className="text-xs">
                  Net = Taxable income − Deductible expenses. Estimated tax = Net × ({(combinedRate * 100).toFixed(1)}%) at your current Fed + NYS{cityEnabled ? ' + NYC' : ''} rates. Only approved / edited expenses count toward deductions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scope</TableHead>
                      <TableHead className="text-right">Taxable Income</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Est. Tax</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {showPersonal && (
                      <TableRow>
                        <TableCell className="font-medium">Personal</TableCell>
                        <TableCell className="text-right">{fmt(projection.personal.taxable)}</TableCell>
                        <TableCell className="text-right">−{fmt(projection.personal.deductions)}</TableCell>
                        <TableCell className="text-right">{fmt(pNet)}</TableCell>
                        <TableCell className="text-right text-warning">{fmt(pTax)}</TableCell>
                      </TableRow>
                    )}
                    {showBusiness && (
                      <TableRow>
                        <TableCell className="font-medium">Business</TableCell>
                        <TableCell className="text-right">{fmt(projection.business.taxable)}</TableCell>
                        <TableCell className="text-right">−{fmt(projection.business.deductions)}</TableCell>
                        <TableCell className="text-right">{fmt(bNet)}</TableCell>
                        <TableCell className="text-right text-warning">{fmt(bTax)}</TableCell>
                      </TableRow>
                    )}
                    {scope === 'all' && (
                      <TableRow className="font-semibold border-t-2">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right">{fmt(totalTaxable)}</TableCell>
                        <TableCell className="text-right">−{fmt(totalDeductionsProj)}</TableCell>
                        <TableCell className="text-right">{fmt(totalNet)}</TableCell>
                        <TableCell className="text-right text-destructive">{fmt(totalTax)}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {potentialDeductions.total > 0 && (scope === 'business' || scope === 'all') && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    + <span className="text-foreground/80 font-medium">{fmt(potentialDeductions.total)}</span> in unreviewed business spend not yet counted toward deductions. Approve them on the Expenses page to lock in the deduction.
                  </p>
                )}
                {selectedYear > nowYear && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    {selectedYear} has limited or no actuals yet — projections will populate as transactions land.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Summary Cards */}
        <div className={`grid grid-cols-2 md:grid-cols-3 ${seEnabled ? 'lg:grid-cols-7' : 'lg:grid-cols-6'} gap-4`}>
          <SummaryCard icon={Landmark} label="Federal Reserve" value={fmt(federalReserve)} sub={`${federalPercent}%`} />
          {seEnabled && (
            <SummaryCard icon={Briefcase} label="Self-Employment Tax" value={fmt(selfEmploymentTax)} sub="15.3% Sch SE" />
          )}
          <SummaryCard icon={Building2} label="NYS Reserve" value={fmt(nysReserve)} sub={`${nysPercent}%`} />
          <SummaryCard icon={Building} label="NYC Reserve" value={fmt(nycReserve)} sub={cityEnabled ? `${nycPercent}%` : 'Disabled'} />
          <SummaryCard icon={Shield} label="Total Target" value={fmt(totalReserve)} />
          <SummaryCard icon={DollarSign} label="Paid / Withheld YTD" value={fmt(paidYtd)} />
          <SummaryCard icon={reserveGap > 0 ? AlertTriangle : TrendingUp} label="Reserve Gap" value={fmt(reserveGap)} variant={reserveGap > 0 ? 'warning' : 'success'} />
        </div>

        {/* Quarterly Estimated Taxes — annual reserve apportioned across the 4 uneven IRS/NY periods by when income landed */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Quarterly Estimated Taxes — {selectedYear}</CardTitle>
            <CardDescription className="text-xs">
              Set-aside targets apportioned by when income landed — pay estimated taxes by each date to avoid IRS/NY underpayment penalties.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {quarters.map(q => {
                const meta = {
                  paid: { label: 'Paid', pill: 'bg-success/15 text-success border border-success/30', card: 'border-success/30' },
                  overdue: { label: 'Overdue', pill: 'bg-destructive/15 text-destructive border border-destructive/30', card: 'border-destructive/40' },
                  'due-soon': { label: 'Due soon', pill: 'bg-warning/15 text-warning border border-warning/30', card: 'border-warning/40' },
                  upcoming: { label: 'Upcoming', pill: 'bg-secondary text-muted-foreground border border-border/40', card: 'border-border/50' },
                }[q.status];
                return (
                  <div key={q.label} className={`rounded-lg border ${meta.card} bg-card p-3`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <span className="text-sm font-semibold text-foreground">{q.label}</span>
                        <p className="text-[11px] text-muted-foreground">
                          Due {q.due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${meta.pill}`}>{meta.label}</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Target</span>
                        <span className="font-medium text-foreground">{fmt(q.target)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Paid</span>
                        <span className="text-foreground">{fmt(q.paid)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-border/40 pt-1 mt-1">
                        <span className="text-muted-foreground">Remaining</span>
                        <span className={`font-semibold ${q.status === 'overdue' ? 'text-destructive' : q.status === 'due-soon' ? 'text-warning' : 'text-foreground'}`}>{fmt(q.remaining)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Estimate disclaimer */}
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Estimates only — not a tax calculation</p>
            <p className="text-warning/80 mt-0.5">Based on flat reserve rates, not progressive tax brackets. {seEnabled ? 'Self-employment tax (Schedule SE) is included on business net profit. ' : ''}Deductions are simplified (no above/below-the-line distinction). Consult your accountant for actual liability.</p>
          </div>
        </div>

        {/* Data coverage indicator */}
        {(() => {
          const monthsWithData = new Set((incomeRows as any[]).map(r => r?.date?.substring?.(0, 7)).filter(Boolean)).size;
          const currentMonth = selectedYear < nowYear ? 12 : selectedYear > nowYear ? 0 : new Date().getMonth() + 1;
          return monthsWithData < currentMonth ? (
            <div className="rounded-lg border border-border/50 bg-secondary/30 px-4 py-2 text-xs text-muted-foreground">
              ⚠️ Income data covers {monthsWithData} of {currentMonth} months in {selectedYear}. Reserve targets may be understated.
            </div>
          ) : null;
        })()}

        {/* Unreviewed business spend → potential additional deductions */}
        {potentialDeductions.count > 0 && (
          <a
            href={`/?scope=${scope === 'all' ? 'business' : scope}&review=unreviewed`}
            className="block rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning hover:bg-warning/10 transition-colors"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-medium">
                  {potentialDeductions.count} {scope === 'personal' ? 'personal' : 'business'} transaction{potentialDeductions.count > 1 ? 's' : ''} still need categorization for {selectedYear}
                </div>
                <div className="text-warning/80 mt-0.5">
                  Up to <span className="font-semibold">{fmt(potentialDeductions.total)}</span> in additional deductions could be unlocked. Your tax estimate is likely overstated. <span className="underline">Review now →</span>
                </div>
              </div>
            </div>
          </a>
        )}

        {/* Adjusted income context */}
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div><span className="text-muted-foreground">Taxable Income YTD</span><p className="text-lg font-semibold text-foreground">{fmt(taxableIncome)}</p></div>
              <div>
                <span className="text-muted-foreground">Estimated Deductions YTD</span>
                <p className="text-lg font-semibold text-foreground">−{fmt(totalDeductions)}</p>
                {(deductionBreakdown.predicted > 0 || deductionBreakdown.review > 0) && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span><span className="text-foreground/80 font-medium">{fmt(deductionBreakdown.confirmed)}</span> confirmed</span>
                    {deductionBreakdown.predicted > 0 && (
                      <span><span className="text-primary font-medium">{fmt(deductionBreakdown.predicted)}</span> predicted</span>
                    )}
                    {deductionBreakdown.review > 0 && (
                      <span><span className="text-warning font-medium">{fmt(deductionBreakdown.review)}</span> needs review</span>
                    )}
                  </div>
                )}
              </div>
              <div><span className="text-muted-foreground">Est. Adjusted Income</span><p className="text-lg font-semibold text-foreground">{fmt(adjustedIncome)}</p></div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs for breakdowns */}
        <Tabs defaultValue="income">
          <TabsList>
            <TabsTrigger value="income">Income Breakdown</TabsTrigger>
            <TabsTrigger value="deductions">Deductions</TabsTrigger>
            <TabsTrigger value="payments">Tax Payments</TabsTrigger>
          </TabsList>

          <TabsContent value="income">
            <Card>
              <CardHeader><CardTitle className="text-base">Taxable Income by Type</CardTitle></CardHeader>
              <CardContent>
                {incomeByType.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No income recorded for {selectedYear}.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">Excluded</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {incomeByType.map(([type, vals]) => (
                        <TableRow key={type}>
                          <TableCell className="capitalize">
                            {type.replace(/_/g, ' ')}
                            {type === 'reimbursement' && vals.taxable > 0 && (
                              <span className="ml-2 inline-flex items-center gap-1 text-warning text-[10px]">
                                <AlertTriangle className="h-3 w-3" />Taxable reimbursement — verify
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{fmt(vals.taxable)}</TableCell>
                          <TableCell className="text-right">{fmt(vals.excluded)}</TableCell>
                          <TableCell className="text-right font-medium">{fmt(vals.taxable + vals.excluded)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="deductions">
            <Card>
              <CardHeader><CardTitle className="text-base">Deductions by Category</CardTitle></CardHeader>
              <CardContent>
                {deductionsByCategory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deductions recorded for {selectedYear}.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Treatment</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deductionsByCategory.map(([cat, info]) => (
                        <TableRow key={cat}>
                          <TableCell>{cat}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {info.hint === 'full' && 'Full Schedule C'}
                            {info.hint === 'partial' && '50% (business meals §274)'}
                            {info.hint === 'requires_review' && 'Itemizable — subject to limits'}
                            {info.hint === 'none' && 'Manually flagged'}
                          </TableCell>
                          <TableCell className="text-right">{fmt(info.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold">
                        <TableCell>Total</TableCell>
                        <TableCell />
                        <TableCell className="text-right">{fmt(totalDeductions)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <CardHeader><CardTitle className="text-base">Tax Payments Made</CardTitle></CardHeader>
              <CardContent>
                {taxPayments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tax payments recorded for {selectedYear}.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {taxPayments.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell>{p.date || '—'}</TableCell>
                          <TableCell>{p.description_normalized || '—'}</TableCell>
                          <TableCell className="capitalize">{p.treatment_type.replace(/_/g, ' ')}</TableCell>
                          <TableCell className="text-right">{fmt(Math.abs(p.amount || 0))}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold">
                        <TableCell colSpan={3}>Total</TableCell>
                        <TableCell className="text-right">{fmt(taxPaymentsTotal)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Tax Profile</DialogTitle>
          </DialogHeader>
          <ProfileForm draft={draft} setDraft={setDraft} onSave={saveProfile} saving={saving} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, variant }: { icon: any; label: string; value: string; sub?: string; variant?: 'warning' | 'success' }) {
  return (
    <Card className={variant === 'warning' ? 'border-destructive/40' : variant === 'success' ? 'border-primary/40' : ''}>
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`h-4 w-4 ${variant === 'warning' ? 'text-destructive' : 'text-muted-foreground'}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className={`text-lg font-semibold ${variant === 'warning' ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  );
}

function ProfileForm({ draft, setDraft, onSave, saving }: { draft: Partial<TaxProfile>; setDraft: (d: Partial<TaxProfile>) => void; onSave: () => void; saving: boolean }) {
  const upd = (key: keyof TaxProfile, value: any) => setDraft({ ...draft, [key]: value });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Filing Status</Label>
          <Select value={draft.filing_status || 'single'} onValueChange={v => upd('filing_status', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FILING_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>State</Label>
          <Input value={draft.state || 'NY'} onChange={e => upd('state', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>City</Label>
          <Input value={draft.city || 'NYC'} onChange={e => upd('city', e.target.value)} />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Switch checked={draft.resident_city_tax_enabled ?? true} onCheckedChange={v => upd('resident_city_tax_enabled', v)} />
          <Label>City tax enabled</Label>
        </div>
      </div>

      <div>
        <Label className="text-sm font-medium text-muted-foreground mb-2 block">Income Types</Label>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Switch checked={draft.w2_income_enabled ?? true} onCheckedChange={v => upd('w2_income_enabled', v)} />
            <Label>W-2 Income</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={draft.self_employment_income_enabled ?? false} onCheckedChange={v => upd('self_employment_income_enabled', v)} />
            <Label>Self-Employment Income</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={draft.business_owner_income_enabled ?? false} onCheckedChange={v => upd('business_owner_income_enabled', v)} />
            <Label>Business Owner Income</Label>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-sm font-medium text-muted-foreground mb-2 block">Reserve Percentages</Label>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Federal %</Label>
            <Input type="number" value={draft.default_federal_reserve_percent ?? 25} onChange={e => upd('default_federal_reserve_percent', parseFloat(e.target.value) || 0)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">NYS %</Label>
            <Input type="number" value={draft.default_nys_reserve_percent ?? 7} onChange={e => upd('default_nys_reserve_percent', parseFloat(e.target.value) || 0)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">NYC %</Label>
            <Input type="number" value={draft.default_nyc_reserve_percent ?? 3.5} onChange={e => upd('default_nyc_reserve_percent', parseFloat(e.target.value) || 0)} />
          </div>
        </div>
      </div>

      <div>
        <Label className="text-sm font-medium text-muted-foreground mb-2 block">Withholding & Estimated Payments</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">W-2 Withholding YTD</Label>
            <Input type="number" value={draft.estimated_w2_withholding_ytd ?? 0} onChange={e => upd('estimated_w2_withholding_ytd', parseFloat(e.target.value) || 0)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Estimated Tax Payments YTD</Label>
            <Input type="number" value={draft.estimated_tax_payments_ytd ?? 0} onChange={e => upd('estimated_tax_payments_ytd', parseFloat(e.target.value) || 0)} />
          </div>
        </div>
      </div>

      <Button onClick={onSave} disabled={saving} className="w-full">{saving ? 'Saving…' : 'Save Tax Profile'}</Button>
    </div>
  );
}
