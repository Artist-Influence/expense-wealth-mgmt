import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';
import type { ParsePreview } from '@/lib/csv-parser';

interface ImportPreviewDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  preview: ParsePreview | null;
  fileName: string;
  detectedMethod: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  amount: 'Amount',
  date: 'Date',
  category: 'Category',
  method: 'Method',
  notes: 'Notes',
};

export function ImportPreviewDialog({ open, onConfirm, onCancel, preview, fileName, detectedMethod }: ImportPreviewDialogProps) {
  if (!preview) return null;

  const hasBlockingErrors = preview.unmappedRequired.length > 0;

  return (
    <Dialog open={open} onOpenChange={v => !v && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Import Preview</DialogTitle>
          <DialogDescription className="text-xs">
            {fileName} · {preview.rowCount} rows detected
            {detectedMethod && (
              <Badge variant="secondary" className="ml-2 text-xs">{detectedMethod}</Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Column Mappings */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Column Mappings</h4>
            <div className="space-y-1.5">
              {Object.entries(preview.mapping).map(([field, csvCol]) => {
                const isRequired = ['description', 'amount', 'date'].includes(field);
                const isMapped = !!csvCol;
                return (
                  <div key={field} className="flex items-center gap-2 text-xs">
                    {isMapped ? (
                      <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
                    ) : isRequired ? (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border border-border shrink-0" />
                    )}
                    <span className="text-muted-foreground w-20">{FIELD_LABELS[field]}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                    <span className={isMapped ? 'text-foreground font-medium' : 'text-muted-foreground italic'}>
                      {csvCol || 'not found'}
                    </span>
                    {isRequired && !isMapped && (
                      <Badge variant="destructive" className="text-[10px] h-4">required</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sample Data */}
          {preview.sampleRows.length > 0 && !hasBlockingErrors && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Sample Data (first 3 rows)</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-border/40 rounded">
                  <thead>
                    <tr className="bg-secondary/30">
                      {preview.mapping.date && <th className="px-2 py-1 text-left text-muted-foreground">Date</th>}
                      {preview.mapping.description && <th className="px-2 py-1 text-left text-muted-foreground">Description</th>}
                      {preview.mapping.amount && <th className="px-2 py-1 text-right text-muted-foreground">Amount</th>}
                      {preview.mapping.category && <th className="px-2 py-1 text-left text-muted-foreground">Category</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => (
                      <tr key={i} className="border-t border-border/20">
                        {preview.mapping.date && (
                          <td className="px-2 py-1 text-muted-foreground font-mono">{row[preview.mapping.date] || '—'}</td>
                        )}
                        {preview.mapping.description && (
                          <td className="px-2 py-1 text-foreground max-w-[200px] truncate">{row[preview.mapping.description] || '—'}</td>
                        )}
                        {preview.mapping.amount && (
                          <td className="px-2 py-1 text-right font-mono text-foreground">{row[preview.mapping.amount] || '—'}</td>
                        )}
                        {preview.mapping.category && (
                          <td className="px-2 py-1 text-muted-foreground">{row[preview.mapping.category] || '—'}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {hasBlockingErrors && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive font-medium">Cannot import: missing required columns</p>
              <p className="text-xs text-destructive/80 mt-1">
                The CSV is missing: {preview.unmappedRequired.join(', ')}. Please check your file headers.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={onConfirm} disabled={hasBlockingErrors}>
            Import {preview.rowCount} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
