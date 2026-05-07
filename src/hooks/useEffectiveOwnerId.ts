import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

/**
 * Returns the owner_id to use in queries.
 * - For the owner: their own user ID
 * - For accountants: the actual owner's user ID (so they see the owner's data)
 * - For investors: their own user ID (investor portal has its own logic)
 */
export function useEffectiveOwnerId(): string | null {
  const { user, role, isAccountant } = useAuth();
  const [ownerId, setOwnerId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setOwnerId(null);
      return;
    }

    if (!isAccountant) {
      setOwnerId(user.id);
      return;
    }

    // Accountant: look up the actual owner's user_id from profiles
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('is_owner', true)
        .maybeSingle();
      if (!cancelled) {
        setOwnerId(data?.user_id ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, isAccountant, role]);

  return ownerId;
}
