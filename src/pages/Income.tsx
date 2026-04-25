import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { CsvUploader } from '@/components/CsvUploader';
import { classifyIncome, INCOME_TYPE_OPTIONS, TAXABLE_STATUS_OPTIONS, MODE_OPTIONS } from '@/lib/income-classifier';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DollarSign, TrendingUp, Shield, ShieldOff, Briefcase, Banknote,
  Search, Download, Plus, Check, Trash2, Upload, Receipt,
  Calendar, ChevronDown, X
} from 'lucide-react';

interface IncomeTransaction {
  id: string;
  date: string | null;
  description_raw: string | null;
  description_normalized: string | null;
  amount: number | null;
  income_type: string;
  taxable_status: string;
  mode: string;
  source_account_name: string | null;
  linked_expense_id: string | null;
  linked_reimbursement_group_id: string | null;
  allocation_month: string | null;
  status: string;
  notes: string | null;
  source_file_name: string | null;
  created_at: string;
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
  const [filterMode, setFilterMode] = useState<'all' | 'personal' | 'business'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [csvImportMode, setCsvImportMode] = useState<'personal' | 'business'>('personal');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [dateLabel, setDateLabel] = useState<string>('All Dates');

  // Manual entry form
  const [manualDate, setManualDate] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualType, setManualType] = useState('other');
  const [manualTaxable, setManualTaxable] = useState('unknown');
  const [manualMode, setManualMode] = useState<'personal' | 'business'>('personal');
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

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  // Summary calculations
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const summaryCards = useMemo(() => {
    const dateActive = !!(dateFrom || dateTo);
    const inRange = transactions.filter(t => {
      if (dateActive) {
        if (dateFrom && (!t.date || t.date < dateFrom)) return false;
        if (dateTo && (!t.date || t.date > dateTo)) return false;
      }
      if (filterMode !== 'all' && t.mode !== filterMode) return false;
      return true;
    });
    // Always compute personal/business splits from the date-filtered set (ignore mode filter so the cards still show both)
    const dateRangeAll = transactions.filter(t => {
      if (!dateActive) return true;
      if (dateFrom && (!t.date || t.date < dateFrom)) return false;
      if (dateTo && (!t.date || t.date > dateTo)) return false;
      return true;
    });
    const personalIncome = dateRangeAll.filter(t => t.mode === 'personal').reduce((s, t) => s + (t.amount || 0), 0);
    const businessIncome = dateRangeAll.filter(t => t.mode === 'business').reduce((s, t) => s + (t.amount || 0), 0);

    const totalInflows = inRange.reduce((s, t) => s + (t.amount || 0), 0);
    const taxable = inRange.filter(t => t.taxable_status === 'taxable').reduce((s, t) => s + (t.amount || 0), 0);
    const nonTaxable = inRange.filter(t => t.taxable_status === 'non_taxable').reduce((s, t) => s + (t.amount || 0), 0);
    const revenue = inRange.filter(t => t.income_type === 'business_revenue').reduce((s, t) => s + (t.amount || 0), 0);
    const payroll = inRange.filter(t => t.income_type === 'payroll').reduce((s, t) => s + (t.amount || 0), 0);
    const other = inRange.filter(t => !['business_revenue', 'payroll'].includes(t.income_type)).reduce((s, t) => s + (t.amount || 0), 0);
    return { totalInflows, taxable, nonTaxable, revenue, payroll, other, personalIncome, businessIncome };
  }, [transactions, dateFrom, dateTo, filterMode]);

  // Filtering
  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (filterMode !== 'all' && t.mode !== filterMode) return false;
      if (filterType !== 'all' && t.income_type !== filterType) return false;
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (dateFrom && (!t.date || t.date < dateFrom)) return false;
      if (dateTo && (!t.date || t.date > dateTo)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const match = (t.description_raw || '').toLowerCase().includes(q)
          || (t.description_normalized || '').toLowerCase().includes(q)
          || (t.source_account_name || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [transactions, filterMode, filterType, filterStatus, dateFrom, dateTo, searchQuery]);

  // Months derived from transactions for the date filter
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => { if (t.date) set.add(t.date.slice(0, 7)); });
    return Array.from(set).sort().reverse();
  }, [transactions]);

  // ---- Date filter helpers ----
  const fmtYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const fmtMonthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  };
  const clearDates = () => {
    setDateFrom(null);
    setDateTo(null);
    setDateLabel('All Dates');
  };
  const applyMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    setDateFrom(fmtYMD(first));
    setDateTo(fmtYMD(last));
    setDateLabel(fmtMonthLabel(ym));
  };
  const applyThisMonth = () => {
    const nowD = new Date();
    applyMonth(`${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`);
    setDateLabel('This Month');
  };
  const applyLastMonth = () => {
    const nowD = new Date();
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
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
  const applyYTD = () => {
    const nowD = new Date();
    setDateFrom(`${nowD.getFullYear()}-01-01`);
    setDateTo(fmtYMD(nowD));
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
          // Honor user-selected mode for the import; the classifier's suggested_mode is a fallback hint
          mode: csvImportMode,
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
      mode: manualMode,
      source_account_name: manualAccount || null,
      notes: manualNotes || null,
      status: 'approved',
    });
    if (error) { toast.error('Failed to save'); console.error(error); }
    else {
      toast.success('Income entry added');
      setShowManualEntry(false);
      setManualDate(''); setManualDesc(''); setManualAmount(''); setManualType('other');
      setManualTaxable('unknown'); setManualMode('personal'); setManualAccount(''); setManualNotes('');
      fetchTransactions();
    }
  };

  const updateField = async (id: string, field: string, value: string) => {
    const { error } = await supabase.from('income_transactions').update({ [field]: value }).eq('id', id);
    if (error) toast.error('Update failed');
    else setTransactions(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
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


  // Export CSV
  const exportCsv = () => {
    const usingSelection = selectedIds.size > 0;
    const rows = usingSelection ? filtered.filter(t => selectedIds.has(t.id)) : filtered;
    if (rows.length === 0) { toast.error(usingSelection ? 'No selected rows to export' : 'No rows to export'); return; }
    const header = 'Date,Description,Amount,Income Type,Taxable Status,Source Account,Status,Notes\n';
    const csv = header + rows.map(t =>
      [t.date, `"${(t.description_raw || '').replace(/"/g, '""')}"`, t.amount, t.income_type, t.taxable_status, t.source_account_name || '', t.status, `"${(t.notes || '').replace(/"/g, '""')}"`].join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `income-${thisMonth}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(usingSelection ? `Exported ${rows.length} selected row${rows.length === 1 ? '' : 's'}` : `Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
  };

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  const cards = [
    { label: 'Personal Income', value: summaryCards.personalIncome, icon: Banknote, color: 'text-foreground' },
    { label: 'Business Income', value: summaryCards.businessIncome, icon: Briefcase, color: 'text-primary' },
    { label: filterMode === 'all' ? 'Total Inflows' : `${filterMode === 'business' ? 'Business' : 'Personal'} Total`, value: summaryCards.totalInflows, icon: DollarSign, color: 'text-primary' },
    { label: 'Taxable', value: summaryCards.taxable, icon: Shield, color: 'text-destructive' },
    { label: 'Non-Taxable', value: summaryCards.nonTaxable, icon: ShieldOff, color: 'text-success' },
    { label: 'Payroll', value: summaryCards.payroll, icon: Banknote, color: 'text-foreground' },
    { label: 'Business Revenue', value: summaryCards.revenue, icon: Briefcase, color: 'text-primary' },
    { label: 'Other', value: summaryCards.other, icon: Receipt, color: 'text-muted-foreground' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Income</h1>
            <p className="text-sm text-muted-foreground">Track inflows and classify by type. <span className="text-[10px] text-muted-foreground/70">Summary: {dateActive ? dateLabel : 'All Dates'}</span></p>
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

        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">View:</span>
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {(['all', 'personal', 'business'] as const).map(m => (
              <button
                key={m}
                onClick={() => setFilterMode(m)}
                className={`px-3 py-1 text-xs rounded-[4px] transition-colors ${
                  filterMode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                }`}
              >
                {m === 'all' ? 'All' : m === 'personal' ? 'Personal' : 'Business'}
              </button>
            ))}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
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
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground uppercase tracking-wide">Import as:</span>
              <div className="inline-flex rounded-md border border-border bg-card p-0.5">
                {(['personal', 'business'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setCsvImportMode(m)}
                    className={`px-3 py-1 rounded-[4px] transition-colors ${
                      csvImportMode === m
                        ? (m === 'business' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground')
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m === 'personal' ? 'Personal' : 'Business'}
                  </button>
                ))}
              </div>
              <span className="text-muted-foreground/70">All rows in this CSV will be tagged as {csvImportMode}.</span>
            </div>
            <CsvUploader onFilesSelect={handleCsvFiles} disabled={false} />
          </div>
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
              <SelectItem value="edited">Edited</SelectItem>
            </SelectContent>
          </Select>

          {/* Date range filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={`h-9 gap-1.5 text-xs bg-card border-border ${dateActive ? 'border-primary/40 text-primary' : ''}`}>
                <Calendar className="h-3.5 w-3.5" />
                {dateLabel}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[340px] p-3 space-y-3" align="start">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Quick presets</div>
                <div className="grid grid-cols-2 gap-1">
                  <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={clearDates}>All Dates</Button>
                  <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={applyThisMonth}>This Month</Button>
                  <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={applyLastMonth}>Last Month</Button>
                  <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={() => applyLastNDays(30)}>Last 30 Days</Button>
                  <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={() => applyLastNDays(90)}>Last 90 Days</Button>
                  <Button variant="ghost" size="sm" className="h-7 justify-start text-xs" onClick={applyYTD}>Year to Date</Button>
                  <Button variant="ghost" size="sm" className="h-7 justify-start text-xs col-span-2" onClick={applyLastYear}>Last Year</Button>
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

          {selectedIds.size > 0 && (
            <div className="flex gap-2 ml-auto">
              <Select onValueChange={v => bulkUpdate('mode', v)}>
                <SelectTrigger className="w-[130px] bg-card border-border"><SelectValue placeholder="Set Mode" /></SelectTrigger>
                <SelectContent>{MODE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
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
          Showing {filtered.length} of {transactions.length} income transactions · {dateActive ? dateLabel : 'All Dates'}
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

    </div>
  );
}
