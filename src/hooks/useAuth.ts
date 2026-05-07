import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useUserRole, type AppRole } from './useUserRole';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const initialised = useRef(false);
  const { role, roleLoading } = useUserRole(user);

  useEffect(() => {
    // Prevent double-init in StrictMode
    if (initialised.current) return;
    initialised.current = true;

    // 1. Restore session from storage first
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setReady(true);
    });

    // 2. Listen for subsequent changes (sign-in / sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

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
