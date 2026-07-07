import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Sparkles, Upload, CheckCheck, DollarSign, TrendingUp,
  MessageCircle, Settings as SettingsIcon, ArrowRight, ArrowLeft,
  User, Briefcase, Layers, Check,
} from 'lucide-react';
import type { UsageProfile } from '@/hooks/useUsageProfile';

interface OnboardingStep {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
  /** Special step keys render custom interactive content instead of `body`. */
  key?: string;
}

const STEPS: OnboardingStep[] = [
  {
    icon: Sparkles,
    title: 'Welcome to your cash control system',
    body: (
      <>
        This tool turns your raw bank and credit-card statements into a clear picture of your
        money — categorized expenses, tracked income, and a plan for what to do with what's left.
        This quick walkthrough shows the main workflow. It takes about a minute.
      </>
    ),
  },
  {
    icon: Layers,
    key: 'usage',
    title: 'How will you use this?',
    body: (
      <>
        Pick how you'll use the app so we can keep it focused. You can change this anytime in Settings.
      </>
    ),
  },
  {
    icon: Upload,
    title: '1 · Upload your statements',
    body: (
      <>
        On the <strong>Expenses</strong> page, drag in CSV exports from your banks and cards. The app
        auto-detects which account each file belongs to (by filename), skips exact duplicates, and
        runs every transaction through the categorization engine automatically.
      </>
    ),
  },
  {
    icon: CheckCheck,
    title: '2 · Review &amp; categorize',
    body: (
      <>
        Only <strong>reviewed</strong> transactions count toward your totals — the red badge in the
        nav shows how many still need attention. Approve or fix the suggested category, split a
        mixed personal/business charge, or mark internal transfers so they don't inflate your spend.
      </>
    ),
  },
  {
    icon: DollarSign,
    title: '3 · Track income',
    body: (
      <>
        Upload income CSVs on the <strong>Income</strong> page. Keep true earnings separate from
        transfers and money you fronted — so your real cash flow and profit stay accurate.
      </>
    ),
  },
  {
    icon: TrendingUp,
    title: '4 · Wealth, allocations &amp; tax',
    body: (
      <>
        Set a wealth target, then use <strong>Allocate</strong> to put your investable surplus to
        work each month. The <strong>Tax</strong> page estimates how much to reserve so a tax bill
        never catches you off guard.
      </>
    ),
  },
  {
    icon: MessageCircle,
    title: '5 · Ask the Assistant &amp; close the month',
    body: (
      <>
        The <strong>Assistant</strong> answers plain-English questions about your finances using your
        live data. When a month is done, the guided <strong>Close</strong> workflow walks you through
        reconciling and finalizing the period.
      </>
    ),
  },
  {
    icon: SettingsIcon,
    title: "You're ready to go",
    body: (
      <>
        Last tip: open <strong>Settings</strong> to set your cash buffers, tax reserve %, and savings
        goals — these power the allocation and tax estimates. You can replay this walkthrough anytime
        from Settings. Let's start by uploading your first statement.
      </>
    ),
  },
];

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  /** When true (auto-shown on first login), completion is persisted. */
  persistOnComplete?: boolean;
}

export function OnboardingWizard({ open, onClose, persistOnComplete = true }: OnboardingWizardProps) {
  const { ownerId } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [usageProfile, setUsageProfile] = useState<UsageProfile | null>(null);

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];
  const Icon = current.icon;
  const isUsageStep = current.key === 'usage';
  const nextDisabled = isUsageStep && !usageProfile;

  const markComplete = async () => {
    if (!persistOnComplete || !ownerId) return;
    // Fresh accounts have no app_settings row yet, so a plain UPDATE would
    // match 0 rows and silently drop the usage profile. owner_id is UNIQUE.
    const { error } = await supabase
      .from('app_settings')
      .upsert(
        {
          owner_id: ownerId,
          onboarding_completed: true,
          ...(usageProfile ? { usage_profile: usageProfile } : {}),
        },
        { onConflict: 'owner_id' },
      );
    if (error) toast.error(`Could not save your onboarding choices: ${error.message}`);
  };

  const finish = async () => {
    setSaving(true);
    await markComplete();
    setSaving(false);
    setStep(0);
    onClose();
  };

  const skip = async () => {
    await finish();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) finish(); }}>
      <DialogContent className="glass-panel sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 border border-primary/20 shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle
              className="text-base font-semibold text-foreground"
              dangerouslySetInnerHTML={{ __html: current.title }}
            />
          </div>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground pt-1">
            {current.body}
          </DialogDescription>
        </DialogHeader>

        {isUsageStep && (
          <div className="grid gap-2 py-1">
            {([
              { value: 'personal' as const, icon: User, label: 'Personal', desc: 'Track your own spending, income, and savings.' },
              { value: 'business' as const, icon: Briefcase, label: 'Business', desc: 'Track business expenses, income, and reporting.' },
              { value: 'both' as const, icon: Layers, label: 'Both', desc: 'Manage personal and business side by side.' },
            ]).map((opt) => {
              const OptIcon = opt.icon;
              const selected = usageProfile === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setUsageProfile(opt.value)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                    selected
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border/50 bg-secondary/30 hover:bg-secondary/50'
                  }`}
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${selected ? 'bg-primary/20' : 'bg-secondary/60'}`}>
                    <OptIcon className={`h-4 w-4 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.desc}</div>
                  </div>
                  {selected && <Check className="h-4 w-4 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        )}


        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 py-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={skip}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Skip
          </Button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((s) => s - 1)}
                className="gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={finish} disabled={saving} className="gap-1.5">
                Get started
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep((s) => s + 1)} disabled={nextDisabled} className="gap-1.5">
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
