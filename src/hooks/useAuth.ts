import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useUserRole, type AppRole } from './useUserRole';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const { role, roleLoading } = useUserRole(user);
  const [effectiveOwnerId, setEffectiveOwnerId] = useState<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setReady(true);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Resolve effective owner ID for accountants
  useEffect(() => {
    if (!user || roleLoading) return;

    if (role === 'accountant') {
      let cancelled = false;
      supabase
        .from('profiles')
        .select('user_id')
        .eq('is_owner', true)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setEffectiveOwnerId(data?.user_id ?? null);
        });
      return () => { cancelled = true; };
    } else {
      setEffectiveOwnerId(user.id);
    }
  }, [user?.id, role, roleLoading]);

  const loading = !ready || roleLoading;

  const isAuthorized = !!role;
  const isInvestor = role === 'investor';
  const isOwner = role === 'owner';
  const isAccountant = role === 'accountant';

  // ownerId: the user ID to use in queries (owner's ID for accountants)
  const ownerId = effectiveOwnerId;

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return {
    user,
    loading,
    isAuthorized,
    isInvestor,
    isOwner,
    isAccountant,
    ownerId,
    role,
    signIn,
    signOut,
  };
}
