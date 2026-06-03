import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type UsageProfile = 'personal' | 'business' | 'both';

/**
 * Reads the owner's chosen usage profile (personal / business / both) from
 * app_settings. Defaults to 'both' until loaded, so the full UI shows by default.
 */
export function useUsageProfile(): { profile: UsageProfile; loading: boolean } {
  const { ownerId } = useAuth();
  const [profile, setProfile] = useState<UsageProfile>('both');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ownerId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('usage_profile')
          .eq('owner_id', ownerId)
          .maybeSingle();
        if (cancelled) return;
        const v = (data as { usage_profile?: string } | null)?.usage_profile;
        if (v === 'personal' || v === 'business' || v === 'both') {
          setProfile(v);
        } else {
          setProfile('both');
        }
      } catch {
        if (!cancelled) setProfile('both');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  return { profile, loading };
}
