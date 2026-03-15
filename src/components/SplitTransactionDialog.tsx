import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, AlertTriangle, Check } from 'lucide-react';

interface SplitRow {
  id: string;
  amount: number;
  mode: 'personal' | 'business' | 'reimbursable_work';
  category: string;
  notes: string;
  is_reimbursable: boolean;
  reimbursable_to: string;
  tax_treatment: string;
}

interface SplitTransactionDialogProps {
  open: boolean;
  onClose: () => void;
  transaction: {
    id: string;
    amount: number | null;
    date: string | null;
    description_raw: string | null;
    description_normalized: string | null;
    mode: string;
    source_file_name: string | null;
  } | null;
  categories: string[];
  onSplit: (parentId: string, children: SplitRow[]) => Promise<void>;
}

const MODE_LABELS: Record<string, string> = {
  personal: 'Personal',
  business: 'Business',
  reimbursable_work: 'Reimbursable',
};

const TAX_TREATMENTS = [
  'unknown', 'likely_deductible', 'likely_nondeductible',
  'excluded_reimbursement', 'capital_or_investment', 'transfer_nonexpense',
];

let nextId = 1;
function makeRow(mode: string, remaining: number): SplitRow {
  return {
    id: `split-${nextId++}`,
    amount: Math.round(remaining * 100) / 100,
    mode: (mode as SplitRow['mode']) || 'personal',
    category: '',
    notes: '',
    is_reimbursable: mode === 'reimbursable_work',
    reimbursable_to: mode === 'reimbursable_work' ? 'employer' : '',
    tax_treatment: 'unknown',
  };
}

export function SplitTransactionDialog({ open, onClose, transaction, categories, onSplit }: SplitTransactionDialogProps) {
  const totalAmount = Math.abs(transaction?.amount || 0);
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset rows when dialog opens
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  if (transaction && transaction.id !== lastTxId) {
    setLastTxId(transaction.id);
    const half = Math.round((totalAmount / 2) * 100) / 100;
    setRows([
      makeRow(transaction.mode, half),
      makeRow(transaction.mode, Math.round((totalAmount - half) * 100) / 100),
    ]);
  }

  const allocated = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const remaining = Math.round((totalAmount - allocated) * 100) / 100;
  const isBalanced = Math.abs(remaining) < 0.01;
  const hasEmptyAmounts = rows.some(r => r.amount <= 0);

  const updateRow = (id: string, patch: Partial<SplitRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const addRow = () => {
    setRows(prev => [...prev, makeRow('personal', Math.max(0, remaining))]);
  };

  const removeRow = (id: string) => {
    if (rows.length <= 2) return; // Minimum 2 splits
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const handleModeChange = (id: string, mode: SplitRow['mode']) => {
    const updates: Partial<SplitRow> = { mode };
    if (mode === 'reimbursable_work') {
      updates.is_reimbursable = true;
      updates.reimbursable_to = 'employer';
    } else {
      updates.is_reimbursable = false;
      updates.reimbursable_to = '';
    }
    updateRow(id, updates);
  };

  const handleSave = async () => {
    if (!transaction || !isBalanced || hasEmptyAmounts) return;
    setSaving(true);
    try {
      await onSplit(transaction.id, rows);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Split Transaction</DialogTitle>
        </DialogHeader>

        {/* Parent summary */}
        <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{transaction.date}</span>
            <span className="font-mono font-semibold text-foreground">${totalAmount.toFixed(2)}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{transaction.description_raw}</p>
        </div>

        {/* Balance indicator */}
        <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${
          isBalanced 
            ? 'border-primary/30 bg-primary/5 text-primary' 
            : 'border-warning/30 bg-warning/5 text-warning'
        }`}>
          <span>Allocated: ${allocated.toFixed(2)} / ${totalAmount.toFixed(2)}</span>
          {isBalanced ? (
            <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Balanced</span>
          ) : (
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {remaining > 0 ? `$${remaining.toFixed(2)} unallocated` : `$${Math.abs(remaining).toFixed(2)} over`}
            </span>
          )}
        </div>

        <Separator />

        {/* Split rows */}
        <div className="space-y-3">
          {rows.map((row, idx) => (
            <div key={row.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px]">Split {idx + 1}</Badge>
                {rows.length > 2 && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeRow(row.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={row.amount || ''}
                    onChange={e => updateRow(row.id, { amount: parseFloat(e.target.value) || 0 })}
                    className="h-8 text-sm font-mono"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Mode</Label>
                  <Select value={row.mode} onValueChange={v => handleModeChange(row.id, v as SplitRow['mode'])}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(MODE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Category</Label>
                  <Select value={row.category} onValueChange={v => updateRow(row.id, { category: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Tax Treatment</Label>
                  <Select value={row.tax_treatment} onValueChange={v => updateRow(row.id, { tax_treatment: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TAX_TREATMENTS.map(t => <SelectItem key={t} value={t} className="text-xs">{t.replace(/_/g, ' ')}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Notes</Label>
                  <Input
                    value={row.notes}
                    onChange={e => updateRow(row.id, { notes: e.target.value })}
                    className="h-8 text-xs"
                    placeholder="Split note..."
                  />
                </div>
              </div>

              {row.is_reimbursable && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] border-warning/30 text-warning">Reimbursable</Badge>
                  <Select value={row.reimbursable_to} onValueChange={v => updateRow(row.id, { reimbursable_to: v })}>
                    <SelectTrigger className="h-7 text-[10px] w-32"><SelectValue placeholder="To..." /></SelectTrigger>
                    <SelectContent>
                      {['employer', 'artist_influence', 'client', 'other'].map(o => (
                        <SelectItem key={o} value={o} className="text-xs">{o.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={addRow} className="w-full gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Split Row
        </Button>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !isBalanced || hasEmptyAmounts}
          >
            {saving ? 'Splitting…' : `Split into ${rows.length} Rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
