import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, AlertTriangle, Check, Copy, FileWarning, Clock, ListChecks, Activity } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { runHealthCheck, type HealthCheckSummary } from '@/lib/health-check';
import { DuplicateResolverDialog } from './DuplicateResolverDialog';
import { toast } from 'sonner';

interface HealthCheckPanelProps {
  open: boolean;
  onClose: () => void;
  initialSummary?: HealthCheckSummary | null;
  onSummaryChange?: (s: HealthCheckSummary) => void;
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return 'never';
  const d = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - d) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

export function HealthCheckPanel({ open, onClose, initialSummary, onSummaryChange }: HealthCheckPanelProps) {
  const { user, ownerId } = useAuth();
  const [summary, setSummary] = useState<HealthCheckSummary | null>(initialSummary || null);
  const [running, setRunning] = useState(false);
  const [resolverOpen, setResolverOpen] = useState(false);

  useEffect(() => {
    if (initialSummary) setSummary(initialSummary);
  }, [initialSummary]);

  async function refresh() {
    // Scan the WORKSPACE owner's data — a delegate scanning their own empty
    // tenant would report "healthy" no matter what.
    if (!user || !ownerId) return;
    setRunning(true);
    try {
      const s = await runHealthCheck(ownerId);
      setSummary(s);
      onSummaryChange?.(s);
      toast.success(s.totalIssues === 0 ? 'All clean — no issues found.' : `Health check complete · ${s.totalIssues} issue${s.totalIssues > 1 ? 's' : ''}`);
    } catch (e: any) {
      toast.error(`Health check failed: ${e?.message || 'unknown error'}`);
    } finally {
      setRunning(false);
    }
  }

  // Auto-run when opened (always refresh to get fresh data)
  useEffect(() => {
    if (open && !running) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dupTotal = summary
    ? summary.income.exactClusters.length +
      summary.expenses.exactClusters.length +
      summary.expenses.nearClusters.length +
      summary.expenses.crossModePairs.length
    : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" /> Data Health Check
            </DialogTitle>
            <DialogDescription>
              Auto-runs every 14 hours. Scans for duplicates, stale reviews, and parse errors across income and expenses.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Last run: {fmtRelative(summary?.ranAt)}</span>
            <Button size="sm" variant="outline" onClick={refresh} disabled={running} className="h-7 text-xs">
              {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Run now
            </Button>
          </div>

          {!summary && running && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-3" />
              <p className="text-sm">Scanning your data…</p>
            </div>
          )}

          {summary && (
            <div className="space-y-2">
              {summary.totalIssues === 0 && (
                <div className="glass-panel p-6 flex flex-col items-center justify-center text-center">
                  <Check className="h-8 w-8 text-success mb-2" />
                  <p className="text-sm font-medium">Everything looks clean</p>
                  <p className="text-xs text-muted-foreground mt-1">No duplicates, stale reviews, or parse errors found.</p>
                </div>
              )}

              {/* Duplicates */}
              <div className="glass-panel p-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <Copy className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      Duplicate transactions
                      {dupTotal > 0 && <Badge variant="secondary" className="text-[10px]">{dupTotal} clusters</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {summary.income.exactClusters.length} income · {summary.expenses.exactClusters.length} exact · {summary.expenses.nearClusters.length} possible · {summary.expenses.crossModePairs.length} cross-mode
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={dupTotal > 0 ? 'default' : 'outline'}
                  disabled={dupTotal === 0}
                  onClick={() => setResolverOpen(true)}
                  className="h-7 text-xs shrink-0"
                >
                  Review & resolve
                </Button>
              </div>

              {/* Needs Review */}
              <div className="glass-panel p-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <ListChecks className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Needs review</div>
                    <div className="text-xs text-muted-foreground">
                      {summary.needsReview.expenseCount} expenses · {summary.needsReview.incomeCount} income
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link to="/" onClick={onClose}>Expenses</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link to="/income" onClick={onClose}>Income</Link>
                  </Button>
                </div>
              </div>

              {/* Stale Reviews */}
              <div className="glass-panel p-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <Clock className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      Stale reviews
                      {summary.staleReviews.count > 0 && <Badge variant="secondary" className="text-[10px]">{summary.staleReviews.count}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {summary.staleReviews.count > 0
                        ? `Untouched 7+ days · oldest from ${summary.staleReviews.oldestDate}`
                        : 'No stale items.'}
                    </div>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" disabled={summary.staleReviews.count === 0} className="h-7 text-xs shrink-0">
                  <Link to="/" onClick={onClose}>Review</Link>
                </Button>
              </div>

              {/* Parse Errors */}
              <div className="glass-panel p-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <FileWarning className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2">
                      Parse errors
                      {summary.parseErrors.count > 0 && <Badge variant="destructive" className="text-[10px]">{summary.parseErrors.count}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {summary.parseErrors.count > 0 ? 'Rows that failed to import cleanly.' : 'All imports parsed cleanly.'}
                    </div>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" disabled={summary.parseErrors.count === 0} className="h-7 text-xs shrink-0">
                  <Link to="/" onClick={onClose}>View</Link>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {summary && (
        <DuplicateResolverDialog
          open={resolverOpen}
          onClose={() => setResolverOpen(false)}
          exactClusters={summary.expenses.exactClusters}
          nearClusters={summary.expenses.nearClusters}
          crossModePairs={summary.expenses.crossModePairs}
          rowIndex={summary.expenses.rowIndex}
          incomeClusters={summary.income.exactClusters}
          incomeRowIndex={summary.income.rowIndex}
          onResolved={() => { refresh(); }}
        />
      )}
    </>
  );
}
