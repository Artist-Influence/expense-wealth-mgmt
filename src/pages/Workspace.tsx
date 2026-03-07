import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { CsvUploader } from '@/components/CsvUploader';
import { FileProgressList, type FileQueueItem } from '@/components/FileProgressList';
import { ImportPreviewDialog } from '@/components/ImportPreviewDialog';
import { previewCsvFile, parseCsvFileWithMapping, type ParsePreview, type ColumnMapping } from '@/lib/csv-parser';
import { categorizeTransactions } from '@/lib/categorization-engine';
import { detectMethodFromFilename } from '@/lib/method-detector';
import { detectTransfer } from '@/lib/transfer-detector';
import { generateFingerprint, isNearDuplicate } from '@/lib/duplicate-detector';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface BatchSummary {
  id: string;
  file_name: string;
  uploaded_at: string;
  total_rows: number;
  auto_categorized_count: number;
  suggested_count: number;
  needs_review_count: number;
  approved_count: number;
  exact_duplicates_skipped: number;
  possible_duplicates_flagged: number;
  transfers_detected: number;
  parse_errors: number;
}

export default function Workspace() {
  const { mode } = useParams<{ mode: 'personal' | 'business' }>();
  const { user } = useAuth();
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [fileQueue, setFileQueue] = useState<FileQueueItem[]>([]);
  const processingRef = useRef(false);

  // Import preview state
  const [previewData, setPreviewData] = useState<ParsePreview | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewMethod, setPreviewMethod] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const validMode = mode === 'personal' || mode === 'business' ? mode : 'personal';
  const isProcessing = fileQueue.some(f => !['done', 'error'].includes(f.status));

  const totalFiles = fileQueue.length;
  const completedFiles = fileQueue.filter(f => f.status === 'done' || f.status === 'error').length;
  const overallProgress = totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;

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

  const loadSettings = async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('prevent_exact_duplicates, flag_possible_duplicates, exclude_transfers_from_totals')
      .eq('owner_id', user!.id)
      .maybeSingle();
    return {
      preventExactDuplicates: data?.prevent_exact_duplicates ?? true,
      flagPossibleDuplicates: data?.flag_possible_duplicates ?? true,
      excludeTransfers: data?.exclude_transfers_from_totals ?? true,
    };
  };

  const processFile = async (item: FileQueueItem, mapping: ColumnMapping) => {
    if (!user) return;
    const { id, file, method } = item;

    try {
      const appSettings = await loadSettings();

      // Parse with confirmed mapping
      updateItem(id, { status: 'parsing' });
      const parsed = await parseCsvFileWithMapping(file, mapping);

      const validRows = parsed.filter(r => r.parse_status === 'ok');
      const parseErrorRows = parsed.filter(r => r.parse_status === 'parse_error');

      if (validRows.length === 0) {
        updateItem(id, { status: 'error', error: `No valid rows. ${parseErrorRows.length} parse errors.` });
        return;
      }

      // Dedup
      updateItem(id, { status: 'deduplicating' });
      const dates = validRows.map(r => r.date).filter(Boolean).sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      // Load existing transactions for dedup
      const existingFingerprints = new Set<string>();
      const existingForNearDup: { date: string | null; amount: number; description_normalized: string; id: string; fingerprint: string }[] = [];

      if (minDate && maxDate) {
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;
        while (hasMore) {
          const { data: existing } = await supabase
            .from('transactions_uploaded')
            .select('id, date, description_raw, description_normalized, amount, duplicate_fingerprint')
            .eq('mode', validMode)
            .eq('owner_id', user.id)
            .gte('date', minDate)
            .lte('date', maxDate)
            .range(from, from + pageSize - 1);
          if (existing) {
            for (const row of existing) {
              const fp = row.duplicate_fingerprint || generateFingerprint(validMode, row.date, row.amount ?? 0, row.description_normalized || '');
              existingFingerprints.add(fp);
              existingForNearDup.push({
                date: row.date,
                amount: row.amount ?? 0,
                description_normalized: row.description_normalized || '',
                id: row.id,
                fingerprint: fp,
              });
            }
          }
          hasMore = (existing?.length ?? 0) === pageSize;
          from += pageSize;
        }
      }

      // Classify each row for duplicates
      let exactDupCount = 0;
      let possibleDupCount = 0;
      const rowsToInsert: typeof validRows = [];
      const dupStatuses: Map<number, { status: string; matchId: string | null }> = new Map();

      for (let i = 0; i < validRows.length; i++) {
        const tx = validRows[i];
        const fp = generateFingerprint(validMode, tx.date, tx.amount, tx.description_normalized);

        if (appSettings.preventExactDuplicates && existingFingerprints.has(fp)) {
          exactDupCount++;
          continue; // skip
        }

        let nearDupMatch: string | null = null;
        if (appSettings.flagPossibleDuplicates) {
          for (const existing of existingForNearDup) {
            if (existing.fingerprint === fp) continue;
            if (isNearDuplicate(tx, existing)) {
              nearDupMatch = existing.id;
              possibleDupCount++;
              break;
            }
          }
        }

        dupStatuses.set(rowsToInsert.length, {
          status: nearDupMatch ? 'possible_duplicate' : 'unique',
          matchId: nearDupMatch,
        });
        rowsToInsert.push(tx);
        // Add to existing set to prevent intra-batch duplicates
        existingFingerprints.add(fp);
      }

      if (rowsToInsert.length === 0) {
        updateItem(id, {
          status: 'done',
          result: {
            batchId: '', total: 0, auto: 0, suggested: 0, review: 0,
            skipped: exactDupCount, possibleDuplicates: possibleDupCount,
            transfers: 0, parseErrors: parseErrorRows.length,
          },
        });
        toast.info(`${file.name}: all ${parsed.length} rows are duplicates`);
        return;
      }

      // Categorize
      updateItem(id, { status: 'categorizing' });
      const results = await categorizeTransactions(rowsToInsert, validMode, user.id);

      // Detect transfers
      let transferCount = 0;

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
          total_rows: rowsToInsert.length,
          auto_categorized_count: autoCount,
          suggested_count: suggestedCount,
          needs_review_count: reviewCount,
          exact_duplicates_skipped: exactDupCount,
          possible_duplicates_flagged: possibleDupCount,
          transfers_detected: 0,
          parse_errors: parseErrorRows.length,
          owner_id: user.id,
        })
        .select()
        .single();

      if (batchError) throw batchError;

      // Insert transactions in chunks
      const chunkSize = 100;
      for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
        const chunk = rowsToInsert.slice(i, i + chunkSize).map((tx, idx) => {
          const globalIdx = i + idx;
          const result = results[globalIdx];
          const txMethod = method || result.predicted_method;
          const dupInfo = dupStatuses.get(globalIdx) || { status: 'unique', matchId: null };
          const fp = generateFingerprint(validMode, tx.date, tx.amount, tx.description_normalized);

          // Transfer detection
          const transfer = detectTransfer(tx.description_raw);
          if (transfer.isTransfer) transferCount++;

          return {
            upload_batch_id: batch.id,
            mode: validMode,
            date: tx.date,
            description_raw: tx.description_raw,
            description_normalized: tx.description_normalized,
            amount: tx.amount,
            predicted_category: transfer.isTransfer ? 'Transfer' : result.predicted_category,
            predicted_method: txMethod,
            predicted_notes: result.predicted_notes,
            final_category: result.review_status === 'auto_categorized' ? (transfer.isTransfer ? 'Transfer' : result.predicted_category) : null,
            final_method: result.review_status === 'auto_categorized' ? txMethod : null,
            final_notes: result.review_status === 'auto_categorized' ? result.predicted_notes : null,
            confidence: result.confidence,
            match_source: result.match_source,
            review_status: result.review_status,
            owner_id: user.id,
            source_row_json: tx.source_row_json,
            source_file_name: file.name,
            parse_status: tx.parse_status,
            parse_error: tx.parse_error,
            duplicate_fingerprint: fp,
            duplicate_status: dupInfo.status,
            duplicate_of_transaction_id: dupInfo.matchId,
            is_transfer: transfer.isTransfer,
            exclude_from_expense_totals: transfer.isTransfer && appSettings.excludeTransfers,
            transfer_type: transfer.transferType,
          };
        });

        const { error: txError } = await supabase
          .from('transactions_uploaded')
          .insert(chunk);
        if (txError) throw txError;
      }

      // Update batch with transfer count
      if (transferCount > 0) {
        await supabase.from('upload_batches').update({ transfers_detected: transferCount }).eq('id', batch.id);
      }

      updateItem(id, {
        status: 'done',
        result: {
          batchId: batch.id, total: rowsToInsert.length, auto: autoCount,
          suggested: suggestedCount, review: reviewCount, skipped: exactDupCount,
          possibleDuplicates: possibleDupCount, transfers: transferCount,
          parseErrors: parseErrorRows.length,
        },
      });
    } catch (err: any) {
      updateItem(id, { status: 'error', error: err.message || 'Processing failed' });
    }
  };

  const processQueue = useCallback(async (items: FileQueueItem[], mapping: ColumnMapping) => {
    if (processingRef.current) return;
    processingRef.current = true;
    for (const item of items) {
      await processFile(item, mapping);
    }
    await loadBatches();
    processingRef.current = false;
  }, [user, validMode]);

  const handleFilesSelect = async (files: File[]) => {
    // Show preview for first file to confirm mapping
    const firstFile = files[0];
    try {
      const preview = await previewCsvFile(firstFile);
      setPreviewData(preview);
      setPreviewFile(firstFile);
      setPreviewMethod(detectMethodFromFilename(firstFile.name));
      setPendingFiles(files);
      setShowPreview(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handlePreviewConfirm = () => {
    if (!previewData || pendingFiles.length === 0) return;
    setShowPreview(false);

    const mapping = previewData.mapping;
    const newItems: FileQueueItem[] = pendingFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'queued' as const,
      progress: 0,
      method: detectMethodFromFilename(file.name),
    }));
    setFileQueue(prev => [...newItems, ...prev]);
    processQueue(newItems, mapping);

    setPreviewData(null);
    setPreviewFile(null);
    setPendingFiles([]);
  };

  const handlePreviewCancel = () => {
    setShowPreview(false);
    setPreviewData(null);
    setPreviewFile(null);
    setPendingFiles([]);
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

            {/* Overall progress */}
            {totalFiles > 0 && (
              <div className="glass-panel p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{completedFiles} / {totalFiles} files processed</span>
                  <span>{overallProgress}%</span>
                </div>
                <Progress value={overallProgress} className="h-1.5" />
              </div>
            )}

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
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="text-success">{batch.auto_categorized_count} auto</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-warning">{batch.suggested_count + batch.needs_review_count} review</span>
                    {(batch.exact_duplicates_skipped > 0) && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{batch.exact_duplicates_skipped} dupes</span>
                      </>
                    )}
                    {(batch.transfers_detected > 0) && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-primary">{batch.transfers_detected} transfers</span>
                      </>
                    )}
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

      <ImportPreviewDialog
        open={showPreview}
        onConfirm={handlePreviewConfirm}
        onCancel={handlePreviewCancel}
        preview={previewData}
        fileName={previewFile?.name || ''}
        detectedMethod={previewMethod}
      />
    </div>
  );
}
