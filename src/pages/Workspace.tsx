import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { CsvUploader } from '@/components/CsvUploader';
import { FileProgressList, type FileQueueItem } from '@/components/FileProgressList';
import { parseCsvFile } from '@/lib/csv-parser';
import { categorizeTransactions } from '@/lib/categorization-engine';
import { detectMethodFromFilename } from '@/lib/method-detector';
import { toast } from 'sonner';
import { ArrowLeft, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BatchSummary {
  id: string;
  file_name: string;
  uploaded_at: string;
  total_rows: number;
  auto_categorized_count: number;
  suggested_count: number;
  needs_review_count: number;
  approved_count: number;
}

export default function Workspace() {
  const { mode } = useParams<{ mode: 'personal' | 'business' }>();
  const { user } = useAuth();
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
  const processingRef = useRef(false);

  const validMode = mode === 'personal' || mode === 'business' ? mode : 'personal';
  const isProcessing = fileQueue.some(f => !['done', 'error'].includes(f.status));

  useEffect(() => {
    if (user) loadBatches();
  }, [user, validMode]);

  const loadBatches = async () => {
    const { data } = await supabase
      .from('upload_batches')
      .select('*')
      .eq('mode', validMode)
      .eq('owner_id', user!.id)
      .order('uploaded_at', { ascending: false })
      .limit(20);
    setBatches((data || []) as BatchSummary[]);
  };

  const updateItem = (id: string, patch: Partial<FileQueueItem>) => {
    setFileQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const processFile = async (item: FileQueueItem) => {
    if (!user) return;
    const { id, file, method } = item;

    try {
      // Parse
      updateItem(id, { status: 'parsing' });
      const parsed = await parseCsvFile(file);
      if (parsed.length === 0) {
        updateItem(id, { status: 'error', error: 'No valid rows found' });
        return;
      }

      // Dedup
      updateItem(id, { status: 'deduplicating' });
      const dates = parsed.map(r => r.date).filter(Boolean).sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      const existingKeys = new Set<string>();
      if (minDate && maxDate) {
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;
        while (hasMore) {
          const { data: existing } = await supabase
            .from('transactions_uploaded')
            .select('date, description_raw, amount')
            .eq('mode', validMode)
            .eq('owner_id', user.id)
            .gte('date', minDate)
            .lte('date', maxDate)
            .range(from, from + pageSize - 1);
          if (existing) {
            for (const row of existing) {
              existingKeys.add(`${row.date}|${row.description_raw}|${row.amount}`);
            }
          }
          hasMore = (existing?.length ?? 0) === pageSize;
          from += pageSize;
        }
      }

      const dedupedParsed = parsed.filter(
        row => !existingKeys.has(`${row.date}|${row.description_raw}|${row.amount}`)
      );
      const skippedCount = parsed.length - dedupedParsed.length;

      if (dedupedParsed.length === 0) {
        updateItem(id, { status: 'done', result: { batchId: '', total: 0, auto: 0, suggested: 0, review: 0, skipped: parsed.length } });
        toast.info(`${file.name}: all ${parsed.length} rows are duplicates`);
        return;
      }

      // Categorize
      updateItem(id, { status: 'categorizing' });
      const results = await categorizeTransactions(dedupedParsed, validMode, user.id);

      // Create batch
      updateItem(id, { status: 'inserting' });
      const autoCount = results.filter(r => r.review_status === 'auto_categorized').length;
      const suggestedCount = results.filter(r => r.review_status === 'suggested').length;
      const reviewCount = results.filter(r => r.review_status === 'needs_review').length;

      const { data: batch, error: batchError } = await supabase
        .from('upload_batches')
        .insert({
          mode: validMode,
          file_name: file.name,
          total_rows: dedupedParsed.length,
          auto_categorized_count: autoCount,
          suggested_count: suggestedCount,
          needs_review_count: reviewCount,
          owner_id: user.id,
        })
        .select()
        .single();

      if (batchError) throw batchError;

      // Insert transactions in chunks, override method from filename
      const chunkSize = 100;
      for (let i = 0; i < dedupedParsed.length; i += chunkSize) {
        const chunk = dedupedParsed.slice(i, i + chunkSize).map((tx, idx) => {
          const result = results[i + idx];
          const txMethod = method || result.predicted_method;
          return {
            upload_batch_id: batch.id,
            mode: validMode,
            date: tx.date,
            description_raw: tx.description_raw,
            description_normalized: tx.description_normalized,
            amount: tx.amount,
            predicted_category: result.predicted_category,
            predicted_method: txMethod,
            predicted_notes: result.predicted_notes,
            final_category: result.review_status === 'auto_categorized' ? result.predicted_category : null,
            final_method: result.review_status === 'auto_categorized' ? txMethod : null,
            final_notes: result.review_status === 'auto_categorized' ? result.predicted_notes : null,
            confidence: result.confidence,
            match_source: result.match_source,
            review_status: result.review_status,
            owner_id: user.id,
          };
        });

        const { error: txError } = await supabase
          .from('transactions_uploaded')
          .insert(chunk);
        if (txError) throw txError;
      }

      updateItem(id, {
        status: 'done',
        result: { batchId: batch.id, total: dedupedParsed.length, auto: autoCount, suggested: suggestedCount, review: reviewCount, skipped: skippedCount },
      });
    } catch (err: any) {
      updateItem(id, { status: 'error', error: err.message || 'Processing failed' });
    }
  };

  const processQueue = useCallback(async (items: FileQueueItem[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    for (const item of items) {
      await processFile(item);
    }
    await loadBatches();
    processingRef.current = false;
  }, [user, validMode]);

  const handleFilesSelect = (files: File[]) => {
    const newItems: FileQueueItem[] = files.map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'queued' as const,
      progress: 0,
      method: detectMethodFromFilename(file.name),
    }));
    setFileQueue(prev => [...newItems, ...prev]);
    processQueue(newItems);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-8 animate-fade-in">
        <div className="mb-6 flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-foreground capitalize">{validMode} Expenses</h1>
            <p className="text-sm text-muted-foreground">Upload and categorize {validMode} expense CSVs</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <CsvUploader onFilesSelect={handleFilesSelect} disabled={isProcessing} />
            <FileProgressList items={fileQueue} mode={validMode} />
          </div>

          {/* Upload History */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Upload History</h3>
            {batches.length === 0 ? (
              <div className="glass-panel-sm p-4 text-center text-sm text-muted-foreground">
                No uploads yet
              </div>
            ) : (
              batches.map(batch => (
                <Link
                  key={batch.id}
                  to={`/review?mode=${validMode}&batch=${batch.id}`}
                  className="glass-panel-sm p-3 block glow-hover"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground truncate max-w-[180px]">
                      {batch.file_name}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {batch.total_rows} rows
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-success">{batch.auto_categorized_count} auto</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-warning">{batch.suggested_count + batch.needs_review_count} review</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      {new Date(batch.uploaded_at).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
