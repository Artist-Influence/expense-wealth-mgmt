import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Check, Trash2, X, FileText, Landmark, User, Briefcase } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { INCOME_TYPE_OPTIONS, TAXABLE_STATUS_OPTIONS, MODE_OPTIONS } from '@/lib/income-classifier';

// Structural subset of the page's IncomeTransaction — the parent passes its
// richer object, which is assignable to this.
interface IncomeTransaction {
  id: string;
  date: string | null;
  description_raw: string | null;
  amount: number | null;
  income_type: string;
  taxable_status: string;
  mode: string;
  source_account_name: string | null;
  status: string;
  notes: string | null;
  source_file_name: string | null;
}

interface IncomeDetailDrawerProps {
  transaction: IncomeTransaction | null;
  open: boolean;
  onClose: () => void;
  /** Page's reload — called after a successful save or delete so the list refreshes. */
  onSaved: () => void;
  readOnly?: boolean;
}

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

export function IncomeDetailDrawer({ transaction: tx, open, onClose, onSaved, readOnly }: IncomeDetailDrawerProps) {
  const [editValues, setEditValues] = useState({
    income_type: 'other',
    taxable_status: 'unknown',
    mode: 'personal',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever a different row is opened.
  useEffect(() => {
    if (tx) {
      setEditValues({
        income_type: tx.income_type || 'other',
        taxable_status: tx.taxable_status || 'unknown',
        mode: tx.mode || 'personal',
        notes: tx.notes || '',
      });
    }
  }, [tx?.id]);

  if (!tx) return null;

  const handleSave = async () => {
    if (saving || readOnly) return;
    setSaving(true);
    try {
      // Mirror the page's inline updateField — persist only the edited fields,
      // leave status untouched (same as updateField/bulkUpdate).
      const { error } = await supabase
        .from('income_transactions')
        .update({
          income_type: editValues.income_type,
          taxable_status: editValues.taxable_status,
          mode: editValues.mode,
          notes: editValues.notes || null,
        } as never)
        .eq('id', tx.id);
      if (error) { toast.error('Failed to save'); console.error(error); return; }
      toast.success('Income entry updated');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (saving || readOnly) return;
    if (!confirm('Delete this income transaction? This cannot be undone.')) return;
    setSaving(true);
    try {
      // Soft-delete via deleted_at — same pattern as the page's bulkDelete.
      const { error } = await supabase
        .from('income_transactions')
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', tx.id);
      if (error) { toast.error('Delete failed'); console.error(error); return; }
      toast.success('Income transaction deleted');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = (tx.status || '').replace(/_/g, ' ') || '—';

  return (
    <Sheet
      open={open}
      onOpenChange={v => {
        if (v) return;
        if (saving) return;
        onClose();
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-lg bg-background border-border overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-foreground text-base">Income</SheetTitle>
        </SheetHeader>

        {/* Summary — date, amount, status */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">{tx.date || '—'}</span>
            <span className="font-mono text-lg font-semibold text-success">
              {tx.amount != null ? fmt(tx.amount) : '—'}
            </span>
          </div>
          <Badge variant="outline" className="text-xs capitalize">{statusLabel}</Badge>
        </div>

        {/* Full raw description — NOT truncated, so the whole merchant string is readable */}
        <div className="mb-4">
          <Label className="text-[11px] text-muted-foreground">Full description</Label>
          <p className="mt-1 text-sm text-foreground break-words bg-secondary/30 rounded-md px-3 py-2 leading-relaxed">
            {tx.description_raw || '—'}
          </p>
        </div>

        {/* ============ Editable fields ============ */}
        <div className="space-y-4 mb-5">
          {/* Mode — Personal / Business */}
          <div>
            <Label className="text-xs font-medium text-foreground">Mode</Label>
            <div className="flex rounded-lg border border-border/40 overflow-hidden mt-1.5">
              {MODE_OPTIONS.map(o => {
                const Icon = o.value === 'business' ? Briefcase : User;
                const active = editValues.mode === o.value;
                return (
                  <button
                    key={o.value}
                    disabled={readOnly}
                    onClick={() => setEditValues(prev => ({ ...prev, mode: o.value }))}
                    className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors ${
                      active
                        ? o.value === 'business' ? 'bg-primary/20 text-primary' : 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Income type */}
          <div>
            <Label className="text-xs font-medium text-foreground">Income type</Label>
            <Select value={editValues.income_type} onValueChange={v => setEditValues(prev => ({ ...prev, income_type: v }))} disabled={readOnly}>
              <SelectTrigger className="mt-1.5 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCOME_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Taxable status */}
          <div>
            <Label className="text-xs font-medium text-foreground">Taxable status</Label>
            <Select value={editValues.taxable_status} onValueChange={v => setEditValues(prev => ({ ...prev, taxable_status: v }))} disabled={readOnly}>
              <SelectTrigger className="mt-1.5 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TAXABLE_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs font-medium text-foreground">Notes</Label>
            <Textarea
              value={editValues.notes}
              onChange={e => setEditValues(prev => ({ ...prev, notes: e.target.value }))}
              className="mt-1.5 text-sm min-h-[60px]"
              placeholder="Add notes..."
              disabled={readOnly}
            />
          </div>
        </div>

        {/* Source account / file — read-only context */}
        {(tx.source_account_name || tx.source_file_name) && (
          <div className="space-y-1.5 mb-4">
            {tx.source_account_name && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Landmark className="h-3 w-3" /> {tx.source_account_name}
              </p>
            )}
            {tx.source_file_name && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> {tx.source_file_name}
              </p>
            )}
          </div>
        )}

        <Separator className="mb-4" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving || readOnly} className="flex-1 h-9 text-sm gap-1.5">
            <Check className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
          </Button>
          {!readOnly && (
            <Button variant="destructive" onClick={handleDelete} disabled={saving} className="h-9 text-sm gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} className="h-9 text-sm">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
