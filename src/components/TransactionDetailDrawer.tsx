import { useState, useEffect, useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Check, X, ArrowLeftRight, AlertTriangle, Ban, FileText,
  Brain, History, BookOpen, Zap, Bot, User, Briefcase, Receipt, Scissors, ChevronDown
} from 'lucide-react';
import { MethodSelect } from '@/components/MethodSelect';
import type { PaymentMethod } from '@/hooks/usePaymentMethods';
import { ReceiptManager } from '@/components/ReceiptManager';
import { isDeductibleCategory } from '@/lib/categorization-engine';

interface Transaction {
  id: string;
  date: string | null;
  description_raw: string | null;
  description_normalized: string | null;
  amount: number | null;
  predicted_category: string | null;
  predicted_method: string | null;
  predicted_notes: string | null;
  final_category: string | null;
  final_method: string | null;
  final_notes: string | null;
  confidence: number | null;
  match_source: string | null;
  match_explanation?: string | null;
  review_status: string;
  mode: string;
  transaction_mode: string;
  economic_owner: string;
  treatment_type: string;
  counts_toward_true_personal_spend: boolean;
  counts_toward_true_business_spend: boolean;
  is_reimbursable: boolean;
  reimbursable_to: string | null;
  reimbursement_status: string;
  tax_treatment: string;
  tax_entity: string | null;
  counts_as_tax_deduction: boolean;
  is_non_expense_cash_movement: boolean;
  client_or_project_tag: string | null;
  business_purpose: string | null;
  receipt_required: boolean;
  receipt_attached: boolean;
  receipt_path?: string | null;
  parse_status: string | null;
  duplicate_status: string | null;
  is_transfer: boolean | null;
  exclude_from_expense_totals: boolean | null;
  transfer_type: string | null;
  source_file_name: string | null;
  is_split_parent: boolean;
  parent_transaction_id: string | null;
  // Optional fields present on some page-specific interfaces
  linked_reimbursement_group_id?: string | null;
  exclude_from_cash_spend_reporting?: boolean;
  upload_batch_id?: string | null;
  [key: string]: any;
}

interface TransactionDetailDrawerProps {
  transaction: Transaction | null;
  open: boolean;
  onClose: () => void;
  categories: string[];
  paymentMethods?: PaymentMethod[];
  onSave: (id: string, values: any) => Promise<boolean>;
  onApprove: (tx: Transaction) => Promise<void>;
  onToggleTransfer: (tx: Transaction) => Promise<void>;
  onSplit?: (tx: Transaction) => void;
  onAddCategory?: () => void;
  ownerId?: string | null;
  readOnly?: boolean;
  /** When set, drawer auto-applies this value to its category field, then clears it via onPendingCategoryConsumed. */
  pendingCategoryToSelect?: string | null;
  onPendingCategoryConsumed?: () => void;
}

const matchSourceLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  exact_history: { label: 'Exact Historical Match', icon: <History className="h-3.5 w-3.5" />, color: 'text-green-400' },
  normalized_history: { label: 'Normalized Merchant Match', icon: <BookOpen className="h-3.5 w-3.5" />, color: 'text-emerald-400' },
  partial_history: { label: 'Partial Merchant Match', icon: <BookOpen className="h-3.5 w-3.5" />, color: 'text-teal-400' },
  rule: { label: 'Rule Match', icon: <Zap className="h-3.5 w-3.5" />, color: 'text-amber-400' },
  ai: { label: 'AI Suggestion', icon: <Bot className="h-3.5 w-3.5" />, color: 'text-purple-400' },
};

// Reimbursable/Work mode retired — a transaction is Personal or Business.
const MODE_OPTIONS = [
  { value: 'personal', label: 'Personal', icon: User },
  { value: 'business', label: 'Business', icon: Briefcase },
] as const;

const ECONOMIC_OWNER_OPTIONS = ['personal', 'artist_influence', 'employer', 'client', 'other'];
const TREATMENT_TYPE_OPTIONS = ['expense', 'income', 'reimbursable_expense', 'reimbursement_received', 'transfer', 'investment_contribution', 'tax_payment', 'debt_payment', 'owner_draw', 'refund', 'payroll', 'business_revenue', 'credit_card_payment'];
const TAX_TREATMENT_OPTIONS = ['unknown', 'likely_deductible', 'likely_nondeductible', 'excluded_reimbursement', 'capital_or_investment', 'transfer_nonexpense', 'payroll_withholding', 'estimated_tax_payment'];
const REIMBURSABLE_TO_OPTIONS = ['employer', 'artist_influence', 'client', 'personal', 'other'];
const REIMBURSEMENT_STATUS_OPTIONS = ['none', 'pending', 'submitted', 'approved', 'reimbursed', 'partially_reimbursed', 'denied'];

export function TransactionDetailDrawer({
  transaction: tx,
  open,
  onClose,
  categories,
  paymentMethods = [],
  onSave,
  onApprove,
  onToggleTransfer,
  onSplit,
  onAddCategory,
  ownerId,
  readOnly,
  pendingCategoryToSelect,
  onPendingCategoryConsumed,
}: TransactionDetailDrawerProps) {
  const [editValues, setEditValues] = useState({
    category: '', method: '', notes: '',
    transaction_mode: 'personal', economic_owner: 'personal', treatment_type: 'expense',
    tax_treatment: 'unknown', is_reimbursable: false, reimbursable_to: '',
    reimbursement_status: 'none', business_purpose: '',
    counts_toward_true_personal_spend: true, counts_toward_true_business_spend: false,
    client_or_project_tag: '',
  });
  // null = follow the auto-computed deductibility; true/false = user override.
  // Kept out of editValues on purpose so the parent still auto-recomputes the
  // flag from (mode, category) whenever the user hasn't explicitly overridden.
  const [taxOverride, setTaxOverride] = useState<boolean | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Snapshot of the values as loaded — used to detect unsaved edits so an
  // accidental outside-click can't silently discard work.
  const initialValuesRef = useRef<string>('');
  const initialTaxOverrideRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (tx) {
      const initial = {
        category: tx.final_category || tx.predicted_category || '',
        method: tx.final_method || tx.predicted_method || '',
        notes: tx.final_notes || tx.predicted_notes || '',
        transaction_mode: tx.transaction_mode || tx.mode || 'personal',
        economic_owner: tx.economic_owner || 'personal',
        treatment_type: tx.treatment_type || 'expense',
        tax_treatment: tx.tax_treatment || 'unknown',
        is_reimbursable: tx.is_reimbursable || false,
        reimbursable_to: tx.reimbursable_to || '',
        reimbursement_status: tx.reimbursement_status || 'none',
        business_purpose: tx.business_purpose || '',
        counts_toward_true_personal_spend: tx.counts_toward_true_personal_spend ?? true,
        counts_toward_true_business_spend: tx.counts_toward_true_business_spend ?? false,
        client_or_project_tag: tx.client_or_project_tag || '',
      };
      setEditValues(initial);
      initialValuesRef.current = JSON.stringify(initial);

      // Treat the stored flag as an "override" only when it disagrees with what
      // the auto-rule would produce — otherwise leave it on auto so changing the
      // category keeps updating the deduction.
      const autoAtLoad = initial.category ? isDeductibleCategory(initial.transaction_mode, initial.category) : false;
      const stored = tx.counts_as_tax_deduction ?? autoAtLoad;
      const loadedOverride = stored === autoAtLoad ? null : stored;
      setTaxOverride(loadedOverride);
      initialTaxOverrideRef.current = loadedOverride;
      setAdvancedOpen(false);
    }
  }, [tx?.id]);

  // When parent creates a new category from the drawer flow, auto-select it.
  useEffect(() => {
    if (pendingCategoryToSelect && categories.includes(pendingCategoryToSelect)) {
      setEditValues(prev => ({ ...prev, category: pendingCategoryToSelect }));
      onPendingCategoryConsumed?.();
    }
  }, [pendingCategoryToSelect, categories, onPendingCategoryConsumed]);

  if (!tx) return null;

  // Build the payload sent to the parent. Every editValues field is preserved;
  // counts_as_tax_deduction is added ONLY when the user overrode the auto value
  // (otherwise the parent recomputes it from mode + category).
  const buildPayload = (extra?: Record<string, any>) => ({
    ...editValues,
    ...(taxOverride !== null ? { counts_as_tax_deduction: taxOverride } : {}),
    ...extra,
  });

  const handleSave = async () => {
    // Guard: require reimbursable_to when marking as reimbursable
    if (editValues.is_reimbursable && !editValues.reimbursable_to) {
      const confirmed = confirm('This expense is marked reimbursable but no "Reimbursable To" is set. Save anyway?');
      if (!confirmed) return;
    }

    if (!editValues.category) {
      // Keep as needs_review if no category set
      setSaving(true);
      try {
        await onSave(tx.id, buildPayload({ _keepNeedsReview: true }));
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    try {
      await onSave(tx.id, buildPayload());
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    setSaving(true);
    try {
      // If the save was rejected (category not in the whitelist, RLS, network),
      // approving anyway would persist the rejected value with an 'approved'
      // status — stop instead.
      const saved = await onSave(tx.id, buildPayload());
      if (!saved) return;
      await onApprove({ ...tx, final_category: editValues.category, final_method: editValues.method, final_notes: editValues.notes });
    } finally {
      setSaving(false);
    }
  };

  const handleModeSwitch = (newMode: string) => {
    const updates: Partial<typeof editValues> = { transaction_mode: newMode };
    if (newMode === 'personal') {
      updates.economic_owner = 'personal';
      updates.counts_toward_true_personal_spend = true;
      updates.counts_toward_true_business_spend = false;
      updates.is_reimbursable = false;
    } else if (newMode === 'business') {
      updates.economic_owner = 'artist_influence';
      updates.counts_toward_true_personal_spend = false;
      updates.counts_toward_true_business_spend = true;
      updates.is_reimbursable = false;
    } else {
      updates.economic_owner = 'employer';
      updates.counts_toward_true_personal_spend = false;
      updates.counts_toward_true_business_spend = false;
      updates.is_reimbursable = true;
      updates.reimbursement_status = 'pending';
    }
    setEditValues(prev => ({ ...prev, ...updates }));
  };

  const confidencePercent = tx.confidence != null ? Math.round(tx.confidence) : null;
  const confidenceColor = confidencePercent === null ? 'bg-muted' :
    confidencePercent >= 90 ? 'bg-green-500' :
    confidencePercent >= 70 ? 'bg-amber-500' : 'bg-destructive';

  const matchInfo = tx.match_source ? matchSourceLabels[tx.match_source] : null;
  const statusLabel = tx.review_status.replace(/_/g, ' ');
  const isReimbursable = editValues.transaction_mode === 'reimbursable_work' || editValues.is_reimbursable;

  // Tax-deductible row: auto-computed default + optional manual override.
  const autoDeductible = editValues.category ? isDeductibleCategory(editValues.transaction_mode, editValues.category) : false;
  const taxDeductibleEffective = taxOverride ?? autoDeductible;
  const taxIsOverridden = taxOverride !== null;
  const taxAutoReason =
    editValues.transaction_mode === 'business'
      ? (autoDeductible ? 'Work expenses deduct by default.' : 'This category is treated as non-deductible.')
      : editValues.transaction_mode === 'reimbursable_work'
      ? "Reimbursed costs usually aren't your deduction."
      : "Personal spending isn't deductible.";

  return (
    <Sheet
      open={open}
      onOpenChange={v => {
        if (v) return;
        if (saving) return;
        const dirty = JSON.stringify(editValues) !== initialValuesRef.current || taxOverride !== initialTaxOverrideRef.current;
        if (dirty && !readOnly && !confirm('Discard unsaved changes to this transaction?')) return;
        onClose();
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-lg bg-background border-border overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-foreground text-base">Transaction</SheetTitle>
        </SheetHeader>

        {/* Summary — date, amount, status */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">{tx.date || '—'}</span>
            <span className="font-mono text-lg font-semibold text-foreground">
              ${tx.amount != null ? Math.abs(tx.amount).toFixed(2) : '0.00'}
            </span>
          </div>
          <Badge variant="outline" className="text-xs capitalize">{statusLabel}</Badge>
        </div>

        {/* What is this — the raw merchant line, the one bit of context needed to categorize */}
        <p className="text-sm text-foreground break-words bg-secondary/30 rounded-md px-3 py-2 leading-relaxed mb-4">
          {tx.description_raw || '—'}
        </p>

        {/* ============ THE FOUR THINGS THAT MATTER ============ */}
        <div className="space-y-4 mb-5">
          {/* Category */}
          <div>
            <Label className="text-xs font-medium text-foreground">Category</Label>
            <Select
              value={editValues.category}
              onValueChange={v => {
                if (v === '__add_new__') {
                  onAddCategory?.();
                  return;
                }
                setEditValues(prev => ({ ...prev, category: v }));
              }}
            >
              <SelectTrigger className="mt-1.5 h-9 text-sm">
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
                {onAddCategory && (
                  <SelectItem value="__add_new__" className="text-primary font-medium border-t border-border mt-1 pt-1.5">
                    + Add new category…
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {(matchInfo || tx.match_explanation) && (
              <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${matchInfo?.color ?? 'text-muted-foreground'}`}>
                {matchInfo?.icon}
                <span className="text-muted-foreground">
                  {matchInfo ? matchInfo.label : 'Suggested'}
                  {confidencePercent !== null ? ` · ${confidencePercent}% confident` : ''}
                </span>
              </div>
            )}
          </div>

          {/* Personal / Business / Reimbursable */}
          <div>
            <Label className="text-xs font-medium text-foreground">What kind of expense?</Label>
            <div className="flex rounded-lg border border-border/40 overflow-hidden mt-1.5">
              {MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => handleModeSwitch(value)}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors ${
                    editValues.transaction_mode === value
                      ? value === 'personal' ? 'bg-secondary text-foreground'
                      : value === 'business' ? 'bg-primary/20 text-primary'
                      : 'bg-warning/15 text-warning'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Business = a work expense (may be tax-deductible). Reimbursable = someone will pay you back.
            </p>
          </div>

          {/* Reimbursement details — only when Reimbursable is selected */}
          {isReimbursable && (
            <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 space-y-3">
              <div>
                <Label className="text-xs font-medium text-foreground">Who pays you back?</Label>
                <Select value={editValues.reimbursable_to} onValueChange={v => setEditValues(prev => ({ ...prev, reimbursable_to: v }))}>
                  <SelectTrigger className="mt-1.5 h-9 text-sm"><SelectValue placeholder="Select who owes you..." /></SelectTrigger>
                  <SelectContent>
                    {REIMBURSABLE_TO_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-sm capitalize">{o.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">Who owes you for this expense.</p>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Reimbursement status</Label>
                <Select value={editValues.reimbursement_status} onValueChange={v => setEditValues(prev => ({ ...prev, reimbursement_status: v }))}>
                  <SelectTrigger className="mt-1 h-8 text-xs capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REIMBURSEMENT_STATUS_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs capitalize">{o.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-xs ${tx.receipt_attached ? 'border-green-400/30 text-green-400' : 'border-muted-foreground/30 text-muted-foreground'}`}>
                  {tx.receipt_attached ? '✓ Receipt attached' : 'No receipt'}
                </Badge>
                <ReceiptManager
                  transactionId={tx.id}
                  ownerId={ownerId ?? null}
                  receiptPath={tx.receipt_path ?? null}
                  readOnly={readOnly}
                />
              </div>
            </div>
          )}

          {/* Payment method */}
          <div>
            <Label className="text-xs font-medium text-foreground">Payment method</Label>
            <MethodSelect
              value={editValues.method}
              methods={paymentMethods}
              mode={editValues.transaction_mode === 'business' ? 'business' : 'personal'}
              onChange={v => setEditValues(prev => ({ ...prev, method: v }))}
              className="mt-1.5 h-9 text-sm"
              placeholder="Select method"
            />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs font-medium text-foreground">Notes</Label>
            <Textarea value={editValues.notes} onChange={e => setEditValues(prev => ({ ...prev, notes: e.target.value }))} className="mt-1.5 text-sm min-h-[60px]" placeholder="Add notes..." />
          </div>

          {/* Tax deductible? — auto default + manual override */}
          <div className="rounded-lg border border-border/40 bg-secondary/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label className="text-xs font-medium text-foreground">Tax deductible?</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">Auto-set from category + type; flip if you disagree.</p>
              </div>
              <Switch checked={taxDeductibleEffective} onCheckedChange={v => setTaxOverride(v)} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                {taxIsOverridden
                  ? <>You set this manually. Auto guess: {autoDeductible ? 'Deductible' : 'Not deductible'}.</>
                  : taxAutoReason}
              </span>
              {taxIsOverridden && (
                <button onClick={() => setTaxOverride(null)} className="text-primary hover:underline shrink-0">Reset to auto</button>
              )}
            </div>
          </div>
        </div>

        {/* ============ ADVANCED — hidden by default ============ */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="mb-4">
          <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Brain className="h-3.5 w-3.5" />
            <span>Advanced accounting details</span>
            <ChevronDown className="h-3.5 w-3.5 ml-auto transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              These are auto-filled from your choices above. Most people never need to touch them.
            </p>

            <div>
              <Label className="text-[11px] text-muted-foreground">Economic owner</Label>
              <Select value={editValues.economic_owner} onValueChange={v => setEditValues(prev => ({ ...prev, economic_owner: v }))}>
                <SelectTrigger className="mt-1 h-8 text-xs capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ECONOMIC_OWNER_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs capitalize">{o.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Whose money ultimately paid for this.</p>
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Treatment type</Label>
              <Select value={editValues.treatment_type} onValueChange={v => setEditValues(prev => ({ ...prev, treatment_type: v }))}>
                <SelectTrigger className="mt-1 h-8 text-xs capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TREATMENT_TYPE_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs capitalize">{o.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">How this line is treated in the books.</p>
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Tax treatment</Label>
              <Select value={editValues.tax_treatment} onValueChange={v => setEditValues(prev => ({ ...prev, tax_treatment: v }))}>
                <SelectTrigger className="mt-1 h-8 text-xs capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TAX_TREATMENT_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs capitalize">{o.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">Detailed IRS category (the toggle above is the simple version).</p>
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Client / project tag</Label>
              <Input value={editValues.client_or_project_tag} onChange={e => setEditValues(prev => ({ ...prev, client_or_project_tag: e.target.value }))} className="mt-1 h-8 text-xs" placeholder="Tag..." />
              <p className="text-[10px] text-muted-foreground mt-1">Attribute this to a specific client or project.</p>
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Business purpose</Label>
              <Textarea value={editValues.business_purpose} onChange={e => setEditValues(prev => ({ ...prev, business_purpose: e.target.value }))} className="mt-1 text-xs min-h-[50px]" placeholder="Why was this incurred for work?" />
              <p className="text-[10px] text-muted-foreground mt-1">Kept on record for taxes / audits.</p>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-[11px] text-muted-foreground">Counts as true personal spend</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Include in your real personal-spending totals.</p>
                </div>
                <Switch checked={editValues.counts_toward_true_personal_spend} onCheckedChange={v => setEditValues(prev => ({ ...prev, counts_toward_true_personal_spend: v }))} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-[11px] text-muted-foreground">Counts as true business spend</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Include in your real business-spending totals.</p>
                </div>
                <Switch checked={editValues.counts_toward_true_business_spend} onCheckedChange={v => setEditValues(prev => ({ ...prev, counts_toward_true_business_spend: v }))} />
              </div>
            </div>

            {(matchInfo || tx.match_explanation || confidencePercent !== null) && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-[11px] text-muted-foreground">Why this category</Label>
                  {matchInfo && (
                    <div className={`flex items-center gap-2 text-xs ${matchInfo.color}`}>
                      {matchInfo.icon}
                      <span>{matchInfo.label}</span>
                    </div>
                  )}
                  {tx.match_explanation && (
                    <p className="text-xs text-muted-foreground bg-background/40 rounded px-2 py-1.5 leading-relaxed">
                      {tx.match_explanation}
                    </p>
                  )}
                  {confidencePercent !== null && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${confidenceColor}`} style={{ width: `${confidencePercent}%` }} />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">{confidencePercent}%</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {tx.description_normalized && (
              <>
                <Separator />
                <div>
                  <Label className="text-[11px] text-muted-foreground">Normalized merchant key</Label>
                  <p className="text-xs text-muted-foreground mt-1 font-mono bg-background/40 rounded px-2 py-1.5 break-words">
                    {tx.description_normalized}
                  </p>
                </div>
              </>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Flags — safety warnings, always visible */}
        {(tx.is_transfer || tx.transfer_type === 'possible_transfer' || tx.duplicate_status === 'possible_duplicate' || tx.parse_status === 'parse_error' || tx.exclude_from_expense_totals) && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {tx.is_transfer && (
              <Badge variant="outline" className="text-xs gap-1 border-muted-foreground/30 text-muted-foreground">
                <ArrowLeftRight className="h-3 w-3" /> Transfer ({tx.transfer_type || 'unknown'})
              </Badge>
            )}
            {!tx.is_transfer && tx.transfer_type === 'possible_transfer' && (
              <Badge variant="outline" className="text-xs gap-1 border-warning/30 text-warning">
                <AlertTriangle className="h-3 w-3" /> Possible Transfer — review needed
              </Badge>
            )}
            {tx.duplicate_status === 'possible_duplicate' && (
              <Badge variant="outline" className="text-xs gap-1 border-warning/30 text-warning">
                <AlertTriangle className="h-3 w-3" /> Possible Duplicate
              </Badge>
            )}
            {tx.parse_status === 'parse_error' && (
              <Badge variant="destructive" className="text-xs">Parse Error</Badge>
            )}
            {tx.exclude_from_expense_totals && (
              <Badge variant="outline" className="text-xs text-muted-foreground">Excluded from totals</Badge>
            )}
          </div>
        )}

        {/* Source file */}
        {tx.source_file_name && (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <FileText className="h-3 w-3" /> {tx.source_file_name}
            </p>
          </div>
        )}

        {/* Split parent/child badges */}
        {tx.is_split_parent && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary flex items-center gap-2 mb-4">
            <Scissors className="h-3.5 w-3.5" />
            <span>This transaction has been split. The parent is excluded from reporting — child rows carry the amounts.</span>
          </div>
        )}
        {tx.parent_transaction_id && (
          <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2 mb-4">
            <Scissors className="h-3.5 w-3.5" />
            <span>Split child row — part of a split transaction.</span>
          </div>
        )}

        <Separator className="mb-4" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving || tx.is_split_parent} className="flex-1 h-9 text-sm gap-1.5">
            <Check className="h-3.5 w-3.5" /> Save
          </Button>
          {!['approved', 'edited'].includes(tx.review_status) && !tx.is_split_parent && (
            <Button onClick={handleApprove} disabled={saving || !editValues.category} variant="secondary" className="flex-1 h-9 text-sm gap-1.5">
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
          )}
          {!tx.is_split_parent && !tx.parent_transaction_id && onSplit && (
            <Button variant="outline" onClick={() => onSplit(tx)} className="h-9 text-sm gap-1.5">
              <Scissors className="h-3.5 w-3.5" /> Split
            </Button>
          )}
          <Button variant="outline" onClick={() => onToggleTransfer(tx)} className="h-9 text-sm gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" /> {tx.is_transfer ? 'Restore' : 'Transfer'}
          </Button>
          <Button variant="ghost" onClick={onClose} className="h-9 text-sm">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
