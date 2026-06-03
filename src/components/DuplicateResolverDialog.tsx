import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Check, Trash2, X, FileText, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { DuplicateCluster } from '@/lib/duplicate-detector';

export type DupClusterRow = {
  id: string;
  date: string | null;
  description_raw: string | null;
  description_normalized: string | null;
  amount: number | null;
  final_category: string | null;
  predicted_category: string | null;
  final_method: string | null;
  predicted_method: string | null;
  source_file_name: string | null;
  source_account_name?: string | null;
  mode: string;
  duplicate_status: string | null;
};

interface DuplicateResolverDialogProps {
  open: boolean;
  onClose: () => void;
  exactClusters: DuplicateCluster[];
  nearClusters: DuplicateCluster[];
  crossModePairs: { rowIds: string[] }[];
  rowIndex: Map<string, DupClusterRow> | Record<string, DupClusterRow>;
  // NEW — optional income duplicates
  incomeClusters?: DuplicateCluster[];
  incomeRowIndex?: Map<string, DupClusterRow> | Record<string, DupClusterRow>;
  onResolved: () => void; // refresh after change
}

function getRow(idx: Map<string, DupClusterRow> | Record<string, DupClusterRow> | undefined, id: string): DupClusterRow | undefined {
  if (!idx) return undefined;
  if (idx instanceof Map) return idx.get(id);
  return (idx as Record<string, DupClusterRow>)[id];
}

const PAGE_SIZE = 10;

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtDate(d: string | null) {
  if (!d) return 'no date';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function DuplicateResolverDialog({
  open,
  onClose,
  exactClusters,
  nearClusters,
  crossModePairs,
  rowIndex,
  incomeClusters = [],
  incomeRowIndex,
  onResolved,
}: DuplicateResolverDialogProps) {
  const [tab, setTab] = useState<'exact' | 'near' | 'cross' | 'income'>('exact');
  const [page, setPage] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  // IDs of rows whose cluster has been resolved in-session. Used to hide the
  // cluster immediately (optimistically) instead of waiting for the parent
  // refresh/sweep round-trip.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Reset state ONLY when the dialog transitions from closed → open.
  // Do NOT re-pick the tab when cluster counts change after an in-session
  // resolution, otherwise the user gets yanked off the tab they're working in.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setPage(0);
      setDismissedIds(new Set());
      if (exactClusters.length > 0) setTab('exact');
      else if (incomeClusters.length > 0) setTab('income');
      else if (nearClusters.length > 0) setTab('near');
      else if (crossModePairs.length > 0) setTab('cross');
      else setTab('exact');
    }
    prevOpen.current = open;
  }, [open, exactClusters.length, nearClusters.length, crossModePairs.length, incomeClusters.length]);

  const rawActiveList: { rowIds: string[] }[] =
    tab === 'exact' ? exactClusters
    : tab === 'near' ? nearClusters
    : tab === 'cross' ? crossModePairs
    : incomeClusters;
  // Hide any cluster that contains a row we've already resolved this session.
  const activeList = useMemo(
    () => rawActiveList.filter(c => !c.rowIds.some(id => dismissedIds.has(id))),
    [rawActiveList, dismissedIds],
  );
  const activeRowIndex = tab === 'income' ? incomeRowIndex : rowIndex;

  const pageCount = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE));
  const visible = useMemo(() => activeList.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [activeList, page]);

  async function archiveLosers(keeperId: string, loserIds: string[], clusterKey: string) {
    setBusyId(clusterKey);
    try {
      const { error } = await supabase
        .from('transactions_uploaded')
        .update({
          review_status: 'archived',
          exclude_from_expense_totals: true,
          duplicate_status: 'exact_duplicate',
          duplicate_of_transaction_id: keeperId,
        })
        .in('id', loserIds);
      if (error) throw error;
      // Mark keeper as resolved
      await supabase
        .from('transactions_uploaded')
        .update({ duplicate_status: 'unique', duplicate_of_transaction_id: null })
        .eq('id', keeperId);
      toast.success(`Archived ${loserIds.length} duplicate${loserIds.length > 1 ? 's' : ''}`);
      onResolved();
    } catch (e: any) {
      toast.error(`Archive failed: ${e?.message || 'unknown error'}`);
    } finally {
      setBusyId(null);
    }
  }

  async function hardDelete(loserIds: string[], clusterKey: string) {
    if (!confirm(`Permanently delete ${loserIds.length} row${loserIds.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setBusyId(clusterKey);
    try {
      const { error } = await supabase.from('transactions_uploaded').delete().in('id', loserIds);
      if (error) throw error;
      toast.success(`Deleted ${loserIds.length} row${loserIds.length > 1 ? 's' : ''}`);
      onResolved();
    } catch (e: any) {
      toast.error(`Delete failed: ${e?.message || 'unknown error'}`);
    } finally {
      setBusyId(null);
    }
  }

  async function markNotDuplicates(rowIds: string[], clusterKey: string) {
    setBusyId(clusterKey);
    try {
      const table = tab === 'income' ? 'income_transactions' : 'transactions_uploaded';
      const updates: any = tab === 'income'
        ? { duplicate_status: 'not_duplicate', duplicate_of_income_id: null }
        : { duplicate_status: 'not_duplicate', duplicate_of_transaction_id: null };
      const { error } = await supabase.from(table as any).update(updates).in('id', rowIds);
      if (error) throw error;
      toast.success('Marked as not duplicates');
      onResolved();
    } catch (e: any) {
      toast.error(`Update failed: ${e?.message || 'unknown error'}`);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteIncomeLosers(loserIds: string[], clusterKey: string) {
    if (!confirm(`Delete ${loserIds.length} duplicate income row${loserIds.length > 1 ? 's' : ''}? Keeps the oldest.`)) return;
    setBusyId(clusterKey);
    try {
      const { error } = await supabase.from('income_transactions').delete().in('id', loserIds);
      if (error) throw error;
      toast.success(`Deleted ${loserIds.length} duplicate income row${loserIds.length > 1 ? 's' : ''}`);
      onResolved();
    } catch (e: any) {
      toast.error(`Delete failed: ${e?.message || 'unknown error'}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5 text-warning" /> Resolve Duplicates
          </DialogTitle>
          <DialogDescription>
            Review duplicate clusters and decide what to keep. Archiving hides rows from totals but preserves them; hard delete removes them entirely.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as any); setPage(0); }} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-4 w-full shrink-0">
            <TabsTrigger value="exact">
              Exp Exact <Badge variant="secondary" className="ml-2">{exactClusters.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="income">
              Income <Badge variant="secondary" className="ml-2">{incomeClusters.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="near">
              Possible <Badge variant="secondary" className="ml-2">{nearClusters.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="cross">
              Cross-mode <Badge variant="secondary" className="ml-2">{crossModePairs.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="flex-1 min-h-0 mt-3">
            {activeList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Check className="h-10 w-10 mb-2 text-success/60" />
                <p className="text-sm">No {tab === 'exact' ? 'exact expense' : tab === 'near' ? 'possible' : tab === 'cross' ? 'cross-mode' : 'income'} duplicates found.</p>
              </div>
            ) : (
              <ScrollArea className="h-[55vh] w-full pr-3">
                <div className="space-y-3 w-full min-w-0">
                  {visible.map((cluster, ci) => {
                    const clusterKey = `${tab}-${page}-${ci}`;
                    const rows = cluster.rowIds.map(id => getRow(activeRowIndex, id)).filter(Boolean) as DupClusterRow[];
                    if (rows.length < 2) return null;
                    const keeper = rows[0]; // oldest
                    const losers = rows.slice(1);
                    const isCross = tab === 'cross';
                    const isIncome = tab === 'income';

                    return (
                      <div key={clusterKey} className="glass-panel p-3 space-y-2 w-full min-w-0 overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                            <span className="truncate">{rows.length} rows · {fmtMoney(keeper.amount)}</span>
                          </div>
                          {!isCross && (
                            <div className="flex flex-wrap items-center gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === clusterKey}
                                onClick={() => markNotDuplicates(rows.map(r => r.id), clusterKey)}
                                className="h-7 text-xs"
                              >
                                <X className="h-3 w-3 mr-1" /> Not duplicates
                              </Button>
                              {isIncome ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busyId === clusterKey}
                                  onClick={() => deleteIncomeLosers(losers.map(r => r.id), clusterKey)}
                                  className="h-7 text-xs border-warning/40 text-warning hover:bg-warning/10"
                                >
                                  <Trash2 className="h-3 w-3 mr-1" /> Keep oldest, delete {losers.length}
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busyId === clusterKey}
                                    onClick={() => archiveLosers(keeper.id, losers.map(r => r.id), clusterKey)}
                                    className="h-7 text-xs border-warning/40 text-warning hover:bg-warning/10"
                                  >
                                    <Check className="h-3 w-3 mr-1" /> Keep oldest, archive {losers.length}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busyId === clusterKey}
                                    onClick={() => hardDelete(losers.map(r => r.id), clusterKey)}
                                    className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="grid gap-2">
                          {rows.map((r, ri) => (
                            <div
                              key={r.id}
                              className={`text-xs rounded-md border px-2 py-1.5 ${
                                ri === 0 && !isCross
                                  ? 'border-success/30 bg-success/5'
                                  : 'border-border/50 bg-background/40'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 w-full min-w-0">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {ri === 0 && !isCross && (
                                    <Badge variant="outline" className="text-[10px] h-4 px-1 border-success/40 text-success shrink-0">KEEP</Badge>
                                  )}
                                  {isCross && (
                                    <Badge variant="outline" className="text-[10px] h-4 px-1 capitalize shrink-0">{r.mode}</Badge>
                                  )}
                                  <span className="text-muted-foreground shrink-0">{fmtDate(r.date)}</span>
                                  <span className="truncate min-w-0">{r.description_raw || r.description_normalized || '—'}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                                  {(r.final_category || r.predicted_category) && (
                                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                      {r.final_category || r.predicted_category}
                                    </Badge>
                                  )}
                                  {(r.final_method || r.predicted_method || r.source_account_name) && (
                                    <span className="text-[10px]">{r.final_method || r.predicted_method || r.source_account_name}</span>
                                  )}
                                </div>
                              </div>
                              {r.source_file_name && (
                                <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <FileText className="h-2.5 w-2.5" /> {r.source_file_name}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>

        {pageCount > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/30">
            <span>Page {page + 1} of {pageCount} · {activeList.length} clusters</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</Button>
              <Button size="sm" variant="ghost" disabled={page >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}>Next</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
