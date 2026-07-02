import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type OverrideStatus = 'confirmed' | 'dismissed';
type RowMode = 'personal' | 'business';

interface OverrideRow {
  merchant_key: string;
  mode: RowMode;
  status: OverrideStatus;
}

/** Map of merchant_key -> status for the active owner + mode. */
export type OverrideMap = Record<string, OverrideStatus>;

/**
 * Loads and mutates the user's recurring-charge decisions (confirmed / dismissed).
 * Decisions live in the `recurring_overrides` table and are read-only for delegated
 * accountants.
 *
 * `mode` may be 'all' (used by the Personal/Business/All scope toggle); in that case
 * both personal and business rows are loaded. Use `statusFor(key, mode)` for precise,
 * mode-aware lookups; the flat `overrides` map (keyed by merchant_key) is convenient
 * for single-mode callers like the Insights page.
 */
export function useRecurringOverrides(mode: 'personal' | 'business' | 'all') {
  const { user, ownerId, isOwner } = useAuth();
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [loading, setLoading] = useState(true);

  const applyRows = useCallback((next: OverrideRow[]) => {
    setRows(next);
    const map: OverrideMap = {};
    next.forEach((r) => {
      map[r.merchant_key] = r.status;
    });
    setOverrides(map);
  }, []);

  const reload = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    let q = supabase
      .from('recurring_overrides')
      .select('merchant_key, status, mode')
      .eq('owner_id', ownerId);
    if (mode !== 'all') q = q.eq('mode', mode);
    const { data } = await q;
    applyRows((data || []) as OverrideRow[]);
    setLoading(false);
  }, [ownerId, mode, applyRows]);

  useEffect(() => {
    if (user && ownerId) reload();
    else setLoading(false);
  }, [user, ownerId, reload]);

  // Precise, mode-aware status lookup.
  const statusFor = useCallback(
    (merchantKey: string, rowMode: RowMode): OverrideStatus | undefined =>
      rows.find((r) => r.merchant_key === merchantKey && r.mode === rowMode)?.status,
    [rows],
  );

  const setStatus = useCallback(
    async (merchantKey: string, status: OverrideStatus, rowMode: RowMode) => {
      if (!ownerId || !isOwner) return;
      // Optimistic update — roll back if the write fails.
      const prev = rows;
      applyRows([
        ...rows.filter((r) => !(r.merchant_key === merchantKey && r.mode === rowMode)),
        { merchant_key: merchantKey, mode: rowMode, status },
      ]);
      const { error } = await supabase
        .from('recurring_overrides')
        .upsert(
          { owner_id: ownerId, mode: rowMode, merchant_key: merchantKey, status },
          { onConflict: 'owner_id,mode,merchant_key' },
        );
      if (error) {
        applyRows(prev);
        toast.error('Failed to save decision');
        console.error(error);
      }
    },
    [ownerId, isOwner, rows, applyRows],
  );

  // Clear a decision entirely (undo back to "undecided").
  const clearStatus = useCallback(
    async (merchantKey: string, rowMode: RowMode) => {
      if (!ownerId || !isOwner) return;
      // Optimistic update — roll back if the write fails.
      const prev = rows;
      applyRows(rows.filter((r) => !(r.merchant_key === merchantKey && r.mode === rowMode)));
      const { error } = await supabase
        .from('recurring_overrides')
        .delete()
        .eq('owner_id', ownerId)
        .eq('mode', rowMode)
        .eq('merchant_key', merchantKey);
      if (error) {
        applyRows(prev);
        toast.error('Failed to undo decision');
        console.error(error);
      }
    },
    [ownerId, isOwner, rows, applyRows],
  );

  const confirm = useCallback((key: string, rowMode: RowMode) => setStatus(key, 'confirmed', rowMode), [setStatus]);
  const dismiss = useCallback((key: string, rowMode: RowMode) => setStatus(key, 'dismissed', rowMode), [setStatus]);
  const undo = clearStatus;

  return { overrides, statusFor, loading, reload, confirm, dismiss, undo, canEdit: isOwner };
}
