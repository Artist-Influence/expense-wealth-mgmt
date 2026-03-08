import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Check, X, ArrowLeftRight, AlertTriangle, Ban, FileText,
  Brain, History, BookOpen, Zap, Bot
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
  match_explanation?: string | null;
  review_status: string;
  mode: string;
  parse_status: string | null;
  duplicate_status: string | null;
  is_transfer: boolean | null;
  exclude_from_expense_totals: boolean | null;
  transfer_type: string | null;
  source_file_name: string | null;
}

interface TransactionDetailDrawerProps {
  transaction: Transaction | null;
  open: boolean;
  onClose: () => void;
  categories: string[];
  onSave: (id: string, values: { category: string; method: string; notes: string }) => Promise<void>;
  onApprove: (tx: Transaction) => Promise<void>;
  onToggleTransfer: (tx: Transaction) => Promise<void>;
}

const matchSourceLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  exact_history: { label: 'Exact Historical Match', icon: <History className="h-3.5 w-3.5" />, color: 'text-green-400' },
  normalized_history: { label: 'Normalized Merchant Match', icon: <BookOpen className="h-3.5 w-3.5" />, color: 'text-emerald-400' },
  partial_history: { label: 'Partial Merchant Match', icon: <BookOpen className="h-3.5 w-3.5" />, color: 'text-teal-400' },
  rule: { label: 'Rule Match', icon: <Zap className="h-3.5 w-3.5" />, color: 'text-amber-400' },
  ai: { label: 'AI Suggestion', icon: <Bot className="h-3.5 w-3.5" />, color: 'text-purple-400' },
};

export function TransactionDetailDrawer({
  transaction: tx,
  open,
  onClose,
  categories,
  onSave,
  onApprove,
  onToggleTransfer,
}: TransactionDetailDrawerProps) {
  const [editValues, setEditValues] = useState({ category: '', method: '', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tx) {
      setEditValues({
        category: tx.final_category || tx.predicted_category || '',
        method: tx.final_method || tx.predicted_method || '',
        notes: tx.final_notes || tx.predicted_notes || '',
      });
    }
  }, [tx?.id]);

  if (!tx) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(tx.id, editValues);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    setSaving(true);
    try {
      // Set values first if changed, then approve
      await onSave(tx.id, editValues);
      await onApprove({ ...tx, final_category: editValues.category, final_method: editValues.method, final_notes: editValues.notes });
    } finally {
      setSaving(false);
    }
  };

  const confidencePercent = tx.confidence != null ? Math.round(tx.confidence) : null;
  const confidenceColor = confidencePercent === null ? 'bg-muted' :
    confidencePercent >= 90 ? 'bg-green-500' :
    confidencePercent >= 70 ? 'bg-amber-500' : 'bg-destructive';

  const matchInfo = tx.match_source ? matchSourceLabels[tx.match_source] : null;

  const statusLabel = tx.review_status.replace(/_/g, ' ');

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg bg-background border-border overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-foreground flex items-center gap-2 text-base">
            Transaction Detail
          </SheetTitle>
        </SheetHeader>

        {/* Header row: date, amount, status */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">{tx.date || '—'}</span>
            <span className="font-mono text-lg font-semibold text-foreground">
              ${tx.amount != null ? Math.abs(tx.amount).toFixed(2) : '0.00'}
            </span>
          </div>
          <Badge variant="outline" className="text-xs capitalize">{statusLabel}</Badge>
        </div>

        <Separator className="mb-4" />

        {/* Full raw description */}
        <div className="space-y-3 mb-4">
          <div>
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Raw Description</Label>
            <p className="text-sm text-foreground mt-1 break-words font-mono bg-secondary/30 rounded-md p-2.5 leading-relaxed">
              {tx.description_raw || '—'}
            </p>
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Normalized Merchant Key</Label>
            <p className="text-xs text-muted-foreground mt-1 font-mono bg-secondary/20 rounded px-2 py-1.5">
              {tx.description_normalized || '—'}
            </p>
          </div>
        </div>

        <Separator className="mb-4" />

        {/* Categorization reason */}
        {(matchInfo || tx.match_explanation) && (
          <div className="mb-4 space-y-2">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Why This Category</Label>
            {matchInfo && (
              <div className={`flex items-center gap-2 text-xs ${matchInfo.color}`}>
                {matchInfo.icon}
                <span>{matchInfo.label}</span>
              </div>
            )}
            {tx.match_explanation && (
              <p className="text-xs text-muted-foreground bg-secondary/20 rounded px-2 py-1.5 leading-relaxed">
                {tx.match_explanation}
              </p>
            )}
            {confidencePercent !== null && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${confidenceColor}`} style={{ width: `${confidencePercent}%` }} />
                </div>
                <span className="text-xs font-mono text-muted-foreground">{confidencePercent}%</span>
              </div>
            )}
          </div>
        )}

        <Separator className="mb-4" />

        {/* Editable fields */}
        <div className="space-y-3 mb-4">
          <div>
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Category</Label>
            <Select value={editValues.category} onValueChange={v => setEditValues(prev => ({ ...prev, category: v }))}>
              <SelectTrigger className="mt-1 h-9 text-sm">
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tx.predicted_category && tx.predicted_category !== editValues.category && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Predicted: <span className="text-foreground">{tx.predicted_category}</span>
              </p>
            )}
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Method</Label>
            <Input
              value={editValues.method}
              onChange={e => setEditValues(prev => ({ ...prev, method: e.target.value }))}
              className="mt-1 h-9 text-sm"
              placeholder="e.g. Chase Visa, PayPal"
            />
          </div>

          <div>
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Notes</Label>
            <Textarea
              value={editValues.notes}
              onChange={e => setEditValues(prev => ({ ...prev, notes: e.target.value }))}
              className="mt-1 text-sm min-h-[60px]"
              placeholder="Add notes..."
            />
          </div>
        </div>

        <Separator className="mb-4" />

        {/* Flags */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {tx.is_transfer && (
            <Badge variant="outline" className="text-xs gap-1 border-primary/30 text-primary">
              <ArrowLeftRight className="h-3 w-3" /> Transfer ({tx.transfer_type || 'unknown'})
            </Badge>
          )}
          {tx.duplicate_status === 'possible_duplicate' && (
            <Badge variant="outline" className="text-xs gap-1 border-warning/30 text-warning">
              <AlertTriangle className="h-3 w-3" /> Possible Duplicate
            </Badge>
          )}
          {tx.parse_status === 'parse_error' && (
            <Badge variant="destructive" className="text-xs">Parse Error</Badge>
          )}
          {!tx.final_category && !tx.predicted_category && tx.match_source && (
            <Badge variant="outline" className="text-xs gap-1 border-destructive/30 text-destructive">
              <Ban className="h-3 w-3" /> Category Rejected
            </Badge>
          )}
          {tx.exclude_from_expense_totals && (
            <Badge variant="outline" className="text-xs text-muted-foreground">Excluded from totals</Badge>
          )}
        </div>

        {/* Source file */}
        {tx.source_file_name && (
          <div className="mb-4">
            <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Source File</Label>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <FileText className="h-3 w-3" /> {tx.source_file_name}
            </p>
          </div>
        )}

        <Separator className="mb-4" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1 h-9 text-sm gap-1.5">
            <Check className="h-3.5 w-3.5" /> Save
          </Button>
          {!['approved', 'edited'].includes(tx.review_status) && (
            <Button onClick={handleApprove} disabled={saving || !editValues.category} variant="secondary" className="flex-1 h-9 text-sm gap-1.5">
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
          )}
          <Button variant="outline" onClick={() => onToggleTransfer(tx)} className="h-9 text-sm gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" /> {tx.is_transfer ? 'Restore' : 'Transfer'}
          </Button>
          <Button variant="ghost" onClick={onClose} className="h-9 text-sm">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
