import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useUserRole, type AppRole } from './useUserRole';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const { role, roleLoading } = useUserRole(user);
  const [effectiveOwnerId, setEffectiveOwnerId] = useState<string | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    // Set up listener first
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // Only accept auth state changes after initial settle,
        // or if it's the first event
        if (!settled.current) {
          settled.current = true;
          setUser(session?.user ?? null);
          setReady(true);
        } else {
          // For subsequent events, only update if meaningful change
          setUser(prev => {
            const newId = session?.user?.id ?? null;
            const prevId = prev?.id ?? null;
            if (newId === prevId) return prev;
            return session?.user ?? null;
          });
        }
      }
    );

    // Also call getSession for the initial load
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        // Stale/broken session — clear it
        supabase.auth.signOut();
        setUser(null);
        setReady(true);
        settled.current = true;
        return;
      }
      if (!settled.current) {
        settled.current = true;
        setUser(session?.user ?? null);
        setReady(true);
      }
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
