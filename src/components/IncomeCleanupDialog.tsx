import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetch-all';
import { detectTransfer } from '@/lib/transfer-detector';
import { classifyIncome } from '@/lib/income-classifier';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { AlertTriangle, Trash2, Wand2, FileWarning } from 'lucide-react';

// Money-OUT phrasing. Old imports Math.abs'd every row, so withdrawals and
// payments got stored as positive "income". These descriptions are
// unambiguous outflows — safe to flag for removal (with a preview + confirm).
const OUTFLOW_HINTS = /\b(withdrawal|atm\s*withdrawal|bill\s*pay|autopay|auto\s*pay|pos\s*(purchase|debit)|debit\s*card\s*purchase|checkcard|check\s*card|purchase\s*at|ach\s*debit|payment\s*to)\b/i;

type Row = {
  id: string; date: string | null; amount: number | null;
  description_raw: string | null; mode: string; source_file_name: string | null;
};

type ImportGroup = {
  key: string; name: string; mode: string; count: number; total: number;
  minDate: string | null; maxDate: string | null; ids: string[];
};

const fmt = (n: number) => '$' + Math.round(n).toLocaleString();

function reasonFor(desc: string): 'transfer' | 'outflow' | null {
  const d = desc || '';
  const t = detectTransfer(d);
  if (t.isTransfer) return 'transfer';
  if (classifyIncome(d).income_type === 'transfer') return 'transfer';
  if (OUTFLOW_HINTS.test(d)) return 'outflow';
  return null;
}

export function IncomeCleanupDialog({
  open, onClose, ownerId, onDone,
}: {
  open: boolean; onClose: () => void; ownerId: string | null; onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [nonIncome, setNonIncome] = useState<(Row & { reason: string })[]>([]);
  const [groups, setGroups] = useState<ImportGroup[]>([]);

  const scan = async () => {
    if (!ownerId) return;
    setLoading(true);
    try {
      const rows = await fetchAllRows<Row>((from, to) => supabase
        .from('income_transactions')
        .select('id, date, amount, description_raw, mode, source_file_name')
        .eq('owner_id', ownerId)
        .is('deleted_at', null)
        .order('id')
        .range(from, to));

      const flagged: (Row & { reason: string })[] = [];
      const byFile = new Map<string, ImportGroup>();
      for (const r of rows) {
        const reason = reasonFor(r.description_raw || '');
        if (reason) flagged.push({ ...r, reason });

        const name = r.source_file_name || '(manually added / unknown source)';
        const key = `${r.mode}|${name}`;
        const g = byFile.get(key) || { key, name, mode: r.mode, count: 0, total: 0, minDate: r.date, maxDate: r.date, ids: [] };
        g.count += 1;
        g.total += Math.abs(Number(r.amount) || 0);
        g.ids.push(r.id);
        if (r.date && (!g.minDate || r.date < g.minDate)) g.minDate = r.date;
        if (r.date && (!g.maxDate || r.date > g.maxDate)) g.maxDate = r.date;
        byFile.set(key, g);
      }
      setNonIncome(flagged);
      setGroups([...byFile.values()].sort((a, b) => b.count - a.count));
    } catch (e: any) {
      toast.error(`Scan failed: ${e?.message || 'unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) scan(); /* eslint-disable-next-line */ }, [open, ownerId]);

  const softDelete = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    setWorking(true);
    try {
      let failed = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.from('income_transactions')
          .update({ deleted_at: new Date().toISOString() } as never)
          .in('id', ids.slice(i, i + 200));
        if (error) failed += Math.min(200, ids.length - i);
      }
      if (failed > 0) toast.error(`Removed some, but ${failed} failed.`);
      else toast.success(`Removed ${ids.length} ${label}.`);
      onDone();
      await scan();
    } finally {
      setWorking(false);
    }
  };

  const removeNonIncome = () => {
    if (!confirm(`Remove ${nonIncome.length} row(s) that look like transfers, investments, or money going OUT — none of these are income. This can be undone by re-importing.`)) return;
    softDelete(nonIncome.map(r => r.id), 'non-income rows');
  };

  const deleteImport = (g: ImportGroup) => {
    if (!confirm(`Delete the entire "${g.name}" import (${g.count} ${g.mode} rows, ${fmt(g.total)})? Use this to wipe a bad statement so you can re-upload it cleanly.`)) return;
    softDelete(g.ids, `rows from ${g.name}`);
  };

  const personalFlagged = nonIncome.filter(r => r.mode === 'personal').length;
  const businessFlagged = nonIncome.filter(r => r.mode === 'business').length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto glass-panel">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Wand2 className="h-4 w-4 text-primary" /> Clean up income
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Scanning your income…</div>
        ) : (
          <div className="space-y-5">
            {/* Section A — auto-detected non-income */}
            <div className="glass-panel-sm p-3">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h3 className="text-sm font-medium text-foreground">Remove things that aren't income</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Transfers, moves into investments (Gemini, Wealthfront…), and withdrawals/payments that older
                imports wrongly counted as money earned.
              </p>
              {nonIncome.length === 0 ? (
                <p className="text-xs text-success">Nothing to remove — your income looks clean.</p>
              ) : (
                <>
                  <p className="text-xs text-foreground mb-2">
                    Found <span className="font-semibold text-warning">{nonIncome.length}</span> row(s)
                    ({personalFlagged} personal · {businessFlagged} business).
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded border border-border/30 divide-y divide-border/20 mb-2">
                    {nonIncome.slice(0, 40).map(r => (
                      <div key={r.id} className="flex items-center justify-between px-2 py-1 text-[11px]">
                        <span className="truncate max-w-[320px] text-muted-foreground" title={r.description_raw || ''}>
                          {r.description_raw || '—'}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-muted-foreground/70">{r.reason}</span>
                          <span className="font-mono text-foreground">{fmt(Math.abs(Number(r.amount) || 0))}</span>
                        </span>
                      </div>
                    ))}
                    {nonIncome.length > 40 && (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground">…and {nonIncome.length - 40} more</div>
                    )}
                  </div>
                  <Button size="sm" variant="destructive" disabled={working} onClick={removeNonIncome} className="gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Remove {nonIncome.length} non-income row{nonIncome.length === 1 ? '' : 's'}
                  </Button>
                </>
              )}
            </div>

            {/* Section B — delete a whole import */}
            <div className="glass-panel-sm p-3">
              <div className="flex items-center gap-2 mb-1">
                <FileWarning className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium text-foreground">Delete a whole import & re-upload</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                For a statement that came in wrong (e.g. the June 5373 file), delete it here, then re-upload it —
                the new import only keeps real money coming in.
              </p>
              {groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">No imports found.</p>
              ) : (
                <div className="space-y-1">
                  {groups.map(g => (
                    <div key={g.key} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-border/30 text-[11px]">
                      <div className="min-w-0">
                        <p className="truncate text-foreground" title={g.name}>{g.name}</p>
                        <p className="text-muted-foreground/70">
                          <span className="uppercase">{g.mode}</span> · {g.count} rows · {fmt(g.total)}
                          {g.minDate && g.maxDate ? ` · ${g.minDate} → ${g.maxDate}` : ''}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" disabled={working} onClick={() => deleteImport(g)} className="gap-1 shrink-0 h-7">
                        <Trash2 className="h-3 w-3" /> Delete
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
