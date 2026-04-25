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
import { Plus, Pencil, TrendingUp, Wallet, Target, DollarSign, Trash2, RefreshCw, Sparkles, CalendarPlus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ModeScopeToggle, readPersistedScope, type ModeScope } from '@/components/ModeScopeToggle';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CombinedWealthChart, type Snapshot } from '@/components/CombinedWealthChart';

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
  mode: 'personal' | 'business';
  starting_balance_year: number;
  auto_track_pattern: string | null;
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
  mode: 'personal' as 'personal' | 'business',
  starting_balance_year: 0,
  auto_track_pattern: '',
};

// Default auto-track patterns the "Sync from expenses" button seeds for missing accounts.
// Matches description_normalized OR description_raw via case-insensitive ILIKE in Supabase.
const DEFAULT_AUTO_ACCOUNTS: Array<{
  name: string; account_type: string; platform: string; pattern: string;
}> = [
  { name: 'Gemini',      account_type: 'crypto',       platform: 'Gemini',      pattern: 'gemini' },
  { name: 'Dub',         account_type: 'brokerage',    platform: 'Dub',         pattern: 'dub (ecfi)' },
  { name: 'Wealthfront', account_type: 'brokerage',    platform: 'Wealthfront', pattern: 'wealthfront' },
  { name: 'Pokémon',     account_type: 'collectibles', platform: 'TCGPlayer / Zelle', pattern: 'tcgplayer|pokemon' },
];

export default function Wealth() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [scope, setScope] = useState<ModeScope>(() => readPersistedScope('wealth_scope', 'all'));
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

  const { data: snapshots = [] } = useQuery({
    queryKey: ['account_balance_snapshots', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_balance_snapshots')
        .select('account_id, as_of_date, balance')
        .order('as_of_date', { ascending: true });
      if (error) throw error;
      return (data || []).map(s => ({
        account_id: s.account_id,
        as_of_date: s.as_of_date,
        balance: Number(s.balance),
      })) as Snapshot[];
    },
    enabled: !!user,
  });

  const upsertSnapshot = useMutation({
    mutationFn: async ({ account_id, as_of_date, balance }: { account_id: string; as_of_date: string; balance: number }) => {
      const { error } = await supabase
        .from('account_balance_snapshots')
        .upsert(
          { owner_id: user!.id, account_id, as_of_date, balance },
          { onConflict: 'account_id,as_of_date' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account_balance_snapshots', user?.id] });
      toast.success('Balance saved');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteSnapshot = useMutation({
    mutationFn: async ({ account_id, as_of_date }: { account_id: string; as_of_date: string }) => {
      const { error } = await supabase
        .from('account_balance_snapshots')
        .delete()
        .eq('account_id', account_id)
        .eq('as_of_date', as_of_date);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account_balance_snapshots', user?.id] });
      toast.success('Balance removed');
    },
    onError: (e: any) => toast.error(e.message),
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
        starting_balance_year: Number(values.starting_balance_year || 0),
        priority: Number(values.priority),
        platform: values.platform || null,
        notes: values.notes || null,
        auto_track_pattern: values.auto_track_pattern || null,
      };
      let savedId = editingId;
      if (editingId) {
        const { error } = await supabase.from('investment_accounts').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('investment_accounts').insert(payload).select('id').single();
        if (error) throw error;
        savedId = data?.id || null;
      }
      // Auto-snapshot today's balance so the chart's "Today" point and history stay in sync.
      if (savedId && Number(payload.current_balance) > 0) {
        const today = new Date().toISOString().slice(0, 10);
        await supabase
          .from('account_balance_snapshots')
          .upsert(
            { owner_id: user!.id, account_id: savedId, as_of_date: today, balance: Number(payload.current_balance) },
            { onConflict: 'account_id,as_of_date' }
          );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investment_accounts'] });
      qc.invalidateQueries({ queryKey: ['account_balance_snapshots', user?.id] });
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

  // ---------------------------------------------------------------
  // Auto-Sync Contributions: scans Personal expenses YTD for each
  // account's auto_track_pattern, sums them, writes contributions_ytd.
  // Creates the 4 default auto-track accounts on first run if missing.
  // ---------------------------------------------------------------
  const sync = useMutation({
    mutationFn: async () => {
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const yearEnd = `${new Date().getFullYear()}-12-31`;

      // 1. Seed default auto-track accounts that don't exist yet.
      const existingNames = new Set(accounts.map(a => a.account_name.toLowerCase()));
      const seeds: any[] = [];
      for (const def of DEFAULT_AUTO_ACCOUNTS) {
        if (!existingNames.has(def.name.toLowerCase())) {
          seeds.push({
            owner_id: user!.id,
            account_name: def.name,
            account_type: def.account_type,
            platform: def.platform,
            auto_track_pattern: def.pattern,
            mode: 'personal',
            current_balance: 0,
            contributions_ytd: 0,
            starting_balance_year: 0,
          });
        }
      }
      if (seeds.length) {
        const { error } = await supabase.from('investment_accounts').insert(seeds);
        if (error) throw error;
      }

      // 2. Re-fetch (we may have added rows above).
      const { data: latest } = await supabase.from('investment_accounts').select('*').eq('owner_id', user!.id);
      const all = (latest || []) as Account[];

      // 3. For each account with a pattern, sum matching personal expenses YTD.
      let updated = 0;
      for (const acc of all) {
        const pattern = acc.auto_track_pattern?.trim();
        if (!pattern) continue;
        const tokens = pattern.split('|').map(t => t.trim()).filter(Boolean);
        if (tokens.length === 0) continue;

        // Build OR filter for description_normalized + description_raw across all tokens.
        const orParts: string[] = [];
        for (const t of tokens) {
          const safe = t.replace(/[%,]/g, ' ');
          orParts.push(`description_normalized.ilike.%${safe}%`);
          orParts.push(`description_raw.ilike.%${safe}%`);
        }

        const { data: matches } = await supabase
          .from('transactions_uploaded')
          .select('amount')
          .eq('owner_id', user!.id)
          .eq('mode', 'personal')
          .gte('date', yearStart)
          .lte('date', yearEnd)
          .or(orParts.join(','));

        const total = (matches || []).reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
        if (Math.abs(Number(acc.contributions_ytd) - total) > 0.01) {
          const { error } = await supabase
            .from('investment_accounts')
            .update({ contributions_ytd: total })
            .eq('id', acc.id);
          if (!error) updated++;
        }
      }
      return { updated, seeded: seeds.length };
    },
    onSuccess: ({ updated, seeded }) => {
      qc.invalidateQueries({ queryKey: ['investment_accounts'] });
      toast.success(`Synced from expenses · ${updated} updated${seeded ? `, ${seeded} new account${seeded > 1 ? 's' : ''} added` : ''}`);
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
      mode: (a.mode as 'personal' | 'business') || 'personal',
      starting_balance_year: Number(a.starting_balance_year || 0),
      auto_track_pattern: a.auto_track_pattern || '',
    });
    setDialogOpen(true);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm, mode: scope === 'business' ? 'business' : 'personal' });
    setDialogOpen(true);
  };

  // Scope-filtered set powers all summary cards and grouped sections.
  const scopedAccounts = scope === 'all'
    ? accounts
    : accounts.filter(a => (a.mode || 'personal') === scope);

  const totalBalance = scopedAccounts.reduce((s, a) => s + Number(a.current_balance), 0);
  const totalYtd = scopedAccounts.reduce((s, a) => s + Number(a.contributions_ytd), 0);
  const totalYearlyTarget = scopedAccounts.reduce((s, a) => s + Number(a.contribution_target_yearly), 0);

  // Side-by-side personal vs business splits when "All" is active.
  const personalBalance = accounts.filter(a => (a.mode || 'personal') === 'personal').reduce((s, a) => s + Number(a.current_balance), 0);
  const businessBalance = accounts.filter(a => a.mode === 'business').reduce((s, a) => s + Number(a.current_balance), 0);

  const grouped = Object.entries(TYPE_GROUPS)
    .map(([key, g]) => ({
      key,
      label: g.label,
      accounts: scopedAccounts.filter(a => g.types.includes(a.account_type)),
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-foreground">Wealth</h1>
            <ModeScopeToggle value={scope} onChange={setScope} storageKey="wealth_scope" />
            <span className="text-[10px] text-muted-foreground">
              Showing: <span className="text-foreground/80 font-medium">{scope === 'all' ? 'All' : scope === 'business' ? 'Business' : 'Personal'}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              title="Scan personal expenses YTD and update contributions for any account with an auto-track pattern"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${sync.isPending ? 'animate-spin' : ''}`} />
              {sync.isPending ? 'Syncing…' : 'Sync from Expenses'}
            </Button>
            <Button size="sm" className="h-8" onClick={openAdd}><Plus className="h-3.5 w-3.5 mr-1" />Add Account</Button>
          </div>
        </div>

        {/* Summary cards (scope-filtered) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Card>
            <CardHeader className="p-3 pb-1 flex flex-row items-center gap-2 space-y-0">
              <Wallet className="h-3.5 w-3.5 text-primary" />
              <CardTitle className="text-[11px] font-medium text-muted-foreground">
                {scope === 'all' ? 'Total Balance' : scope === 'business' ? 'Business Balance' : 'Personal Balance'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <span className="text-lg font-bold text-foreground">{fmt(totalBalance)}</span>
              {scope === 'all' && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  P {fmt(personalBalance)} · B {fmt(businessBalance)}
                </div>
              )}
            </CardContent>
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
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${a.mode === 'business' ? 'bg-primary/15 text-primary border-primary/25' : 'bg-secondary text-foreground border-border'}`}
                          >
                            {a.mode === 'business' ? 'Business' : 'Personal'}
                          </Badge>
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
                      ) : a.contribution_target_monthly > 0 ? (
                        <p className="text-[10px] text-muted-foreground">Monthly target: {fmt(Number(a.contribution_target_monthly))}</p>
                      ) : Number(a.contributions_ytd) > 0 && (
                        <p className="text-[10px] text-muted-foreground">{fmt(Number(a.contributions_ytd))} contributed YTD</p>
                      )}

                      {/* Growth chart: Jan 1 baseline → Today current_balance */}
                      {(() => {
                        const baseline = Number(a.starting_balance_year || 0) > 0
                          ? Number(a.starting_balance_year)
                          : Math.max(0, Number(a.current_balance) - Number(a.contributions_ytd));
                        const current = Number(a.current_balance);
                        if (baseline <= 0 && current <= 0) return null;
                        const contributed = Number(a.contributions_ytd || 0);
                        const growth = current - baseline - contributed; // appreciation only
                        const data = [
                          { label: 'Jan 1', value: baseline },
                          { label: '+ contrib', value: baseline + contributed },
                          { label: 'Today', value: current },
                        ];
                        const delta = current - baseline;
                        const deltaPct = baseline > 0 ? (delta / baseline) * 100 : 0;
                        return (
                          <div className="pt-1 border-t border-border/50">
                            <div className="flex items-center justify-between text-[10px] mb-0.5">
                              <span className="text-muted-foreground">Growth YTD</span>
                              <span className={delta >= 0 ? 'text-[hsl(var(--success))]' : 'text-destructive'}>
                                {delta >= 0 ? '+' : ''}{fmt(delta)}{baseline > 0 ? ` (${deltaPct.toFixed(1)}%)` : ''}
                              </span>
                            </div>
                            <div className="h-12 -mx-1">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data} margin={{ top: 2, right: 4, left: 4, bottom: 2 }}>
                                  <Line
                                    type="monotone"
                                    dataKey="value"
                                    stroke={delta >= 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}
                                    strokeWidth={1.5}
                                    dot={{ r: 2 }}
                                  />
                                  <XAxis dataKey="label" hide />
                                  <YAxis hide domain={['dataMin', 'dataMax']} />
                                  <Tooltip
                                    contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', fontSize: 11, padding: '4px 8px' }}
                                    formatter={(v: any) => fmt(Number(v))}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="flex justify-between text-[9px] text-muted-foreground">
                              <span>Start {fmt(baseline)}</span>
                              <span>Contrib {fmt(contributed)}</span>
                              <span>Apprec {growth >= 0 ? '+' : ''}{fmt(growth)}</span>
                            </div>
                          </div>
                        );
                      })()}
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
                <Label className="text-xs">Scope</Label>
                <Select value={form.mode} onValueChange={v => setForm(f => ({ ...f, mode: v as 'personal' | 'business' }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={form.account_type} onValueChange={v => setForm(f => ({ ...f, account_type: v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{ACCOUNT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Platform</Label>
              <Input className="h-8 text-sm" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} placeholder="Fidelity, Wealthfront…" />
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
                <Label className="text-xs">Starting Balance (Jan 1)</Label>
                <Input className="h-8 text-sm" type="number" value={form.starting_balance_year} onChange={e => setForm(f => ({ ...f, starting_balance_year: Number(e.target.value) }))} placeholder="0 (auto)" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Auto-Track Pattern</Label>
                <Input className="h-8 text-sm" value={form.auto_track_pattern} onChange={e => setForm(f => ({ ...f, auto_track_pattern: e.target.value }))} placeholder="gemini|wealthfront" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Auto-track scans personal expenses for keywords (pipe-separated). Use Sync from Expenses to update.
            </p>
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
