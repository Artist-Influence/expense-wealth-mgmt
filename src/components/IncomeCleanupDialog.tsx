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
// `payment to` is scoped to credit-card-payment context so an incoming wire
// like "WIRE PAYMENT TO ACME FROM CLIENT" isn't mistaken for money out.
// Exported so the income CSV import applies the exact same outflow check.
export const OUTFLOW_HINTS = /\b(withdrawal|atm\s*withdrawal|bill\s*pay|autopay|auto\s*pay|pos\s*(purchase|debit)|debit\s*card\s*purchase|checkcard|check\s*card|purchase\s*at|ach\s*debit|payment\s*to\b.*\b(?:card|crd|visa|mastercard|amex|chase|citi|discover|capital\s*one))\b/i;

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
  const d = (desc || '').trim();
  const u = d.toUpperCase();
  // Bank "Details/Type" values that mean money OUT — common when a checking
  // CSV's DEBIT/CREDIT column got imported as the description. DEBIT is always
  // an outflow; CHECK is a written check (money out). CREDIT stays (money in).
  if (u === 'DEBIT' || u === 'CHECK' || u.startsWith('DEBIT ')) return 'outflow';
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
  const [dupes, setDupes] = useState<Row[]>([]);
  const [groups, setGroups] = useState<ImportGroup[]>([]);
  // In-page confirmation (no native confirm() — nicer, and drivable via automation).
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDupes, setConfirmDupes] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

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
      const flaggedIds = new Set<string>();
      const byFile = new Map<string, ImportGroup>();
      for (const r of rows) {
        const reason = reasonFor(r.description_raw || '');
        if (reason) { flagged.push({ ...r, reason }); flaggedIds.add(r.id); }

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

      // Duplicate deposits: the SAME (mode, date, amount) imported twice — once
      // with a real merchant name, once as a bare "CREDIT" (from a Details
      // column). Keep the named one, flag the bare "CREDIT" twin for removal.
      const isBareCredit = (d: string | null) => /^credit$/i.test((d || '').trim());
      const isReal = (d: string | null) => {
        const s = (d || '').trim();
        return s.length > 3 && !/^(credit|debit|check)$/i.test(s);
      };
      const byAmt = new Map<string, Row[]>();
      for (const r of rows) {
        const k = `${r.mode}|${r.date || ''}|${Math.round((Number(r.amount) || 0) * 100)}`;
        const arr = byAmt.get(k) || [];
        arr.push(r);
        byAmt.set(k, arr);
      }
      const dupeList: Row[] = [];
      for (const arr of byAmt.values()) {
        if (arr.length < 2) continue;
        if (!arr.some(r => isReal(r.description_raw))) continue;
        for (const r of arr) {
          // Only the junk twin has a null source. A bare "CREDIT" that came from
          // a real statement (has a source_file_name) is a legit separate
          // deposit — never auto-flag it as a duplicate.
          if (isBareCredit(r.description_raw) && !r.source_file_name && !flaggedIds.has(r.id)) dupeList.push(r);
        }
      }

      setNonIncome(flagged);
      setDupes(dupeList);
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

  const removeNonIncome = async () => {
    setConfirmRemove(false);
    await softDelete(nonIncome.map(r => r.id), 'non-income rows');
  };

  const removeDupes = async () => {
    setConfirmDupes(false);
    await softDelete(dupes.map(r => r.id), 'duplicate deposits');
  };

  const deleteImport = async (g: ImportGroup) => {
    setConfirmDeleteKey(null);
    await softDelete(g.ids, `rows from ${g.name}`);
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
                  {confirmRemove ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-warning">Remove these {nonIncome.length}? (Restore later by re-importing.)</span>
                      <Button size="sm" variant="destructive" disabled={working} onClick={removeNonIncome} className="gap-1.5 h-7">
                        <Trash2 className="h-3.5 w-3.5" /> Yes, remove
                      </Button>
                      <Button size="sm" variant="outline" disabled={working} onClick={() => setConfirmRemove(false)} className="h-7">Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="destructive" disabled={working} onClick={() => setConfirmRemove(true)} className="gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" /> Remove {nonIncome.length} non-income row{nonIncome.length === 1 ? '' : 's'}
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Section A2 — duplicate deposits */}
            {dupes.length > 0 && (
              <div className="glass-panel-sm p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <h3 className="text-sm font-medium text-foreground">Remove duplicate deposits</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  The same deposit imported twice — once with a real name, once as a bare "CREDIT". Keeps the
                  named copy, removes the duplicate. Found <span className="font-semibold text-warning">{dupes.length}</span>.
                </p>
                {confirmDupes ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-warning">Remove these {dupes.length} duplicates?</span>
                    <Button size="sm" variant="destructive" disabled={working} onClick={removeDupes} className="gap-1.5 h-7">
                      <Trash2 className="h-3.5 w-3.5" /> Yes, remove
                    </Button>
                    <Button size="sm" variant="outline" disabled={working} onClick={() => setConfirmDupes(false)} className="h-7">Cancel</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="destructive" disabled={working} onClick={() => setConfirmDupes(true)} className="gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Remove {dupes.length} duplicate{dupes.length === 1 ? '' : 's'}
                  </Button>
                )}
              </div>
            )}

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
                      {confirmDeleteKey === g.key ? (
                        <span className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="destructive" disabled={working} onClick={() => deleteImport(g)} className="gap-1 h-7">Confirm</Button>
                          <Button size="sm" variant="outline" disabled={working} onClick={() => setConfirmDeleteKey(null)} className="h-7">Cancel</Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" disabled={working} onClick={() => setConfirmDeleteKey(g.key)} className="gap-1 shrink-0 h-7">
                          <Trash2 className="h-3 w-3" /> Delete
                        </Button>
                      )}
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
