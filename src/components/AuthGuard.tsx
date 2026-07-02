import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Navigate, useLocation } from 'react-router-dom';

/** Routes an investor is allowed to access */
const INVESTOR_ALLOWED = ['/', '/income', '/insights'];

/** Owner-only configuration surfaces; delegates never see them. */
const DELEGATE_BLOCKED = ['/settings'];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthorized, isInvestor, isAccountant } = useAuth();
  const location = useLocation();

  // MFA step-up enforcement: a password-only (aal1) session on an account with
  // a verified TOTP factor must NOT reach the app — otherwise 2FA is decorative
  // (anyone with the password could just navigate straight here).
  const [mfaOk, setMfaOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setMfaOk(null);
      return;
    }
    (async () => {
      try {
        const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        setMfaOk(!(data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2'));
      } catch {
        // Fail open only for the AAL probe itself; RLS still protects data.
        if (!cancelled) setMfaOk(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, location.pathname]);

  if (loading || (user && mfaOk === null)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="glass-panel p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !isAuthorized) {
    return <Navigate to="/login" replace />;
  }

  if (mfaOk === false) {
    return <Navigate to="/login" state={{ stepUp: true }} replace />;
  }

  // Investor trying to access a restricted page → redirect to expenses
  if (isInvestor && !INVESTOR_ALLOWED.includes(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  // Delegates (accountant/investor) never reach owner configuration pages
  if ((isAccountant || isInvestor) && DELEGATE_BLOCKED.includes(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
