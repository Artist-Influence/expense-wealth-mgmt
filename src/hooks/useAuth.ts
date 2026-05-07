import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useUserRole, type AppRole } from './useUserRole';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const { role, roleLoading } = useUserRole(user);

  useEffect(() => {
    // 1. Listen for auth changes (must be set up before getSession)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setReady(true);
      }
    );

    // 2. Restore session from storage
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Loading until initial session is restored AND role is resolved
  const loading = !ready || roleLoading;

  const isAuthorized = !!role;
  const isInvestor = role === 'investor';
  const isOwner = role === 'owner';

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
    role,
    signIn,
    signOut,
  };
}
