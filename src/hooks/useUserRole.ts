import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export type AppRole = 'owner' | 'investor' | null;

export function useUserRole(user: User | null): { role: AppRole; roleLoading: boolean } {
  const [role, setRole] = useState<AppRole>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRole(null);
      setRoleLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setRoleLoading(true);
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
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
