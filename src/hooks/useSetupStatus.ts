import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Derives whether the owner has completed the minimum setup needed for
 * accurate categorization before uploading real statements:
 *   1. At least one payment method registered.
 *   2. At least one reference statement seeded (merchant_memory rows exist).
 *
 * Readiness is computed live from existing tables — no extra schema.
 * Only meaningful for owners; investors/accountants never see the gate.
 */
export function useSetupStatus() {
  const { ownerId, isOwner } = useAuth();
  const [hasMethods, setHasMethods] = useState(true);
  const [hasReferenceData, setHasReferenceData] = useState(true);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    const [methods, memory] = await Promise.all([
      supabase
        .from('payment_methods')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', ownerId),
      supabase
        .from('merchant_memory')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', ownerId),
    ]);
    setHasMethods((methods.count ?? 0) > 0);
    setHasReferenceData((memory.count ?? 0) > 0);
    setLoading(false);
  }, [ownerId]);

  useEffect(() => {
    if (ownerId && isOwner) reload();
    else setLoading(false);
  }, [ownerId, isOwner, reload]);

  const isReady = hasMethods && hasReferenceData;

  return { hasMethods, hasReferenceData, isReady, loading, reload };
}
