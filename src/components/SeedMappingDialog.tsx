import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { ColumnMapping, ParsePreview } from '@/lib/csv-parser';

interface SeedMappingDialogProps {
  open: boolean;
  preview: ParsePreview | null;
  mode: 'personal' | 'business';
  label: string;
  isIncome?: boolean;
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

const NONE_VALUE = '__none__';

const FIELDS: { key: keyof ColumnMapping; label: string; required: boolean }[] = [
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'date', label: 'Date', required: false },
  { key: 'category', label: 'Category', required: true },
  { key: 'method', label: 'Method', required: false },
  { key: 'notes', label: 'Notes', required: false },
];

export function SeedMappingDialog({ open, preview, mode, label, isIncome = false, onConfirm, onCancel }: SeedMappingDialogProps) {
  const [mapping, setMapping] = useState<ColumnMapping>(preview?.mapping ?? {
    description: null, amount: null, date: null, category: null, method: null, notes: null,
  });

  // Sync mapping when preview changes
  const [lastPreview, setLastPreview] = useState<ParsePreview | null>(null);
  if (preview && preview !== lastPreview) {
    setLastPreview(preview);
    setMapping(preview.mapping);
  }

  if (!preview) return null;

  const effectiveFields = FIELDS.map(f =>
    f.key === 'category' && isIncome ? { ...f, required: false } : f
  );
  const missingRequired = effectiveFields.filter(f => f.required && !mapping[f.key]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Map Columns — {label}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {preview.rowCount} rows detected · {preview.headers.length} columns
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {effectiveFields.map(field => (
            <div key={field.key} className="flex items-center gap-3">
              <Label className="text-xs w-24 shrink-0">
                {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <Select
                value={mapping[field.key] ?? NONE_VALUE}
                onValueChange={v => setMapping(m => ({ ...m, [field.key]: v === NONE_VALUE ? null : v }))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="— unmapped —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— unmapped —</SelectItem>
                  {preview.headers.map(h => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        {missingRequired.length > 0 && (
          <p className="text-xs text-destructive">
            Missing required: {missingRequired.map(f => f.label).join(', ')}
          </p>
        )}

        <div className="text-[11px] text-muted-foreground border rounded p-2 max-h-32 overflow-auto">
          <p className="font-medium mb-1">Sample row:</p>
          {preview.sampleRows[0] && Object.entries(preview.sampleRows[0]).map(([k, v]) => (
            <div key={k}><span className="text-foreground">{k}</span>: {v}</div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" disabled={missingRequired.length > 0} onClick={() => onConfirm(mapping)}>
            Confirm & Seed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
