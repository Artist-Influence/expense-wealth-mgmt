import { CheckCircle, AlertCircle, Loader2, FileText, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Link } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type FileStatus = 'queued' | 'parsing' | 'deduplicating' | 'categorizing' | 'inserting' | 'done' | 'error';

export interface FileQueueItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  method: string | null;
  result?: {
    batchId: string; total: number; auto: number; suggested: number; review: number;
    skipped: number; possibleDuplicates?: number; transfers?: number; parseErrors?: number;
  };
  error?: string;
}

const STATUS_LABELS: Record<FileStatus, string> = {
  queued: 'Queued',
  parsing: 'Parsing CSV…',
  deduplicating: 'Checking duplicates…',
  categorizing: 'Categorizing…',
  inserting: 'Saving…',
  done: 'Complete',
  error: 'Failed',
};

const STATUS_PROGRESS: Record<FileStatus, number> = {
  queued: 0,
  parsing: 15,
  deduplicating: 35,
  categorizing: 60,
  inserting: 85,
  done: 100,
  error: 0,
};

interface FileProgressListProps {
  items: FileQueueItem[];
  mode: string;
}

type SkippedRow = { date: string | null; amount: number; description: string; matched_id: string | null };

export function FileProgressList({ items, mode }: FileProgressListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [skippedDialogBatchId, setSkippedDialogBatchId] = useState<string | null>(null);
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  const [skippedLoading, setSkippedLoading] = useState(false);

  if (items.length === 0) return null;

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openSkipped = async (batchId: string) => {
    setSkippedDialogBatchId(batchId);
    setSkippedLoading(true);
    setSkippedRows([]);
    try {
      const { data } = await supabase
        .from('upload_batches')
        .select('parse_details')
        .eq('id', batchId)
        .maybeSingle();
      const detail = (data?.parse_details as any)?.exact_duplicates_detail;
      if (Array.isArray(detail)) setSkippedRows(detail as SkippedRow[]);
    } finally {
      setSkippedLoading(false);
    }
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {items.map(item => (
        <div key={item.id} className="glass-panel p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">{item.file.name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {item.method && (
                <Badge variant="secondary" className="text-xs">{item.method}</Badge>
              )}
              {item.status === 'done' && <CheckCircle className="h-4 w-4 text-success" />}
              {item.status === 'error' && <AlertCircle className="h-4 w-4 text-destructive" />}
              {!['done', 'error', 'queued'].includes(item.status) && (
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              )}
            </div>
          </div>

          {item.status !== 'queued' && (
            <Progress value={STATUS_PROGRESS[item.status]} className="h-1.5" />
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[item.status]}</span>
            {item.status === 'done' && item.result && (
              <button
                onClick={() => toggleExpand(item.id)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <span className="text-success">{item.result.total} imported</span>
                {expandedIds.has(item.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>

          {/* Expanded summary */}
          {item.status === 'done' && item.result && expandedIds.has(item.id) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pt-1 border-t border-border/30">
              <span className="text-muted-foreground">Auto-categorized</span>
              <span className="text-success text-right">{item.result.auto}</span>
              <span className="text-muted-foreground">Suggested</span>
              <span className="text-warning text-right">{item.result.suggested}</span>
              <span className="text-muted-foreground">Needs review</span>
              <span className="text-destructive text-right">{item.result.review}</span>
              {item.result.skipped > 0 && (
                <>
                  <span className="text-muted-foreground">Exact duplicates skipped</span>
                  <span className="text-muted-foreground text-right">{item.result.skipped}</span>
                </>
              )}
              {(item.result.possibleDuplicates ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground">Possible duplicates</span>
                  <span className="text-warning text-right">{item.result.possibleDuplicates}</span>
                </>
              )}
              {(item.result.transfers ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground">Transfers detected</span>
                  <span className="text-primary text-right">{item.result.transfers}</span>
                </>
              )}
              {(item.result.parseErrors ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground">Parse errors</span>
                  <span className="text-destructive text-right">{item.result.parseErrors}</span>
                </>
              )}
            </div>
          )}

          {item.status === 'error' && item.error && (
            <p className="text-xs text-destructive">{item.error}</p>
          )}

          {item.status === 'done' && item.result && item.result.batchId && (
            <Button asChild variant="outline" size="sm" className="w-full mt-1">
              <Link to={`/review?mode=${mode}&batch=${item.result.batchId}`}>
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Review {item.result.total} rows
              </Link>
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
