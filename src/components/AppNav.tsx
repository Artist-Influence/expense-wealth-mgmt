import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  Receipt, BarChart3, Brain, Settings, LogOut, Database,
  DollarSign, TrendingUp, Landmark, FileSpreadsheet, CalendarCheck,
  Activity, MessageCircle, CreditCard, MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HealthCheckPanel } from './HealthCheckPanel';
import { runHealthCheck, shouldAutoRun, type HealthCheckSummary } from '@/lib/health-check';
import { useUsageProfile } from '@/hooks/useUsageProfile';

/** Pages that only make sense for business usage; hidden in personal-only mode. */
const BUSINESS_ONLY_NAV = ['/accountant'];

const INVESTOR_NAV = ['/', '/income', '/insights'];

type NavItem = { to: string; label: string; icon: typeof Receipt; showBadge?: boolean };

// The five destinations used most often sit in the bar; everything else lives
// under "More" so the header reads as a short, scannable row.
const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Expenses', icon: Receipt, showBadge: true },
  { to: '/income', label: 'Income', icon: DollarSign },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
  { to: '/wealth', label: 'Wealth', icon: TrendingUp },
  { to: '/tax', label: 'Tax', icon: Landmark },
];

const MORE_NAV: NavItem[] = [
  { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { to: '/assistant', label: 'Assistant', icon: MessageCircle },
  { to: '/close-month', label: 'Close Month', icon: CalendarCheck },
  { to: '/accountant', label: 'Accountant', icon: FileSpreadsheet },
  { to: '/merchants', label: 'Merchant Memory', icon: Brain },
];

const isRouteActive = (pathname: string, to: string) =>
  to === '/' ? pathname === '/' : pathname.startsWith(to);

export function AppNav() {
  const location = useLocation();
  const { user, signOut, isInvestor, isAccountant, ownerId } = useAuth();
  const { profile } = useUsageProfile();
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthSummary, setHealthSummary] = useState<HealthCheckSummary | null>(null);

  // Fetch needs_review count for badge
  const { data: reviewCount = 0 } = useQuery({
    queryKey: ['needs_review_count', user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('transactions_uploaded')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', ownerId!)
        .is('deleted_at', null)
        .in('review_status', ['needs_review', 'suggested', 'ai_suggested']);
      return count || 0;
    },
    enabled: !!user && !!ownerId,
    refetchInterval: 30000,
  });

  // Load last persisted health summary, then auto-run if >14h old
  useEffect(() => {
    if (!user || !ownerId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('last_health_check_at, last_health_check_summary')
          .eq('owner_id', ownerId!)
          .maybeSingle();
        if (!cancelled && data?.last_health_check_summary) {
          setHealthSummary({
            ranAt: data.last_health_check_at || new Date().toISOString(),
            income: { exactClusters: [], rowIndex: {} },
            expenses: { exactClusters: [], nearClusters: [], crossModePairs: [], rowIndex: {} },
            needsReview: { incomeCount: 0, expenseCount: 0 },
            staleReviews: { count: 0, oldestDate: null },
            parseErrors: { count: 0 },
            totalIssues: (data.last_health_check_summary as any)?.totalIssues || 0,
          } as HealthCheckSummary);
        }
        const due = await shouldAutoRun(ownerId!);
        if (due && !cancelled) {
          const fresh = await runHealthCheck(ownerId!);
          if (!cancelled) setHealthSummary(fresh);
        }
      } catch {/* silent */}
    })();
    return () => { cancelled = true; };
  }, [user?.id, ownerId]);

  const totalIssues = healthSummary?.totalIssues ?? 0;
  const healthTone = totalIssues === 0
    ? 'text-success border-success/30 bg-success/5 hover:bg-success/10'
    : totalIssues <= 5
      ? 'text-warning border-warning/40 bg-warning/10 hover:bg-warning/15'
      : 'text-destructive border-destructive/40 bg-destructive/10 hover:bg-destructive/15';

  // Investors see only their whitelisted destinations, and never the More menu.
  const visiblePrimary = PRIMARY_NAV.filter(({ to }) => !isInvestor || INVESTOR_NAV.includes(to));
  const visibleMore = isInvestor
    ? []
    : MORE_NAV.filter(({ to }) => isAccountant || profile !== 'personal' || !BUSINESS_ONLY_NAV.includes(to));
  const moreActive = visibleMore.some(({ to }) => isRouteActive(location.pathname, to));

  return (
    <nav className="sticky top-0 z-50 glass-panel rounded-none border-x-0 border-t-0">
      <div className="container flex h-14 items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link to="/" className="flex items-center gap-2 mr-3 shrink-0">
            <Database className="h-4 w-4 text-primary" />
            <span className="font-bold italic tracking-tight text-foreground text-sm hidden sm:inline">Expense Memory</span>
          </Link>

          {visiblePrimary.map(({ to, label, icon: Icon, showBadge }) => {
            const active = isRouteActive(location.pathname, to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all relative ${
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden md:inline">{label}</span>
                {showBadge && !isInvestor && reviewCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                    {reviewCount > 99 ? '99+' : reviewCount}
                  </span>
                )}
              </Link>
            );
          })}

          {visibleMore.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all outline-none ${
                    moreActive
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="hidden md:inline">More</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="glass-panel min-w-[200px]">
                {visibleMore.map(({ to, label, icon: Icon }) => {
                  const active = isRouteActive(location.pathname, to);
                  return (
                    <DropdownMenuItem key={to} asChild>
                      <Link
                        to={to}
                        className={`flex items-center gap-2.5 cursor-pointer ${active ? 'text-primary' : ''}`}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isInvestor && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setHealthOpen(true)}
                  className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors ${healthTone}`}
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">
                    {totalIssues === 0 ? 'Healthy' : `${totalIssues} issue${totalIssues > 1 ? 's' : ''}`}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Data Health Check {healthSummary?.ranAt ? `· last run ${new Date(healthSummary.ranAt).toLocaleString()}` : ''}
              </TooltipContent>
            </Tooltip>
          )}

          {isInvestor && (
            <span className="text-[10px] text-muted-foreground/60 hidden md:inline">Investor View</span>
          )}
          {isAccountant && (
            <span className="text-[10px] text-muted-foreground/60 hidden md:inline">Accountant View</span>
          )}

          {!isInvestor && !isAccountant && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/settings"
                  className={`flex items-center justify-center h-8 w-8 rounded-lg transition-colors ${
                    isRouteActive(location.pathname, '/settings')
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Settings</TooltipContent>
            </Tooltip>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="text-muted-foreground hover:text-foreground text-xs gap-1.5 h-8"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </Button>
        </div>
      </div>

      {!isInvestor && (
        <HealthCheckPanel
          open={healthOpen}
          onClose={() => setHealthOpen(false)}
          initialSummary={healthSummary}
          onSummaryChange={setHealthSummary}
        />
      )}
    </nav>
  );
}
