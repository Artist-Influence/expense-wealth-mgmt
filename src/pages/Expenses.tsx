import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { CsvUploader } from '@/components/CsvUploader';
import { FileProgressList, type FileQueueItem } from '@/components/FileProgressList';
import { ImportPreviewDialog, type FilePreviewInfo } from '@/components/ImportPreviewDialog';
import { previewCsvFile, parseCsvFileWithMapping, type ParsePreview, type ColumnMapping } from '@/lib/csv-parser';
import { categorizeTransactions, updateMerchantMemory } from '@/lib/categorization-engine';
import { detectMethodFromFilename } from '@/lib/method-detector';
import { detectTransfer } from '@/lib/transfer-detector';
import { generateFingerprint, isNearDuplicate } from '@/lib/duplicate-detector';
import { generateMerchantKey, normalizeDescription } from '@/lib/normalizer';
import { isStatementArtifact } from '@/lib/csv-parser';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  Upload, Search, Download, Check, CheckCheck, Edit3, X,
  ArrowLeftRight, AlertTriangle, Ban, FileText, Filter,
  Calendar, ChevronDown, Trash2
} from 'lucide-react';

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
  source_file_name: string | null;
}

export default function Expenses() {
  const { user } = useAuth();
  const [mode, setMode] = useState<'personal' | 'business'>('personal');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [extraFilter, setExtraFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ category: '', method: '', notes: '' });
  const [categories, setCategories] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sortCol, setSortCol] = useState<string>('date');
  const [sortAsc, setSortAsc] = useState(false);

  // Upload state
  const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
  const processingRef = useRef(false);
  const [filePreviews, setFilePreviews] = useState<FilePreviewInfo[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const isProcessing = fileQueue.some(f => !['done', 'error'].includes(f.status));
  const totalFiles = fileQueue.length;
  const completedFiles = fileQueue.filter(f => f.status === 'done' || f.status === 'error').length;
  const overallProgress = totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;

  useEffect(() => {
    if (user) { loadTransactions(); loadCategories(); }
  }, [user, mode]);

  const loadCategories = async () => {
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
    let from = 0;
    const pageSize = 1000;
    let allData: Transaction[] = [];
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('transactions_uploaded')
        .select('*')
        .eq('owner_id', user!.id)
        .eq('mode', mode)
        .order('date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (data) allData = [...allData, ...(data as Transaction[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    setTransactions(allData);
    setLoading(false);
  };

  // Filtering and sorting
  const filtered = useMemo(() => {
    let result = transactions.filter(tx => {
      if (statusFilter !== 'all' && tx.review_status !== statusFilter) return false;
      if (extraFilter === 'transfers' && !tx.is_transfer) return false;
      if (extraFilter === 'possible_duplicates' && tx.duplicate_status !== 'possible_duplicate') return false;
      if (extraFilter === 'parse_errors' && tx.parse_status !== 'parse_error') return false;
      if (extraFilter === 'excluded' && !tx.exclude_from_expense_totals) return false;
      if (extraFilter === 'uncategorized' && (tx.final_category || tx.predicted_category)) return false;
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

    result.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortCol) {
        case 'date': aVal = a.date || ''; bVal = b.date || ''; break;
        case 'description': aVal = (a.description_raw || '').toLowerCase(); bVal = (b.description_raw || '').toLowerCase(); break;
        case 'amount': aVal = Math.abs(a.amount || 0); bVal = Math.abs(b.amount || 0); break;
        case 'category': aVal = (a.final_category || a.predicted_category || '').toLowerCase(); bVal = (b.final_category || b.predicted_category || '').toLowerCase(); break;
        case 'confidence': aVal = a.confidence || 0; bVal = b.confidence || 0; break;
        default: aVal = a.date || ''; bVal = b.date || '';
      }
      if (aVal < bVal) return sortAsc ? -1 : 1;
      if (aVal > bVal) return sortAsc ? 1 : -1;
      return 0;
    });

    return result;
  }, [transactions, statusFilter, extraFilter, search, sortCol, sortAsc]);

  // Summary stats
  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const needsReview = transactions.filter(t => t.review_status === 'needs_review' || t.review_status === 'suggested').length;
    const uncategorized = transactions.filter(t => !t.final_category && !t.predicted_category).length;
    const duplicates = transactions.filter(t => t.duplicate_status === 'possible_duplicate').length;
    const transfersExcluded = transactions.filter(t => t.exclude_from_expense_totals).length;
    const thisMonthSpend = transactions
      .filter(t => t.date?.startsWith(thisMonth) && !t.exclude_from_expense_totals && t.parse_status !== 'parse_error')
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    return { total: transactions.length, needsReview, uncategorized, duplicates, transfersExcluded, thisMonthSpend };
  }, [transactions]);

  // Sort handler
  const handleSort = (col: string) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  // Selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(t => t.id)));
  };

  // Editing
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
      .update({ final_category: editValues.category, final_method: editValues.method, final_notes: editValues.notes, review_status: 'edited' })
      .eq('id', tx.id);
    if (!error) {
      // Merchant memory protection
      if (tx.parse_status === 'ok' && !tx.is_transfer && tx.duplicate_status !== 'possible_duplicate') {
        const desc = tx.description_raw || '';
        if (!isStatementArtifact(desc, tx.amount || 0)) {
          const merchantKey = generateMerchantKey(normalizeDescription(desc));
          await updateMerchantMemory(merchantKey, tx.mode as 'personal' | 'business', editValues.category, editValues.method || null, editValues.notes || null, desc, user!.id);
        }
      }
      setEditingId(null);
      await loadTransactions();
      toast.success('Saved');
    }
  };

  const approveRow = async (tx: Transaction) => {
    const category = tx.final_category || tx.predicted_category;
    if (!category) { toast.error('Set a category first'); return; }
    const { error } = await supabase
      .from('transactions_uploaded')
      .update({ final_category: category, final_method: tx.final_method || tx.predicted_method, final_notes: tx.final_notes || tx.predicted_notes, review_status: 'approved' })
      .eq('id', tx.id);
    if (!error) {
      // Merchant memory protection
      if (tx.parse_status === 'ok' && !tx.is_transfer && tx.duplicate_status !== 'possible_duplicate') {
        const desc = tx.description_raw || '';
        if (!isStatementArtifact(desc, tx.amount || 0)) {
          const merchantKey = generateMerchantKey(normalizeDescription(desc));
          await updateMerchantMemory(merchantKey, tx.mode as 'personal' | 'business', category, tx.final_method || tx.predicted_method || null, tx.final_notes || tx.predicted_notes || null, desc, user!.id);
        }
      }
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
    await supabase.from('transactions_uploaded').update({
      is_transfer: true, exclude_from_expense_totals: true, transfer_type: 'unknown_transfer',
      predicted_category: 'Transfer', final_category: 'Transfer',
    }).in('id', ids);
    setSelectedIds(new Set());
    await loadTransactions();
    toast.success(`Marked ${ids.length} rows as transfer`);
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (!confirm(`Delete ${ids.length} selected transaction(s)? This cannot be undone.`)) return;
    const { error } = await supabase.from('transactions_uploaded').delete().in('id', ids);
    if (error) { toast.error('Failed to delete'); return; }
    setSelectedIds(new Set());
    await loadTransactions();
    toast.success(`Deleted ${ids.length} rows`);
  };

  const toggleTransfer = async (tx: Transaction) => {
    const newIsTransfer = !tx.is_transfer;
    await supabase.from('transactions_uploaded').update({
      is_transfer: newIsTransfer, exclude_from_expense_totals: newIsTransfer,
      transfer_type: newIsTransfer ? 'unknown_transfer' : null,
    }).eq('id', tx.id);
    await loadTransactions();
    toast.success(newIsTransfer ? 'Marked as transfer' : 'Restored to expense');
  };

  const exportCsv = () => {
    const rows = filtered
      .filter(t => ['approved', 'auto_categorized', 'edited'].includes(t.review_status))
      .map(t => ({
        Date: t.date || '',
        Description: t.description_raw || '',
        Amount: t.amount != null ? `$${Math.abs(t.amount).toFixed(2)}` : '',
        Category: t.final_category || t.predicted_category || '',
        Method: t.final_method || t.predicted_method || '',
        Notes: t.final_notes || t.predicted_notes || '',
        Transfer: t.is_transfer ? 'Yes' : 'No',
      }));
    const headers = ['Date', 'Description', 'Amount', 'Category', 'Method', 'Notes', 'Transfer'];
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${(r[h as keyof typeof r] || '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses_${mode}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  // Upload processing (from Workspace)
  const updateItem = (id: string, patch: Partial<FileQueueItem>) => {
    setFileQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const loadSettings = async () => {
    const { data } = await supabase.from('app_settings')
      .select('prevent_exact_duplicates, flag_possible_duplicates, exclude_transfers_from_totals')
      .eq('owner_id', user!.id).maybeSingle();
    return {
      preventExactDuplicates: data?.prevent_exact_duplicates ?? true,
      flagPossibleDuplicates: data?.flag_possible_duplicates ?? true,
      excludeTransfers: data?.exclude_transfers_from_totals ?? true,
    };
  };

  const processFile = async (item: FileQueueItem, mapping: ColumnMapping) => {
    if (!user) return;
    const { id, file, method } = item;
    try {
      const appSettings = await loadSettings();
      updateItem(id, { status: 'parsing' });
      const parsed = await parseCsvFileWithMapping(file, mapping);
      const validRows = parsed.filter(r => r.parse_status === 'ok');
      const parseErrorRows = parsed.filter(r => r.parse_status === 'parse_error');

      if (validRows.length === 0) {
        updateItem(id, { status: 'error', error: `No valid rows. ${parseErrorRows.length} parse errors.` });
        return;
      }

      updateItem(id, { status: 'deduplicating' });
      const dates = validRows.map(r => r.date).filter(Boolean).sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      const existingFingerprints = new Set<string>();
      const existingForNearDup: { date: string | null; amount: number; description_normalized: string; id: string; fingerprint: string }[] = [];

      if (minDate && maxDate) {
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;
        while (hasMore) {
          const { data: existing } = await supabase
            .from('transactions_uploaded')
            .select('id, date, description_normalized, amount, duplicate_fingerprint')
            .eq('mode', mode).eq('owner_id', user.id)
            .gte('date', minDate).lte('date', maxDate)
            .range(from, from + pageSize - 1);
          if (existing) {
            for (const row of existing) {
              const fp = row.duplicate_fingerprint || generateFingerprint(mode, row.date, row.amount ?? 0, row.description_normalized || '');
              existingFingerprints.add(fp);
              existingForNearDup.push({ date: row.date, amount: row.amount ?? 0, description_normalized: row.description_normalized || '', id: row.id, fingerprint: fp });
            }
          }
          hasMore = (existing?.length ?? 0) === pageSize;
          from += pageSize;
        }
      }

      let exactDupCount = 0, possibleDupCount = 0;
      const rowsToInsert: typeof validRows = [];
      const dupStatuses: Map<number, { status: string; matchId: string | null }> = new Map();

      for (const tx of validRows) {
        const fp = generateFingerprint(mode, tx.date, tx.amount, tx.description_normalized);
        if (appSettings.preventExactDuplicates && existingFingerprints.has(fp)) { exactDupCount++; continue; }
        let nearDupMatch: string | null = null;
        if (appSettings.flagPossibleDuplicates) {
          for (const existing of existingForNearDup) {
            if (existing.fingerprint === fp) continue;
            if (isNearDuplicate(tx, existing)) { nearDupMatch = existing.id; possibleDupCount++; break; }
          }
        }
        dupStatuses.set(rowsToInsert.length, { status: nearDupMatch ? 'possible_duplicate' : 'unique', matchId: nearDupMatch });
        rowsToInsert.push(tx);
        existingFingerprints.add(fp);
      }

      if (rowsToInsert.length === 0) {
        updateItem(id, { status: 'done', result: { batchId: '', total: 0, auto: 0, suggested: 0, review: 0, skipped: exactDupCount, possibleDuplicates: possibleDupCount, transfers: 0, parseErrors: parseErrorRows.length } });
        toast.info(`${file.name}: all rows are duplicates`);
        return;
      }

      updateItem(id, { status: 'categorizing' });
      const results = await categorizeTransactions(rowsToInsert, mode, user.id);

      let transferCount = 0;
      updateItem(id, { status: 'inserting' });
      const autoCount = results.filter(r => r.review_status === 'auto_categorized').length;
      const suggestedCount = results.filter(r => r.review_status === 'suggested').length;
      const reviewCount = results.filter(r => r.review_status === 'needs_review').length;

      const { data: batch, error: batchError } = await supabase.from('upload_batches').insert({
        mode, file_name: file.name, total_rows: rowsToInsert.length,
        auto_categorized_count: autoCount, suggested_count: suggestedCount, needs_review_count: reviewCount,
        exact_duplicates_skipped: exactDupCount, possible_duplicates_flagged: possibleDupCount,
        transfers_detected: 0, parse_errors: parseErrorRows.length, owner_id: user.id,
      }).select().single();
      if (batchError) throw batchError;

      const chunkSize = 100;
      for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
        const chunk = rowsToInsert.slice(i, i + chunkSize).map((tx, idx) => {
          const globalIdx = i + idx;
          const result = results[globalIdx];
          const txMethod = method || result.predicted_method;
          const dupInfo = dupStatuses.get(globalIdx) || { status: 'unique', matchId: null };
          const fp = generateFingerprint(mode, tx.date, tx.amount, tx.description_normalized);
          const transfer = detectTransfer(tx.description_raw);
          if (transfer.isTransfer) transferCount++;

          return {
            upload_batch_id: batch.id, mode, date: tx.date,
            description_raw: tx.description_raw, description_normalized: tx.description_normalized,
            amount: tx.amount,
            predicted_category: transfer.isTransfer ? 'Transfer' : result.predicted_category,
            predicted_method: txMethod,
            predicted_notes: result.predicted_notes,
            final_category: result.review_status === 'auto_categorized' ? (transfer.isTransfer ? 'Transfer' : result.predicted_category) : null,
            final_method: result.review_status === 'auto_categorized' ? txMethod : null,
            final_notes: result.review_status === 'auto_categorized' ? result.predicted_notes : null,
            confidence: result.confidence, match_source: result.match_source,
            review_status: result.review_status, owner_id: user.id,
            source_row_json: tx.source_row_json, source_file_name: file.name,
            parse_status: tx.parse_status, parse_error: tx.parse_error,
            duplicate_fingerprint: fp, duplicate_status: dupInfo.status,
            duplicate_of_transaction_id: dupInfo.matchId,
            is_transfer: transfer.isTransfer,
            exclude_from_expense_totals: transfer.isTransfer && appSettings.excludeTransfers,
            transfer_type: transfer.transferType,
          };
        });
        const { error: txError } = await supabase.from('transactions_uploaded').insert(chunk);
        if (txError) throw txError;
      }

      if (transferCount > 0) {
        await supabase.from('upload_batches').update({ transfers_detected: transferCount }).eq('id', batch.id);
      }

      updateItem(id, {
        status: 'done',
        result: { batchId: batch.id, total: rowsToInsert.length, auto: autoCount, suggested: suggestedCount, review: reviewCount, skipped: exactDupCount, possibleDuplicates: possibleDupCount, transfers: transferCount, parseErrors: parseErrorRows.length },
      });
    } catch (err: any) {
      updateItem(id, { status: 'error', error: err.message || 'Processing failed' });
    }
  };

  const processQueue = useCallback(async (items: FileQueueItem[], mapping: ColumnMapping) => {
    if (processingRef.current) return;
    processingRef.current = true;
    for (const item of items) await processFile(item, mapping);
    await loadTransactions();
    processingRef.current = false;
  }, [user, mode]);

  const handleFilesSelect = async (files: File[]) => {
    try {
      const preview = await previewCsvFile(files[0]);
      setPreviewData(preview);
      setPreviewFile(files[0]);
      setPreviewMethod(detectMethodFromFilename(files[0].name));
      setPendingFiles(files);
      setShowPreview(true);
    } catch (err: any) { toast.error(err.message); }
  };

  const handlePreviewConfirm = () => {
    if (!previewData || pendingFiles.length === 0) return;
    setShowPreview(false);
    const mapping = previewData.mapping;
    const newItems: FileQueueItem[] = pendingFiles.map(file => ({
      id: crypto.randomUUID(), file, status: 'queued' as const, progress: 0,
      method: detectMethodFromFilename(file.name),
    }));
    setFileQueue(prev => [...newItems, ...prev]);
    processQueue(newItems, mapping);
    setPreviewData(null); setPreviewFile(null); setPendingFiles([]);
  };

  const handlePreviewCancel = () => {
    setShowPreview(false); setPreviewData(null); setPreviewFile(null); setPendingFiles([]);
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
      case 'approved': case 'edited': return 'status-approved';
      default: return 'match-tag';
    }
  };

  const SortHeader = ({ col, label, className = '' }: { col: string; label: string; className?: string }) => (
    <th
      className={`px-2 py-2 text-left text-[11px] font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap ${className}`}
      onClick={() => handleSort(col)}
    >
      {label}
      {sortCol === col && <span className="ml-0.5 text-primary">{sortAsc ? '↑' : '↓'}</span>}
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-4 animate-fade-in">
        {/* Top Control Bar */}
        <div className="glass-panel p-3 mb-3 flex flex-wrap items-center gap-2 sticky top-14 z-40">
          {/* Mode Toggle */}
          <div className="flex rounded-lg border border-border/40 overflow-hidden">
            <button
              onClick={() => setMode('personal')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'personal' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Personal
            </button>
            <button
              onClick={() => setMode('business')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'business' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Business
            </button>
          </div>

          {/* Upload */}
          <Sheet open={uploadOpen} onOpenChange={setUploadOpen}>
            <SheetTrigger asChild>
              <Button size="sm" className="h-8 gap-1.5 text-xs">
                <Upload className="h-3.5 w-3.5" /> Upload CSV
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md bg-background border-border">
              <SheetHeader>
                <SheetTitle className="text-foreground">Upload Expenses</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <CsvUploader onFilesSelect={handleFilesSelect} disabled={isProcessing} />
                {totalFiles > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{completedFiles} / {totalFiles} files</span>
                      <span>{overallProgress}%</span>
                    </div>
                    <Progress value={overallProgress} className="h-1.5" />
                  </div>
                )}
                <FileProgressList items={fileQueue} mode={mode} />
              </div>
            </SheetContent>
          </Sheet>

          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="glass-input pl-8 h-8 text-xs" />
          </div>

          {/* Filters */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-8 glass-input text-xs">
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
            <SelectTrigger className="w-[140px] h-8 glass-input text-xs">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Rows</SelectItem>
              <SelectItem value="uncategorized">Uncategorized</SelectItem>
              <SelectItem value="transfers">Transfers</SelectItem>
              <SelectItem value="possible_duplicates">Duplicates</SelectItem>
              <SelectItem value="parse_errors">Parse Errors</SelectItem>
              <SelectItem value="excluded">Excluded</SelectItem>
            </SelectContent>
          </Select>

          {/* Bulk Actions */}
          {selectedIds.size > 0 && (
            <>
              <Button size="sm" onClick={bulkApprove} className="h-8 gap-1 text-xs">
                <CheckCheck className="h-3 w-3" /> Approve {selectedIds.size}
              </Button>
              <Button size="sm" variant="outline" onClick={bulkMarkTransfer} className="h-8 gap-1 text-xs">
                <ArrowLeftRight className="h-3 w-3" /> Transfer
              </Button>
              <Button size="sm" variant="destructive" onClick={bulkDelete} className="h-8 gap-1 text-xs">
                <Trash2 className="h-3 w-3" /> Delete {selectedIds.size}
              </Button>
            </>
          )}

          <Button variant="outline" size="sm" onClick={exportCsv} className="h-8 gap-1 text-xs ml-auto">
            <Download className="h-3 w-3" /> Export
          </Button>

          <span className="text-[11px] text-muted-foreground font-mono">{filtered.length} rows</span>
        </div>

        {/* Summary Chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="glass-panel-sm px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">Total</span>{' '}
            <span className="font-mono font-medium text-foreground">{stats.total}</span>
          </div>
          {stats.uncategorized > 0 && (
            <div className="glass-panel-sm px-3 py-1.5 text-xs cursor-pointer" onClick={() => setExtraFilter('uncategorized')}>
              <span className="text-muted-foreground">Uncategorized</span>{' '}
              <span className="font-mono font-medium text-warning">{stats.uncategorized}</span>
            </div>
          )}
          {stats.needsReview > 0 && (
            <div className="glass-panel-sm px-3 py-1.5 text-xs cursor-pointer" onClick={() => setStatusFilter('needs_review')}>
              <span className="text-muted-foreground">Needs Review</span>{' '}
              <span className="font-mono font-medium text-destructive">{stats.needsReview}</span>
            </div>
          )}
          {stats.duplicates > 0 && (
            <div className="glass-panel-sm px-3 py-1.5 text-xs cursor-pointer" onClick={() => setExtraFilter('possible_duplicates')}>
              <span className="text-muted-foreground">Duplicates</span>{' '}
              <span className="font-mono font-medium text-warning">{stats.duplicates}</span>
            </div>
          )}
          {stats.transfersExcluded > 0 && (
            <div className="glass-panel-sm px-3 py-1.5 text-xs cursor-pointer" onClick={() => setExtraFilter('transfers')}>
              <span className="text-muted-foreground">Transfers</span>{' '}
              <span className="font-mono font-medium text-muted-foreground">{stats.transfersExcluded}</span>
            </div>
          )}
          <div className="glass-panel-sm px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">This Month</span>{' '}
            <span className="font-mono font-medium text-primary">${stats.thisMonthSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Airtable-style Table */}
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card/90 backdrop-blur-sm">
                <tr className="border-b border-border/40">
                  <th className="px-2 py-2 text-left w-8 sticky left-0 bg-card/90 z-20">
                    <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={selectAll} className="rounded border-border" />
                  </th>
                  <SortHeader col="date" label="Date" />
                  <SortHeader col="description" label="Description" />
                  <SortHeader col="amount" label="Amount" className="text-right" />
                  <SortHeader col="category" label="Category" />
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Method</th>
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Notes</th>
                  <SortHeader col="confidence" label="Conf" />
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Status</th>
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Flags</th>
                  <th className="px-2 py-2 text-right text-[11px] font-medium text-muted-foreground w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11} className="px-2 py-12 text-center text-muted-foreground">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2" />
                    Loading...
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={11} className="px-2 py-12 text-center text-muted-foreground">No transactions found</td></tr>
                ) : (
                  filtered.map(tx => (
                    <tr key={tx.id} className={`border-b border-border/10 hover:bg-secondary/20 transition-colors ${tx.exclude_from_expense_totals ? 'opacity-50' : ''}`} style={{ height: '32px' }}>
                      <td className="px-2 py-1 sticky left-0 bg-card/60">
                        <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelect(tx.id)} className="rounded border-border" />
                      </td>
                      <td className="px-2 py-1 font-mono text-muted-foreground whitespace-nowrap">{tx.date || '—'}</td>
                      <td className="px-2 py-1 max-w-[220px]">
                        <p className="text-foreground truncate" title={tx.description_raw || ''}>{tx.description_raw || '—'}</p>
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-foreground whitespace-nowrap">
                        ${tx.amount != null ? Math.abs(tx.amount).toFixed(2) : '0.00'}
                      </td>
                      <td className="px-2 py-1">
                        {editingId === tx.id ? (
                          <Input value={editValues.category} onChange={e => setEditValues(v => ({ ...v, category: e.target.value }))} className="glass-input h-6 text-xs w-28 px-1" list="cat-opts" />
                        ) : (
                          <span className="text-foreground">{tx.final_category || tx.predicted_category || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {editingId === tx.id ? (
                          <Input value={editValues.method} onChange={e => setEditValues(v => ({ ...v, method: e.target.value }))} className="glass-input h-6 text-xs w-24 px-1" />
                        ) : (
                          <span className="text-muted-foreground">{tx.final_method || tx.predicted_method || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {editingId === tx.id ? (
                          <Input
                            value={editValues.notes}
                            onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))}
                            className="glass-input h-6 text-xs w-28 px-1"
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(tx); if (e.key === 'Escape') setEditingId(null); }}
                          />
                        ) : (
                          <span className="text-muted-foreground truncate max-w-[100px] block">{tx.final_notes || tx.predicted_notes || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <span className={getConfidenceClass(tx.confidence)}>
                          {tx.confidence != null ? `${Math.round(tx.confidence)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <span className={getStatusClass(tx.review_status)}>
                          {tx.review_status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-0.5 flex-wrap">
                          {tx.is_transfer && (
                            <Badge variant="outline" className="text-[9px] h-3.5 gap-0.5 border-primary/30 text-primary px-1">
                              <ArrowLeftRight className="h-2 w-2" /> xfer
                            </Badge>
                          )}
                          {tx.duplicate_status === 'possible_duplicate' && (
                            <Badge variant="outline" className="text-[9px] h-3.5 gap-0.5 border-warning/30 text-warning px-1">
                              <AlertTriangle className="h-2 w-2" /> dup
                            </Badge>
                          )}
                          {tx.parse_status === 'parse_error' && (
                            <Badge variant="destructive" className="text-[9px] h-3.5 px-1">err</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        {editingId === tx.id ? (
                          <div className="flex items-center gap-0.5 justify-end">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => saveEdit(tx)}>
                              <Check className="h-3 w-3 text-success" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => setEditingId(null)}>
                              <X className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-0.5 justify-end">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => startEdit(tx)} title="Edit">
                              <Edit3 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => toggleTransfer(tx)} title={tx.is_transfer ? 'Restore' : 'Transfer'}>
                              <ArrowLeftRight className={`h-3 w-3 ${tx.is_transfer ? 'text-primary' : 'text-muted-foreground'}`} />
                            </Button>
                            {!['approved', 'edited'].includes(tx.review_status) && (
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => approveRow(tx)} title="Approve">
                                <Check className="h-3 w-3 text-success" />
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

        <datalist id="cat-opts">
          {categories.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>

      <ImportPreviewDialog
        open={showPreview}
        onConfirm={handlePreviewConfirm}
        onCancel={handlePreviewCancel}
        preview={previewData}
        fileName={previewFile?.name || ''}
        detectedMethod={previewMethod}
      />
    </div>
  );
}
