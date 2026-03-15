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
import { useToast } from '@/hooks/use-toast';
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
  const { toast } = useToast();
  const [profile, setProfile] = useState<TaxProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([]);
  const [taxPayments, setTaxPayments] = useState<TaxPaymentRow[]>([]);

  // Draft for setup/edit form
  const [draft, setDraft] = useState<Partial<TaxProfile>>({});

  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  useEffect(() => {
    if (!user) return;
    loadAll();
  }, [user]);

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
    const { data } = await supabase
      .from('income_transactions')
      .select('income_type, taxable_status, amount')
      .eq('owner_id', user!.id)
      .gte('date', yearStart)
      .lte('date', yearEnd);
    setIncomeRows((data as IncomeRow[]) || []);
  }

  async function loadDeductions() {
    const { data } = await supabase
      .from('transactions_uploaded')
      .select('final_category, amount')
      .eq('owner_id', user!.id)
      .eq('counts_as_tax_deduction', true)
      .gte('date', yearStart)
      .lte('date', yearEnd);
    setDeductionRows((data as DeductionRow[]) || []);
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
      toast({ title: 'Error saving', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Tax profile saved' });
      setEditOpen(false);
      await loadProfile();
    }
    setSaving(false);
  }

  // --- Calculations ---
  const taxableIncome = useMemo(() => {
    return incomeRows
      .filter(r => r.taxable_status === 'taxable' || r.taxable_status === 'partially_taxable')
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
      if (r.taxable_status === 'taxable' || r.taxable_status === 'partially_taxable') {
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Tax Reserves — {currentYear}</h1>
            <p className="text-sm text-muted-foreground">
              {profile.filing_status.replace(/_/g, ' ')} · {profile.city}, {profile.state}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setDraft(profile); setEditOpen(true); }}>
            <Settings className="h-4 w-4 mr-1" /> Edit Profile
          </Button>
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

        {/* Adjusted income context */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div><span className="text-muted-foreground">Taxable Income YTD</span><p className="text-lg font-semibold text-foreground">{fmt(taxableIncome)}</p></div>
              <div><span className="text-muted-foreground">Deductions YTD</span><p className="text-lg font-semibold text-foreground">−{fmt(totalDeductions)}</p></div>
              <div><span className="text-muted-foreground">Adjusted Income</span><p className="text-lg font-semibold text-foreground">{fmt(adjustedIncome)}</p></div>
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
                          <TableCell className="capitalize">{type.replace(/_/g, ' ')}</TableCell>
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
