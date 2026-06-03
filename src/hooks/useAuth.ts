import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

export type AppRole = 'owner' | 'investor' | 'accountant' | null;

/**
 * Access model (multi-tenant):
 * - Every authenticated user OWNS their own data (rows where owner_id = auth.uid()).
 *   Such a user has role 'owner' and ownerId = their own id, with full read/write.
 * - A user may instead be a DELEGATE: granted read access to a specific owner's data
 *   via the delegated_access table. Delegates are read-only and see only that owner.
 *     - 'accountant' = full read of the owner's data
 *     - 'investor'   = business-scoped read of the owner's data
 *
 * Authorization is never trusted from the client for data access — it is enforced by
 * RLS. These flags only drive UI affordances.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<AppRole>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const initialChecked = useRef(false);
  const lastResolvedFor = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Subscribe first so we don't miss events.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const next = session?.user ?? null;
        setUser(prev => {
          const prevId = prev?.id ?? null;
          const nextId = next?.id ?? null;
          if (prevId === nextId) return prev;
          return next;
        });
      },
    );

    // Authoritative initial session check.
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

  // Resolve role + effective owner from delegated_access.
  useEffect(() => {
    const uid = user?.id ?? null;
    if (uid === lastResolvedFor.current) return;
    lastResolvedFor.current = uid;

    if (!uid) {
      setRole(null);
      setOwnerId(null);
      setAccessLoading(false);
      return;
    }

    let cancelled = false;
    setAccessLoading(true);

    (async () => {
      try {
        // Is this user a delegate for someone else's data?
        const { data, error } = await supabase
          .from('delegated_access')
          .select('owner_id, role')
          .eq('grantee_user_id', uid)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;

        if (!error && data) {
          setRole(data.role as AppRole);
          setOwnerId(data.owner_id as string);
        } else {
          // Default: the user is the owner of their own data.
          setRole('owner');
          setOwnerId(uid);
        }
      } catch {
        if (!cancelled) {
          // Fail closed for delegation, but still let users reach their own data.
          setRole('owner');
          setOwnerId(uid);
        }
      } finally {
        if (!cancelled) setAccessLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const loading = !ready || (!!user && accessLoading);

  const isAuthorized = !!user; // any authenticated user can reach their own data
  const isInvestor = role === 'investor';
  const isOwner = role === 'owner';
  const isAccountant = role === 'accountant';

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      // Clean logout: drop any cached app state so private data never lingers.
      try {
        const keep = (k: string) => k.startsWith('sb-'); // supabase auth handles its own keys
        Object.keys(localStorage).forEach((k) => { if (!keep(k)) localStorage.removeItem(k); });
        sessionStorage.clear();
      } catch { /* ignore storage access errors */ }
      // Hard reload to /login guarantees React Query / in-memory caches are cleared.
      window.location.replace('/login');
    }
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
