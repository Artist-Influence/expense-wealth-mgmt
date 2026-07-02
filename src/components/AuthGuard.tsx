import { useAuth } from '@/hooks/useAuth';
import { Navigate, useLocation } from 'react-router-dom';

/** Routes an investor is allowed to access */
const INVESTOR_ALLOWED = ['/', '/income', '/insights'];

/** Owner-only configuration surfaces; delegates never see them. */
const DELEGATE_BLOCKED = ['/settings'];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthorized, isInvestor, isAccountant } = useAuth();
  const location = useLocation();

  if (loading) {
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
