import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { updateMerchantMemory } from '@/lib/categorization-engine';
import { generateMerchantKey, normalizeDescription } from '@/lib/normalizer';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Download, Check, CheckCheck, Edit3, X, ArrowLeftRight, AlertTriangle, Ban } from 'lucide-react';

interface Transaction {
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
  review_status: string;
  mode: string;
  parse_status: string | null;
  duplicate_status: string | null;
  is_transfer: boolean | null;
  exclude_from_expense_totals: boolean | null;
  transfer_type: string | null;
}

export default function ReviewTable() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const modeFilter = searchParams.get('mode') || '';
  const batchFilter = searchParams.get('batch') || '';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [extraFilter, setExtraFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ category: '', method: '', notes: '' });
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    if (user) {
      loadTransactions();
      loadCategories();
    }
  }, [user, modeFilter, batchFilter]);

  const loadCategories = async () => {
    const mode = modeFilter || 'personal';
    const { data } = await supabase
      .from('category_options')
      .select('category_name')
      .eq('mode', mode)
      .eq('is_active', true)
      .eq('owner_id', user!.id)
      .order('sort_order');
    setCategories((data || []).map(c => c.category_name));
  };

  const loadTransactions = async () => {
    setLoading(true);
    let query = supabase
      .from('transactions_uploaded')
      .select('*')
      .eq('owner_id', user!.id)
      .order('date', { ascending: false })
      .limit(500);

    if (modeFilter) query = query.eq('mode', modeFilter);
    if (batchFilter) query = query.eq('upload_batch_id', batchFilter);

    const { data, error } = await query;
    if (error) toast.error(error.message);
    setTransactions((data || []) as Transaction[]);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (statusFilter !== 'all' && tx.review_status !== statusFilter) return false;
      if (extraFilter === 'transfers' && !tx.is_transfer) return false;
      if (extraFilter === 'possible_duplicates' && tx.duplicate_status !== 'possible_duplicate') return false;
      if (extraFilter === 'parse_errors' && tx.parse_status !== 'parse_error') return false;
      if (extraFilter === 'excluded' && !tx.exclude_from_expense_totals) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          (tx.description_raw || '').toLowerCase().includes(s) ||
          (tx.predicted_category || '').toLowerCase().includes(s) ||
          (tx.final_category || '').toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [transactions, statusFilter, extraFilter, search]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(t => t.id)));
    }
  };

  const startEdit = (tx: Transaction) => {
    setEditingId(tx.id);
    setEditValues({
      category: tx.final_category || tx.predicted_category || '',
      method: tx.final_method || tx.predicted_method || '',
      notes: tx.final_notes || tx.predicted_notes || '',
    });
  };

  const saveEdit = async (tx: Transaction) => {
    const { error } = await supabase
      .from('transactions_uploaded')
      .update({
        final_category: editValues.category,
        final_method: editValues.method,
        final_notes: editValues.notes,
        review_status: 'edited',
      })
      .eq('id', tx.id);

    if (!error) {
      const merchantKey = generateMerchantKey(normalizeDescription(tx.description_raw || ''));
      await updateMerchantMemory(merchantKey, tx.mode as 'personal' | 'business', editValues.category, editValues.method || null, editValues.notes || null, tx.description_raw || '', user!.id);
      setEditingId(null);
      await loadTransactions();
      toast.success('Saved and memory updated');
    }
  };

  const approveRow = async (tx: Transaction) => {
    const category = tx.final_category || tx.predicted_category;
    if (!category) { toast.error('Set a category before approving'); return; }

    const { error } = await supabase
      .from('transactions_uploaded')
      .update({
        final_category: category,
        final_method: tx.final_method || tx.predicted_method,
        final_notes: tx.final_notes || tx.predicted_notes,
        review_status: 'approved',
      })
      .eq('id', tx.id);

    if (!error) {
      const merchantKey = generateMerchantKey(normalizeDescription(tx.description_raw || ''));
      await updateMerchantMemory(merchantKey, tx.mode as 'personal' | 'business', category, tx.final_method || tx.predicted_method || null, tx.final_notes || tx.predicted_notes || null, tx.description_raw || '', user!.id);
      await loadTransactions();
    }
  };

  const bulkApprove = async () => {
    const selected = filtered.filter(t => selectedIds.has(t.id));
    for (const tx of selected) await approveRow(tx);
    setSelectedIds(new Set());
    toast.success(`Approved ${selected.length} rows`);
  };

  const bulkMarkTransfer = async () => {
    const ids = [...selectedIds];
    const { error } = await supabase
      .from('transactions_uploaded')
      .update({
        is_transfer: true,
        exclude_from_expense_totals: true,
        transfer_type: 'unknown_transfer',
        predicted_category: 'Transfer',
        final_category: 'Transfer',
      })
      .in('id', ids);

    if (!error) {
      setSelectedIds(new Set());
      await loadTransactions();
      toast.success(`Marked ${ids.length} rows as transfer`);
    }
  };

  const toggleTransfer = async (tx: Transaction) => {
    const newIsTransfer = !tx.is_transfer;
    const { error } = await supabase
      .from('transactions_uploaded')
      .update({
        is_transfer: newIsTransfer,
        exclude_from_expense_totals: newIsTransfer,
        transfer_type: newIsTransfer ? 'unknown_transfer' : null,
      })
      .eq('id', tx.id);

    if (!error) {
      await loadTransactions();
      toast.success(newIsTransfer ? 'Marked as transfer' : 'Restored to expense');
    }
  };

  const exportCsv = () => {
    const rows = filtered
      .filter(t => t.review_status === 'approved' || t.review_status === 'auto_categorized' || t.review_status === 'edited')
      .map(t => ({
        Date: t.date || '',
        'Short Description': t.description_raw || '',
        Total: t.amount != null ? `$${Math.abs(t.amount).toFixed(2)}` : '',
        Category: t.final_category || t.predicted_category || '',
        Method: t.final_method || t.predicted_method || '',
        Notes: t.final_notes || t.predicted_notes || '',
        Transfer: t.is_transfer ? 'Yes' : 'No',
        'Excluded from Totals': t.exclude_from_expense_totals ? 'Yes' : 'No',
      }));

    const headers = ['Date', 'Short Description', 'Total', 'Category', 'Method', 'Notes', 'Transfer', 'Excluded from Totals'];
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${(r[h as keyof typeof r] || '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses_${modeFilter || 'all'}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const getConfidenceClass = (c: number | null) => {
    if (c === null) return 'confidence-low';
    if (c >= 90) return 'confidence-high';
    if (c >= 70) return 'confidence-medium';
    return 'confidence-low';
  };

  const getStatusClass = (s: string) => {
    switch (s) {
      case 'auto_categorized': return 'status-auto';
      case 'suggested': return 'status-suggested';
      case 'needs_review': return 'status-review';
      case 'approved':
      case 'edited': return 'status-approved';
      default: return 'match-tag';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-6 animate-fade-in">
        {/* Filters */}
        <div className="glass-panel p-4 mb-4 flex flex-wrap items-center gap-3 sticky top-14 z-40">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search descriptions..." value={search} onChange={e => setSearch(e.target.value)} className="glass-input pl-9 h-9 text-sm" />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] h-9 glass-input text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="needs_review">Needs Review</SelectItem>
              <SelectItem value="suggested">Suggested</SelectItem>
              <SelectItem value="auto_categorized">Auto</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="edited">Edited</SelectItem>
            </SelectContent>
          </Select>

          <Select value={extraFilter} onValueChange={setExtraFilter}>
            <SelectTrigger className="w-[170px] h-9 glass-input text-sm">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Rows</SelectItem>
              <SelectItem value="transfers">Transfers Only</SelectItem>
              <SelectItem value="possible_duplicates">Possible Duplicates</SelectItem>
              <SelectItem value="parse_errors">Parse Errors</SelectItem>
              <SelectItem value="excluded">Excluded from Totals</SelectItem>
            </SelectContent>
          </Select>

          {selectedIds.size > 0 && (
            <>
              <Button size="sm" onClick={bulkApprove} className="h-9 gap-1.5">
                <CheckCheck className="h-3.5 w-3.5" />
                Approve {selectedIds.size}
              </Button>
              <Button size="sm" variant="outline" onClick={bulkMarkTransfer} className="h-9 gap-1.5">
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Mark Transfer
              </Button>
            </>
          )}

          <Button variant="outline" size="sm" onClick={exportCsv} className="h-9 gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>

          <span className="text-xs text-muted-foreground font-mono ml-auto">
            {filtered.length} rows
          </span>
        </div>

        {/* Table */}
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="px-3 py-3 text-left">
                    <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={selectAll} className="rounded border-border" />
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Date</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Description</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Category</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Method</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Conf</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Flags</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2" />
                      Loading...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                      No transactions found
                    </td>
                  </tr>
                ) : (
                  filtered.map(tx => (
                    <tr key={tx.id} className={`border-b border-border/20 hover:bg-secondary/20 transition-colors ${tx.exclude_from_expense_totals ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelect(tx.id)} className="rounded border-border" />
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {tx.date || '—'}
                      </td>
                      <td className="px-3 py-2 max-w-[250px]">
                        <p className="text-xs text-foreground truncate" title={tx.description_raw || ''}>
                          {tx.description_raw || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-mono text-foreground whitespace-nowrap">
                        ${tx.amount != null ? Math.abs(tx.amount).toFixed(2) : '0.00'}
                      </td>
                      <td className="px-3 py-2">
                        {editingId === tx.id ? (
                          <Input value={editValues.category} onChange={e => setEditValues(v => ({ ...v, category: e.target.value }))} className="glass-input h-7 text-xs w-32" list="category-options" />
                        ) : (
                          <span className="text-xs text-foreground">
                            {tx.final_category || tx.predicted_category || '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {editingId === tx.id ? (
                          <Input value={editValues.method} onChange={e => setEditValues(v => ({ ...v, method: e.target.value }))} className="glass-input h-7 text-xs w-28" />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {tx.final_method || tx.predicted_method || '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={getConfidenceClass(tx.confidence)}>
                          {tx.confidence != null ? `${Math.round(tx.confidence)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={getStatusClass(tx.review_status)}>
                          {tx.review_status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          {tx.is_transfer && (
                            <Badge variant="outline" className="text-[10px] h-4 gap-0.5 border-primary/30 text-primary">
                              <ArrowLeftRight className="h-2.5 w-2.5" /> transfer
                            </Badge>
                          )}
                          {tx.duplicate_status === 'possible_duplicate' && (
                            <Badge variant="outline" className="text-[10px] h-4 gap-0.5 border-warning/30 text-warning">
                              <AlertTriangle className="h-2.5 w-2.5" /> dup?
                            </Badge>
                          )}
                          {tx.parse_status === 'parse_error' && (
                            <Badge variant="destructive" className="text-[10px] h-4">error</Badge>
                          )}
                          {tx.exclude_from_expense_totals && (
                            <Badge variant="outline" className="text-[10px] h-4 gap-0.5 border-muted-foreground/30 text-muted-foreground">
                              <Ban className="h-2.5 w-2.5" /> excl
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {editingId === tx.id ? (
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => saveEdit(tx)}>
                              <Check className="h-3.5 w-3.5 text-success" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(tx)} title="Edit">
                              <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => toggleTransfer(tx)} title={tx.is_transfer ? 'Restore to expense' : 'Mark as transfer'}>
                              <ArrowLeftRight className={`h-3.5 w-3.5 ${tx.is_transfer ? 'text-primary' : 'text-muted-foreground'}`} />
                            </Button>
                            {tx.review_status !== 'approved' && tx.review_status !== 'edited' && (
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => approveRow(tx)} title="Approve">
                                <Check className="h-3.5 w-3.5 text-success" />
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <datalist id="category-options">
          {categories.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>
    </div>
  );
}
