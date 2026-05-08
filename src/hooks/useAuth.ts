import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useUserRole, type AppRole } from './useUserRole';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const { role, roleLoading } = useUserRole(user);
  const [effectiveOwnerId, setEffectiveOwnerId] = useState<string | null>(null);
  const initialChecked = useRef(false);

  useEffect(() => {
    // Subscribe first so we don't miss events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const next = session?.user ?? null;
        setUser(prev => {
          const prevId = prev?.id ?? null;
          const nextId = next?.id ?? null;
          if (prevId === nextId) return prev;
          return next;
        });
        if (initialChecked.current) {
          // already past initial load, keep ready=true
        }
      }
    );

    // Authoritative initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(prev => {
        const next = session?.user ?? null;
        if ((prev?.id ?? null) === (next?.id ?? null)) return prev;
        return next;
      });
      initialChecked.current = true;
      setReady(true);
    }).catch(() => {
      initialChecked.current = true;
      setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Resolve effective owner ID for accountants
  useEffect(() => {
    if (!user) {
      setEffectiveOwnerId(null);
      return;
    }
    if (roleLoading) return;

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

  const loading = !ready || (!!user && roleLoading);

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
