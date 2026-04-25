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
import { DollarSign, TrendingUp, Shield, AlertTriangle, Settings, Landmark, Building2, Building } from 'lucide-react';

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
}

interface DeductionRow {
  final_category: string | null;
  amount: number | null;
  review_status: string;
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
  const { user } = useAuth();
  // toast imported from sonner at top
  const [profile, setProfile] = useState<TaxProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([]);
  const [taxPayments, setTaxPayments] = useState<TaxPaymentRow[]>([]);
  const [unreviewedDeductionCount, setUnreviewedDeductionCount] = useState(0);
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
    if (!user) return;
    loadAll();
  }, [user, scope]);

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('tax_scope', scope);
  }, [scope]);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadProfile(), loadIncome(), loadDeductions(), loadTaxPayments()]);
    setLoading(false);
  }

  async function loadProfile() {
    const { data } = await supabase
      .from('tax_profiles' as any)
      .select('*')
      .eq('owner_id', user!.id)
      .maybeSingle();
    if (data) {
      setProfile(data as any);
      setDraft(data as any);
    }
  }

  async function loadIncome() {
    let q = supabase
      .from('income_transactions')
      .select('income_type, taxable_status, amount')
      .eq('owner_id', user!.id)
      .gte('date', yearStart)
      .lte('date', yearEnd);
    if (scope !== 'all') q = q.eq('mode', scope);
    const { data } = await q;
    setIncomeRows((data as IncomeRow[]) || []);
  }

  async function loadDeductions() {
    let q = supabase
      .from('transactions_uploaded')
      .select('final_category, amount, review_status')
      .eq('owner_id', user!.id)
      .eq('counts_as_tax_deduction', true)
      .eq('is_split_parent', false)
      .in('review_status', ['approved', 'auto_categorized', 'edited'])
      .gte('date', yearStart)
      .lte('date', yearEnd);
    if (scope !== 'all') q = q.eq('transaction_mode', scope);
    const { data } = await q;
    setDeductionRows((data as DeductionRow[]) || []);

    // Also count unreviewed deductions for warning
    let cq = supabase
      .from('transactions_uploaded')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user!.id)
      .eq('counts_as_tax_deduction', true)
      .in('review_status', ['needs_review', 'suggested', 'ai_suggested'])
      .gte('date', yearStart)
      .lte('date', yearEnd);
    if (scope !== 'all') cq = cq.eq('transaction_mode', scope);
    const { count } = await cq;
    setUnreviewedDeductionCount(count || 0);
  }

  async function loadTaxPayments() {
    const { data } = await supabase
      .from('transactions_uploaded')
      .select('date, description_normalized, amount, treatment_type')
      .eq('owner_id', user!.id)
      .in('treatment_type', ['tax_payment', 'estimated_tax_payment'])
      .gte('date', yearStart)
      .lte('date', yearEnd)
      .order('date', { ascending: false });
    setTaxPayments((data as TaxPaymentRow[]) || []);
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

  const totalDeductions = useMemo(() => {
    return deductionRows.reduce((s, r) => s + Math.abs(r.amount || 0), 0);
  }, [deductionRows]);

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
  const totalReserve = federalReserve + nysReserve + nycReserve;
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

  // Deductions grouped by category
  const deductionsByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    deductionRows.forEach(r => {
      const key = r.final_category || 'Uncategorized';
      map[key] = (map[key] || 0) + Math.abs(r.amount || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [deductionRows]);

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
            <h1 className="text-2xl font-semibold text-foreground">Tax Reserves — {currentYear}</h1>
            <p className="text-sm text-muted-foreground">
              {profile.filing_status.replace(/_/g, ' ')} · {profile.city}, {profile.state}
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <SummaryCard icon={Landmark} label="Federal Reserve" value={fmt(federalReserve)} sub={`${federalPercent}%`} />
          <SummaryCard icon={Building2} label="NYS Reserve" value={fmt(nysReserve)} sub={`${nysPercent}%`} />
          <SummaryCard icon={Building} label="NYC Reserve" value={fmt(nycReserve)} sub={cityEnabled ? `${nycPercent}%` : 'Disabled'} />
          <SummaryCard icon={Shield} label="Total Target" value={fmt(totalReserve)} />
          <SummaryCard icon={DollarSign} label="Paid / Withheld YTD" value={fmt(paidYtd)} />
          <SummaryCard icon={reserveGap > 0 ? AlertTriangle : TrendingUp} label="Reserve Gap" value={fmt(reserveGap)} variant={reserveGap > 0 ? 'warning' : 'success'} />
        </div>

        {/* Estimate disclaimer */}
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Estimates only — not a tax calculation</p>
            <p className="text-warning/80 mt-0.5">Based on flat reserve rates, not progressive tax brackets. Deductions are simplified (no above/below-the-line distinction). Consult your accountant for actual liability.</p>
          </div>
        </div>

        {/* Data coverage indicator */}
        {(() => {
          const monthsWithData = new Set((incomeRows as any[]).map(r => r?.date?.substring?.(0, 7)).filter(Boolean)).size;
          const currentMonth = new Date().getMonth() + 1;
          return monthsWithData < currentMonth ? (
            <div className="rounded-lg border border-border/50 bg-secondary/30 px-4 py-2 text-xs text-muted-foreground">
              ⚠️ Income data covers {monthsWithData} of {currentMonth} months in {currentYear}. Reserve targets may be understated.
            </div>
          ) : null;
        })()}

        {/* Unreviewed deductions warning */}
        {unreviewedDeductionCount > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-2 text-xs text-warning flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{unreviewedDeductionCount} potential deduction{unreviewedDeductionCount > 1 ? 's' : ''} from unreviewed transactions excluded — review them to include in estimates.</span>
          </div>
        )}

        {/* Adjusted income context */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div><span className="text-muted-foreground">Taxable Income YTD</span><p className="text-lg font-semibold text-foreground">{fmt(taxableIncome)}</p></div>
              <div><span className="text-muted-foreground">Estimated Deductions YTD</span><p className="text-lg font-semibold text-foreground">−{fmt(totalDeductions)}</p></div>
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
                  <p className="text-sm text-muted-foreground">No income recorded for {currentYear}.</p>
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
                  <p className="text-sm text-muted-foreground">No deductions recorded for {currentYear}.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deductionsByCategory.map(([cat, amt]) => (
                        <TableRow key={cat}>
                          <TableCell>{cat}</TableCell>
                          <TableCell className="text-right">{fmt(amt)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold">
                        <TableCell>Total</TableCell>
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
                  <p className="text-sm text-muted-foreground">No tax payments recorded for {currentYear}.</p>
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
