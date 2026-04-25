import { useState, useMemo, useEffect } from 'react';
import { AppNav } from '@/components/AppNav';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Link } from 'react-router-dom';
import { NON_EARNING_TYPES } from '@/lib/income-classifier';
import {
  AlertTriangle, Landmark, Target, FileSpreadsheet,
  CheckCircle2, ChevronRight, ExternalLink
} from 'lucide-react';

const steps = [
  { id: 1, label: 'Review Exceptions', icon: AlertTriangle, desc: 'Approve or fix transactions needing review' },
  { id: 2, label: 'Check Tax Reserves', icon: Landmark, desc: 'Verify tax reserve levels are adequate' },
  { id: 3, label: 'Review Allocations', icon: Target, desc: 'Review or create the month\'s allocation plan' },
  { id: 4, label: 'Generate Exports', icon: FileSpreadsheet, desc: 'Download accountant-ready reports' },
  { id: 5, label: 'Mark Complete', icon: CheckCircle2, desc: 'Summary and confirmation' },
];

function getMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    options.push({ value: val, label: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) });
  }
  return options;
}

function getDateRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
  return { start, end };
}

export default function CloseMonth() {
  const { user } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [activeStep, setActiveStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  // Personal vs Business scope. Persisted across sessions.
  const [scope, setScope] = useState<'personal' | 'business'>(() => {
    if (typeof window === 'undefined') return 'personal';
    return (localStorage.getItem('close_scope') as 'personal' | 'business') || 'personal';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('close_scope', scope);
  }, [scope]);

  const monthOptions = useMemo(getMonthOptions, []);
  const dateRange = useMemo(() => getDateRange(selectedMonth), [selectedMonth]);

  // Exceptions count
  const { data: exceptions } = useQuery({
    queryKey: ['close-exceptions', user?.id, dateRange, scope],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from('transactions_uploaded')
        .select('id, description_normalized, amount, date, review_status')
        .eq('owner_id', user.id)
        .eq('transaction_mode', scope)
        .in('review_status', ['needs_review', 'suggested', 'ai_suggested'])
        .gte('date', dateRange.start)
        .lte('date', dateRange.end);
      return data || [];
    },
    enabled: !!user,
  });


  // Tax profile
  const { data: taxProfile } = useQuery({
    queryKey: ['close-tax', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('tax_profiles')
        .select('*')
        .eq('owner_id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  // Income for month — earned-only, mode-scoped
  const { data: monthIncome } = useQuery({
    queryKey: ['close-income', user?.id, dateRange, scope],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from('income_transactions')
        .select('amount, income_type')
        .eq('owner_id', user.id)
        .eq('mode', scope)
        .gte('date', dateRange.start)
        .lte('date', dateRange.end);
      return (data || []).filter(r => !(NON_EARNING_TYPES as readonly string[]).includes(r.income_type));
    },
    enabled: !!user,
  });

  // Allocation plan for month
  const { data: allocationPlan } = useQuery({
    queryKey: ['close-alloc', user?.id, selectedMonth],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('allocation_plans')
        .select('*')
        .eq('owner_id', user.id)
        .eq('month', selectedMonth)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const totalMonthIncome = (monthIncome || []).reduce((s, i) => s + (i.amount || 0), 0);
  const totalReserveRate = taxProfile
    ? (taxProfile.default_federal_reserve_percent + taxProfile.default_nys_reserve_percent + taxProfile.default_nyc_reserve_percent)
    : 0;
  const suggestedReserve = totalMonthIncome * (totalReserveRate / 100);

  const markStepComplete = (step: number) => {
    setCompletedSteps(prev => new Set(prev).add(step));
    if (step < 5) setActiveStep(step + 1);
  };

  const progressPercent = (completedSteps.size / 5) * 100;

  const renderStepContent = (step: number) => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={exceptions?.length ? 'destructive' : 'secondary'} className="text-xs">
                {exceptions?.length || 0} needing review or confirmation
              </Badge>
            </div>
            {exceptions && exceptions.length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-auto">
                {exceptions.slice(0, 10).map(e => (
                  <div key={e.id} className="flex justify-between items-center text-xs bg-secondary/30 rounded px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">{e.review_status.replace(/_/g, ' ')}</Badge>
                      <span className="text-foreground truncate max-w-[180px]">{e.description_normalized || 'Unknown'}</span>
                    </div>
                    <span className="text-muted-foreground font-mono">${Number(e.amount || 0).toFixed(2)}</span>
                  </div>
                ))}
                {exceptions.length > 10 && <p className="text-[10px] text-muted-foreground">+ {exceptions.length - 10} more</p>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">✓ No exceptions this month</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs gap-1" asChild>
                <Link to="/"><ExternalLink className="h-3 w-3" /> Go to Expenses</Link>
              </Button>
              {exceptions && exceptions.length > 0 ? (
                <Button size="sm" variant="outline" className="text-xs text-warning border-warning/30" onClick={() => {
                  if (confirm(`${exceptions.length} transactions still need review. Mark done anyway?`)) markStepComplete(1);
                }}>
                  Accept {exceptions.length} Unreviewed
                </Button>
              ) : (
                <Button size="sm" className="text-xs" onClick={() => markStepComplete(1)}>Mark Done</Button>
              )}
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-secondary/30 rounded p-2.5">
                <p className="text-muted-foreground">Month Income</p>
                <p className="font-mono font-medium text-foreground">${totalMonthIncome.toFixed(2)}</p>
              </div>
              <div className="bg-secondary/30 rounded p-2.5">
                <p className="text-muted-foreground">Suggested Reserve ({totalReserveRate.toFixed(1)}%)</p>
                <p className="font-mono font-medium text-foreground">${suggestedReserve.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs gap-1" asChild>
                <Link to="/tax"><ExternalLink className="h-3 w-3" /> Go to Tax</Link>
              </Button>
              <Button size="sm" className="text-xs" onClick={() => markStepComplete(2)}>Mark Done</Button>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-3">
            {allocationPlan ? (
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-secondary/30 rounded p-2.5">
                  <p className="text-muted-foreground">Status</p>
                  <Badge variant="outline" className="text-[10px] mt-1">{allocationPlan.status}</Badge>
                </div>
                <div className="bg-secondary/30 rounded p-2.5">
                  <p className="text-muted-foreground">Free Cash</p>
                  <p className="font-mono font-medium text-foreground">${Number(allocationPlan.free_cash).toFixed(2)}</p>
                </div>
                <div className="bg-secondary/30 rounded p-2.5">
                  <p className="text-muted-foreground">Tax Reserve</p>
                  <p className="font-mono font-medium text-foreground">${Number(allocationPlan.tax_reserve_amount).toFixed(2)}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No allocation plan for this month yet.</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs gap-1" asChild>
                <Link to="/allocations"><ExternalLink className="h-3 w-3" /> Go to Allocations</Link>
              </Button>
              <Button size="sm" className="text-xs" onClick={() => markStepComplete(3)}>Mark Done</Button>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Generate and download reports for this month's data.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs gap-1" asChild>
                <Link to="/accountant"><ExternalLink className="h-3 w-3" /> Go to Accountant</Link>
              </Button>
              <Button size="sm" className="text-xs" onClick={() => markStepComplete(4)}>Mark Done</Button>
            </div>
          </div>
        );
      case 5:
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-secondary/30 rounded p-2.5 text-center">
                <p className="font-mono font-medium text-foreground text-lg">{completedSteps.size}</p>
                <p className="text-muted-foreground">Steps Done</p>
              </div>
              <div className="bg-secondary/30 rounded p-2.5 text-center">
                <p className="font-mono font-medium text-foreground text-lg">{exceptions?.length || 0}</p>
                <p className="text-muted-foreground">Exceptions</p>
              </div>
            </div>
            {completedSteps.size === 4 ? (
              <Button size="sm" className="text-xs w-full gap-1.5" onClick={() => markStepComplete(5)}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Close Month
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Complete all previous steps first.</p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Close Month</h1>
            <p className="text-sm text-muted-foreground">Guided monthly review — work through each step to close the books.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border/40 p-0.5 bg-secondary/40 text-xs">
              {(['personal', 'business'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { setScope(s); setCompletedSteps(new Set()); setActiveStep(1); }}
                  className={`px-3 py-1 rounded-sm capitalize transition-colors ${scope === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <Select value={selectedMonth} onValueChange={(v) => { setSelectedMonth(v); setCompletedSteps(new Set()); setActiveStep(1); }}>
              <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{completedSteps.size} of 5 steps</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {steps.map(step => {
            const Icon = step.icon;
            const isActive = activeStep === step.id;
            const isDone = completedSteps.has(step.id);
            return (
              <Card
                key={step.id}
                className={`transition-all ${isActive ? 'border-primary/40 bg-primary/[0.02]' : isDone ? 'border-green-500/30 bg-green-500/[0.02]' : 'opacity-60'}`}
              >
                <CardHeader
                  className="pb-2 cursor-pointer flex flex-row items-center gap-3"
                  onClick={() => setActiveStep(step.id)}
                >
                  <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium ${isDone ? 'bg-green-500/15 text-green-600' : isActive ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : step.id}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {step.label}
                      {isDone && <Badge variant="outline" className="text-[10px] text-green-600 border-green-500/30">Done</Badge>}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{step.desc}</p>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isActive ? 'rotate-90' : ''}`} />
                </CardHeader>
                {isActive && (
                  <CardContent className="pt-0">
                    {renderStepContent(step.id)}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
