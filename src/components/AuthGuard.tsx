import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthorized } = useAuth();

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

  return <>{children}</>;
}
