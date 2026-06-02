import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { CsvUploader } from '@/components/CsvUploader';
import { FileProgressList, type FileQueueItem } from '@/components/FileProgressList';
import { ImportPreviewDialog, type FilePreviewInfo } from '@/components/ImportPreviewDialog';
import { TransactionDetailDrawer } from '@/components/TransactionDetailDrawer';
import { SplitTransactionDialog } from '@/components/SplitTransactionDialog';
import { AddCategoryDialog } from '@/components/AddCategoryDialog';
import { DuplicateResolverDialog, type DupClusterRow } from '@/components/DuplicateResolverDialog';
import { previewCsvFile, parseCsvFileWithMapping, type ParsePreview, type ColumnMapping } from '@/lib/csv-parser';
import { categorizeTransactions, categorizeWithAI, updateMerchantMemory, isDeductibleCategory } from '@/lib/categorization-engine';
import { detectMethodFromFilename } from '@/lib/method-detector';
import { usePaymentMethods, type PaymentMethod } from '@/hooks/usePaymentMethods';
import { MethodSelect } from '@/components/MethodSelect';
import { detectTransfer } from '@/lib/transfer-detector';
import { routeTransaction } from '@/lib/transaction-router';
import { classifyIncome } from '@/lib/income-classifier';
import { generateFingerprint, isNearDuplicate, findExactClusters, findNearClusters, type DuplicateCluster } from '@/lib/duplicate-detector';
import { generateMerchantKey, normalizeDescription } from '@/lib/normalizer';
import { backfillRecurringForOwner } from '@/lib/recurrence-detector';
import { isStatementArtifact } from '@/lib/csv-parser';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Upload, Search, Download, Check, CheckCheck, Edit3, X,
  ArrowLeftRight, AlertTriangle, Ban, FileText, Filter,
  Calendar, ChevronDown, Trash2, Briefcase, User, Receipt, Scissors, RefreshCw, Copy
} from 'lucide-react';

type TransactionMode = 'personal' | 'business' | 'reimbursable_work';

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
  exclude_from_cash_spend_reporting: boolean;
  parse_status: string | null;
  duplicate_status: string | null;
  is_transfer: boolean | null;
  exclude_from_expense_totals: boolean | null;
  transfer_type: string | null;
  source_file_name: string | null;
  source_account_name: string | null;
  upload_batch_id: string | null;
  is_split_parent: boolean;
  parent_transaction_id: string | null;
}

const MODE_CONFIG: Record<TransactionMode, { label: string; color: string; activeClass: string; icon: React.ElementType }> = {
  personal: { label: 'Personal', color: 'text-foreground', activeClass: 'bg-secondary text-foreground border-border', icon: User },
  business: { label: 'Business', color: 'text-primary', activeClass: 'bg-primary/20 text-primary border-primary/30', icon: Briefcase },
  reimbursable_work: { label: 'Reimbursable/Work', color: 'text-warning', activeClass: 'bg-warning/15 text-warning border-warning/30', icon: Receipt },
};

export default function Expenses() {
  const { user, isInvestor, isAccountant, ownerId } = useAuth();
  const { methods: paymentMethods } = usePaymentMethods();
  const [mode, setMode] = useState<TransactionMode>(isInvestor ? 'business' : 'personal');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [extraFilter, setExtraFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [scanningRecurring, setScanningRecurring] = useState(false);
  const [sweepingDuplicates, setSweepingDuplicates] = useState(false);
  const [resolverOpen, setResolverOpen] = useState(false);
  const [exactClusters, setExactClusters] = useState<DuplicateCluster[]>([]);
  const [nearClusters, setNearClusters] = useState<DuplicateCluster[]>([]);
  const [crossModePairs, setCrossModePairs] = useState<{ rowIds: string[] }[]>([]);
  const [clusterRowIndex, setClusterRowIndex] = useState<Map<string, DupClusterRow>>(new Map());
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [dateLabel, setDateLabel] = useState<string>('All Dates');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sortCol, setSortCol] = useState<string>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [splitTx, setSplitTx] = useState<Transaction | null>(null);
  // "+ Add new category" inline dialog — tracks which surface triggered it
  // so we can auto-apply the new category back to that surface.
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addCategoryTarget, setAddCategoryTarget] = useState<
    | { kind: 'inline'; txId: string }
    | { kind: 'drawer' }
    | { kind: 'split'; rowId: string }
    | null
  >(null);
  const [pendingDrawerCategory, setPendingDrawerCategory] = useState<string | null>(null);
  const [pendingSplitCategory, setPendingSplitCategory] = useState<{ rowId: string; name: string } | null>(null);

  // Upload state
  const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
  const processingRef = useRef(false);
  const [filePreviews, setFilePreviews] = useState<FilePreviewInfo[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // NOTE: cross-mode totals are now derived from the loaded `transactions`
  // set + the active date range via `useMemo` below. The previous
  // `loadCrossModeTotals` paginated re-fetch was wasteful (data is already
  // loaded by `loadTransactions`) and — more importantly — couldn't react to
  // the date filter, so the summary cards were stale.

  const isProcessing = fileQueue.some(f => !['done', 'error'].includes(f.status));
  const totalFiles = fileQueue.length;
  const completedFiles = fileQueue.filter(f => f.status === 'done' || f.status === 'error').length;
  const overallProgress = totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;

  // For category loading, use the base mode (personal/business) — reimbursable uses personal categories
  const categoryMode = mode === 'reimbursable_work' ? 'personal' : mode;

  useEffect(() => {
    if (user && ownerId) { loadTransactions(); loadCategories(); loadAllModeTransactions(); }
  }, [user, ownerId, mode]);

  // Apply incoming URL params (e.g. linked from Allocations review warning).
  // Supported: ?month=YYYY-MM, &scope=personal|business|reimbursable_work, &review=unreviewed|<status>
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const month = searchParams.get('month');
    const scope = searchParams.get('scope') as TransactionMode | null;
    const review = searchParams.get('review');
    const method = searchParams.get('method');
    let consumed = false;
    if (scope && ['personal', 'business', 'reimbursable_work'].includes(scope)) {
      setMode(scope);
      consumed = true;
    }
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const first = new Date(y, m - 1, 1);
      const last = new Date(y, m, 0);
      const fmtYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      setDateFrom(fmtYMD(first));
      setDateTo(fmtYMD(last));
      setDateLabel(first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
      consumed = true;
    }
    if (review) {
      setStatusFilter(review);
      consumed = true;
    }
    if (method) {
      setMethodFilter(method);
      consumed = true;
    }
    if (consumed) {
      // Clear params so refresh doesn't re-trigger.
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // All-mode transaction snapshot — needed because `loadTransactions` is
  // already scoped to the active mode tab, but the summary strip compares
  // Personal vs Business side-by-side. We keep this slim (only the math
  // fields) and re-fetch only on user/mode change.
  type AllModeRow = {
    amount: number | null; transaction_mode: string | null; mode: string | null;
    is_split_parent: boolean | null; is_transfer: boolean | null;
    exclude_from_expense_totals: boolean | null; is_non_expense_cash_movement: boolean | null;
    parse_status: string | null; counts_toward_true_personal_spend: boolean | null;
    counts_toward_true_business_spend: boolean | null; is_reimbursable: boolean | null;
    reimbursement_status: string | null; date: string | null;
  };
  const [allModeRows, setAllModeRows] = useState<AllModeRow[]>([]);

  const loadAllModeTransactions = async () => {
    if (!user || !ownerId) return;
    let from = 0;
    const pageSize = 1000;
    let all: AllModeRow[] = [];
    let hasMore = true;
    while (hasMore) {
      let q = supabase
        .from('transactions_uploaded')
        .select('amount, transaction_mode, mode, is_split_parent, is_transfer, exclude_from_expense_totals, is_non_expense_cash_movement, parse_status, counts_toward_true_personal_spend, counts_toward_true_business_spend, is_reimbursable, reimbursement_status, date')
        .eq('owner_id', ownerId!);
      if (isInvestor) q = q.eq('mode', 'business');
      const { data } = await q.range(from, from + pageSize - 1);
      if (data) all = [...all, ...(data as unknown as AllModeRow[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    setAllModeRows(all);
  };

  const loadCategories = async () => {
    if (!ownerId) return;
    const { data } = await supabase
      .from('category_options')
      .select('category_name')
      .eq('mode', categoryMode)
      .eq('is_active', true)
      .eq('owner_id', ownerId!)
      .order('sort_order');
    setCategories((data || []).map(c => c.category_name));
  };

  const loadTransactions = async () => {
    if (!ownerId) return;
    setLoading(true);
    let from = 0;
    const pageSize = 1000;
    let allData: Transaction[] = [];
    let hasMore = true;
    while (hasMore) {
      const { data } = await supabase
        .from('transactions_uploaded')
        .select('*')
        .eq('owner_id', ownerId!)
        .eq('transaction_mode', mode)
        .order('date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (data) allData = [...allData, ...(data as unknown as Transaction[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    setTransactions(allData);
    setLoading(false);
  };

  /**
   * "Find duplicates" sweep across already-imported rows.
   * Loads all rows for the active mode (paged), groups by fingerprint,
   * then runs near-dup pairwise within amount buckets. Marks DB rows so
   * the existing "Possible duplicates" filter and badge work, then opens
   * the resolver dialog. Also surfaces cross-mode same-charge pairs as
   * read-only suggestions.
   */
  const runDuplicateSweep = async () => {
    if (!user) return;
    setSweepingDuplicates(true);
    const tId = toast.loading('Scanning for duplicate transactions…');
    try {
      // Pull a slim row set across ALL modes (cross-mode tab needs it).
      const rows: { id: string; date: string | null; description_normalized: string | null; description_raw: string | null; amount: number | null; duplicate_fingerprint: string | null; mode: string; created_at: string | null; final_category: string | null; predicted_category: string | null; final_method: string | null; predicted_method: string | null; source_file_name: string | null; source_account_name: string | null; duplicate_status: string | null; is_transfer: boolean | null; is_split_parent: boolean | null; parent_transaction_id: string | null; review_status: string }[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data } = await supabase
          .from('transactions_uploaded')
          .select('id, date, description_normalized, description_raw, amount, duplicate_fingerprint, mode, created_at, final_category, predicted_category, final_method, predicted_method, source_file_name, source_account_name, duplicate_status, is_transfer, is_split_parent, parent_transaction_id, review_status')
          .eq('owner_id', ownerId!)
          .range(from, from + pageSize - 1);
        if (data) rows.push(...(data as any));
        hasMore = (data?.length ?? 0) === pageSize;
        from += pageSize;
      }

      // Filter out rows that aren't real expenses for clustering purposes.
      const activeRows = rows.filter(r =>
        r.amount != null &&
        !r.is_split_parent &&
        !r.parent_transaction_id &&
        r.review_status !== 'archived'
      );

      // Same-mode clustering uses normalized fingerprint already in DB (or recomputed).
      const sameModeRows = activeRows.filter(r => r.mode === categoryMode).map(r => ({
        id: r.id,
        date: r.date,
        description_normalized: r.description_normalized || '',
        amount: Number(r.amount),
        fingerprint: r.duplicate_fingerprint || generateFingerprint(r.mode, r.date, Number(r.amount), r.description_normalized || ''),
        created_at: r.created_at,
      }));

      const exact = findExactClusters(sameModeRows);
      const exactIds = new Set<string>();
      for (const c of exact) for (const id of c.rowIds) exactIds.add(id);
      const near = findNearClusters(sameModeRows, exactIds, 7);

      // Cross-mode pairs: same date + amount + matching merchant key, different mode.
      const crossPairs: { rowIds: string[] }[] = [];
      const byKey = new Map<string, typeof activeRows>();
      for (const r of activeRows) {
        const mk = generateMerchantKey(r.description_normalized || '');
        if (!mk || !r.date) continue;
        const k = `${r.date}|${Math.round(Number(r.amount) * 100)}|${mk}`;
        const list = byKey.get(k) || [];
        list.push(r);
        byKey.set(k, list);
      }
      for (const list of byKey.values()) {
        if (list.length < 2) continue;
        const modes = new Set(list.map(r => r.mode));
        if (modes.size < 2) continue;
        crossPairs.push({ rowIds: list.map(r => r.id) });
      }

      // Mark same-mode dups in DB (idempotent).
      if (exact.length > 0) {
        for (const c of exact) {
          const [keeper, ...losers] = c.rowIds;
          if (losers.length > 0) {
            await supabase.from('transactions_uploaded')
              .update({ duplicate_status: 'possible_duplicate', duplicate_of_transaction_id: keeper })
              .in('id', losers);
          }
        }
      }
      if (near.length > 0) {
        for (const c of near) {
          const [keeper, ...losers] = c.rowIds;
          if (losers.length > 0) {
            await supabase.from('transactions_uploaded')
              .update({ duplicate_status: 'possible_duplicate', duplicate_of_transaction_id: keeper })
              .in('id', losers);
          }
        }
      }

      // Build row index for the dialog
      const idx = new Map<string, DupClusterRow>();
      for (const r of activeRows) {
        idx.set(r.id, {
          id: r.id, date: r.date, description_raw: r.description_raw,
          description_normalized: r.description_normalized, amount: r.amount,
          final_category: r.final_category, predicted_category: r.predicted_category,
          final_method: r.final_method, predicted_method: r.predicted_method,
          source_file_name: r.source_file_name, source_account_name: r.source_account_name,
          mode: r.mode, duplicate_status: r.duplicate_status,
        });
      }

      setExactClusters(exact);
      setNearClusters(near);
      setCrossModePairs(crossPairs);
      setClusterRowIndex(idx);
      toast.dismiss(tId);
      const total = exact.length + near.length;
      if (total === 0 && crossPairs.length === 0) {
        toast.success('No duplicates found 🎉');
      } else {
        toast.success(`Found ${exact.length} exact + ${near.length} possible${crossPairs.length ? ` + ${crossPairs.length} cross-mode` : ''} cluster${total + crossPairs.length === 1 ? '' : 's'}`);
        setResolverOpen(true);
      }
      await loadTransactions();
    } catch (err: any) {
      toast.dismiss(tId);
      toast.error(`Sweep failed: ${err?.message || 'unknown error'}`);
      console.error(err);
    } finally {
      setSweepingDuplicates(false);
    }
  };

  const filtered = useMemo(() => {
    let result = transactions.filter(tx => {
      if (statusFilter === 'unreviewed') {
        if (!['needs_review', 'suggested', 'ai_suggested'].includes(tx.review_status)) return false;
      } else if (statusFilter !== 'all' && tx.review_status !== statusFilter) return false;
      if (extraFilter === 'transfers' && !tx.is_transfer && tx.transfer_type !== 'possible_transfer') return false;
      if (extraFilter === 'possible_transfers' && tx.transfer_type !== 'possible_transfer') return false;
      if (extraFilter === 'possible_duplicates' && tx.duplicate_status !== 'possible_duplicate') return false;
      if (extraFilter === 'parse_errors' && tx.parse_status !== 'parse_error') return false;
      if (extraFilter === 'excluded' && !tx.exclude_from_expense_totals) return false;
      if (extraFilter === 'uncategorized' && (tx.final_category || tx.predicted_category)) return false;
      if (extraFilter === 'reimbursable' && !tx.is_reimbursable) return false;
      if (extraFilter === 'splits' && !tx.is_split_parent && !tx.parent_transaction_id) return false;
      if (categoryFilter !== 'all') {
        const effective = tx.final_category || tx.predicted_category || '';
        if (categoryFilter === '__uncategorized__') {
          if (effective) return false;
        } else if (effective !== categoryFilter) {
          return false;
        }
      }
      if (methodFilter !== 'all') {
        const effMethod = (tx.final_method || tx.predicted_method || tx.source_account_name || '').trim();
        if (methodFilter === '__nomethod__') {
          if (effMethod) return false;
        } else if (effMethod.toLowerCase() !== methodFilter.toLowerCase()) {
          return false;
        }
      }
      if (dateFrom && (!tx.date || tx.date < dateFrom)) return false;
      if (dateTo && (!tx.date || tx.date > dateTo)) return false;
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
        case 'method':
          aVal = (a.final_method || a.predicted_method || a.source_account_name || '').toLowerCase();
          bVal = (b.final_method || b.predicted_method || b.source_account_name || '').toLowerCase();
          break;
        case 'confidence': aVal = a.confidence || 0; bVal = b.confidence || 0; break;
        default: aVal = a.date || ''; bVal = b.date || '';
      }
      if (aVal < bVal) return sortAsc ? -1 : 1;
      if (aVal > bVal) return sortAsc ? 1 : -1;
      return 0;
    });

    return result;
  }, [transactions, statusFilter, extraFilter, categoryFilter, methodFilter, dateFrom, dateTo, search, sortCol, sortAsc]);

  // Available payment methods derived from loaded transactions for the Method filter.
  // Falls back to source_account_name (set on upload from filename) so accounts that
  // never had a method explicitly tagged still show up as a slice option.
  const availableMethods = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => {
      const m = (t.final_method || t.predicted_method || t.source_account_name || '').trim();
      if (m) set.add(m);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  // Available months derived from transactions for the date filter
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
    const now = new Date();
    applyMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setDateLabel('This Month');
  };
  const applyLastMonth = () => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
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
    const now = new Date();
    setDateFrom(`${now.getFullYear()}-01-01`);
    setDateTo(fmtYMD(now));
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

  // Date predicate shared by both summary memos so the cards mirror the table.
  const inDateRange = (d: string | null | undefined) => {
    if (!d) return !dateFrom && !dateTo; // a row with no date only counts when no range is active
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  // Cross-mode summary strip — Personal vs Business at a glance, scoped to the
  // active date range so the cards actually move when you pick "March 2026"
  // or "Year to Date".
  const crossModeTotals = useMemo(() => {
    const active = allModeRows.filter(r =>
      !r.is_split_parent && r.parse_status !== 'parse_error' && inDateRange(r.date)
    );
    const isOutflow = (r: AllModeRow) => !r.is_non_expense_cash_movement && !r.is_transfer && !r.exclude_from_expense_totals;
    const sum = (rows: AllModeRow[]) => rows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);
    return {
      personalCashOut: sum(active.filter(r => (r.transaction_mode || r.mode) === 'personal' && isOutflow(r))),
      businessCashOut: sum(active.filter(r => (r.transaction_mode || r.mode) === 'business' && isOutflow(r))),
      truePersonal: sum(active.filter(r => r.counts_toward_true_personal_spend)),
      trueBusiness: sum(active.filter(r => r.counts_toward_true_business_spend)),
      pendingReimbursable: sum(active.filter(r => r.is_reimbursable && r.reimbursement_status !== 'reimbursed')),
    };
  }, [allModeRows, dateFrom, dateTo]);

  // Summary stats — V3 (date-filter aware + richer metrics)
  const stats = useMemo(() => {
    // Mode-scoped, exclude split parents, exclude parse errors, scope to date range.
    const activeTxns = transactions.filter(t =>
      !t.is_split_parent && t.parse_status !== 'parse_error' && inDateRange(t.date)
    );
    const needsReview = activeTxns.filter(t => t.review_status === 'needs_review' || t.review_status === 'suggested' || t.review_status === 'ai_suggested').length;
    const uncategorized = activeTxns.filter(t => !t.final_category && !t.predicted_category).length;
    const transfersExcluded = transactions.filter(t => t.exclude_from_expense_totals && inDateRange(t.date)).length;

    const cashOutTxns = activeTxns.filter(t =>
      !t.is_non_expense_cash_movement && !t.is_transfer && !t.exclude_from_expense_totals
    );

    const totalCashOut = cashOutTxns.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const truePersonalSpend = activeTxns
      .filter(t => t.counts_toward_true_personal_spend)
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const trueBusinessSpend = activeTxns
      .filter(t => t.counts_toward_true_business_spend)
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const pendingReimbursable = activeTxns
      .filter(t => t.is_reimbursable && t.reimbursement_status !== 'reimbursed')
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    // Largest single expense in the period (excluding transfers/parse errors)
    let largest: { amount: number; description: string; date: string | null } | null = null;
    for (const t of cashOutTxns) {
      const amt = Math.abs(t.amount || 0);
      if (!largest || amt > largest.amount) {
        largest = { amount: amt, description: (t.description_raw || t.description_normalized || 'Unknown').slice(0, 60), date: t.date };
      }
    }

    // Unique merchants in period
    const merchants = new Set<string>();
    cashOutTxns.forEach(t => {
      const key = (t.description_normalized || t.description_raw || '').trim().toUpperCase();
      if (key) merchants.add(key.slice(0, 40));
    });

    // Avg per day across the active range (or full data span when no range set)
    const dates = cashOutTxns.map(t => t.date).filter(Boolean) as string[];
    let spanDays = 1;
    if (dateFrom && dateTo) {
      const from = new Date(dateFrom).getTime();
      const to = new Date(dateTo).getTime();
      spanDays = Math.max(1, Math.round((to - from) / 86400000) + 1);
    } else if (dates.length > 0) {
      const sorted = [...dates].sort();
      const from = new Date(sorted[0]).getTime();
      const to = new Date(sorted[sorted.length - 1]).getTime();
      spanDays = Math.max(1, Math.round((to - from) / 86400000) + 1);
    }
    const avgPerDay = totalCashOut / spanDays;

    return {
      total: transactions.filter(t => inDateRange(t.date)).length,
      needsReview,
      uncategorized,
      transfersExcluded,
      totalCashOut,
      truePersonalSpend,
      trueBusinessSpend,
      pendingReimbursable,
      largest,
      uniqueMerchants: merchants.size,
      avgPerDay,
      spanDays,
    };
  }, [transactions, dateFrom, dateTo]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

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

  // Drawer save
  const handleDrawerSave = async (id: string, values: {
    category: string; method: string; notes: string;
    transaction_mode?: string; economic_owner?: string; treatment_type?: string;
    tax_treatment?: string; is_reimbursable?: boolean; reimbursable_to?: string;
    reimbursement_status?: string; business_purpose?: string;
    counts_toward_true_personal_spend?: boolean; counts_toward_true_business_spend?: boolean;
    counts_as_tax_deduction?: boolean;
    client_or_project_tag?: string;
    _keepNeedsReview?: boolean;
  }) => {
    if (values.category && categories.length > 0) {
      const isAllowed = categories.some(c => c.toLowerCase() === values.category.toLowerCase());
      if (!isAllowed) {
        toast.error(`"${values.category}" is not in your approved category list for ${categoryMode} mode`);
        return;
      }
      const canonical = categories.find(c => c.toLowerCase() === values.category.toLowerCase());
      if (canonical) values.category = canonical;
    }

    const updatePayload: Record<string, any> = {
      final_category: values.category,
      final_method: values.method,
      final_notes: values.notes,
      review_status: (!values.category && values._keepNeedsReview) ? 'needs_review' : 'edited',
    };

    // Auto-recompute tax-deduction flag from (mode, category) unless the user
    // explicitly toggled it in the drawer (values.counts_as_tax_deduction set).
    if (values.counts_as_tax_deduction !== undefined) {
      updatePayload.counts_as_tax_deduction = values.counts_as_tax_deduction;
    } else if (values.category !== undefined) {
      const mode = values.transaction_mode || transactions.find(t => t.id === id)?.transaction_mode;
      updatePayload.counts_as_tax_deduction = isDeductibleCategory(mode as any, values.category);
    }

    if (values.transaction_mode !== undefined) updatePayload.transaction_mode = values.transaction_mode;
    if (values.economic_owner !== undefined) updatePayload.economic_owner = values.economic_owner;
    if (values.treatment_type !== undefined) updatePayload.treatment_type = values.treatment_type;
    if (values.tax_treatment !== undefined) updatePayload.tax_treatment = values.tax_treatment;
    if (values.is_reimbursable !== undefined) updatePayload.is_reimbursable = values.is_reimbursable;
    if (values.reimbursable_to !== undefined) updatePayload.reimbursable_to = values.reimbursable_to;
    if (values.reimbursement_status !== undefined) updatePayload.reimbursement_status = values.reimbursement_status;
    if (values.business_purpose !== undefined) updatePayload.business_purpose = values.business_purpose;
    if (values.counts_toward_true_personal_spend !== undefined) updatePayload.counts_toward_true_personal_spend = values.counts_toward_true_personal_spend;
    if (values.counts_toward_true_business_spend !== undefined) updatePayload.counts_toward_true_business_spend = values.counts_toward_true_business_spend;
    if (values.client_or_project_tag !== undefined) updatePayload.client_or_project_tag = values.client_or_project_tag;

    const { error } = await supabase
      .from('transactions_uploaded')
      .update(updatePayload as never)
      .eq('id', id);

    if (!error) {
      const tx = transactions.find(t => t.id === id);
      if (tx && tx.parse_status === 'ok' && !tx.is_transfer && !tx.is_split_parent && !tx.parent_transaction_id && tx.duplicate_status !== 'possible_duplicate') {
        const desc = tx.description_raw || '';
        if (!isStatementArtifact(desc, tx.amount || 0)) {
          const merchantKey = generateMerchantKey(normalizeDescription(desc));
          await updateMerchantMemory(merchantKey, categoryMode as 'personal' | 'business', values.category, values.method || null, values.notes || null, desc, user!.id, tx.match_source);
        }
      }
      await loadTransactions();
      toast.success('Saved');
      setDetailTx(null);
    }
  };

  const approveRow = async (tx: Transaction) => {
    const category = tx.final_category || tx.predicted_category;
    if (!category) { toast.error('Set a category first'); return; }
    const { error } = await supabase
      .from('transactions_uploaded')
      .update({
        final_category: category,
        final_method: tx.final_method || tx.predicted_method,
        final_notes: tx.final_notes || tx.predicted_notes,
        review_status: 'approved',
        counts_as_tax_deduction: isDeductibleCategory(tx.transaction_mode as any, category),
      })
      .eq('id', tx.id);
    if (!error) {
      if (tx.parse_status === 'ok' && !tx.is_transfer && !tx.is_split_parent && !tx.parent_transaction_id && tx.duplicate_status !== 'possible_duplicate') {
        const desc = tx.description_raw || '';
        if (!isStatementArtifact(desc, tx.amount || 0)) {
          const merchantKey = generateMerchantKey(normalizeDescription(desc));
          await updateMerchantMemory(merchantKey, categoryMode as 'personal' | 'business', category, tx.final_method || tx.predicted_method || null, tx.final_notes || tx.predicted_notes || null, desc, user!.id, tx.match_source);
        }
      }
      await loadTransactions();
      setDetailTx(null);
    }
  };

  /**
   * Bulk-approve helper. One round-trip per row in parallel, ONE reload at the end.
   * Silently skips rows that have no category or are split parents (no per-row toast spam).
   * Returns counts so the caller can show a single summary toast.
   */
  const bulkApproveRows = async (txs: Transaction[]): Promise<{ approved: number; skipped: number }> => {
    const eligible = txs.filter(t => !t.is_split_parent && (t.final_category || t.predicted_category));
    const skipped = txs.length - eligible.length;
    if (eligible.length === 0) return { approved: 0, skipped };

    // Issue all updates in parallel.
    const updates = eligible.map(tx => {
      const category = (tx.final_category || tx.predicted_category)!;
      return supabase
        .from('transactions_uploaded')
        .update({
          final_category: category,
          final_method: tx.final_method || tx.predicted_method,
          final_notes: tx.final_notes || tx.predicted_notes,
          review_status: 'approved',
          counts_as_tax_deduction: isDeductibleCategory(tx.transaction_mode as any, category),
        })
        .eq('id', tx.id);
    });
    const results = await Promise.all(updates);
    const approved = results.filter(r => !r.error).length;

    // Update merchant memory in parallel for eligible, non-artifact rows.
    const memoryTasks = eligible
      .filter(tx => tx.parse_status === 'ok' && !tx.is_transfer && !tx.is_split_parent && !tx.parent_transaction_id && tx.duplicate_status !== 'possible_duplicate')
      .map(tx => {
        const category = (tx.final_category || tx.predicted_category)!;
        const desc = tx.description_raw || '';
        if (isStatementArtifact(desc, tx.amount || 0)) return null;
        const merchantKey = generateMerchantKey(normalizeDescription(desc));
        return updateMerchantMemory(
          merchantKey,
          categoryMode as 'personal' | 'business',
          category,
          tx.final_method || tx.predicted_method || null,
          tx.final_notes || tx.predicted_notes || null,
          desc,
          user!.id,
          tx.match_source,
        );
      })
      .filter(Boolean) as Promise<unknown>[];
    if (memoryTasks.length > 0) await Promise.all(memoryTasks);

    await loadTransactions();
    return { approved, skipped };
  };

  // Inline cell edit — update a single field directly from the table.
  // Mirrors handleDrawerSave guardrails (category whitelist, status transition, merchant memory).
  const inlineUpdate = async (tx: Transaction, field: 'final_category' | 'final_method' | 'economic_owner', value: string) => {
    if (tx.is_split_parent) {
      toast.error('Split parent — edit child rows instead.');
      return;
    }

    let nextValue: string | null = value;

    if (field === 'final_category') {
      if (!value) {
        nextValue = null;
      } else if (categories.length > 0) {
        const canonical = categories.find(c => c.toLowerCase() === value.toLowerCase());
        if (!canonical) {
          toast.error(`"${value}" is not in your approved category list for ${categoryMode} mode`);
          return;
        }
        nextValue = canonical;
      }
    }

    const updatePayload: Record<string, any> = { [field]: nextValue };

    // Any meaningful inline edit promotes the row to 'edited' (unless we're clearing the category).
    if (field === 'final_category') {
      updatePayload.review_status = nextValue ? 'edited' : 'needs_review';
      // Auto-recompute tax-deduction flag when the category changes inline.
      updatePayload.counts_as_tax_deduction = isDeductibleCategory(
        tx.transaction_mode as any,
        nextValue,
      );
    } else if (!['approved'].includes(tx.review_status)) {
      updatePayload.review_status = 'edited';
    } else {
      updatePayload.review_status = 'edited';
    }

    // Optimistic update
    setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, ...updatePayload } as Transaction : t));

    const { error } = await supabase
      .from('transactions_uploaded')
      .update(updatePayload as never)
      .eq('id', tx.id);

    if (error) {
      toast.error('Failed to save');
      await loadTransactions();
      return;
    }

    // Update merchant memory the same way the drawer does (skip transfers, splits, duplicates, artifacts).
    if (
      field !== 'economic_owner' &&
      tx.parse_status === 'ok' &&
      !tx.is_transfer &&
      !tx.is_split_parent &&
      !tx.parent_transaction_id &&
      tx.duplicate_status !== 'possible_duplicate'
    ) {
      const desc = tx.description_raw || '';
      if (!isStatementArtifact(desc, tx.amount || 0)) {
        const merchantKey = generateMerchantKey(normalizeDescription(desc));
        const finalCategory = field === 'final_category' ? (nextValue || '') : (tx.final_category || tx.predicted_category || '');
        const finalMethod = field === 'final_method' ? nextValue : (tx.final_method || tx.predicted_method || null);
        if (finalCategory) {
          await updateMerchantMemory(
            merchantKey,
            categoryMode as 'personal' | 'business',
            finalCategory,
            finalMethod,
            tx.final_notes || tx.predicted_notes || null,
            desc,
            user!.id,
            tx.match_source,
          );
        }
      }
    }

    toast.success('Saved');
  };

  const bulkApprove = async () => {
    const selected = filtered.filter(t => selectedIds.has(t.id));
    const { approved, skipped } = await bulkApproveRows(selected);
    setSelectedIds(new Set());
    toast.success(`Approved ${approved} row${approved === 1 ? '' : 's'}${skipped > 0 ? ` · ${skipped} skipped (no category)` : ''}`);
  };

  const bulkMarkTransfer = async () => {
    const ids = [...selectedIds];
    const transferCategory = categories.find(c => c.toLowerCase() === 'transfer') || null;
    await supabase.from('transactions_uploaded').update({
      is_transfer: true, exclude_from_expense_totals: true, transfer_type: 'unknown_transfer',
      is_non_expense_cash_movement: true,
      counts_toward_true_personal_spend: false,
      counts_toward_true_business_spend: false,
      treatment_type: 'transfer',
      predicted_category: transferCategory,
      final_category: transferCategory,
      review_status: transferCategory ? 'edited' : 'needs_review',
    }).in('id', ids);
    setSelectedIds(new Set());
    await loadTransactions();
    toast.success(`Marked ${ids.length} rows as transfer`);
  };

  const bulkSwitchMode = async (targetMode: TransactionMode) => {
    const ids = [...selectedIds];
    const updates: Record<string, any> = {
      transaction_mode: targetMode,
      mode: targetMode === 'reimbursable_work' ? 'personal' : targetMode,
    };
    if (targetMode === 'personal') {
      updates.economic_owner = 'personal';
      updates.counts_toward_true_personal_spend = true;
      updates.counts_toward_true_business_spend = false;
      updates.is_reimbursable = false;
    } else if (targetMode === 'business') {
      updates.economic_owner = 'artist_influence';
      updates.counts_toward_true_personal_spend = false;
      updates.counts_toward_true_business_spend = true;
      updates.is_reimbursable = false;
    } else {
      updates.economic_owner = 'employer';
      updates.counts_toward_true_personal_spend = false;
      updates.counts_toward_true_business_spend = false;
      updates.is_reimbursable = true;
      updates.reimbursement_status = 'pending';
    }
    await supabase.from('transactions_uploaded').update(updates as never).in('id', ids);
    setSelectedIds(new Set());
    await loadTransactions();
    toast.success(`Switched ${ids.length} rows to ${MODE_CONFIG[targetMode].label}`);
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (!confirm(`Delete ${ids.length} selected transaction(s)? This cannot be undone.`)) return;

    const affectedTxs = transactions.filter(t => selectedIds.has(t.id));
    const affectedBatchIds = [...new Set(
      affectedTxs.map(t => t.upload_batch_id).filter(Boolean) as string[]
    )];

    const { error } = await supabase.from('transactions_uploaded').delete().in('id', ids);
    if (error) { toast.error('Failed to delete'); return; }

    for (const batchId of affectedBatchIds) {
      const { count } = await supabase
        .from('transactions_uploaded')
        .select('id', { count: 'exact', head: true })
        .eq('upload_batch_id', batchId);
      if (count === 0) {
        await supabase.from('upload_batches').delete().eq('id', batchId);
        setFileQueue(prev => prev.filter(item => item.result?.batchId !== batchId));
      }
    }

    setSelectedIds(new Set());
    await loadTransactions();
    toast.success(`Deleted ${ids.length} rows`);
  };

  const toggleTransfer = async (tx: Transaction) => {
    const newIsTransfer = !tx.is_transfer;
    await supabase.from('transactions_uploaded').update({
      is_transfer: newIsTransfer, exclude_from_expense_totals: newIsTransfer,
      transfer_type: newIsTransfer ? 'unknown_transfer' : null,
      is_non_expense_cash_movement: newIsTransfer,
      treatment_type: newIsTransfer ? 'transfer' : 'expense',
      counts_toward_true_personal_spend: newIsTransfer ? false : (tx.transaction_mode === 'personal'),
      counts_toward_true_business_spend: newIsTransfer ? false : (tx.transaction_mode === 'business'),
    }).eq('id', tx.id);
    await loadTransactions();
    setDetailTx(null);
    toast.success(newIsTransfer ? 'Marked as transfer' : 'Restored to expense');
  };

  const handleSplit = async (parentId: string, children: Array<{
    amount: number; mode: string; category: string; notes: string;
    is_reimbursable: boolean; reimbursable_to: string; tax_treatment: string;
  }>) => {
    if (!user) return;
    // Mark parent as split
    await supabase.from('transactions_uploaded').update({
      is_split_parent: true,
      exclude_from_expense_totals: true,
      counts_toward_true_personal_spend: false,
      counts_toward_true_business_spend: false,
      review_status: 'edited',
    }).eq('id', parentId);

    const parent = transactions.find(t => t.id === parentId);
    if (!parent) return;

    // Create child rows
    const childRows = children.map(c => ({
      owner_id: user.id,
      parent_transaction_id: parentId,
      date: parent.date,
      description_raw: parent.description_raw,
      description_normalized: parent.description_normalized,
      source_file_name: parent.source_file_name,
      amount: parent.amount && parent.amount < 0 ? -c.amount : c.amount,
      mode: c.mode === 'reimbursable_work' ? 'personal' : c.mode,
      transaction_mode: c.mode,
      economic_owner: c.mode === 'business' ? 'artist_influence' : c.mode === 'reimbursable_work' ? 'employer' : 'personal',
      treatment_type: c.is_reimbursable ? 'reimbursable_expense' : 'expense',
      tax_treatment: c.tax_treatment,
      is_reimbursable: c.is_reimbursable,
      reimbursable_to: c.reimbursable_to || null,
      reimbursement_status: c.is_reimbursable ? 'pending' : 'none',
      counts_toward_true_personal_spend: c.mode === 'personal',
      counts_toward_true_business_spend: c.mode === 'business',
      final_category: c.category || null,
      final_notes: c.notes || null,
      final_method: parent.final_method || parent.predicted_method,
      review_status: c.category ? 'edited' : 'needs_review',
      parse_status: 'ok',
      duplicate_status: 'unique',
      is_split_parent: false,
    }));

    const { error } = await supabase.from('transactions_uploaded').insert(childRows);
    if (error) {
      toast.error(`Split failed: ${error.message}`);
      return;
    }

    await loadTransactions();
    setDetailTx(null);
    setSplitTx(null);
    toast.success(`Split into ${children.length} rows`);
  };

  const exportCsv = () => {
    const usingSelection = selectedIds.size > 0;
    // When user explicitly checks rows, export every one of them as-is.
    // Otherwise fall back to the filtered view restricted to approved-style rows.
    const source = usingSelection
      ? filtered.filter(t => selectedIds.has(t.id))
      : filtered.filter(t => ['approved', 'auto_categorized', 'edited'].includes(t.review_status) && !t.is_split_parent);
    const rows = source.map(t => ({
      Date: t.date || '',
      Description: t.description_raw || '',
      Amount: t.amount != null ? `$${Math.abs(t.amount).toFixed(2)}` : '',
      Category: t.final_category || t.predicted_category || '',
      Method: t.final_method || t.predicted_method || '',
      Mode: t.transaction_mode || t.mode || '',
      'Economic Owner': t.economic_owner || '',
      'Tax Treatment': t.tax_treatment || '',
      Reimbursable: t.is_reimbursable ? 'Yes' : 'No',
      Transfer: t.is_transfer ? 'Yes' : 'No',
      'Review Status': t.review_status || '',
      Notes: t.final_notes || t.predicted_notes || '',
    }));
    if (rows.length === 0) {
      toast.error(usingSelection ? 'No selected rows to export' : 'No approved/edited transactions to export');
      return;
    }
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${(r[h as keyof typeof r] || '').toString().replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses_${mode}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(usingSelection ? `Exported ${rows.length} selected row${rows.length === 1 ? '' : 's'}` : `Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
  };

  // Upload processing
  const updateItem = (id: string, patch: Partial<FileQueueItem>) => {
    setFileQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const loadSettings = async () => {
    const { data } = await supabase.from('app_settings')
      .select('prevent_exact_duplicates, flag_possible_duplicates, exclude_transfers_from_totals, ai_enabled')
      .eq('owner_id', ownerId!).maybeSingle();
    return {
      preventExactDuplicates: data?.prevent_exact_duplicates ?? true,
      flagPossibleDuplicates: data?.flag_possible_duplicates ?? true,
      excludeTransfers: data?.exclude_transfers_from_totals ?? true,
      aiEnabled: data?.ai_enabled ?? false,
    };
  };

  const processFile = async (item: FileQueueItem & { mapping: ColumnMapping; detectedHeaders?: string[] }) => {
    if (!user) return;
    const { id, file, method, mapping, detectedHeaders } = item;
    try {
      const appSettings = await loadSettings();

      const { data: catData } = await supabase
        .from('category_options')
        .select('category_name')
        .eq('mode', categoryMode)
        .eq('is_active', true)
        .eq('owner_id', ownerId!)
        .order('sort_order');
      const allowedCategories = (catData || []).map(c => c.category_name);
      const allowedSet = new Set(allowedCategories.map(c => c.toLowerCase()));

      updateItem(id, { status: 'parsing' });
      const parsed = await parseCsvFileWithMapping(file, mapping);
      const validRowsAll = parsed.filter(r => r.parse_status === 'ok');
      const parseErrorRows = parsed.filter(r => r.parse_status === 'parse_error');

      if (validRowsAll.length === 0) {
        updateItem(id, { status: 'error', error: `No valid rows. ${parseErrorRows.length} parse errors.` });
        return;
      }

      // SIGN-AWARE ROUTING — split rows by where they actually belong before
      // they pollute the expenses pipeline. Uses the original signed amount and
      // any Details / Type signal columns the bank kept in source_row_json.
      const incomeRows: typeof validRowsAll = [];
      const ccPaymentRowKeys = new Set<string>();   // identify by description+amount
      const refundRowKeys = new Set<string>();
      const validRows: typeof validRowsAll = [];

      for (const tx of validRowsAll) {
        const decision = routeTransaction({
          signedAmount: tx.amount,
          description: tx.description_raw || '',
          sourceRow: (tx.source_row_json as Record<string, unknown> | null) || null,
        });
        if (decision.route === 'income') {
          incomeRows.push(tx);
          continue;
        }
        // Build a stable key for the row to mark CC payment / refund treatment downstream
        const key = `${tx.date}|${tx.amount}|${tx.description_normalized}`;
        if (decision.route === 'cc_payment_transfer') ccPaymentRowKeys.add(key);
        if (decision.route === 'refund') refundRowKeys.add(key);
        // Store ABS amount for the existing pipeline (display + dedupe expect positives).
        validRows.push({ ...tx, amount: Math.abs(tx.amount) });
      }

      // Insert income rows directly into income_transactions and skip the
      // expenses pipeline for them entirely.
      // The income table's `mode` must mirror the upload's mode — a Business
      // expense file's auto-routed inflows belong to business income, not
      // personal. (reimbursable_work uploads are personal-owned at the cash
      // level, so their inflows stay personal.)
      const incomeMode: 'personal' | 'business' =
        categoryMode === 'business' ? 'business' : 'personal';
      let incomeInsertedCount = 0;
      if (incomeRows.length > 0) {
        const incomePayload = incomeRows.map(tx => {
          const cls = classifyIncome(tx.description_raw || '');
          return {
            owner_id: user.id,
            date: tx.date,
            amount: Math.abs(tx.amount),
            description_raw: tx.description_raw,
            description_normalized: tx.description_normalized,
            income_type: cls.income_type,
            taxable_status: cls.taxable_status,
            mode: incomeMode,
            source_account_name: method || null,
            source_file_name: file.name,
            status: 'needs_review',
          };
        });
        const { error: incomeErr } = await supabase.from('income_transactions').insert(incomePayload);
        if (!incomeErr) incomeInsertedCount = incomePayload.length;
        else console.error('Income insert failed:', incomeErr);
      }

      if (validRows.length === 0) {
        updateItem(id, {
          status: 'done',
          result: {
            batchId: '',
            total: 0,
            auto: 0,
            suggested: 0,
            review: 0,
            skipped: 0,
            possibleDuplicates: 0,
            transfers: 0,
            parseErrors: parseErrorRows.length,
            incomeRouted: incomeInsertedCount,
          } as any,
        });
        toast.success(`${file.name}: routed ${incomeInsertedCount} rows to Income (no expenses)`);
        return;
      }

      updateItem(id, { status: 'deduplicating' });
      const dates = validRows.map(r => r.date).filter(Boolean).sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];
      // Widen the lookup window by ±3 days so edge-of-window matches still hit.
      const shiftDate = (iso: string, days: number) => {
        const d = new Date(iso + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
      };

      const existingFingerprints = new Set<string>();
      const existingForNearDup: { date: string | null; amount: number; description_normalized: string; id: string; fingerprint: string }[] = [];

      const ingestExisting = (rows: { id: string; date: string | null; description_normalized: string | null; amount: number | null; duplicate_fingerprint: string | null }[]) => {
        for (const row of rows) {
          const fp = row.duplicate_fingerprint || generateFingerprint(categoryMode, row.date, row.amount ?? 0, row.description_normalized || '');
          existingFingerprints.add(fp);
          existingForNearDup.push({ date: row.date, amount: row.amount ?? 0, description_normalized: row.description_normalized || '', id: row.id, fingerprint: fp });
        }
      };

      if (minDate && maxDate) {
        const fromDate = shiftDate(minDate, -3);
        const toDate = shiftDate(maxDate, 3);
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;
        while (hasMore) {
          const { data: existing } = await supabase
            .from('transactions_uploaded')
            .select('id, date, description_normalized, amount, duplicate_fingerprint')
            .eq('mode', categoryMode).eq('owner_id', ownerId!)
            .gte('date', fromDate).lte('date', toDate)
            .range(from, from + pageSize - 1);
          if (existing) ingestExisting(existing as any);
          hasMore = (existing?.length ?? 0) === pageSize;
          from += pageSize;
        }
      }
      // Also pull rows with NULL date so they participate in fp matching.
      {
        const { data: nullDateRows } = await supabase
          .from('transactions_uploaded')
          .select('id, date, description_normalized, amount, duplicate_fingerprint')
          .eq('mode', categoryMode).eq('owner_id', ownerId!)
          .is('date', null)
          .limit(1000);
        if (nullDateRows) ingestExisting(nullDateRows as any);
      }

      let exactDupCount = 0, possibleDupCount = 0;
      const rowsToInsert: typeof validRows = [];
      const dupStatuses: Map<number, { status: string; matchId: string | null }> = new Map();
      const exactSkippedDetail: { date: string | null; amount: number; description: string; matched_id: string | null }[] = [];
      // In-file dedup: track signatures already seen in THIS import (amount + merchant key).
      const inFileNearSeen = new Map<string, number>();

      for (const tx of validRows) {
        const fp = generateFingerprint(categoryMode, tx.date, tx.amount, tx.description_normalized);
        if (appSettings.preventExactDuplicates && existingFingerprints.has(fp)) {
          exactDupCount++;
          const matched = existingForNearDup.find(e => e.fingerprint === fp);
          if (exactSkippedDetail.length < 50) {
            exactSkippedDetail.push({
              date: tx.date,
              amount: tx.amount,
              description: tx.description_raw?.slice(0, 120) || tx.description_normalized?.slice(0, 120) || '',
              matched_id: matched?.id || null,
            });
          }
          continue;
        }
        let nearDupMatch: string | null = null;
        if (appSettings.flagPossibleDuplicates) {
          for (const existing of existingForNearDup) {
            if (existing.fingerprint === fp) continue;
            if (isNearDuplicate(tx, existing)) { nearDupMatch = existing.id; possibleDupCount++; break; }
          }
        }
        // In-file near-duplicate sweep (against rows already queued for insert this batch).
        if (!nearDupMatch && appSettings.flagPossibleDuplicates) {
          const mk = generateMerchantKey(tx.description_normalized || '');
          const inFileKey = `${Math.round(tx.amount * 100)}|${mk}`;
          if (mk && inFileNearSeen.has(inFileKey)) {
            // Mark THIS row as a possible duplicate of the earlier one in the same file.
            const earlierIdx = inFileNearSeen.get(inFileKey)!;
            const earlierFp = generateFingerprint(categoryMode, rowsToInsert[earlierIdx].date, rowsToInsert[earlierIdx].amount, rowsToInsert[earlierIdx].description_normalized);
            // We don't have its DB id yet; rely on duplicate_fingerprint to link post-insert.
            void earlierFp;
            possibleDupCount++;
            nearDupMatch = '__in_file__';
          } else if (mk) {
            inFileNearSeen.set(inFileKey, rowsToInsert.length);
          }
        }
        dupStatuses.set(rowsToInsert.length, { status: nearDupMatch ? 'possible_duplicate' : 'unique', matchId: nearDupMatch === '__in_file__' ? null : nearDupMatch });
        rowsToInsert.push(tx);
        existingFingerprints.add(fp);
      }

      if (rowsToInsert.length === 0) {
        updateItem(id, { status: 'done', result: { batchId: '', total: 0, auto: 0, suggested: 0, review: 0, skipped: exactDupCount, possibleDuplicates: possibleDupCount, transfers: 0, parseErrors: parseErrorRows.length } });
        toast.info(`${file.name}: all rows are duplicates`);
        return;
      }

      updateItem(id, { status: 'categorizing' });

      // Build recurring-charge history map: merchant_key → [{ date, amount }, …] over last 180 days
      const recurringHistory = new Map<string, { date: string; amount: number }[]>();
      try {
        const incomingKeys = new Set<string>();
        for (const r of rowsToInsert) {
          const k = generateMerchantKey(r.description_normalized || '');
          if (k) incomingKeys.add(k);
        }
        if (incomingKeys.size > 0) {
          const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
          let from = 0;
          const pageSize = 1000;
          let hasMore = true;
          while (hasMore) {
            const { data: priorRows } = await supabase
              .from('transactions_uploaded')
              .select('description_normalized, amount, date')
              .eq('mode', categoryMode)
              .eq('owner_id', ownerId!)
              .gte('date', since)
              .not('amount', 'is', null)
              .range(from, from + pageSize - 1);
            if (priorRows) {
              for (const row of priorRows) {
                if (!row.date || row.amount == null) continue;
                const k = generateMerchantKey(row.description_normalized || '');
                if (!k || !incomingKeys.has(k)) continue;
                const list = recurringHistory.get(k) || [];
                list.push({ date: row.date, amount: Number(row.amount) });
                recurringHistory.set(k, list);
              }
            }
            hasMore = (priorRows?.length ?? 0) === pageSize;
            from += pageSize;
          }
        }
      } catch (err) {
        console.warn('Recurrence history load failed; continuing without:', err);
      }

      const results = await categorizeTransactions(rowsToInsert, categoryMode as 'personal' | 'business', user.id, undefined, allowedCategories, recurringHistory);

      // Layer 5: AI categorization for unmatched rows
      const aiExplanations = new Map<number, string>();
      if (appSettings.aiEnabled && allowedCategories.length > 0) {
        const unmatchedRows: { index: number; description_raw: string; description_normalized: string }[] = [];
        results.forEach((r, idx) => {
          if (r.review_status === 'needs_review' && !r.predicted_category) {
            const tx = rowsToInsert[idx];
            unmatchedRows.push({
              index: idx,
              description_raw: tx.description_raw || '',
              description_normalized: tx.description_normalized || '',
            });
          }
        });

        if (unmatchedRows.length > 0) {
          try {
            const aiResults = await categorizeWithAI(unmatchedRows, categoryMode as 'personal' | 'business', user.id, allowedCategories);
            for (const [idx, aiResult] of aiResults) {
              if (aiResult.category && aiResult.confidence >= 50) {
                results[idx].predicted_category = aiResult.category;
                results[idx].confidence = aiResult.confidence;
                results[idx].match_source = 'ai';
                results[idx].match_explanation = aiResult.explanation;
                results[idx].review_status = aiResult.confidence >= 80 ? 'ai_suggested' : 'needs_review';
                aiExplanations.set(idx, aiResult.explanation);
              } else if (aiResult.explanation) {
                results[idx].match_explanation = aiResult.explanation;
                aiExplanations.set(idx, aiResult.explanation);
              }
            }
          } catch (err) {
            console.error('AI categorization failed, continuing without:', err);
          }
        }
      }

      let transferCount = 0;
      updateItem(id, { status: 'inserting' });
      const autoCount = results.filter(r => r.review_status === 'auto_categorized').length;
      const suggestedCount = results.filter(r => r.review_status === 'suggested' || r.review_status === 'ai_suggested').length;
      const reviewCount = results.filter(r => r.review_status === 'needs_review').length;

      const { data: batch, error: batchError } = await supabase.from('upload_batches').insert({
        mode: categoryMode, file_name: file.name, total_rows: rowsToInsert.length,
        auto_categorized_count: autoCount, suggested_count: suggestedCount, needs_review_count: reviewCount,
        exact_duplicates_skipped: exactDupCount, possible_duplicates_flagged: possibleDupCount,
        transfers_detected: 0, parse_errors: parseErrorRows.length, owner_id: user.id,
        detected_headers: detectedHeaders || null,
        mapped_columns: mapping as any,
        parse_details: { total_raw_rows: parsed.length, filtered_artifacts: parsed.length - validRows.length - parseErrorRows.length, valid_rows: validRows.length, parse_error_count: parseErrorRows.length, exact_duplicates: exactDupCount, possible_duplicates: possibleDupCount, exact_duplicates_detail: exactSkippedDetail } as any,
      } as any).select().single();
      if (batchError) throw batchError;

      // V2 mode defaults for new rows
      const modeDefaults = getModeDefaults(mode);

      const chunkSize = 100;
      for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
        const chunk = rowsToInsert.slice(i, i + chunkSize).map((tx, idx) => {
          const globalIdx = i + idx;
          const result = results[globalIdx];
          const txMethod = method || result.predicted_method;
          const dupInfo = dupStatuses.get(globalIdx) || { status: 'unique', matchId: null };
          const fp = generateFingerprint(categoryMode, tx.date, tx.amount, tx.description_normalized);
          const transfer = detectTransfer(tx.description_raw);
          const isHighConfTransfer = transfer.isTransfer && transfer.transferConfidence === 'high';
          const isMediumTransfer = transfer.transferConfidence === 'medium';
          const routerKey = `${tx.date}|${tx.amount}|${tx.description_normalized}`;
          const isCcPayment = ccPaymentRowKeys.has(routerKey);
          const isRefund = refundRowKeys.has(routerKey);
          if (isHighConfTransfer || isCcPayment) transferCount++;

          let transferCategory: string | null = null;
          if (isHighConfTransfer) {
            transferCategory = allowedSet.has('transfer') ? allowedCategories.find(c => c.toLowerCase() === 'transfer') || null : null;
          }

          const predictedCat = isHighConfTransfer ? transferCategory : result.predicted_category;
          // Auto-approve: if auto_categorized with high confidence exact match, mark as approved
          const shouldAutoApprove = result.review_status === 'auto_categorized' 
            && result.confidence >= 95 
            && (result.match_source === 'exact_history' || result.match_source === 'normalized_history')
            && !isHighConfTransfer;
          const finalCat = (result.review_status === 'auto_categorized' || shouldAutoApprove)
            ? (isHighConfTransfer ? transferCategory : result.predicted_category)
            : null;
          const reviewStatus = (isHighConfTransfer && !transferCategory) ? 'needs_review' 
            : shouldAutoApprove ? 'approved' 
            : result.review_status;

          // Medium-confidence transfers: keep in totals, flag for review
          const matchExplanation = isMediumTransfer
            ? `${result.match_explanation || ''} ⚠️ Possible transfer detected (medium confidence) — review if this is a real expense or inter-account movement.`.trim()
            : result.match_explanation || null;

          return {
            upload_batch_id: batch.id, mode: categoryMode, date: tx.date,
            description_raw: tx.description_raw, description_normalized: tx.description_normalized,
            amount: tx.amount,
            predicted_category: predictedCat,
            predicted_method: txMethod,
            predicted_notes: result.predicted_notes,
            final_category: finalCat,
            final_method: reviewStatus === 'auto_categorized' ? txMethod : null,
            final_notes: reviewStatus === 'auto_categorized' ? result.predicted_notes : null,
            confidence: result.confidence, match_source: result.match_source,
            match_explanation: matchExplanation,
            review_status: reviewStatus, owner_id: user.id,
            source_row_json: tx.source_row_json, source_file_name: file.name,
            parse_status: tx.parse_status, parse_error: tx.parse_error,
            duplicate_fingerprint: fp, duplicate_status: dupInfo.status,
            duplicate_of_transaction_id: dupInfo.matchId,
            is_transfer: isHighConfTransfer || isCcPayment,
            exclude_from_expense_totals: (isHighConfTransfer && appSettings.excludeTransfers) || isCcPayment,
            transfer_type: isCcPayment ? 'credit_card_payment' : transfer.transferType,
            // V2 fields
            transaction_mode: mode,
            ...modeDefaults,
            is_non_expense_cash_movement: isHighConfTransfer || isCcPayment,
            treatment_type: isCcPayment ? 'credit_card_payment' : isRefund ? 'refund' : isHighConfTransfer ? 'transfer' : 'expense',
            counts_toward_true_personal_spend: (isHighConfTransfer || isCcPayment || isRefund) ? false : modeDefaults.counts_toward_true_personal_spend,
            counts_toward_true_business_spend: (isHighConfTransfer || isCcPayment || isRefund) ? false : modeDefaults.counts_toward_true_business_spend,
            // Auto-flag tax deductibility based on (mode, category). Never flags
            // transfers / CC payments / refunds. User can override per-row in the
            // detail drawer. Without this the Tax page perpetually shows $0.
            counts_as_tax_deduction:
              (isHighConfTransfer || isCcPayment || isRefund)
                ? false
                : isDeductibleCategory(mode, finalCat || predictedCat),
          };
        });
        const { error: txError } = await supabase.from('transactions_uploaded').insert(chunk);
        if (txError) throw txError;
      }

      if (transferCount > 0) {
        await supabase.from('upload_batches').update({ transfers_detected: transferCount }).eq('id', batch.id);
      }

      const refundCount = refundRowKeys.size;
      const ccPaymentCount = ccPaymentRowKeys.size;
      updateItem(id, {
        status: 'done',
        result: { batchId: batch.id, total: rowsToInsert.length, auto: autoCount, suggested: suggestedCount, review: reviewCount, skipped: exactDupCount, possibleDuplicates: possibleDupCount, transfers: transferCount, parseErrors: parseErrorRows.length, incomeRouted: incomeInsertedCount, refunds: refundCount, ccPayments: ccPaymentCount } as any,
      });
      if (incomeInsertedCount || refundCount || ccPaymentCount) {
        toast.success(
          `${file.name}: ${rowsToInsert.length} expenses` +
          (refundCount ? `, ${refundCount} refunds` : '') +
          (ccPaymentCount ? `, ${ccPaymentCount} card payments (transfers)` : '') +
          (incomeInsertedCount ? `, ${incomeInsertedCount} routed to Income` : '')
        );
      }
    } catch (err: any) {
      updateItem(id, { status: 'error', error: err.message || 'Processing failed' });
    }
  };

  const processQueue = useCallback(async (items: (FileQueueItem & { mapping: ColumnMapping; detectedHeaders?: string[] })[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    for (const item of items) {
      if (item.status === 'error') continue;
      await processFile(item);
    }
    await loadTransactions();
    processingRef.current = false;
  }, [user, mode]);

  const handleFilesSelect = async (files: File[]) => {
    const previews: FilePreviewInfo[] = [];
    for (const file of files) {
      try {
        const preview = await previewCsvFile(file);
        previews.push({ file, preview, error: null, method: detectMethodFromFilename(file.name) });
      } catch (err: any) {
        previews.push({ file, preview: null, error: err.message || 'Failed to read file', method: detectMethodFromFilename(file.name) });
      }
    }
    setFilePreviews(previews);
    setPendingFiles(files);
    setShowPreview(true);
  };

  const handlePreviewConfirm = (validIndexes: number[]) => {
    if (validIndexes.length === 0) return;
    setShowPreview(false);
    const newItems: (FileQueueItem & { mapping: ColumnMapping; detectedHeaders?: string[] })[] = validIndexes.map(i => {
      const fp = filePreviews[i];
      return {
        id: crypto.randomUUID(), file: fp.file, status: 'queued' as const, progress: 0,
        method: fp.method,
        mapping: fp.preview!.mapping,
        detectedHeaders: fp.preview!.headers,
      };
    });
    const errorItems: FileQueueItem[] = filePreviews
      .filter((fp, i) => !validIndexes.includes(i))
      .map(fp => ({
        id: crypto.randomUUID(), file: fp.file, status: 'error' as const, progress: 0,
        method: fp.method,
        error: fp.error || `Missing required columns: ${fp.preview?.unmappedRequired.join(', ') || 'unknown'}`,
      }));
    setFileQueue(prev => [...newItems, ...errorItems, ...prev]);
    processQueue(newItems);
    setFilePreviews([]); setPendingFiles([]);
  };

  const handlePreviewCancel = () => {
    setShowPreview(false); setFilePreviews([]); setPendingFiles([]);
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
      case 'ai_suggested': return 'status-suggested';
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

  const fmtMoney = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-4 animate-fade-in">
        {/* Top Control Bar */}
        <div className="glass-panel p-3 mb-3 flex flex-wrap items-center gap-2 sticky top-14 z-40">
          {/* 3-Way Mode Toggle — hidden for investors */}
          {!isInvestor && (
            <div className="flex rounded-lg border border-border/40 overflow-hidden">
              {(Object.entries(MODE_CONFIG) as [TransactionMode, typeof MODE_CONFIG[TransactionMode]][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-border/20 last:border-r-0 ${
                    mode === key ? cfg.activeClass : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          )}
          {isInvestor && (
            <span className="text-xs font-medium text-primary px-3 py-1.5">Business Expenses</span>
          )}

          {/* Upload — hidden for investors/accountants */}
          {!isInvestor && !isAccountant && (
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
                  <FileProgressList items={fileQueue} mode={categoryMode} />
                </div>
              </SheetContent>
            </Sheet>
          )}

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
              <SelectItem value="unreviewed">Unreviewed (any)</SelectItem>
              <SelectItem value="needs_review">Needs Review</SelectItem>
              <SelectItem value="suggested">Suggested</SelectItem>
              <SelectItem value="ai_suggested">AI Suggested</SelectItem>
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
              <SelectItem value="possible_transfers">Possible Transfers</SelectItem>
              <SelectItem value="reimbursable">Reimbursable</SelectItem>
              <SelectItem value="splits">Split Transactions</SelectItem>
              <SelectItem value="possible_duplicates">Duplicates</SelectItem>
              <SelectItem value="parse_errors">Parse Errors</SelectItem>
              <SelectItem value="excluded">Excluded</SelectItem>
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[160px] h-8 glass-input text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="__uncategorized__">Uncategorized</SelectItem>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className={`w-[160px] h-8 glass-input text-xs ${methodFilter !== 'all' ? 'border-primary/40 text-primary' : ''}`}>
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="__nomethod__">(No method)</SelectItem>
              {availableMethods.map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={`h-8 gap-1.5 text-xs glass-input ${dateActive ? 'border-primary/40 text-primary' : ''}`}>
                <Calendar className="h-3 w-3" />
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
                    <SelectTrigger className="h-8 glass-input text-xs">
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
                  <Input type="date" value={dateFrom || ''} onChange={(e) => onCustomFrom(e.target.value)} className="glass-input h-8 text-xs flex-1" />
                  <span className="text-xs text-muted-foreground">→</span>
                  <Input type="date" value={dateTo || ''} onChange={(e) => onCustomTo(e.target.value)} className="glass-input h-8 text-xs flex-1" />
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
              className="inline-flex items-center gap-1 h-8 px-2 rounded-md bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors"
              title="Clear date filter"
            >
              {dateLabel}
              <X className="h-3 w-3" />
            </button>
          )}


          {!isInvestor && !isAccountant && selectedIds.size === 0 && user && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs glass-input"
              disabled={scanningRecurring}
              onClick={async () => {
                setScanningRecurring(true);
                const tId = toast.loading(`Scanning ${categoryMode} transactions for recurring charges…`);
                try {
                  const summary = await backfillRecurringForOwner(user.id, categoryMode as 'personal' | 'business');
                  toast.dismiss(tId);
                  if (summary.skippedNoSubsCategory === -1) {
                    toast.error('Add a "Subscriptions" category first.');
                  } else if (summary.updated === 0) {
                    toast.success(`No new recurring charges found (scanned ${summary.scanned} merchants).`);
                  } else {
                    toast.success(`Tagged ${summary.updated} recurring charges as Subscriptions (${summary.eligible} matches across ${summary.scanned} merchants).`);
                  }
                  await loadTransactions();
                } catch (err: any) {
                  toast.dismiss(tId);
                  toast.error(`Scan failed: ${err?.message || 'unknown error'}`);
                  console.error(err);
                } finally {
                  setScanningRecurring(false);
                }
              }}
            >
              <RefreshCw className={`h-3 w-3 ${scanningRecurring ? 'animate-spin' : ''}`} />
              {scanningRecurring ? 'Scanning…' : 'Re-scan recurring'}
            </Button>
          )}

          {!isInvestor && !isAccountant && selectedIds.size === 0 && user && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs glass-input"
              disabled={sweepingDuplicates}
              onClick={runDuplicateSweep}
              title="Scan for duplicate rows already in the database"
            >
              <Copy className={`h-3 w-3 ${sweepingDuplicates ? 'animate-pulse' : ''}`} />
              {sweepingDuplicates ? 'Scanning…' : 'Find duplicates'}
            </Button>
          )}

          {!isInvestor && (exactClusters.length > 0 || nearClusters.length > 0 || crossModePairs.length > 0) && selectedIds.size === 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs border-warning/40 text-warning hover:bg-warning/10"
              onClick={() => setResolverOpen(true)}
            >
              <AlertTriangle className="h-3 w-3" />
              Resolve {exactClusters.length + nearClusters.length + crossModePairs.length}
            </Button>
          )}

          {!isInvestor && !isAccountant && selectedIds.size === 0 && (() => {
            const suggestedCount = filtered.filter(t => ['suggested', 'ai_suggested', 'auto_categorized'].includes(t.review_status) && !t.is_split_parent && (t.final_category || t.predicted_category)).length;
            return suggestedCount > 0 ? (
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs border-success/30 text-success hover:bg-success/10" onClick={async () => {
                const toApprove = filtered.filter(t => ['suggested', 'ai_suggested', 'auto_categorized'].includes(t.review_status) && !t.is_split_parent && (t.final_category || t.predicted_category));
                const { approved, skipped } = await bulkApproveRows(toApprove);
                toast.success(`Approved ${approved} suggested row${approved === 1 ? '' : 's'}${skipped > 0 ? ` · ${skipped} skipped` : ''}`);
              }}>
                <CheckCheck className="h-3 w-3" /> Approve All Suggested ({suggestedCount})
              </Button>
            ) : null;
          })()}

          {/* Bulk Actions — owner only */}
          {!isInvestor && !isAccountant && selectedIds.size > 0 && (
            <>
              <Button size="sm" onClick={bulkApprove} className="h-8 gap-1 text-xs">
                <CheckCheck className="h-3 w-3" /> Approve {selectedIds.size}
              </Button>
              <Button size="sm" variant="outline" onClick={bulkMarkTransfer} className="h-8 gap-1 text-xs">
                <ArrowLeftRight className="h-3 w-3" /> Transfer
              </Button>
              {mode !== 'personal' && (
                <Button size="sm" variant="outline" onClick={() => bulkSwitchMode('personal')} className="h-8 gap-1 text-xs">
                  <User className="h-3 w-3" /> → Personal
                </Button>
              )}
              {mode !== 'business' && (
                <Button size="sm" variant="outline" onClick={() => bulkSwitchMode('business')} className="h-8 gap-1 text-xs text-primary border-primary/30">
                  <Briefcase className="h-3 w-3" /> → Business
                </Button>
              )}
              {mode !== 'reimbursable_work' && (
                <Button size="sm" variant="outline" onClick={() => bulkSwitchMode('reimbursable_work')} className="h-8 gap-1 text-xs text-warning border-warning/30">
                  <Receipt className="h-3 w-3" /> → Reimburse
                </Button>
              )}
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

        {/* Comparative Summary — Personal vs Business at a glance, regardless of active tab */}
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Summary <span className="text-foreground/70 font-mono">· {dateLabel}</span>
            {dateActive && (
              <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-primary/15 text-primary text-[9px] font-medium">
                Filtered
              </span>
            )}
          </p>
        </div>
        <div className={`grid ${isInvestor ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 md:grid-cols-5'} gap-2 mb-2`}>
          {!isInvestor && (
            <div className="glass-panel-sm p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Personal Cash Out</p>
              <p className="text-sm font-mono font-semibold text-foreground mt-0.5">{fmtMoney(crossModeTotals.personalCashOut)}</p>
            </div>
          )}
          <div className="glass-panel-sm p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Business Cash Out</p>
            <p className="text-sm font-mono font-semibold text-primary mt-0.5">{fmtMoney(crossModeTotals.businessCashOut)}</p>
          </div>
          {!isInvestor && (
            <div className="glass-panel-sm p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">True Personal</p>
              <p className="text-sm font-mono font-semibold text-foreground mt-0.5">{fmtMoney(crossModeTotals.truePersonal)}</p>
              <p className="text-[9px] text-muted-foreground">Excludes reimbursable</p>
            </div>
          )}
          <div className="glass-panel-sm p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">True Business</p>
            <p className="text-sm font-mono font-semibold text-primary mt-0.5">{fmtMoney(crossModeTotals.trueBusiness)}</p>
            <p className="text-[9px] text-muted-foreground">Real business spend</p>
          </div>
          {!isInvestor && (
            <div className="glass-panel-sm p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending Reimbursable</p>
              <p className="text-sm font-mono font-semibold text-warning mt-0.5">{fmtMoney(crossModeTotals.pendingReimbursable)}</p>
            </div>
          )}
        </div>

        {/* Period insight tiles — Avg / day, Largest expense, Unique merchants */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
          <div className="glass-panel-sm p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg / day</p>
            <p className="text-sm font-mono font-semibold text-foreground mt-0.5">{fmtMoney(stats.avgPerDay)}</p>
            <p className="text-[9px] text-muted-foreground">over {stats.spanDays} day{stats.spanDays === 1 ? '' : 's'}</p>
          </div>
          <div className="glass-panel-sm p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Largest expense</p>
            {stats.largest ? (
              <>
                <p className="text-sm font-mono font-semibold text-foreground mt-0.5">{fmtMoney(stats.largest.amount)}</p>
                <p className="text-[9px] text-muted-foreground truncate" title={stats.largest.description}>
                  {stats.largest.description}{stats.largest.date ? ` · ${stats.largest.date}` : ''}
                </p>
              </>
            ) : (
              <p className="text-sm font-mono font-semibold text-muted-foreground mt-0.5">—</p>
            )}
          </div>
          <div className="glass-panel-sm p-2.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Unique merchants</p>
            <p className="text-sm font-mono font-semibold text-foreground mt-0.5">{stats.uniqueMerchants}</p>
            <p className="text-[9px] text-muted-foreground">distinct payees in period</p>
          </div>
        </div>

        {/* V2 Stats Row */}
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="glass-panel-sm px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">Total Cash Out</span>{' '}
            <span className="font-mono font-medium text-foreground">{fmtMoney(stats.totalCashOut)}</span>
            <span className="text-[9px] text-muted-foreground ml-1">(all non-excluded outflows)</span>
          </div>
          <div className="glass-panel-sm px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">True Personal</span>{' '}
            <span className="font-mono font-medium text-foreground">{fmtMoney(stats.truePersonalSpend)}</span>
          </div>
          <div className="glass-panel-sm px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">True Business</span>{' '}
            <span className="font-mono font-medium text-primary">{fmtMoney(stats.trueBusinessSpend)}</span>
          </div>
          {stats.pendingReimbursable > 0 && (
            <div className="glass-panel-sm px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">Pending Reimburse</span>{' '}
              <span className="font-mono font-medium text-warning">{fmtMoney(stats.pendingReimbursable)}</span>
            </div>
          )}
          {stats.needsReview > 0 && (
            <div className="glass-panel-sm px-3 py-1.5 text-xs cursor-pointer" onClick={() => setStatusFilter('needs_review')}>
              <span className="text-muted-foreground">Needs Review</span>{' '}
              <span className="font-mono font-medium text-destructive">{stats.needsReview}</span>
            </div>
          )}
          {stats.transfersExcluded > 0 && (
            <div className="glass-panel-sm px-3 py-1.5 text-xs cursor-pointer" onClick={() => setExtraFilter('transfers')}>
              <span className="text-muted-foreground">Transfers</span>{' '}
              <span className="font-mono font-medium text-muted-foreground">{stats.transfersExcluded}</span>
            </div>
          )}
          <div className="glass-panel-sm px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">Total</span>{' '}
            <span className="font-mono font-medium text-foreground">{stats.total}</span>
          </div>
        </div>

        {/* Airtable-style Table */}
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card/90 backdrop-blur-sm">
                <tr className="border-b border-border/40">
                  {!isInvestor && !isAccountant && (
                    <th className="px-2 py-2 text-left w-8 sticky left-0 bg-card/90 z-20">
                      <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={selectAll} className="rounded border-border" />
                    </th>
                  )}
                  <SortHeader col="date" label="Date" />
                  <SortHeader col="description" label="Description" />
                  <SortHeader col="amount" label="Amount" className="text-right" />
                  <SortHeader col="category" label="Category" />
                  <SortHeader col="method" label="Method" />
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Owner</th>
                  <SortHeader col="confidence" label="Conf" />
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Status</th>
                  <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Flags</th>
                  {!isInvestor && <th className="px-2 py-2 text-right text-[11px] font-medium text-muted-foreground w-20">Actions</th>}
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
                    <tr
                      key={tx.id}
                      className={`border-b border-border/10 hover:bg-secondary/20 transition-colors cursor-pointer ${tx.exclude_from_expense_totals ? 'opacity-50' : ''}`}
                      style={{ height: '32px' }}
                      onClick={() => !isInvestor && setDetailTx(tx)}
                    >
                      {!isInvestor && !isAccountant && (
                        <td className="px-2 py-1 sticky left-0 bg-card/60" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selectedIds.has(tx.id)} onChange={() => toggleSelect(tx.id)} className="rounded border-border" />
                        </td>
                      )}
                      <td className="px-2 py-1 font-mono text-muted-foreground whitespace-nowrap">{tx.date || '—'}</td>
                      <td className="px-2 py-1 max-w-[300px]">
                        <p className="text-foreground truncate" title={tx.description_raw || ''}>{tx.description_raw || '—'}</p>
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-foreground whitespace-nowrap">
                        ${tx.amount != null ? Math.abs(tx.amount).toFixed(2) : '0.00'}
                      </td>
                      <td className="px-1 py-0.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {tx.match_source === 'recurring_pattern' && (
                            <span
                              className="inline-flex items-center justify-center text-[10px] leading-none w-4 h-4 rounded bg-primary/15 text-primary shrink-0"
                              title={tx.match_explanation || 'Detected recurring charge'}
                            >
                              🔁
                            </span>
                          )}
                          {tx.is_split_parent || isInvestor ? (
                            <span className="text-foreground px-1" title={tx.is_split_parent ? "Split parent — edit child rows instead" : undefined}>
                              {tx.final_category || tx.predicted_category || '—'}
                            </span>
                          ) : (
                            <Select
                              value={tx.final_category || tx.predicted_category || ''}
                              onValueChange={v => {
                                if (v === '__add_new__') {
                                  setAddCategoryTarget({ kind: 'inline', txId: tx.id });
                                  setAddCategoryOpen(true);
                                  return;
                                }
                                inlineUpdate(tx, 'final_category', v);
                              }}
                            >
                              <SelectTrigger className="h-6 px-1.5 text-xs border-transparent bg-transparent hover:bg-secondary/40 focus:bg-secondary/60 focus:border-border [&>svg]:opacity-0 hover:[&>svg]:opacity-60 focus:[&>svg]:opacity-60">
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                {categories.map(c => (
                                  <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                                ))}
                                <SelectItem value="__add_new__" className="text-xs text-primary font-medium border-t border-border mt-1 pt-1.5">
                                  + Add new category…
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </td>
                      <td className="px-1 py-0.5" onClick={e => e.stopPropagation()}>
                        {tx.is_split_parent ? (
                          <span className="text-muted-foreground px-1">
                            {tx.final_method || tx.predicted_method || tx.source_account_name || '—'}
                          </span>
                        ) : (
                          <InlineMethodCell tx={tx} onCommit={v => inlineUpdate(tx, 'final_method', v)} />
                        )}
                      </td>
                      <td className="px-1 py-0.5" onClick={e => e.stopPropagation()}>
                        {tx.is_split_parent ? (
                          <span className="text-muted-foreground text-[10px] px-1">{tx.economic_owner || '—'}</span>
                        ) : (
                          <Select
                            value={tx.economic_owner || 'personal'}
                            onValueChange={v => inlineUpdate(tx, 'economic_owner', v)}
                          >
                            <SelectTrigger className="h-6 px-1.5 text-[10px] border-transparent bg-transparent hover:bg-secondary/40 focus:bg-secondary/60 focus:border-border [&>svg]:opacity-0 hover:[&>svg]:opacity-60 focus:[&>svg]:opacity-60">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {['personal', 'artist_influence', 'employer', 'client', 'other'].map(o => (
                                <SelectItem key={o} value={o} className="text-[11px]">{o.replace(/_/g, ' ')}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <span className={getConfidenceClass(tx.confidence)}>
                          {tx.confidence != null ? `${Math.round(tx.confidence)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <span className={getStatusClass(tx.review_status)}>
                          {tx.review_status === 'ai_suggested' ? 'AI suggested' : tx.review_status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-0.5 flex-wrap">
                          {tx.is_split_parent && (
                            <Badge variant="outline" className="text-[9px] h-3.5 gap-0.5 border-primary/40 text-primary px-1" title="Split parent — excluded from totals">
                              <Scissors className="h-2 w-2" /> split
                            </Badge>
                          )}
                          {tx.parent_transaction_id && (
                            <Badge variant="outline" className="text-[9px] h-3.5 gap-0.5 border-muted-foreground/40 text-muted-foreground px-1" title="Child of split transaction">
                              <Scissors className="h-2 w-2" /> child
                            </Badge>
                          )}
                          {tx.is_transfer && (
                            <Badge variant="outline" className="text-[9px] h-3.5 gap-0.5 border-muted-foreground/40 text-muted-foreground px-1">
                              <ArrowLeftRight className="h-2 w-2" /> xfer
                            </Badge>
                          )}
                          {!tx.is_transfer && tx.transfer_type === 'possible_transfer' && (
                            <Badge variant="outline" className="text-[9px] h-3.5 gap-0.5 border-warning/40 text-warning px-1" title="Possible transfer — review needed">
                              <ArrowLeftRight className="h-2 w-2" /> xfer?
                            </Badge>
                          )}
                          {tx.is_reimbursable && (
                            <Badge variant="outline" className={`text-[9px] h-3.5 gap-0.5 px-1 ${
                              tx.reimbursement_status === 'reimbursed' ? 'border-success/30 text-success' :
                              tx.reimbursement_status === 'partially_reimbursed' ? 'border-warning/40 text-warning' :
                              tx.reimbursement_status === 'submitted' ? 'border-primary/30 text-primary' :
                              'border-warning/30 text-warning'
                            }`}>
                              <Receipt className="h-2 w-2" /> {
                                tx.reimbursement_status === 'reimbursed' ? 'reimbursed' :
                                tx.reimbursement_status === 'partially_reimbursed' ? 'partial' :
                                tx.reimbursement_status === 'submitted' ? 'submitted' :
                                'reimb'
                              }
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
                          {!tx.final_category && !tx.predicted_category && tx.match_source && (
                            <Badge variant="outline" className="text-[9px] h-3.5 gap-0.5 border-destructive/30 text-destructive px-1" title="Category suggestion rejected — not in approved list">
                              <Ban className="h-2 w-2" /> rejected
                            </Badge>
                          )}
                          {tx.match_source === 'ai' && (
                            <Badge variant="outline" className="text-[9px] h-3.5 gap-0.5 border-purple-400/30 text-purple-400 px-1">
                              AI
                            </Badge>
                          )}
                        </div>
                      </td>
                      {!isInvestor && !isAccountant && (
                        <td className="px-2 py-1 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5 justify-end">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => setDetailTx(tx)} title="Edit">
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
                        </td>
                      )}
                    </tr>
                  ))
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
        onApprove={approveRow}
        onToggleTransfer={toggleTransfer}
        onSplit={(tx) => { setDetailTx(null); setSplitTx(tx as any); }}
        onAddCategory={() => {
          setAddCategoryTarget({ kind: 'drawer' });
          setAddCategoryOpen(true);
        }}
        pendingCategoryToSelect={pendingDrawerCategory}
        onPendingCategoryConsumed={() => setPendingDrawerCategory(null)}
      />

      {/* Split Transaction Dialog */}
      <SplitTransactionDialog
        open={!!splitTx}
        onClose={() => setSplitTx(null)}
        transaction={splitTx}
        categories={categories}
        onSplit={handleSplit}
        onAddCategory={(rowId) => {
          setAddCategoryTarget({ kind: 'split', rowId });
          setAddCategoryOpen(true);
        }}
        pendingCategoryToSelect={pendingSplitCategory}
        onPendingCategoryConsumed={() => setPendingSplitCategory(null)}
      />

      {/* Add new category inline dialog */}
      <AddCategoryDialog
        open={addCategoryOpen}
        onClose={() => { setAddCategoryOpen(false); setAddCategoryTarget(null); }}
        mode={categoryMode}
        existingCategories={categories}
        onCreated={async (newName) => {
          await loadCategories();
          const target = addCategoryTarget;
          if (target?.kind === 'inline') {
            const tx = transactions.find(t => t.id === target.txId);
            if (tx) await inlineUpdate(tx, 'final_category', newName);
          } else if (target?.kind === 'drawer') {
            setPendingDrawerCategory(newName);
          } else if (target?.kind === 'split') {
            setPendingSplitCategory({ rowId: target.rowId, name: newName });
          }
        }}
      />

      <ImportPreviewDialog
        open={showPreview}
        onConfirm={handlePreviewConfirm}
        onCancel={handlePreviewCancel}
        filePreviews={filePreviews}
      />

      {/* Duplicate Resolver Dialog */}
      <DuplicateResolverDialog
        open={resolverOpen}
        onClose={() => setResolverOpen(false)}
        exactClusters={exactClusters}
        nearClusters={nearClusters}
        crossModePairs={crossModePairs}
        rowIndex={clusterRowIndex}
        onResolved={async () => {
          // Re-run the sweep silently to refresh cluster lists after a resolution.
          await loadTransactions();
          await runDuplicateSweep();
        }}
      />
    </div>
  );
}

function getModeDefaults(mode: TransactionMode) {
  switch (mode) {
    case 'personal':
      return {
        economic_owner: 'personal',
        counts_toward_true_personal_spend: true,
        counts_toward_true_business_spend: false,
        is_reimbursable: false,
        reimbursement_status: 'none',
      };
    case 'business':
      return {
        economic_owner: 'artist_influence',
        counts_toward_true_personal_spend: false,
        counts_toward_true_business_spend: true,
        is_reimbursable: false,
        reimbursement_status: 'none',
      };
    case 'reimbursable_work':
      return {
        economic_owner: 'employer',
        counts_toward_true_personal_spend: false,
        counts_toward_true_business_spend: false,
        is_reimbursable: true,
        reimbursement_status: 'pending',
      };
  }
}

// Inline method cell: free-text input that commits on blur or Enter, cancels on Esc.
function InlineMethodCell({ tx, onCommit }: { tx: Transaction; onCommit: (value: string) => void }) {
  const initial = tx.final_method || tx.predicted_method || '';
  const [value, setValue] = useState(initial);
  useEffect(() => { setValue(tx.final_method || tx.predicted_method || ''); }, [tx.id, tx.final_method, tx.predicted_method]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed === (initial || '').trim()) return;
    onCommit(trimmed);
  };

  return (
    <Input
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        else if (e.key === 'Escape') { setValue(initial); (e.target as HTMLInputElement).blur(); }
      }}
      placeholder={tx.source_account_name || '—'}
      title={tx.source_account_name ? `Source account from upload: ${tx.source_account_name}` : undefined}
      className="h-6 px-1.5 text-xs border-transparent bg-transparent hover:bg-secondary/40 focus:bg-secondary/60 focus:border-border text-muted-foreground placeholder:text-muted-foreground/50"
    />
  );
}
