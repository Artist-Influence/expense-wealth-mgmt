import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { TransactionDetailDrawer } from '@/components/TransactionDetailDrawer';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Receipt, Search, Download, Clock, CheckCheck, Send, AlertTriangle,
  Plus, FolderOpen, ChevronDown
} from 'lucide-react';

interface ReimbursableTransaction {
  id: string;
  date: string | null;
  description_raw: string | null;
  description_normalized: string | null;
  amount: number | null;
  predicted_category: string | null;
  predicted_method: string | null;
  predicted_notes: string | null;
  final_category: string | null;
  final_method: string | null;
  final_notes: string | null;
  confidence: number | null;
  match_source: string | null;
  match_explanation?: string | null;
  review_status: string;
  mode: string;
  transaction_mode: string;
  economic_owner: string;
  treatment_type: string;
  counts_toward_true_personal_spend: boolean;
  counts_toward_true_business_spend: boolean;
  is_reimbursable: boolean;
  reimbursable_to: string | null;
  reimbursement_status: string;
  tax_treatment: string;
  tax_entity: string | null;
  counts_as_tax_deduction: boolean;
  is_non_expense_cash_movement: boolean;
  client_or_project_tag: string | null;
  business_purpose: string | null;
  receipt_required: boolean;
  receipt_attached: boolean;
  parse_status: string | null;
  duplicate_status: string | null;
  is_transfer: boolean | null;
  exclude_from_expense_totals: boolean | null;
  transfer_type: string | null;
  source_file_name: string | null;
  linked_reimbursement_group_id: string | null;
}

interface ReimbursementGroup {
  id: string;
  owner_id: string;
  title: string;
  reimbursable_to: string;
  report_id: string | null;
  status: string;
  total_expected: number;
  total_received: number;
  submitted_date: string | null;
  received_date: string | null;
  notes: string | null;
  created_at: string;
}

type TabFilter = 'pending' | 'submitted' | 'reimbursed' | 'all';

const STATUS_COLORS: Record<string, string> = {
  none: 'bg-muted text-muted-foreground',
  pending: 'bg-warning/15 text-warning',
  submitted: 'bg-primary/15 text-primary',
  approved: 'bg-success/15 text-success',
  reimbursed: 'bg-success/20 text-success',
  partially_reimbursed: 'bg-warning/20 text-warning',
  denied: 'bg-destructive/15 text-destructive',
};

export default function Reimbursements() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<ReimbursableTransaction[]>([]);
  const [groups, setGroups] = useState<ReimbursementGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabFilter>('pending');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailTx, setDetailTx] = useState<ReimbursableTransaction | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  // Group creation dialog
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupTo, setNewGroupTo] = useState('employer');
  const [newGroupNotes, setNewGroupNotes] = useState('');

  // Group detail dialog
  const [selectedGroup, setSelectedGroup] = useState<ReimbursementGroup | null>(null);
  const [groupTxs, setGroupTxs] = useState<ReimbursableTransaction[]>([]);

  useEffect(() => {
    if (user) { loadData(); loadCategories(); }
  }, [user]);

  const loadCategories = async () => {
    const { data } = await supabase
      .from('category_options')
      .select('category_name')
      .eq('mode', 'personal')
      .eq('is_active', true)
      .eq('owner_id', user!.id)
      .order('sort_order');
    setCategories((data || []).map(c => c.category_name));
  };

  const loadData = async () => {
    setLoading(true);
    const [txResult, grpResult] = await Promise.all([
      supabase
        .from('transactions_uploaded')
        .select('*')
        .eq('owner_id', user!.id)
        .eq('is_reimbursable', true)
        .order('date', { ascending: false }),
      (supabase as any)
        .from('reimbursement_groups')
        .select('*')
        .eq('owner_id', user!.id)
        .order('created_at', { ascending: false }),
    ]);
    setTransactions((txResult.data || []) as unknown as ReimbursableTransaction[]);
    setGroups((grpResult.data || []) as unknown as ReimbursementGroup[]);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = transactions;
    if (tab === 'pending') result = result.filter(t => ['none', 'pending'].includes(t.reimbursement_status));
    else if (tab === 'submitted') result = result.filter(t => ['submitted', 'approved'].includes(t.reimbursement_status));
    else if (tab === 'reimbursed') result = result.filter(t => ['reimbursed', 'partially_reimbursed'].includes(t.reimbursement_status));

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(t =>
        (t.description_raw || '').toLowerCase().includes(s) ||
        (t.business_purpose || '').toLowerCase().includes(s) ||
        (t.reimbursable_to || '').toLowerCase().includes(s)
      );
    }
    return result;
  }, [transactions, tab, search]);

  // Stats
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const pendingTotal = transactions
      .filter(t => ['none', 'pending'].includes(t.reimbursement_status))
      .reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    const submittedTotal = transactions
      .filter(t => ['submitted', 'approved'].includes(t.reimbursement_status))
      .reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    const reimbursedThisMonth = transactions
      .filter(t => t.reimbursement_status === 'reimbursed' && t.date && t.date.startsWith(thisMonth))
      .reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const overdueTotal = transactions
      .filter(t => t.reimbursement_status === 'submitted' && t.date && t.date < thirtyDaysAgo)
      .reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    return { pendingTotal, submittedTotal, reimbursedThisMonth, overdueTotal };
  }, [transactions]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(t => t.id)));
  };

  const bulkUpdateStatus = async (status: string) => {
    const ids = [...selectedIds];
    await supabase.from('transactions_uploaded').update({ reimbursement_status: status }).in('id', ids);
    setSelectedIds(new Set());
    await loadData();
    toast.success(`Updated ${ids.length} items to ${status}`);
  };

  const createReportGroup = async () => {
    if (!newGroupTitle.trim()) { toast.error('Title required'); return; }
    const ids = [...selectedIds];
    const selectedTxs = transactions.filter(t => ids.includes(t.id));
    const totalExpected = selectedTxs.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    const { data: group, error } = await (supabase as any)
      .from('reimbursement_groups')
      .insert({
        owner_id: user!.id,
        title: newGroupTitle.trim(),
        reimbursable_to: newGroupTo,
        notes: newGroupNotes || null,
        total_expected: totalExpected,
        status: 'pending',
      })
      .select()
      .single();

    if (error || !group) { toast.error('Failed to create group'); return; }

    await (supabase as any).from('transactions_uploaded')
      .update({ linked_reimbursement_group_id: (group as any).id })
      .in('id', ids);

    setShowCreateGroup(false);
    setNewGroupTitle('');
    setNewGroupNotes('');
    setSelectedIds(new Set());
    await loadData();
    toast.success(`Report "${newGroupTitle.trim()}" created with ${ids.length} items`);
  };

  const openGroupDetail = async (group: ReimbursementGroup) => {
    setSelectedGroup(group);
    const { data } = await (supabase as any)
      .from('transactions_uploaded')
      .select('*')
      .eq('linked_reimbursement_group_id', group.id)
      .order('date', { ascending: false });
    setGroupTxs((data || []) as unknown as ReimbursableTransaction[]);
  };

  const updateGroupStatus = async (groupId: string, status: string) => {
    const updates: Record<string, any> = { status };
    if (status === 'submitted') updates.submitted_date = new Date().toISOString().split('T')[0];
    if (status === 'reimbursed') updates.received_date = new Date().toISOString().split('T')[0];

    await (supabase as any).from('reimbursement_groups').update(updates).eq('id', groupId);

    // Also update linked transactions
    const txStatus = status === 'submitted' ? 'submitted' : status === 'reimbursed' ? 'reimbursed' : status;
    await supabase.from('transactions_uploaded')
      .update({ reimbursement_status: txStatus })
      .eq('linked_reimbursement_group_id', groupId);

    setSelectedGroup(null);
    await loadData();
    toast.success(`Report marked as ${status}`);
  };

  const exportCsv = () => {
    const rows = filtered.map(t => ({
      Date: t.date || '',
      Merchant: t.description_raw || '',
      Amount: t.amount != null ? `$${Math.abs(t.amount).toFixed(2)}` : '',
      'Business Purpose': t.business_purpose || '',
      Category: t.final_category || t.predicted_category || '',
      'Receipt Attached': t.receipt_attached ? 'Yes' : 'No',
      'Report ID': groups.find(g => g.id === t.linked_reimbursement_group_id)?.report_id || '',
      Status: t.reimbursement_status,
    }));
    if (!rows.length) { toast.error('No rows to export'); return; }
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${(r[h as keyof typeof r] || '').toString().replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reimbursements_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Expense report exported');
  };

  const getAging = (date: string | null) => {
    if (!date) return '—';
    const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
    return `${days}d`;
  };

  const handleDrawerSave = async (id: string, values: any) => {
    await supabase.from('transactions_uploaded').update({
      final_category: values.category,
      final_method: values.method,
      final_notes: values.notes,
      transaction_mode: values.transaction_mode,
      economic_owner: values.economic_owner,
      treatment_type: values.treatment_type,
      tax_treatment: values.tax_treatment,
      is_reimbursable: values.is_reimbursable,
      reimbursable_to: values.reimbursable_to,
      reimbursement_status: values.reimbursement_status,
      business_purpose: values.business_purpose,
      counts_toward_true_personal_spend: values.counts_toward_true_personal_spend,
      counts_toward_true_business_spend: values.counts_toward_true_business_spend,
      client_or_project_tag: values.client_or_project_tag,
      review_status: 'edited',
    }).eq('id', id);
    await loadData();
    toast.success('Saved');
    setDetailTx(null);
  };

  const handleDrawerApprove = async (tx: ReimbursableTransaction) => {
    await supabase.from('transactions_uploaded').update({
      final_category: tx.final_category,
      final_method: tx.final_method,
      final_notes: tx.final_notes,
      review_status: 'approved',
    }).eq('id', tx.id);
    await loadData();
    setDetailTx(null);
  };

  const handleToggleTransfer = async (tx: ReimbursableTransaction) => {
    const newVal = !tx.is_transfer;
    await supabase.from('transactions_uploaded').update({
      is_transfer: newVal,
      exclude_from_expense_totals: newVal,
      is_non_expense_cash_movement: newVal,
      treatment_type: newVal ? 'transfer' : 'expense',
    }).eq('id', tx.id);
    await loadData();
    setDetailTx(null);
  };

  const TABS: { value: TabFilter; label: string; icon: React.ElementType }[] = [
    { value: 'pending', label: 'Pending', icon: Clock },
    { value: 'submitted', label: 'Submitted', icon: Send },
    { value: 'reimbursed', label: 'Reimbursed', icon: CheckCheck },
    { value: 'all', label: 'All', icon: Receipt },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Reimbursements</h1>
            <p className="text-sm text-muted-foreground mt-1">Track expenses you fronted — get your money back.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card border-border/40">
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Pending</p>
              <p className="text-xl font-semibold text-warning mt-1 font-mono">${stats.pendingTotal.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/40">
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Submitted</p>
              <p className="text-xl font-semibold text-primary mt-1 font-mono">${stats.submittedTotal.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/40">
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Reimbursed This Month</p>
              <p className="text-xl font-semibold text-success mt-1 font-mono">${stats.reimbursedThisMonth.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/40">
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Overdue</p>
              <p className="text-xl font-semibold text-destructive mt-1 font-mono">${stats.overdueTotal.toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Report Groups */}
        {groups.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Report Groups</h2>
            <div className="flex flex-wrap gap-2">
              {groups.map(g => (
                <button
                  key={g.id}
                  onClick={() => openGroupDetail(g)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/40 bg-card hover:bg-secondary/50 transition-colors text-left"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <span className="text-xs font-medium text-foreground">{g.title}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">${g.total_expected.toFixed(2)}</span>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ml-1 ${STATUS_COLORS[g.status] || ''}`}>
                    {g.status}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tabs + Search */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex rounded-lg border border-border/40 overflow-hidden">
            {TABS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => { setTab(value); setSelectedIds(new Set()); }}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  tab === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="pl-8 h-8 text-xs" />
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/30 border border-border/40">
            <span className="text-xs text-muted-foreground font-medium">{selectedIds.size} selected</span>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => bulkUpdateStatus('submitted')}>
              <Send className="h-3 w-3" /> Mark Submitted
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => bulkUpdateStatus('reimbursed')}>
              <CheckCheck className="h-3 w-3" /> Mark Reimbursed
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowCreateGroup(true)}>
              <Plus className="h-3 w-3" /> Create Report
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportCsv}>
              <Download className="h-3 w-3" /> Export
            </Button>
          </div>
        )}

        {/* Table */}
        <div className="border border-border/40 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-secondary/20">
                  <th className="px-3 py-2 text-left w-8">
                    <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={selectAll} className="rounded" />
                  </th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Date</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Merchant</th>
                  <th className="px-3 py-2 text-right text-muted-foreground font-medium">Amount</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Reimburse To</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Business Purpose</th>
                  <th className="px-3 py-2 text-center text-muted-foreground font-medium">Receipt</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Report</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Status</th>
                  <th className="px-3 py-2 text-right text-muted-foreground font-medium">Aging</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No reimbursable expenses found.</td></tr>
                ) : (
                  filtered.map(tx => {
                    const group = groups.find(g => g.id === tx.linked_reimbursement_group_id);
                    return (
                      <tr
                        key={tx.id}
                        className="border-b border-border/20 hover:bg-secondary/10 cursor-pointer transition-colors"
                        onClick={() => setDetailTx(tx)}
                      >
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelect(tx.id)} className="rounded" />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono">{tx.date || '—'}</td>
                        <td className="px-3 py-2 text-foreground max-w-[200px] truncate">{tx.description_raw || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">${tx.amount != null ? Math.abs(tx.amount).toFixed(2) : '0.00'}</td>
                        <td className="px-3 py-2 text-muted-foreground capitalize">{(tx.reimbursable_to || '—').replace(/_/g, ' ')}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{tx.business_purpose || '—'}</td>
                        <td className="px-3 py-2 text-center">
                          {tx.receipt_attached
                            ? <span className="text-success">✓</span>
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </td>
                        <td className="px-3 py-2">
                          {group ? (
                            <button
                              onClick={e => { e.stopPropagation(); openGroupDetail(group); }}
                              className="text-primary hover:underline text-xs"
                            >
                              {group.title}
                            </button>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_COLORS[tx.reimbursement_status] || ''}`}>
                            {tx.reimbursement_status.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground font-mono">{getAging(tx.date)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Transaction Detail Drawer */}
      <TransactionDetailDrawer
        transaction={detailTx}
        open={!!detailTx}
        onClose={() => setDetailTx(null)}
        categories={categories}
        onSave={handleDrawerSave}
        onApprove={handleDrawerApprove}
        onToggleTransfer={handleToggleTransfer}
      />

      {/* Create Report Group Dialog */}
      <Dialog open={showCreateGroup} onOpenChange={setShowCreateGroup}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Create Expense Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Report Title</Label>
              <Input value={newGroupTitle} onChange={e => setNewGroupTitle(e.target.value)} className="mt-1 h-9 text-sm" placeholder="e.g. March 2026 Work Expenses" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Reimbursable To</Label>
              <Select value={newGroupTo} onValueChange={setNewGroupTo}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['employer', 'artist_influence', 'client', 'personal', 'other'].map(v => (
                    <SelectItem key={v} value={v} className="text-sm">{v.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea value={newGroupNotes} onChange={e => setNewGroupNotes(e.target.value)} className="mt-1 text-sm min-h-[60px]" placeholder="Optional notes..." />
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedIds.size} expense(s) will be linked to this report, totaling $
              {transactions.filter(t => selectedIds.has(t.id)).reduce((s, t) => s + Math.abs(t.amount || 0), 0).toFixed(2)}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateGroup(false)}>Cancel</Button>
            <Button onClick={createReportGroup}>Create Report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Detail Dialog */}
      <Dialog open={!!selectedGroup} onOpenChange={v => !v && setSelectedGroup(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          {selectedGroup && (
            <>
              <DialogHeader>
                <DialogTitle className="text-foreground flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" /> {selectedGroup.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="outline" className={`ml-2 text-[10px] capitalize ${STATUS_COLORS[selectedGroup.status] || ''}`}>
                      {selectedGroup.status}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">To:</span>
                    <span className="text-foreground ml-1 capitalize">{selectedGroup.reimbursable_to.replace(/_/g, ' ')}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expected:</span>
                    <span className="text-foreground ml-1 font-mono">${selectedGroup.total_expected.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Received:</span>
                    <span className="text-foreground ml-1 font-mono">${selectedGroup.total_received.toFixed(2)}</span>
                  </div>
                </div>

                {selectedGroup.notes && (
                  <p className="text-xs text-muted-foreground bg-secondary/20 rounded px-2 py-1.5">{selectedGroup.notes}</p>
                )}

                <div>
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Linked Expenses ({groupTxs.length})</span>
                  <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                    {groupTxs.map(tx => (
                      <div key={tx.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-secondary/10">
                        <span className="text-muted-foreground font-mono">{tx.date}</span>
                        <span className="text-foreground truncate mx-2 flex-1">{tx.description_raw}</span>
                        <span className="text-foreground font-mono">${Math.abs(tx.amount || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                {selectedGroup.status === 'pending' && (
                  <Button size="sm" className="gap-1" onClick={() => updateGroupStatus(selectedGroup.id, 'submitted')}>
                    <Send className="h-3 w-3" /> Mark Submitted
                  </Button>
                )}
                {['pending', 'submitted'].includes(selectedGroup.status) && (
                  <Button size="sm" variant="secondary" className="gap-1" onClick={() => updateGroupStatus(selectedGroup.id, 'reimbursed')}>
                    <CheckCheck className="h-3 w-3" /> Mark Reimbursed
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setSelectedGroup(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
