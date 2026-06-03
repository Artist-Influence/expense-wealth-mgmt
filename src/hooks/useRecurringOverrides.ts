import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type OverrideStatus = 'confirmed' | 'dismissed';

/** Map of merchant_key -> status for the active owner + mode. */
export type OverrideMap = Record<string, OverrideStatus>;

/**
 * Loads and mutates the user's recurring-charge decisions (confirmed / dismissed)
 * for a given mode. Decisions are remembered in the `recurring_overrides` table and
 * are read-only for delegated accountants.
 *
 * `mode` may be 'all' (used by the Personal/Business/All scope toggle); in that case
 * both personal and business rows are loaded, and writes default to the row's own mode.
 */
export function useRecurringOverrides(mode: 'personal' | 'business' | 'all') {
  const { user, ownerId, isOwner } = useAuth();
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    let q = supabase
      .from('recurring_overrides')
      .select('merchant_key, status, mode')
      .eq('owner_id', ownerId);
    if (mode !== 'all') q = q.eq('mode', mode);
    const { data } = await q;
    const map: OverrideMap = {};
    (data || []).forEach((row) => {
      map[row.merchant_key] = row.status as OverrideStatus;
    });
    setOverrides(map);
    setLoading(false);
  }, [ownerId, mode]);

  useEffect(() => {
    if (user && ownerId) reload();
    else setLoading(false);
  }, [user, ownerId, reload]);

  // Persist a decision. `rowMode` is the concrete mode the merchant belongs to;
  // when the page is in 'all' scope, the caller passes the candidate's own mode.
  const setStatus = useCallback(
    async (merchantKey: string, status: OverrideStatus, rowMode?: 'personal' | 'business') => {
      if (!ownerId || !isOwner) return;
      const effectiveMode = rowMode || (mode === 'all' ? 'personal' : mode);
      setOverrides((prev) => ({ ...prev, [merchantKey]: status }));
      await supabase
        .from('recurring_overrides')
        .upsert(
          { owner_id: ownerId, mode: effectiveMode, merchant_key: merchantKey, status },
          { onConflict: 'owner_id,mode,merchant_key' },
        );
    },
    [ownerId, isOwner, mode],
  );

  // Clear a decision entirely (e.g. undo a removal back to "undecided").
  const clearStatus = useCallback(
    async (merchantKey: string, rowMode?: 'personal' | 'business') => {
      if (!ownerId || !isOwner) return;
      const effectiveMode = rowMode || (mode === 'all' ? 'personal' : mode);
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[merchantKey];
        return next;
      });
      await supabase
        .from('recurring_overrides')
        .delete()
        .eq('owner_id', ownerId)
        .eq('mode', effectiveMode)
        .eq('merchant_key', merchantKey);
    },
    [ownerId, isOwner, mode],
  );

  const confirm = useCallback(
    (key: string, rowMode?: 'personal' | 'business') => setStatus(key, 'confirmed', rowMode),
    [setStatus],
  );
  const dismiss = useCallback(
    (key: string, rowMode?: 'personal' | 'business') => setStatus(key, 'dismissed', rowMode),
    [setStatus],
  );
  const undo = clearStatus;

  return { overrides, loading, reload, confirm, dismiss, undo, canEdit: isOwner };
}
