import { AppNav } from '@/components/AppNav';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, TrendingUp, Wallet, Target, DollarSign, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ModeScopeToggle, readPersistedScope, type ModeScope } from '@/components/ModeScopeToggle';

const ACCOUNT_TYPES = [
  { value: 'roth_ira', label: 'Roth IRA' },
  { value: 'traditional_ira', label: 'Traditional IRA' },
  { value: 'brokerage', label: 'Brokerage' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'collectibles', label: 'Collectibles' },
  { value: 'savings', label: 'Savings' },
  { value: 'other', label: 'Other' },
];

const TYPE_GROUPS: Record<string, { label: string; types: string[] }> = {
  retirement: { label: 'Retirement', types: ['roth_ira', 'traditional_ira'] },
  brokerage: { label: 'Brokerage', types: ['brokerage'] },
  alternative: { label: 'Alternative', types: ['crypto', 'collectibles'] },
  other: { label: 'Other', types: ['savings', 'other'] },
};

type Account = {
  id: string;
  owner_id: string;
  account_name: string;
  account_type: string;
  platform: string | null;
  current_balance: number;
  contribution_target_monthly: number;
  contribution_target_yearly: number;
  contributions_ytd: number;
  priority: number;
  is_active: boolean;
  notes: string | null;
  updated_at: string;
};

const emptyForm = {
  account_name: '',
  account_type: 'brokerage',
  platform: '',
  current_balance: 0,
  contribution_target_monthly: 0,
  contribution_target_yearly: 0,
  contributions_ytd: 0,
  priority: 0,
  is_active: true,
  notes: '',
};

export default function Wealth() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['investment_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investment_accounts')
        .select('*')
        .order('priority', { ascending: false });
      if (error) throw error;
      return data as Account[];
    },
    enabled: !!user,
  });

  const upsert = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload = {
        ...values,
        owner_id: user!.id,
        current_balance: Number(values.current_balance),
        contribution_target_monthly: Number(values.contribution_target_monthly),
        contribution_target_yearly: Number(values.contribution_target_yearly),
        contributions_ytd: Number(values.contributions_ytd),
        priority: Number(values.priority),
        platform: values.platform || null,
        notes: values.notes || null,
      };
      if (editingId) {
        const { error } = await supabase.from('investment_accounts').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('investment_accounts').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investment_accounts'] });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success(editingId ? 'Account updated' : 'Account added');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteAccount = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('investment_accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investment_accounts'] });
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success('Account deleted');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openEdit = (a: Account) => {
    setEditingId(a.id);
    setForm({
      account_name: a.account_name,
      account_type: a.account_type,
      platform: a.platform || '',
      current_balance: a.current_balance,
      contribution_target_monthly: a.contribution_target_monthly,
      contribution_target_yearly: a.contribution_target_yearly,
      contributions_ytd: a.contributions_ytd,
      priority: a.priority,
      is_active: a.is_active,
      notes: a.notes || '',
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const totalBalance = accounts.reduce((s, a) => s + Number(a.current_balance), 0);
  const totalYtd = accounts.reduce((s, a) => s + Number(a.contributions_ytd), 0);
  const totalYearlyTarget = accounts.reduce((s, a) => s + Number(a.contribution_target_yearly), 0);

  const grouped = Object.entries(TYPE_GROUPS)
    .map(([key, g]) => ({
      key,
      label: g.label,
      accounts: accounts.filter(a => g.types.includes(a.account_type)),
    }))
    .filter(g => g.accounts.length > 0);

  const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  const typeLabel = (t: string) => ACCOUNT_TYPES.find(at => at.value === t)?.label || t;
  const timeAgo = (dateStr: string) => {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Wealth</h1>
          <Button size="sm" className="h-8" onClick={openAdd}><Plus className="h-3.5 w-3.5 mr-1" />Add Account</Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Card>
            <CardHeader className="p-3 pb-1 flex flex-row items-center gap-2 space-y-0">
              <Wallet className="h-3.5 w-3.5 text-primary" />
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Total Balance</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0"><span className="text-lg font-bold text-foreground">{fmt(totalBalance)}</span></CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1 flex flex-row items-center gap-2 space-y-0">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Contributions YTD</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0"><span className="text-lg font-bold text-foreground">{fmt(totalYtd)}</span></CardContent>
          </Card>
          <Card>
            <CardHeader className="p-3 pb-1 flex flex-row items-center gap-2 space-y-0">
              <Target className="h-3.5 w-3.5 text-primary" />
              <CardTitle className="text-[11px] font-medium text-muted-foreground">Yearly Target</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0"><span className="text-lg font-bold text-foreground">{fmt(totalYearlyTarget)}</span></CardContent>
          </Card>
        </div>

        {isLoading && <p className="text-muted-foreground text-xs">Loading…</p>}
        {!isLoading && accounts.length === 0 && (
          <Card className="p-6 text-center">
            <DollarSign className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-sm">No investment accounts yet. Add one to start tracking.</p>
          </Card>
        )}

        {/* Grouped accounts */}
        {grouped.map(g => (
          <div key={g.key} className="space-y-1.5">
            <h2 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{g.label}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.accounts.map(a => {
                const pct = a.contribution_target_yearly > 0
                  ? Math.min(100, (Number(a.contributions_ytd) / Number(a.contribution_target_yearly)) * 100)
                  : 0;
                return (
                  <Card key={a.id} className="relative group">
                    <CardHeader className="p-3 pb-1 flex flex-row items-start justify-between space-y-0">
                      <div className="min-w-0">
                        <CardTitle className="text-sm font-semibold text-foreground truncate">{a.account_name}</CardTitle>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{typeLabel(a.account_type)}</Badge>
                          {a.platform && <span className="text-[10px] text-muted-foreground">{a.platform}</span>}
                          {!a.is_active && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-destructive border-destructive/30">Inactive</Badge>}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => openEdit(a)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </CardHeader>
                    <CardContent className="p-3 pt-1 space-y-1.5">
                      <div className="text-base font-bold text-foreground">{fmt(Number(a.current_balance))}</div>
                      {a.contribution_target_yearly > 0 ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>{fmt(Number(a.contributions_ytd))} contributed</span>
                            <span>{fmt(Number(a.contribution_target_yearly))} target</span>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                        </div>
                      ) : a.contribution_target_monthly > 0 && (
                        <p className="text-[10px] text-muted-foreground">Monthly target: {fmt(Number(a.contribution_target_monthly))}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md p-4 gap-3">
          <DialogHeader className="space-y-0">
            <DialogTitle className="text-base">{editingId ? 'Edit Account' : 'Add Account'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5">
            <div className="space-y-1">
              <Label className="text-xs">Account Name</Label>
              <Input className="h-8 text-sm" value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))} placeholder="e.g. Roth IRA — Fidelity" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={form.account_type} onValueChange={v => setForm(f => ({ ...f, account_type: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{ACCOUNT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Platform</Label>
                <Input className="h-8 text-sm" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} placeholder="Fidelity, Wealthfront…" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Current Balance</Label>
                <Input className="h-8 text-sm" type="number" value={form.current_balance} onChange={e => setForm(f => ({ ...f, current_balance: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Contributions YTD</Label>
                <Input className="h-8 text-sm" type="number" value={form.contributions_ytd} onChange={e => setForm(f => ({ ...f, contributions_ytd: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Monthly Target</Label>
                <Input className="h-8 text-sm" type="number" value={form.contribution_target_monthly} onChange={e => setForm(f => ({ ...f, contribution_target_monthly: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Yearly Target</Label>
                <Input className="h-8 text-sm" type="number" value={form.contribution_target_yearly} onChange={e => setForm(f => ({ ...f, contribution_target_yearly: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Priority</Label>
                <Input className="h-8 text-sm" type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input className="h-8 text-sm" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional…" />
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-between gap-2 pt-1">
            {editingId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="mr-auto h-8">
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete account?</AlertDialogTitle>
                    <AlertDialogDescription>"{form.account_name}" will be permanently removed.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteAccount.mutate(editingId!)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button size="sm" className="h-8" onClick={() => upsert.mutate(form)} disabled={!form.account_name || upsert.isPending}>
                {upsert.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
