import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { CsvUploader } from '@/components/CsvUploader';
import { classifyIncome, INCOME_TYPE_OPTIONS, TAXABLE_STATUS_OPTIONS } from '@/lib/income-classifier';
import { normalizeDescription } from '@/lib/normalizer';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  DollarSign, TrendingUp, Shield, ShieldOff, Briefcase, Banknote,
  Search, Download, Plus, Check, Trash2, Upload, Link2, Receipt
} from 'lucide-react';

interface IncomeTransaction {
  id: string;
  date: string | null;
  description_raw: string | null;
  description_normalized: string | null;
  amount: number | null;
  income_type: string;
  taxable_status: string;
  source_account_name: string | null;
  linked_expense_id: string | null;
  linked_reimbursement_group_id: string | null;
  allocation_month: string | null;
  status: string;
  notes: string | null;
  source_file_name: string | null;
  created_at: string;
}

interface ReimbursementGroup {
  id: string;
  title: string;
  status: string;
  total_expected: number;
  total_received: number;
  received_date: string | null;
}

const INCOME_TYPE_BADGE: Record<string, { class: string }> = {
  payroll: { class: 'bg-primary/15 text-primary border-primary/25' },
  business_revenue: { class: 'bg-success/15 text-success border-success/25' },
  reimbursement: { class: 'bg-warning/15 text-warning border-warning/25' },
  refund: { class: 'bg-muted text-muted-foreground border-border' },
  interest: { class: 'bg-accent/15 text-accent border-accent/25' },
  tax_refund: { class: 'bg-success/15 text-success border-success/25' },
  transfer: { class: 'bg-muted text-muted-foreground border-border' },
  owner_contribution: { class: 'bg-secondary text-secondary-foreground border-border' },
  loan_proceeds: { class: 'bg-secondary text-secondary-foreground border-border' },
  other: { class: 'bg-muted text-muted-foreground border-border' },
};

export default function Income() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<IncomeTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showMatchDialog, setShowMatchDialog] = useState(false);
  const [matchingTxId, setMatchingTxId] = useState<string | null>(null);
  const [reimbursementGroups, setReimbursementGroups] = useState<ReimbursementGroup[]>([]);
  const [showUploader, setShowUploader] = useState(false);

  // Manual entry form
  const [manualDate, setManualDate] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualType, setManualType] = useState('other');
  const [manualTaxable, setManualTaxable] = useState('unknown');
  const [manualAccount, setManualAccount] = useState('');
  const [manualNotes, setManualNotes] = useState('');

  const fetchTransactions = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let allData: IncomeTransaction[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from('income_transactions')
        .select('*')
        .eq('owner_id', user.id)
        .order('date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) { toast.error('Failed to load income'); console.error(error); break; }
      if (data) allData = [...allData, ...(data as IncomeTransaction[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    setTransactions(allData);
    setLoading(false);
  }, [user]);

  const fetchReimbursementGroups = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('reimbursement_groups')
      .select('id, title, status, total_expected, total_received')
      .eq('owner_id', user.id)
      .in('status', ['pending', 'submitted', 'partially_reimbursed']);
    setReimbursementGroups((data as ReimbursementGroup[]) || []);
  }, [user]);

  useEffect(() => { fetchTransactions(); fetchReimbursementGroups(); }, [fetchTransactions, fetchReimbursementGroups]);

  // Summary calculations
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const summaryCards = useMemo(() => {
    const monthTxs = transactions.filter(t => t.date?.startsWith(thisMonth));
    const totalInflows = monthTxs.reduce((s, t) => s + (t.amount || 0), 0);
    const taxable = monthTxs.filter(t => t.taxable_status === 'taxable').reduce((s, t) => s + (t.amount || 0), 0);
    const nonTaxable = monthTxs.filter(t => t.taxable_status === 'non_taxable').reduce((s, t) => s + (t.amount || 0), 0);
    const reimbursements = monthTxs.filter(t => t.income_type === 'reimbursement').reduce((s, t) => s + (t.amount || 0), 0);
    const revenue = monthTxs.filter(t => t.income_type === 'business_revenue').reduce((s, t) => s + (t.amount || 0), 0);
    const payroll = monthTxs.filter(t => t.income_type === 'payroll').reduce((s, t) => s + (t.amount || 0), 0);
    return { totalInflows, taxable, nonTaxable, reimbursements, revenue, payroll };
  }, [transactions, thisMonth]);

  // Filtering
  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (filterType !== 'all' && t.income_type !== filterType) return false;
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const match = (t.description_raw || '').toLowerCase().includes(q)
          || (t.description_normalized || '').toLowerCase().includes(q)
          || (t.source_account_name || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [transactions, filterType, filterStatus, searchQuery]);

  // Selection
  const allSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(t => t.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  // CSV upload handler with duplicate detection
  const handleCsvFiles = async (files: File[]) => {
    if (!user) return;
    for (const file of files) {
      const text = await file.text();
      const parsed = Papa.parse(text, { header: false, skipEmptyLines: true });
      const allRows = parsed.data as string[][];
      if (allRows.length < 2) { toast.error(`${file.name}: No data rows`); continue; }

      const headers = allRows[0].map(h => (h || '').trim().toLowerCase());
      const dateIdx = headers.findIndex(h => /date/i.test(h));
      const descIdx = headers.findIndex(h => /desc|memo|narr|detail/i.test(h));
      const amtIdx = headers.findIndex(h => /amount|credit|deposit/i.test(h));

      if (amtIdx === -1) { toast.error(`${file.name}: No amount column found`); continue; }

      // Load existing income for dedup
      const existingFingerprints = new Set<string>();
      const { data: existingTxs } = await supabase
        .from('income_transactions')
        .select('date, amount, description_normalized')
        .eq('owner_id', user.id);
      for (const ex of (existingTxs || [])) {
        const fp = `income|${ex.date || ''}|${ex.amount || 0}|${(ex.description_normalized || '').toLowerCase()}`;
        existingFingerprints.add(fp);
      }

      const rows: any[] = [];
      let skippedDupes = 0;
      for (let i = 1; i < allRows.length; i++) {
        const cols = allRows[i];
        const rawDesc = descIdx >= 0 ? cols[descIdx] : '';
        const rawAmount = parseFloat((cols[amtIdx] || '0').replace(/[$,]/g, ''));
        if (isNaN(rawAmount) || rawAmount === 0) continue;
        // Accept negative amounts (some banks represent credits as negative)
        const normalizedAmount = Math.abs(rawAmount);

        const classification = classifyIncome(rawDesc);
        const normalized = normalizeDescription(rawDesc);
        const dateVal = dateIdx >= 0 ? cols[dateIdx] : null;

        // Fingerprint-based dedup
        const fp = `income|${dateVal || ''}|${normalizedAmount}|${(normalized || '').toLowerCase()}`;
        if (existingFingerprints.has(fp)) { skippedDupes++; continue; }
        existingFingerprints.add(fp);

        rows.push({
          owner_id: user.id,
          date: dateVal,
          description_raw: rawDesc || null,
          description_normalized: normalized || null,
          amount: normalizedAmount,
          income_type: classification.income_type,
          taxable_status: classification.taxable_status,
          status: classification.confidence >= 80 ? 'auto_classified' : 'needs_review',
          source_file_name: file.name,
        });
      }

      if (rows.length === 0 && skippedDupes > 0) { toast.info(`${file.name}: All ${skippedDupes} rows are duplicates`); continue; }
      if (rows.length === 0) { toast.error(`${file.name}: No valid income rows`); continue; }

      const { error } = await supabase.from('income_transactions').insert(rows);
      if (error) { toast.error(`${file.name}: Import failed`); console.error(error); }
      else toast.success(`${file.name}: ${rows.length} imported${skippedDupes > 0 ? `, ${skippedDupes} duplicates skipped` : ''}`);
    }
    setShowUploader(false);
    fetchTransactions();
  };

  // Manual entry
  const handleManualSave = async () => {
    if (!user || !manualAmount) return;
    const amt = parseFloat(manualAmount);
    if (isNaN(amt)) { toast.error('Invalid amount'); return; }

    const { error } = await supabase.from('income_transactions').insert({
      owner_id: user.id,
      date: manualDate || null,
      description_raw: manualDesc || null,
      description_normalized: manualDesc ? normalizeDescription(manualDesc) : null,
      amount: amt,
      income_type: manualType,
      taxable_status: manualTaxable,
      source_account_name: manualAccount || null,
      notes: manualNotes || null,
      status: 'approved',
    });
    if (error) { toast.error('Failed to save'); console.error(error); }
    else {
      toast.success('Income entry added');
      setShowManualEntry(false);
      setManualDate(''); setManualDesc(''); setManualAmount(''); setManualType('other');
      setManualTaxable('unknown'); setManualAccount(''); setManualNotes('');
      fetchTransactions();
    }
  };

  // Inline update with reimbursement guard
  const updateField = async (id: string, field: string, value: string) => {
    const tx = transactions.find(t => t.id === id);

    // Guard: if changing income_type away from 'reimbursement' while linked to a group, warn and unlink
    if (field === 'income_type' && value !== 'reimbursement' && tx?.linked_reimbursement_group_id) {
      if (!confirm('This transaction is matched to a reimbursement group. Changing the type will unlink it and reverse the received amount. Continue?')) return;
      await unlinkFromGroup(tx);
    }

    const { error } = await supabase.from('income_transactions').update({ [field]: value }).eq('id', id);
    if (error) toast.error('Update failed');
    else setTransactions(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  // Unlink income transaction from reimbursement group
  const unlinkFromGroup = async (tx: IncomeTransaction) => {
    if (!tx.linked_reimbursement_group_id) return;
    const group = reimbursementGroups.find(g => g.id === tx.linked_reimbursement_group_id);
    if (!group) return;

    const newReceived = Math.max(0, group.total_received - (tx.amount || 0));
    let newStatus: string;
    if (newReceived >= group.total_expected) newStatus = 'reimbursed';
    else if (newReceived > 0) newStatus = 'partially_reimbursed';
    else newStatus = 'pending';

    await supabase.from('income_transactions').update({
      linked_reimbursement_group_id: null,
    }).eq('id', tx.id);

    await supabase.from('reimbursement_groups').update({
      total_received: newReceived,
      status: newStatus,
      received_date: newStatus === 'reimbursed' ? group.received_date : null,
    }).eq('id', group.id);

    // Cascade status to linked expenses
    await supabase.from('transactions_uploaded')
      .update({ reimbursement_status: newStatus === 'reimbursed' ? 'reimbursed' : newStatus === 'partially_reimbursed' ? 'partially_reimbursed' : 'pending' })
      .eq('linked_reimbursement_group_id', group.id);

    setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, linked_reimbursement_group_id: null } : t));
    fetchReimbursementGroups();
    toast.success('Unlinked from reimbursement group');
  };

  // Bulk actions
  const bulkUpdate = async (field: string, value: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from('income_transactions').update({ [field]: value }).in('id', ids);
    if (error) toast.error('Bulk update failed');
    else {
      setTransactions(prev => prev.map(t => ids.includes(t.id) ? { ...t, [field]: value } : t));
      setSelectedIds(new Set());
      toast.success(`Updated ${ids.length} rows`);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} income transaction(s)? This cannot be undone.`)) return;
    const ids = Array.from(selectedIds);
    const { error } = await supabase.from('income_transactions').delete().in('id', ids);
    if (error) toast.error('Delete failed');
    else {
      setTransactions(prev => prev.filter(t => !ids.includes(t.id)));
      setSelectedIds(new Set());
      toast.success(`Deleted ${ids.length} rows`);
    }
  };

  // Reimbursement match
  const openMatchDialog = (txId: string) => {
    setMatchingTxId(txId);
    setShowMatchDialog(true);
  };

  const matchToGroup = async (groupId: string) => {
    if (!matchingTxId) return;
    const tx = transactions.find(t => t.id === matchingTxId);
    if (!tx) return;

    const group = reimbursementGroups.find(g => g.id === groupId);
    if (!group) return;

    const paymentAmount = tx.amount || 0;
    const newReceived = group.total_received + paymentAmount;
    const remaining = group.total_expected - group.total_received;

    // Warn on overpayment
    if (paymentAmount > remaining && remaining > 0) {
      const overBy = paymentAmount - remaining;
      if (!confirm(`This payment ($${paymentAmount.toFixed(2)}) exceeds the remaining balance ($${remaining.toFixed(2)}) by $${overBy.toFixed(2)}. Continue?`)) return;
    }

    // Link income to group
    await supabase.from('income_transactions').update({
      linked_reimbursement_group_id: groupId,
      status: 'approved',
    }).eq('id', matchingTxId);

    // Determine new group status
    let newStatus: string;
    if (newReceived >= group.total_expected) {
      newStatus = 'reimbursed';
    } else if (newReceived > 0) {
      newStatus = 'partially_reimbursed';
    } else {
      newStatus = group.status;
    }

    await supabase.from('reimbursement_groups').update({
      total_received: newReceived,
      status: newStatus,
      received_date: newStatus === 'reimbursed' ? new Date().toISOString().split('T')[0] : null,
    }).eq('id', groupId);

    // Cascade reimbursement status to linked expenses
    if (newStatus === 'reimbursed' || newStatus === 'partially_reimbursed') {
      await supabase.from('transactions_uploaded')
        .update({ reimbursement_status: newStatus })
        .eq('linked_reimbursement_group_id', groupId);
    }

    if (newReceived > group.total_expected) {
      toast.warning(`Matched — but received (${fmt(newReceived)}) exceeds expected (${fmt(group.total_expected)})`);
    } else if (newStatus === 'partially_reimbursed') {
      toast.success(`Matched — partially reimbursed (${fmt(newReceived)} of ${fmt(group.total_expected)})`);
    } else {
      toast.success('Matched to reimbursement group — fully reimbursed!');
    }
    setShowMatchDialog(false);
    setMatchingTxId(null);
    fetchTransactions();
    fetchReimbursementGroups();
  };

  // Export CSV
  const exportCsv = () => {
    const rows = filtered.length > 0 ? filtered : transactions;
    const header = 'Date,Description,Amount,Income Type,Taxable Status,Source Account,Status,Notes\n';
    const csv = header + rows.map(t =>
      [t.date, `"${(t.description_raw || '').replace(/"/g, '""')}"`, t.amount, t.income_type, t.taxable_status, t.source_account_name || '', t.status, `"${(t.notes || '').replace(/"/g, '""')}"`].join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `income-${thisMonth}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const cards = [
    { label: 'Total Inflows', value: summaryCards.totalInflows, icon: DollarSign, color: 'text-primary' },
    { label: 'Taxable', value: summaryCards.taxable, icon: Shield, color: 'text-destructive' },
    { label: 'Non-Taxable', value: summaryCards.nonTaxable, icon: ShieldOff, color: 'text-success' },
    { label: 'Reimbursements', value: summaryCards.reimbursements, icon: Receipt, color: 'text-warning' },
    { label: 'Business Revenue', value: summaryCards.revenue, icon: Briefcase, color: 'text-primary' },
    { label: 'Payroll', value: summaryCards.payroll, icon: Banknote, color: 'text-foreground' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Income</h1>
            <p className="text-sm text-muted-foreground">Track inflows, classify by type, and match reimbursements. <span className="text-[10px] text-muted-foreground/70">Summary: This Month</span></p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowUploader(!showUploader)}>
              <Upload className="h-4 w-4 mr-1" /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowManualEntry(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Entry
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {cards.map(c => (
            <Card key={c.label} className="glass-panel border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <c.icon className={`h-4 w-4 ${c.color}`} />
                  <span className="text-xs text-muted-foreground">{c.label}</span>
                </div>
                <p className="text-lg font-semibold text-foreground font-mono">{fmt(c.value)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* CSV Uploader */}
        {showUploader && (
          <CsvUploader onFilesSelect={handleCsvFiles} disabled={false} />
        )}

        {/* Filters & Bulk Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search descriptions..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 bg-card border-border" />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[160px] bg-card border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {INCOME_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px] bg-card border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="needs_review">Needs Review</SelectItem>
              <SelectItem value="auto_classified">Auto-Classified</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
            </SelectContent>
          </Select>

          {selectedIds.size > 0 && (
            <div className="flex gap-2 ml-auto">
              <Select onValueChange={v => bulkUpdate('income_type', v)}>
                <SelectTrigger className="w-[140px] bg-card border-border"><SelectValue placeholder="Set Type" /></SelectTrigger>
                <SelectContent>{INCOME_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select onValueChange={v => bulkUpdate('taxable_status', v)}>
                <SelectTrigger className="w-[140px] bg-card border-border"><SelectValue placeholder="Set Tax" /></SelectTrigger>
                <SelectContent>{TAXABLE_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => bulkUpdate('status', 'approved')}>
                <Check className="h-4 w-4 mr-1" /> Approve
              </Button>
              <Button variant="destructive" size="sm" onClick={bulkDelete}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="glass-panel rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Income Type</TableHead>
                <TableHead>Taxable</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-12">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                  No income transactions yet. Import a CSV or add an entry manually.
                </TableCell></TableRow>
              ) : filtered.map(tx => (
                <TableRow key={tx.id} className="border-border/50">
                  <TableCell><Checkbox checked={selectedIds.has(tx.id)} onCheckedChange={() => toggleOne(tx.id)} /></TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">{tx.date || '—'}</TableCell>
                  <TableCell className="text-sm text-foreground max-w-[240px] truncate">{tx.description_raw || '—'}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-success">{tx.amount != null ? fmt(tx.amount) : '—'}</TableCell>
                  <TableCell>
                    <Select value={tx.income_type} onValueChange={v => updateField(tx.id, 'income_type', v)}>
                      <SelectTrigger className="h-7 text-xs border-0 bg-transparent p-0 w-auto">
                        <Badge variant="outline" className={`text-xs ${INCOME_TYPE_BADGE[tx.income_type]?.class || ''}`}>
                          {INCOME_TYPE_OPTIONS.find(o => o.value === tx.income_type)?.label || tx.income_type}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>{INCOME_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={tx.taxable_status} onValueChange={v => updateField(tx.id, 'taxable_status', v)}>
                      <SelectTrigger className="h-7 text-xs border-0 bg-transparent p-0 w-auto">
                        <Badge variant="outline" className={`text-xs ${tx.taxable_status === 'taxable' ? 'bg-destructive/15 text-destructive border-destructive/25' : tx.taxable_status === 'non_taxable' ? 'bg-success/15 text-success border-success/25' : 'bg-muted text-muted-foreground border-border'}`}>
                          {TAXABLE_STATUS_OPTIONS.find(o => o.value === tx.taxable_status)?.label || tx.taxable_status}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>{TAXABLE_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{tx.source_account_name || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${tx.status === 'approved' ? 'bg-success/15 text-success border-success/25' : tx.status === 'auto_classified' ? 'bg-primary/15 text-primary border-primary/25' : 'bg-warning/15 text-warning border-warning/25'}`}>
                      {tx.status === 'needs_review' ? 'Review' : tx.status === 'auto_classified' ? 'Auto' : 'Approved'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {tx.income_type === 'reimbursement' && !tx.linked_reimbursement_group_id && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openMatchDialog(tx.id)} title="Match to reimbursement">
                          <Link2 className="h-3.5 w-3.5 text-warning" />
                        </Button>
                      )}
                      {tx.status !== 'approved' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateField(tx.id, 'status', 'approved')} title="Approve">
                          <Check className="h-3.5 w-3.5 text-success" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Showing {filtered.length} of {transactions.length} income transactions · This month: {thisMonth}
        </p>
      </div>

      {/* Manual Entry Dialog */}
      <Dialog open={showManualEntry} onOpenChange={setShowManualEntry}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Income Entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Date</Label><Input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className="bg-card" /></div>
              <div><Label className="text-xs">Amount</Label><Input type="number" placeholder="0.00" value={manualAmount} onChange={e => setManualAmount(e.target.value)} className="bg-card" /></div>
            </div>
            <div><Label className="text-xs">Description</Label><Input value={manualDesc} onChange={e => setManualDesc(e.target.value)} className="bg-card" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Income Type</Label>
                <Select value={manualType} onValueChange={setManualType}>
                  <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>{INCOME_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Taxable Status</Label>
                <Select value={manualTaxable} onValueChange={setManualTaxable}>
                  <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>{TAXABLE_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Source Account</Label><Input value={manualAccount} onChange={e => setManualAccount(e.target.value)} className="bg-card" placeholder="e.g. Chase Checking" /></div>
            <div><Label className="text-xs">Notes</Label><Input value={manualNotes} onChange={e => setManualNotes(e.target.value)} className="bg-card" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualEntry(false)}>Cancel</Button>
            <Button onClick={handleManualSave}>Save Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reimbursement Match Dialog */}
      <Dialog open={showMatchDialog} onOpenChange={setShowMatchDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Match to Reimbursement Group</DialogTitle></DialogHeader>
          {(() => {
            const matchTx = matchingTxId ? transactions.find(t => t.id === matchingTxId) : null;
            return matchTx ? (
              <div className="rounded border border-border bg-secondary/20 p-3 mb-2">
                <p className="text-xs text-muted-foreground">This payment</p>
                <p className="text-sm font-semibold text-foreground font-mono">{fmt(matchTx.amount || 0)}</p>
                <p className="text-xs text-muted-foreground truncate">{matchTx.description_raw}</p>
              </div>
            ) : null;
          })()}
          {reimbursementGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No pending reimbursement groups found.</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {reimbursementGroups.map(g => {
                const remaining = g.total_expected - g.total_received;
                const matchTx = matchingTxId ? transactions.find(t => t.id === matchingTxId) : null;
                const paymentAmt = matchTx?.amount || 0;
                const wouldOverpay = paymentAmt > remaining && remaining > 0;
                const wouldPartial = paymentAmt < remaining;
                return (
                  <div key={g.id} className={`flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors ${wouldOverpay ? 'border-destructive/40' : 'border-border'}`} onClick={() => matchToGroup(g.id)}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{g.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Expected: {fmt(g.total_expected)} · Received: {fmt(g.total_received)} · Remaining: {fmt(remaining)}
                      </p>
                      {wouldOverpay && (
                        <p className="text-[10px] text-destructive mt-0.5">⚠️ Payment exceeds remaining by {fmt(paymentAmt - remaining)}</p>
                      )}
                      {wouldPartial && (
                        <p className="text-[10px] text-warning mt-0.5">→ Will be partially reimbursed ({fmt(g.total_received + paymentAmt)} of {fmt(g.total_expected)})</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs ml-2 shrink-0">{g.status.replace(/_/g, ' ')}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
