import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export type AppRole = 'owner' | 'investor' | 'accountant' | null;

export function useUserRole(user: User | null): { role: AppRole; roleLoading: boolean } {
  const [role, setRole] = useState<AppRole>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const lastUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const uid = user?.id ?? null;

    // Skip if user hasn't changed
    if (uid === lastUserId.current) return;
    lastUserId.current = uid;

    if (!uid) {
      setRole(null);
      setRoleLoading(false);
      return;
    }

    let cancelled = false;
    setRoleLoading(true);

    (async () => {
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', uid)
        .maybeSingle();

      if (!cancelled) {
        setRole((data?.role as AppRole) ?? null);
        setRoleLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  return { role, roleLoading };
}
