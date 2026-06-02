import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, ArrowRight, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { ParsePreview } from '@/lib/csv-parser';
import { MethodSelect } from '@/components/MethodSelect';
import type { PaymentMethod } from '@/hooks/usePaymentMethods';

export interface FilePreviewInfo {
  file: File;
  preview: ParsePreview | null;
  error: string | null;
  method: string | null;
}

interface ImportPreviewDialogProps {
  open: boolean;
  onConfirm: (validIndexes: number[]) => void;
  onCancel: () => void;
  filePreviews: FilePreviewInfo[];
  paymentMethods?: PaymentMethod[];
  onMethodChange?: (index: number, method: string) => void;
}

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  amount: 'Amount',
  date: 'Date',
  category: 'Category',
  method: 'Method',
  notes: 'Notes',
};

export function ImportPreviewDialog({ open, onConfirm, onCancel, filePreviews, paymentMethods = [], onMethodChange }: ImportPreviewDialogProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (filePreviews.length === 0) return null;

  const validIndexes = filePreviews
    .map((fp, i) => ({ fp, i }))
    .filter(({ fp }) => fp.preview && fp.preview.unmappedRequired.length === 0)
    .map(({ i }) => i);

  const hasAnyValid = validIndexes.length > 0;
  const totalValidRows = validIndexes.reduce((sum, i) => sum + (filePreviews[i].preview?.rowCount || 0), 0);

  return (
    <Dialog open={open} onOpenChange={v => !v && onCancel()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Batch Import Preview</DialogTitle>
          <DialogDescription className="text-xs">
            {filePreviews.length} file{filePreviews.length !== 1 ? 's' : ''} · {validIndexes.length} ready · {totalValidRows} total rows
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {filePreviews.map((fp, idx) => {
            const isValid = fp.preview && fp.preview.unmappedRequired.length === 0;
            const isExpanded = expandedIdx === idx;
            const hasError = !!fp.error || (fp.preview && fp.preview.unmappedRequired.length > 0);

            return (
              <div key={idx} className={`border rounded-lg p-3 ${hasError ? 'border-destructive/30 bg-destructive/5' : 'border-border/40'}`}>
                {/* File header */}
                <button
                  className="flex items-center justify-between w-full text-left gap-2"
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isValid ? (
                      <CheckCircle className="h-4 w-4 text-success shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium text-foreground truncate">{fp.file.name}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {fp.method && <Badge variant="secondary" className="text-[10px]">{fp.method}</Badge>}
                    {fp.preview && (
                      <span className="text-[10px] text-muted-foreground">{fp.preview.rowCount} rows</span>
                    )}
                    {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </button>

                {/* Error summary */}
                {!isExpanded && fp.error && (
                  <p className="text-[10px] text-destructive mt-1 ml-6">{fp.error}</p>
                )}
                {!isExpanded && fp.preview && fp.preview.unmappedRequired.length > 0 && (
                  <p className="text-[10px] text-destructive mt-1 ml-6">
                    Missing: {fp.preview.unmappedRequired.join(', ')}
                  </p>
                )}

                {/* Expanded: column mappings */}
                {isExpanded && fp.preview && (
                  <div className="mt-3 space-y-3">
                    {onMethodChange && (
                      <div>
                        <h4 className="text-[10px] font-medium text-muted-foreground mb-1.5">Payment Method</h4>
                        <MethodSelect
                          value={fp.method || ''}
                          methods={paymentMethods}
                          onChange={v => onMethodChange(idx, v)}
                          className="h-8 text-xs"
                          placeholder="Auto-detect / select"
                        />
                      </div>
                    )}
                    <div>
                      <h4 className="text-[10px] font-medium text-muted-foreground mb-1.5">Column Mappings</h4>
                      <div className="space-y-1">
                        {Object.entries(fp.preview.mapping).map(([field, csvCol]) => {
                          const isRequired = ['description', 'amount', 'date'].includes(field);
                          const isMapped = !!csvCol;
                          return (
                            <div key={field} className="flex items-center gap-2 text-[11px]">
                              {isMapped ? (
                                <CheckCircle className="h-3 w-3 text-success shrink-0" />
                              ) : isRequired ? (
                                <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                              ) : (
                                <div className="h-3 w-3 rounded-full border border-border shrink-0" />
                              )}
                              <span className="text-muted-foreground w-20">{FIELD_LABELS[field]}</span>
                              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50" />
                              <span className={isMapped ? 'text-foreground font-medium' : 'text-muted-foreground italic'}>
                                {csvCol || 'not found'}
                              </span>
                              {isRequired && !isMapped && (
                                <Badge variant="destructive" className="text-[9px] h-3.5">required</Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sample rows */}
                    {isValid && fp.preview.sampleRows.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-medium text-muted-foreground mb-1.5">Sample (first 3)</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px] border border-border/40 rounded">
                            <thead>
                              <tr className="bg-secondary/30">
                                {fp.preview.mapping.date && <th className="px-1.5 py-0.5 text-left text-muted-foreground">Date</th>}
                                {fp.preview.mapping.description && <th className="px-1.5 py-0.5 text-left text-muted-foreground">Description</th>}
                                {fp.preview.mapping.amount && <th className="px-1.5 py-0.5 text-right text-muted-foreground">Amount</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {fp.preview.sampleRows.map((row, i) => (
                                <tr key={i} className="border-t border-border/20">
                                  {fp.preview!.mapping.date && (
                                    <td className="px-1.5 py-0.5 text-muted-foreground font-mono">{row[fp.preview!.mapping.date!] || '—'}</td>
                                  )}
                                  {fp.preview!.mapping.description && (
                                    <td className="px-1.5 py-0.5 text-foreground max-w-[160px] truncate">{row[fp.preview!.mapping.description!] || '—'}</td>
                                  )}
                                  {fp.preview!.mapping.amount && (
                                    <td className="px-1.5 py-0.5 text-right font-mono text-foreground">{row[fp.preview!.mapping.amount!] || '—'}</td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {fp.preview.unmappedRequired.length > 0 && (
                      <div className="p-2 rounded bg-destructive/10 border border-destructive/20">
                        <p className="text-[10px] text-destructive font-medium">Cannot import: missing required columns</p>
                        <p className="text-[10px] text-destructive/80 mt-0.5">
                          Missing: {fp.preview.unmappedRequired.join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Expanded: error */}
                {isExpanded && fp.error && (
                  <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/20">
                    <p className="text-[10px] text-destructive">{fp.error}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onConfirm(validIndexes)} disabled={!hasAnyValid}>
            Import {validIndexes.length} file{validIndexes.length !== 1 ? 's' : ''} · {totalValidRows} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
