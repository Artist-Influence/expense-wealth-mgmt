import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  Receipt, BarChart3, Brain, Settings, LogOut, Database,
  DollarSign, ReceiptText, TrendingUp, Landmark, FileSpreadsheet, Target, CalendarCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
  { to: '/', label: 'Expenses', icon: Receipt, active: true },
  { to: '/income', label: 'Income', icon: DollarSign, active: true },
  { to: '/insights', label: 'Insights', icon: BarChart3, active: true },
  { to: '/reimbursements', label: 'Reimburse', icon: ReceiptText, active: true },
  { to: '/wealth', label: 'Wealth', icon: TrendingUp, active: true },
  { to: '/allocations', label: 'Allocate', icon: Target, active: true },
  { to: '/tax', label: 'Tax', icon: Landmark, active: true },
  { to: '/merchants', label: 'Memory', icon: Brain, active: true },
  { to: '/accountant', label: 'Accountant', icon: FileSpreadsheet, active: false },
  { to: '/settings', label: 'Settings', icon: Settings, active: true },
];

export function AppNav() {
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <nav className="sticky top-0 z-50 glass-panel rounded-none border-x-0 border-t-0">
      <div className="container flex h-12 items-center justify-between">
        <div className="flex items-center gap-1">
          <Link to="/" className="flex items-center gap-2 mr-4">
            <Database className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground text-xs">Expense Memory</span>
          </Link>
          
          {navItems.map(({ to, label, icon: Icon, active }) => {
            const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
            
            if (!active) {
              return (
                <Tooltip key={to}>
                  <TooltipTrigger asChild>
                    <Link
                      to={to}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground/40 cursor-pointer hover:text-muted-foreground/60 transition-colors"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">{label}</span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {label} — Coming Soon
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-primary/15 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">{label}</span>
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
          <span className="hidden sm:inline">Sign Out</span>
        </Button>
      </div>
    </nav>
  );
}
