import { AppNav } from '@/components/AppNav';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight, Lock, Sparkles, Minus } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

function getMonthOptions() {
  const now = new Date();
  const months: string[] = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function Allocations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const monthOptions = useMemo(() => getMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Fetch income for month
  const { data: monthIncome = 0 } = useQuery({
    queryKey: ['alloc_income', selectedMonth],
    queryFn: async () => {
      const [y, m] = selectedMonth.split('-');
      const start = `${y}-${m}-01`;
      const end = new Date(Number(y), Number(m), 0).toISOString().split('T')[0];
      const { data } = await supabase
        .from('income_transactions')
        .select('amount')
        .gte('date', start)
        .lte('date', end);
      return (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    },
    enabled: !!user,
  });

  // Fetch expenses for month
  const { data: monthExpenses = 0 } = useQuery({
    queryKey: ['alloc_expenses', selectedMonth],
    queryFn: async () => {
      const [y, m] = selectedMonth.split('-');
      const start = `${y}-${m}-01`;
      const end = new Date(Number(y), Number(m), 0).toISOString().split('T')[0];
      const { data } = await supabase
        .from('transactions_uploaded')
        .select('amount')
        .gte('date', start)
        .lte('date', end)
        .eq('exclude_from_expense_totals', false);
      return (data || []).reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    },
    enabled: !!user,
  });

  // Fetch tax profile for reserve calc
  const { data: taxProfile } = useQuery({
    queryKey: ['tax_profile_alloc'],
    queryFn: async () => {
      const { data } = await supabase.from('tax_profiles').select('*').limit(1).maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  // Fetch investment accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['investment_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investment_accounts')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch allocation plan for month
  const { data: plan } = useQuery({
    queryKey: ['allocation_plan', selectedMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from('allocation_plans')
        .select('*')
        .eq('month', selectedMonth)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  // Fetch line items for plan
  const { data: lineItems = [] } = useQuery({
    queryKey: ['allocation_line_items', plan?.id],
    queryFn: async () => {
      if (!plan) return [];
      const { data } = await supabase
        .from('allocation_line_items')
        .select('*')
        .eq('allocation_plan_id', plan.id);
      return data || [];
    },
    enabled: !!plan,
  });

  const taxRate = taxProfile
    ? (Number(taxProfile.default_federal_reserve_percent) + Number(taxProfile.default_nys_reserve_percent) + Number(taxProfile.default_nyc_reserve_percent)) / 100
    : 0.355;
  const taxReserve = monthIncome * taxRate;
  const [emergencyFund, setEmergencyFund] = useState(0);
  const freeCash = Math.max(0, monthIncome - monthExpenses - taxReserve - emergencyFund);

  // Local allocation state
  const [localAmounts, setLocalAmounts] = useState<Record<string, number>>({});

  const totalAllocated = Object.values(localAmounts).reduce((s, v) => s + v, 0);
  const remaining = freeCash - totalAllocated;

  // Save / create plan
  const savePlan = useMutation({
    mutationFn: async () => {
      let planId = plan?.id;
      if (!planId) {
        const { data, error } = await supabase.from('allocation_plans').insert({
          owner_id: user!.id,
          month: selectedMonth,
          total_income: monthIncome,
          total_expenses: monthExpenses,
          tax_reserve_amount: taxReserve,
          emergency_fund_amount: emergencyFund,
          free_cash: freeCash,
          status: 'draft',
        }).select('id').single();
        if (error) throw error;
        planId = data.id;
      } else {
        await supabase.from('allocation_plans').update({
          total_income: monthIncome,
          total_expenses: monthExpenses,
          tax_reserve_amount: taxReserve,
          emergency_fund_amount: emergencyFund,
          free_cash: freeCash,
        }).eq('id', planId);
        // Delete old line items
        await supabase.from('allocation_line_items').delete().eq('allocation_plan_id', planId);
      }

      const items = Object.entries(localAmounts)
        .filter(([, amt]) => amt > 0)
        .map(([accountId, amount]) => ({
          allocation_plan_id: planId!,
          owner_id: user!.id,
          target_account_id: accountId,
          amount,
          executed: false,
        }));

      if (items.length > 0) {
        const { error } = await supabase.from('allocation_line_items').insert(items);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allocation_plan', selectedMonth] });
      qc.invalidateQueries({ queryKey: ['allocation_line_items'] });
      toast({ title: 'Allocation plan saved' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const finalizePlan = useMutation({
    mutationFn: async () => {
      if (!plan) return;
      await supabase.from('allocation_plans').update({ status: 'finalized' }).eq('id', plan.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allocation_plan', selectedMonth] });
      toast({ title: 'Plan finalized' });
    },
  });

  const toggleExecuted = useMutation({
    mutationFn: async ({ id, executed }: { id: string; executed: boolean }) => {
      await supabase.from('allocation_line_items').update({ executed }).eq('id', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allocation_line_items'] });
    },
  });

  const autoDistribute = () => {
    if (accounts.length === 0) return;
    const gaps = accounts.map(a => ({
      id: a.id,
      gap: Math.max(0, Number(a.contribution_target_yearly) - Number(a.contributions_ytd)),
    }));
    const totalGap = gaps.reduce((s, g) => s + g.gap, 0);
    if (totalGap === 0) {
      // Even split
      const each = Math.floor(freeCash / accounts.length);
      const m: Record<string, number> = {};
      accounts.forEach(a => (m[a.id] = each));
      setLocalAmounts(m);
    } else {
      const m: Record<string, number> = {};
      gaps.forEach(g => {
        m[g.id] = Math.round((g.gap / totalGap) * freeCash);
      });
      setLocalAmounts(m);
    }
  };

  // Load existing line items into local state when plan loads
  useEffect(() => {
    if (lineItems.length > 0 && Object.keys(localAmounts).length === 0) {
      const m: Record<string, number> = {};
      lineItems.forEach(li => {
        if (li.target_account_id) m[li.target_account_id] = Number(li.amount);
      });
      if (Object.keys(m).length > 0) {
        setLocalAmounts(m);
      }
    }
  }, [lineItems]);

  const isLocked = plan?.status === 'finalized' || plan?.status === 'executed';
  const allExecuted = lineItems.length > 0 && lineItems.every(li => li.executed);

  const navigateMonth = (dir: number) => {
    const idx = monthOptions.indexOf(selectedMonth);
    const next = monthOptions[idx + dir];
    if (next) {
      setSelectedMonth(next);
      setLocalAmounts({});
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Allocations</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigateMonth(-1)} disabled={monthOptions.indexOf(selectedMonth) === 0}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select value={selectedMonth} onValueChange={v => { setSelectedMonth(v); setLocalAmounts({}); }}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{monthOptions.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => navigateMonth(1)} disabled={monthOptions.indexOf(selectedMonth) === monthOptions.length - 1}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {plan && (
          <div className="flex items-center gap-2">
            <Badge variant={plan.status === 'draft' ? 'secondary' : plan.status === 'finalized' ? 'default' : 'outline'}>
              {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
            </Badge>
            {allExecuted && plan.status === 'finalized' && (
              <Badge variant="outline" className="text-[hsl(var(--success))] border-[hsl(var(--success))]/30">All Executed</Badge>
            )}
          </div>
        )}

        {/* Waterfall */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Cash Flow Waterfall</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <WaterfallRow label="Total Income" value={monthIncome} type="income" />
            <WaterfallRow label="Total Expenses" value={-monthExpenses} type="expense" />
            <WaterfallRow label="Tax Reserve" value={-taxReserve} type="expense" />
            <div className="flex items-center gap-3">
              <Minus className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground flex-1">Emergency Fund</span>
              <Input
                type="number"
                className="w-28 h-8 text-right text-sm"
                value={emergencyFund}
                onChange={e => setEmergencyFund(Number(e.target.value))}
                disabled={isLocked}
              />
            </div>
            <div className="border-t border-border pt-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Free Cash (Safe to Invest)</span>
              <span className={`text-lg font-bold ${freeCash > 0 ? 'text-[hsl(var(--success))]' : 'text-destructive'}`}>
                {fmt(freeCash)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Distribution */}
        {accounts.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">Distribution</CardTitle>
              {!isLocked && (
                <Button variant="outline" size="sm" onClick={autoDistribute}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />Auto-Fill
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {isLocked && <TableHead className="w-10">Done</TableHead>}
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">YTD Gap</TableHead>
                    <TableHead className="text-right w-32">Allocate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map(a => {
                    const gap = Math.max(0, Number(a.contribution_target_yearly) - Number(a.contributions_ytd));
                    const li = lineItems.find(l => l.target_account_id === a.id);
                    return (
                      <TableRow key={a.id}>
                        {isLocked && (
                          <TableCell>
                            <Checkbox
                              checked={li?.executed || false}
                              onCheckedChange={checked => li && toggleExecuted.mutate({ id: li.id, executed: !!checked })}
                            />
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="text-sm font-medium text-foreground">{a.account_name}</div>
                          {a.platform && <div className="text-xs text-muted-foreground">{a.platform}</div>}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{fmt(gap)}</TableCell>
                        <TableCell className="text-right">
                          {isLocked ? (
                            <span className="text-sm font-medium text-foreground">{fmt(li ? Number(li.amount) : 0)}</span>
                          ) : (
                            <Input
                              type="number"
                              className="w-28 h-8 text-right text-sm ml-auto"
                              value={localAmounts[a.id] || 0}
                              onChange={e => setLocalAmounts(m => ({ ...m, [a.id]: Number(e.target.value) }))}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex justify-between items-center mt-4 pt-3 border-t border-border">
                <span className="text-sm text-muted-foreground">
                  Allocated: {fmt(isLocked ? lineItems.reduce((s, l) => s + Number(l.amount), 0) : totalAllocated)}
                  {' '}/ {fmt(freeCash)}
                  {!isLocked && remaining !== 0 && (
                    <span className={remaining > 0 ? 'text-[hsl(var(--warning))]' : 'text-destructive'}>
                      {' '}({remaining > 0 ? `${fmt(remaining)} unallocated` : `${fmt(Math.abs(remaining))} over`})
                    </span>
                  )}
                </span>
                <div className="flex gap-2">
                  {!isLocked && (
                    <Button size="sm" onClick={() => savePlan.mutate()} disabled={savePlan.isPending}>
                      {savePlan.isPending ? 'Saving…' : 'Save Plan'}
                    </Button>
                  )}
                  {plan?.status === 'draft' && (
                    <Button size="sm" variant="outline" onClick={() => finalizePlan.mutate()} disabled={finalizePlan.isPending}>
                      <Lock className="h-3.5 w-3.5 mr-1" />Finalize
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {accounts.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground text-sm">Add investment accounts on the <a href="/wealth" className="text-primary underline">Wealth</a> page first to create allocation plans.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function WaterfallRow({ label, value, type }: { label: string; value: number; type: 'income' | 'expense' }) {
  return (
    <div className="flex items-center gap-3">
      {type === 'income' ? <ArrowRight className="h-4 w-4 text-[hsl(var(--success))]" /> : <ArrowDown className="h-4 w-4 text-destructive" />}
      <span className="text-sm text-foreground flex-1">{label}</span>
      <span className={`text-sm font-medium ${type === 'income' ? 'text-[hsl(var(--success))]' : 'text-destructive'}`}>
        {value < 0 ? `−${fmt(Math.abs(value))}` : fmt(value)}
      </span>
    </div>
  );
}
