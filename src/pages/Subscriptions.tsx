import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { ModeScopeToggle, readPersistedScope, type ModeScope } from '@/components/ModeScopeToggle';
import { useRecurringOverrides, type OverrideStatus } from '@/hooks/useRecurringOverrides';
import { computeRecurringCharges, type RecurringCharge } from '@/lib/recurring-charges';
import {
  RefreshCw, CheckCircle2, X, RotateCcw, ChevronDown, AlertTriangle, CreditCard,
} from 'lucide-react';

type Mode = 'personal' | 'business';
const SCOPE_KEY = 'subscriptions_scope';
const COUNTED = new Set(['approved', 'auto_categorized', 'edited']);

interface ExpenseRow {
  date: string | null;
  amount: number | null;
  description_normalized: string | null;
  description_raw: string | null;
  final_category: string | null;
  review_status: string;
  mode: string;
  is_split_parent: boolean;
  exclude_from_expense_totals: boolean;
  parse_status: string;
}

/** A recurring candidate annotated with the concrete mode it belongs to. */
type Candidate = RecurringCharge & { mode: Mode };

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function Subscriptions() {
  const { user, ownerId } = useAuth();
  const [scope, setScope] = useState<ModeScope>(() => readPersistedScope(SCOPE_KEY, 'personal'));
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRemoved, setShowRemoved] = useState(false);

  const { statusFor, confirm, dismiss, undo, canEdit, loading: overridesLoading } =
    useRecurringOverrides(scope);

  const loadExpenses = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    let from = 0;
    const pageSize = 1000;
    let all: ExpenseRow[] = [];
    let hasMore = true;
    while (hasMore) {
      let q = supabase
        .from('transactions_uploaded')
        .select(
          'date, amount, description_normalized, description_raw, final_category, review_status, mode, is_split_parent, exclude_from_expense_totals, parse_status',
        )
        .eq('owner_id', ownerId)
        .is('deleted_at', null)
        .neq('parse_status', 'parse_error')
        .range(from, from + pageSize - 1);
      if (scope !== 'all') q = q.eq('mode', scope);
      const { data } = await q;
      if (data) all = [...all, ...(data as ExpenseRow[])];
      hasMore = (data?.length ?? 0) === pageSize;
      from += pageSize;
    }
    setRows(all);
    setLoading(false);
  }, [ownerId, scope]);

  useEffect(() => {
    if (user && ownerId) loadExpenses();
    else setLoading(false);
  }, [user, ownerId, loadExpenses]);

  // Compute candidates per concrete mode so each is attributed correctly.
  const candidates = useMemo<Candidate[]>(() => {
    const modes: Mode[] = scope === 'all' ? ['personal', 'business'] : [scope];
    const out: Candidate[] = [];
    modes.forEach((m) => {
      const scoped = rows.filter(
        (t) =>
          t.mode === m &&
          COUNTED.has(t.review_status) &&
          !t.is_split_parent &&
          !t.exclude_from_expense_totals,
      );
      // Surface BOTH auto-detected recurring charges (>= 3 charges) AND anything
      // explicitly tagged with the "Subscriptions" category, even single charges.
      computeRecurringCharges(scoped, { includeCategories: ['Subscriptions'] }).forEach((c) =>
        out.push({ ...c, mode: m }),
      );
    });
    return out.sort((a, b) => b.monthlyEstimate - a.monthlyEstimate);
  }, [rows, scope]);

  // A candidate tagged "Subscriptions" is treated as confirmed by default (the user
  // already categorized it as one), unless they've explicitly overridden that decision.
  const effectiveStatus = (c: Candidate): OverrideStatus | undefined => {
    const override = statusFor(c.merchantKey, c.mode);
    if (override) return override;
    if ((c.category || '').toLowerCase() === 'subscriptions') return 'confirmed';
    return undefined;
  };

  const confirmed = candidates.filter((c) => effectiveStatus(c) === 'confirmed');
  const dismissed = candidates.filter((c) => effectiveStatus(c) === 'dismissed');
  const undecided = candidates.filter((c) => effectiveStatus(c) === undefined);

  const confirmedMonthly = confirmed.reduce((s, c) => s + c.monthlyEstimate, 0);

  // A confirmed subscription is "stale" if it hasn't charged in ~45+ days.
  const isStale = (lastCharged: string) => {
    const days = (Date.now() - new Date(lastCharged).getTime()) / (1000 * 60 * 60 * 24);
    return days > 45;
  };

  const busy = loading || overridesLoading;

  const ModeBadge = ({ m }: { m: Mode }) =>
    scope === 'all' ? (
      <span className="match-tag bg-secondary/60 text-muted-foreground capitalize">{m}</span>
    ) : null;

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              Subscriptions
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Confirm the recurring charges that are real subscriptions, and remove the ones that aren't.
            </p>
          </div>
          <ModeScopeToggle value={scope} onChange={setScope} storageKey={SCOPE_KEY} />
        </div>

        {!canEdit && (
          <div className="glass-panel px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            You have read-only access — subscription decisions can't be changed here.
          </div>
        )}

        {/* Confirmed subscriptions */}
        <div className="glass-panel overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <h3 className="text-sm font-medium text-foreground">Your subscriptions</h3>
            <span className="text-[11px] text-muted-foreground ml-auto font-mono">
              {confirmed.length > 0 ? `${fmt(confirmedMonthly)}/mo` : ''}
            </span>
          </div>
          {busy ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : confirmed.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No confirmed subscriptions yet. Confirm candidates below to build your list.
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Merchant</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Avg</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Frequency</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Last Charged</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Mo. Est.</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmed.map((c) => (
                    <tr key={`${c.mode}-${c.merchantKey}`} className="border-b border-border/10 hover:bg-secondary/20">
                      <td className="px-3 py-2 text-foreground">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {c.name}
                          <ModeBadge m={c.mode} />
                          {isStale(c.lastCharged) && (
                            <span className="match-tag bg-warning/10 text-warning">looks unused</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{fmt(c.avg)}</td>
                      <td className="px-3 py-2"><span className="match-tag bg-primary/10 text-primary/80">{c.frequency}</span></td>
                      <td className="px-3 py-2 text-muted-foreground font-mono">{c.lastCharged}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{fmt(c.monthlyEstimate)}</td>
                      <td className="px-3 py-2 text-right">
                        {canEdit && (
                          <button
                            onClick={() => dismiss(c.merchantKey, c.mode)}
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="h-3 w-3" /> Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detected candidates */}
        <div className="glass-panel overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium text-foreground">Detected recurring charges</h3>
            <span className="text-[11px] text-muted-foreground ml-auto">{undecided.length} to review</span>
          </div>
          {busy ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : undecided.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing new to review — all detected charges have been sorted.
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Merchant</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Avg</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Frequency</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Category</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Mo. Est.</th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {undecided.map((c) => (
                    <tr key={`${c.mode}-${c.merchantKey}`} className="border-b border-border/10 hover:bg-secondary/20">
                      <td className="px-3 py-2 text-foreground">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {c.name}
                          <ModeBadge m={c.mode} />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{fmt(c.avg)}</td>
                      <td className="px-3 py-2"><span className="match-tag bg-primary/10 text-primary/80">{c.frequency}</span></td>
                      <td className="px-3 py-2 text-muted-foreground">{c.category || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{fmt(c.monthlyEstimate)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {canEdit && (
                          <span className="inline-flex items-center gap-2">
                            <button
                              onClick={() => confirm(c.merchantKey, c.mode)}
                              className="inline-flex items-center gap-1 text-[11px] text-success hover:underline"
                            >
                              <CheckCircle2 className="h-3 w-3" /> Confirm
                            </button>
                            <button
                              onClick={() => dismiss(c.merchantKey, c.mode)}
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <X className="h-3 w-3" /> Dismiss
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Removed (dismissed) */}
        {dismissed.length > 0 && (
          <div className="glass-panel overflow-hidden">
            <button
              onClick={() => setShowRemoved((v) => !v)}
              className="w-full px-4 py-3 border-b border-border/40 flex items-center gap-2 text-left"
            >
              <X className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Removed</h3>
              <span className="text-[11px] text-muted-foreground ml-auto">{dismissed.length} hidden</span>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${showRemoved ? 'rotate-180' : ''}`}
              />
            </button>
            {showRemoved && (
              <div className="divide-y divide-border/10">
                {dismissed.map((c) => (
                  <div
                    key={`${c.mode}-${c.merchantKey}`}
                    className="px-4 py-2.5 flex items-center gap-2 text-xs hover:bg-secondary/20"
                  >
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 flex-wrap">
                      {c.name}
                      <ModeBadge m={c.mode} />
                    </span>
                    <span className="font-mono text-muted-foreground ml-auto">{fmt(c.monthlyEstimate)}/mo</span>
                    {canEdit && (
                      <button
                        onClick={() => undo(c.merchantKey, c.mode)}
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline ml-3"
                      >
                        <RotateCcw className="h-3 w-3" /> Undo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
