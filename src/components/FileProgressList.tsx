import { CheckCircle, AlertCircle, Loader2, FileText } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Eye } from 'lucide-react';

export type FileStatus = 'queued' | 'parsing' | 'deduplicating' | 'categorizing' | 'inserting' | 'done' | 'error';

export interface FileQueueItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  method: string | null;
  result?: { batchId: string; total: number; auto: number; suggested: number; review: number; skipped: number };
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

export function FileProgressList({ items, mode }: FileProgressListProps) {
  if (items.length === 0) return null;

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
              <div className="flex items-center gap-2 text-xs">
                <span className="text-success">{item.result.auto} auto</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-warning">{item.result.suggested} suggested</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-destructive">{item.result.review} review</span>
                {item.result.skipped > 0 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{item.result.skipped} dupes</span>
                  </>
                )}
              </div>
            )}
          </div>

          {item.status === 'error' && item.error && (
            <p className="text-xs text-destructive">{item.error}</p>
          )}

          {item.status === 'done' && item.result && (
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
