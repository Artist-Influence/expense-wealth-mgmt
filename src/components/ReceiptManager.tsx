import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Paperclip, Eye, Trash2, Loader2 } from 'lucide-react';
import {
  uploadReceipt,
  getReceiptUrl,
  deleteReceipt,
  RECEIPT_ALLOWED_TYPES,
} from '@/lib/receipts';

interface ReceiptManagerProps {
  transactionId: string;
  ownerId: string | null;
  receiptPath: string | null;
  readOnly?: boolean;
  onChange?: (path: string | null) => void;
}

/**
 * Upload / view / remove a private receipt for a single transaction.
 * Files live in a private bucket; viewing uses short-lived signed URLs.
 */
export function ReceiptManager({ transactionId, ownerId, receiptPath, readOnly, onChange }: ReceiptManagerProps) {
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(receiptPath);

  const persist = async (newPath: string | null) => {
    const { error } = await supabase
      .from('transactions_uploaded')
      .update({ receipt_path: newPath, receipt_attached: !!newPath } as never)
      .eq('id', transactionId);
    if (error) { toast.error('Could not save receipt link'); return false; }
    setPath(newPath);
    onChange?.(newPath);
    // Privacy-safe audit (IDs + event only).
    if (ownerId) {
      await supabase.rpc('log_event', {
        _owner: ownerId,
        _event_type: newPath ? 'RECEIPT_ATTACH' : 'RECEIPT_REMOVE',
        _entity: 'transactions_uploaded',
        _entity_id: transactionId,
        _summary: null,
      });
    }
    return true;
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    const res = await uploadReceipt(file);
    if ('error' in res) { toast.error(res.error); setBusy(false); return; }
    // Point the DB at the new file BEFORE deleting the old one, so a failed
    // write never leaves the transaction referencing a deleted object.
    const oldPath = path;
    const ok = await persist(res.path);
    if (!ok) {
      // DB write failed — remove the orphaned new upload, keep the old file.
      await deleteReceipt(res.path).catch(() => {});
      setBusy(false);
      return;
    }
    if (oldPath) await deleteReceipt(oldPath).catch(() => {});
    toast.success('Receipt attached');
    setBusy(false);
  };

  const view = async () => {
    if (!path) return;
    setBusy(true);
    const url = await getReceiptUrl(path);
    setBusy(false);
    if (!url) { toast.error('Could not open receipt'); return; }
    if (ownerId) {
      supabase.rpc('log_event', {
        _owner: ownerId,
        _event_type: 'RECEIPT_VIEW',
        _entity: 'transactions_uploaded',
        _entity_id: transactionId,
        _summary: null,
      });
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const remove = async () => {
    if (!path) return;
    setBusy(true);
    // Clear the DB pointer first; only delete the object once nothing references it.
    const oldPath = path;
    const ok = await persist(null);
    if (!ok) { setBusy(false); return; }
    await deleteReceipt(oldPath).catch(() => {});
    setBusy(false);
    toast.success('Receipt removed');
  };

  return (
    <div className="flex items-center gap-2">
      {path ? (
        <>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={view} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            View receipt
          </Button>
          {!readOnly && (
            <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 text-destructive" onClick={remove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </>
      ) : (
        !readOnly && (
          <label className="inline-flex">
            <input
              type="file"
              accept={RECEIPT_ALLOWED_TYPES.join(',')}
              className="hidden"
              onChange={handleFile}
              disabled={busy}
            />
            <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs cursor-pointer hover:bg-secondary/40 transition-colors">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              Attach receipt
            </span>
          </label>
        )
      )}
    </div>
  );
}
