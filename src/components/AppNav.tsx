import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  Receipt, BarChart3, Brain, Settings, LogOut, Database,
  DollarSign, TrendingUp, Landmark, FileSpreadsheet, Target, CalendarCheck,
  Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HealthCheckPanel } from './HealthCheckPanel';
import { runHealthCheck, shouldAutoRun, type HealthCheckSummary } from '@/lib/health-check';

const navItems = [
  { to: '/', label: 'Expenses', icon: Receipt, active: true, showBadge: true },
  { to: '/income', label: 'Income', icon: DollarSign, active: true },
  { to: '/insights', label: 'Insights', icon: BarChart3, active: true },
  { to: '/wealth', label: 'Wealth', icon: TrendingUp, active: true },
  { to: '/allocations', label: 'Allocate', icon: Target, active: true },
  { to: '/tax', label: 'Tax', icon: Landmark, active: true },
  { to: '/merchants', label: 'Memory', icon: Brain, active: true },
  { to: '/accountant', label: 'Accountant', icon: FileSpreadsheet, active: true },
  { to: '/close-month', label: 'Close', icon: CalendarCheck, active: true },
  { to: '/settings', label: 'Settings', icon: Settings, active: true },
];

export function AppNav() {
  const location = useLocation();
  const { user, signOut } = useAuth();

  // Fetch needs_review count for badge
  const { data: reviewCount = 0 } = useQuery({
    queryKey: ['needs_review_count', user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('transactions_uploaded')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user!.id)
        .in('review_status', ['needs_review', 'suggested', 'ai_suggested']);
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  return (
    <nav className="sticky top-0 z-50 glass-panel rounded-none border-x-0 border-t-0">
      <div className="container flex h-12 items-center justify-between">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          <Link to="/" className="flex items-center gap-2 mr-4">
            <Database className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground text-xs">Expense Memory</span>
          </Link>
          
          {navItems.map(({ to, label, icon: Icon, active, showBadge }) => {
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
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all relative ${
                  isActive
                    ? 'bg-primary/15 text-primary border border-primary/20'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">{label}</span>
                {showBadge && reviewCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                    {reviewCount > 99 ? '99+' : reviewCount}
                  </span>
                )}
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
