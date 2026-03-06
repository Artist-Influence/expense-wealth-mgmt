import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LayoutDashboard, FileText, Brain, Settings, Cog, LogOut, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/review', label: 'Review', icon: FileText },
  { to: '/merchants', label: 'Memory', icon: Brain },
  { to: '/rules', label: 'Rules', icon: Cog },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppNav() {
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <nav className="sticky top-0 z-50 glass-panel rounded-none border-x-0 border-t-0">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-1">
          <Link to="/" className="flex items-center gap-2 mr-6">
            <Database className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground text-sm">Expense Memory</span>
          </Link>
          
          {navItems.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-primary/15 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="text-muted-foreground hover:text-foreground text-xs gap-1.5"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </Button>
      </div>
    </nav>
  );
}
