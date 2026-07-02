import { supabase } from '@/integrations/supabase/client';
import type { ParsedTransaction } from './csv-parser';
import { fetchAllRows } from './fetch-all';
import { generateMerchantKey, remapCategory } from './normalizer';
import { detectRecurrence } from './recurrence-detector';

export type RecurringHistoryMap = Map<string, { date: string; amount: number }[]>;

// ──────────────────────────────────────────────────────────────────────────────
// Tax-deduction auto-flagging  (NY-aware, Schedule C-aware, creative-friendly)
//
// Determines whether a categorized transaction should default to
// `counts_as_tax_deduction = true`. The user can always override per-row in
// the detail drawer; this just gives us a sane non-zero starting point so the
// Tax page doesn't perpetually show $0 deductions.
//
// Sets are lower-cased for fuzzy comparison.
//
// `deductibilityHint` is the richer signal used by the Tax page UI to
// distinguish "fully deductible business expense" from "partially deductible /
// requires-review personal expense". `isDeductibleCategory` is the boolean
// shortcut still used by the import pipeline & inline edits.
// ──────────────────────────────────────────────────────────────────────────────

// Schedule C lines + ordinary-and-necessary business expenses. Includes the
// user's actual chart of accounts (Apartment/Office, Label Royalties,
// Entertainment, Charity-as-business-promotion, custom client tags).
const BUSINESS_DEDUCTIBLE_FULL = new Set<string>([
  'vendor payment', 'subscriptions', 'software', 'equipment', 'office supplies',
  'travel', 'marketing', 'advertising', 'insurance',
  'fees', 'bank fees', 'commission', 'payroll', 'contractor',
  'professional services', 'rent', 'apartment/office', 'utilities',
  'phone', 'internet', 'shipping', 'education', 'business',
  'label royalties', 'taxes',
  // User-defined client/project categories — clearly business activity.
  'clipscale', 'cure97', 'ddi',
]);

// Business expenses that are partially deductible (e.g., meals are typically
// 50% under §274). We still surface the full amount but tag it as 'partial'
// so the Tax page can apply the haircut.
const BUSINESS_DEDUCTIBLE_PARTIAL = new Set<string>([
  'dining', 'meals', 'food', 'food & drink', 'restaurants', 'coffee', 'bars',
  'business meals', 'client meals',
]);

// Business-mode philosophy: if the owner has already tagged a transaction as
// BUSINESS, they are asserting it is an ordinary-and-necessary business
// expense. So in business mode we deduct by DEFAULT (full) and only exclude
// the things that are genuinely NOT expenses — transfers, capital movements,
// owner draws, refunds, tax payments (all in NEVER_DEDUCTIBLE) — or that carry
// a statutory haircut (PARTIAL) or need review (charity → Schedule A).
// This makes the deduction net robust to the user's own category names instead
// of a brittle allowlist. BUSINESS_DEDUCTIBLE_FULL is kept only as
// documentation of the canonical Schedule C lines.

// Charity paid by an LLC/sole-prop is generally NOT a Sch C deduction (it
// flows to the owner's Schedule A). We still flag it as deductible-with-review
// so it's not silently dropped.
const BUSINESS_DEDUCTIBLE_REVIEW = new Set<string>([
  'charity', 'charitable',
  // Post-TCJA (2018+) client entertainment is ~0% deductible — flag, don't
  // auto-deduct at 50% like meals.
  'entertainment',
  // A category literally named "taxes" must not deduct at 100%: income tax and
  // SE tax aren't deductible; only payroll/property/sales tax is. Flag for
  // review instead of silently writing off tax payments.
  'taxes',
]);

// Personal categories that are commonly itemizable on Schedule A (subject to
// AGI thresholds & SALT cap — surfaced with a "review" hint so the Tax page
// doesn't promise dollar-for-dollar deductions).
const PERSONAL_DEDUCTIBLE_REVIEW = new Set<string>([
  'health', 'medical', 'health/medical', 'health & personal care',
  'charity', 'charitable',
  'mortgage interest', 'state taxes', 'property tax', 'property taxes',
  'taxes',
  // Home-office portion only — flagged for split, not auto-100%.
  'apartment/office',
]);

// Categories that should NEVER be auto-flagged regardless of mode (they are
// transfers / capital movements / refunds / tax payments themselves).
const NEVER_DEDUCTIBLE = new Set<string>([
  'cc payment', 'credit card payment', 'transfer', 'transfers',
  'investment', 'investments', 'savings', 'tax payment', 'taxes paid',
  'income tax', 'estimated taxes', 'estimated tax', 'federal tax',
  // Owner equity movements — NOT expenses. (Bare "distribution" is deliberately
  // NOT here: for a music company "Distribution" = DistroKid/CD Baby, a real
  // deductible cost. Only OWNER/equity distributions are excluded.)
  'owner draw', 'owner draws', 'draw', 'owner distribution', 'equity distribution',
  'capital contribution', 'loan payment', 'loan', 'loan repayment',
  'principal', 'refund', 'refunds', 'reimbursement received', 'debit',
]);

export type DeductibilityHint = 'full' | 'partial' | 'requires_review' | 'none';

export function deductibilityHint(
  mode: 'personal' | 'business' | string | null | undefined,
  category: string | null | undefined,
): DeductibilityHint {
  if (!category) return 'none';
  const c = category.trim().toLowerCase();
  if (!c || NEVER_DEDUCTIBLE.has(c)) return 'none';
  if (mode === 'business') {
    if (BUSINESS_DEDUCTIBLE_PARTIAL.has(c)) return 'partial';
    if (BUSINESS_DEDUCTIBLE_REVIEW.has(c)) return 'requires_review';
    // Deduct-by-default: anything tagged business that isn't a non-expense is
    // treated as a full Schedule C deduction.
    return 'full';
  }
  if (mode === 'personal') {
    if (PERSONAL_DEDUCTIBLE_REVIEW.has(c)) return 'requires_review';
    return 'none';
  }
  return 'none';
}

export function isDeductibleCategory(
  mode: 'personal' | 'business' | string | null | undefined,
  category: string | null | undefined,
): boolean {
  // Anything that has any deductible signal at all gets flagged true; the Tax
  // page is responsible for applying haircuts via `deductibilityHint`.
  return deductibilityHint(mode, category) !== 'none';
}

// ──────────────────────────────────────────────────────────────────────────────
// Reporting helpers (used by Insights & Tax pages)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns the best-known category for a transaction — confirmed if available,
 * otherwise the prediction. This is what the Expenses table already shows, so
 * Insights & Tax should agree.
 */
export function effectiveCategory<T extends { final_category?: string | null; predicted_category?: string | null }>(
  tx: T,
): string | null {
  return tx.final_category || tx.predicted_category || null;
}

/**
 * Review statuses that should be counted in dashboards & tax estimates.
 * High-confidence "suggested" rows are included so users don't have to
 * mass-approve before the numbers reflect reality.
 */
export const COUNTED_FOR_REPORTING_STATUSES = new Set<string>([
  'approved', 'auto_categorized', 'edited', 'suggested', 'ai_suggested',
]);

export function isCountedForReporting(reviewStatus: string | null | undefined): boolean {
  return !!reviewStatus && COUNTED_FOR_REPORTING_STATUSES.has(reviewStatus);
}

interface MerchantMemoryRecord {
  merchant_key: string;
  most_common_category: string | null;
  most_common_method: string | null;
  default_note_template: string | null;
  confidence_weight: number;
  times_seen: number;
}

interface RuleRecord {
  match_type: string;
  pattern: string;
  category_output: string | null;
  method_output: string | null;
  notes_output: string | null;
  priority: number;
}

export interface CategorizationResult {
  predicted_category: string | null;
  predicted_method: string | null;
  predicted_notes: string | null;
  confidence: number;
  match_source: 'exact_history' | 'normalized_history' | 'partial_history' | 'recurring_pattern' | 'rule' | 'ai' | null;
  match_explanation: string;
  review_status: 'auto_categorized' | 'suggested' | 'ai_suggested' | 'needs_review';
  category_rejected: boolean;
}

interface Thresholds {
  auto: number;
  suggest: number;
}

/**
 * Validate a category against the allowed set (case-insensitive).
 */
function validateCategory(
  category: string | null,
  allowedSet: Set<string>
): { category: string | null; wasRejected: boolean } {
  if (!category) return { category: null, wasRejected: false };
  const lower = category.toLowerCase();
  for (const allowed of allowedSet) {
    if (allowed.toLowerCase() === lower) {
      return { category: allowed, wasRejected: false };
    }
  }
  return { category: null, wasRejected: true };
}

/**
 * Try to find a partial/fuzzy match in merchant memory.
 * Returns the best match if one side contains the other.
 */
function findPartialMemoryMatch(
  merchantKey: string,
  rawDescription: string,
  memoryMap: Map<string, MerchantMemoryRecord>
): MerchantMemoryRecord | null {
  if (!merchantKey && !rawDescription) return null;

  const keyUpper = (merchantKey || '').toUpperCase();
  const rawUpper = (rawDescription || '').toUpperCase();
  let bestMatch: MerchantMemoryRecord | null = null;
  let bestScore = 0;

  for (const [memKey, record] of memoryMap) {
    const memUpper = memKey.toUpperCase();

    // Skip very short keys to avoid false positives
    if (memUpper.length < 3) continue;

    let score = 0;

    // Check if merchant key contains memory key or vice versa
    if (keyUpper && keyUpper.length >= 3) {
      if (keyUpper.includes(memUpper)) {
        score = Math.max(score, memUpper.length / keyUpper.length * 100);
      } else if (memUpper.includes(keyUpper)) {
        score = Math.max(score, keyUpper.length / memUpper.length * 100);
      }
    }

    // Check if raw description contains the memory key
    if (rawUpper.includes(memUpper) && memUpper.length >= 4) {
      score = Math.max(score, 60 + memUpper.length); // Longer matches score higher
    }

    if (score > bestScore && score >= 50) {
      bestScore = score;
      bestMatch = record;
    }
  }

  return bestMatch;
}

/**
 * Calculate confidence with boosted scoring for consistent history.
 */
function calculateHistoryConfidence(record: MerchantMemoryRecord): number {
  const baseWeight = record.confidence_weight || 80;
  const timesSeen = record.times_seen || 1;

  // More aggressive confidence boost based on times_seen
  let timesBonus: number;
  if (timesSeen >= 5) {
    timesBonus = 15; // 5+ consistent matches → strong auto-suggest
  } else if (timesSeen >= 3) {
    timesBonus = 10; // 3+ → reliable suggest
  } else if (timesSeen >= 2) {
    timesBonus = 5;
  } else {
    timesBonus = 0;
  }

  return Math.min(baseWeight + timesBonus, 99);
}

// Merchants that span multiple categories and should never auto-approve
const AMBIGUOUS_MERCHANTS = new Set([
  'AMAZON', 'PAYPAL', 'VENMO', 'ZELLE', 'SQUARE', 'STRIPE',
  'WALMART', 'COSTCO', 'TARGET', 'APPLE', 'GOOGLE',
]);

function isAmbiguousMerchant(merchantKey: string): boolean {
  const upper = merchantKey.toUpperCase();
  return [...AMBIGUOUS_MERCHANTS].some(m => upper.includes(m));
}

export async function categorizeTransactions(
  transactions: ParsedTransaction[],
  mode: 'personal' | 'business',
  ownerId: string,
  thresholds: Thresholds = { auto: 90, suggest: 70 },
  allowedCategories: string[] = [],
  recurringHistory?: RecurringHistoryMap,
): Promise<CategorizationResult[]> {
  const allowedSet = new Set(allowedCategories);

  // Load merchant memory for this mode — paginated, or merchants past the
  // 1000-row PostgREST cap silently stop matching.
  const memoryData = await fetchAllRows<MerchantMemoryRecord & { merchant_key: string }>(
    (from, to) => supabase
      .from('merchant_memory')
      .select('merchant_key, most_common_category, most_common_method, default_note_template, confidence_weight, times_seen')
      .eq('mode', mode)
      .eq('owner_id', ownerId)
      .order('merchant_key')
      .range(from, to),
  );

  const memoryMap = new Map<string, MerchantMemoryRecord>();
  memoryData.forEach(m => {
    memoryMap.set(m.merchant_key, m as MerchantMemoryRecord);
  });

  // Load rules — same cap risk once auto-generated rules accumulate.
  const rulesData = await fetchAllRows<RuleRecord>((from, to) => supabase
    .from('categorization_rules')
    .select('match_type, pattern, category_output, method_output, notes_output, priority')
    .or(`mode.eq.${mode},mode.eq.both`)
    .eq('is_active', true)
    .eq('owner_id', ownerId)
    .order('priority', { ascending: true })
    .order('id')
    .range(from, to));

  const rules = rulesData as RuleRecord[];

  return transactions.map(tx => {
    const merchantKey = tx.merchant_key || generateMerchantKey(tx.description_normalized);

    // Layer 1: Exact merchant memory match
    const memory = memoryMap.get(merchantKey);
    if (memory && memory.most_common_category) {
      const confidence = calculateHistoryConfidence(memory);
      const rawCategory = remapCategory(memory.most_common_category, tx.description_raw);
      const validated = allowedSet.size > 0 ? validateCategory(rawCategory, allowedSet) : { category: rawCategory, wasRejected: false };

      if (validated.wasRejected) {
        return buildResult(null, memory.most_common_method, memory.default_note_template, 0,
          memory.times_seen > 1 ? 'exact_history' : 'normalized_history', thresholds, true,
          `Exact merchant key "${merchantKey}" matched but category "${rawCategory}" not in allowed list`, merchantKey);
      }

      const source = memory.times_seen > 1 ? 'exact_history' : 'normalized_history';
      return buildResult(validated.category, memory.most_common_method, memory.default_note_template,
        confidence, source, thresholds, false,
        `Exact merchant key "${merchantKey}" matched (seen ${memory.times_seen}x, confidence ${confidence})`, merchantKey);
    }

    // Layer 1.5: Partial/fuzzy merchant memory match
    const partialMatch = findPartialMemoryMatch(merchantKey, tx.description_raw, memoryMap);
    if (partialMatch && partialMatch.most_common_category) {
      const baseConfidence = Math.min(calculateHistoryConfidence(partialMatch) - 10, 89);
      const confidence = Math.max(baseConfidence, 65);

      const rawCategory = remapCategory(partialMatch.most_common_category, tx.description_raw);
      const validated = allowedSet.size > 0 ? validateCategory(rawCategory, allowedSet) : { category: rawCategory, wasRejected: false };

      if (validated.wasRejected) {
        return buildResult(null, partialMatch.most_common_method, partialMatch.default_note_template, 0,
          'partial_history', thresholds, true,
          `Partial match to "${partialMatch.merchant_key}" but category "${rawCategory}" not in allowed list`, merchantKey);
      }

      return buildResult(validated.category, partialMatch.most_common_method, partialMatch.default_note_template,
        confidence, 'partial_history', thresholds, false,
        `Partial match to merchant key "${partialMatch.merchant_key}" (seen ${partialMatch.times_seen}x)`, merchantKey);
    }

    // Layer 1.7: Recurring-charge detection → Subscriptions
    // Skip ambiguous merchants (PayPal, Venmo, Amazon, etc.) — those carry too many lookalikes.
    if (recurringHistory && allowedSet.has('Subscriptions') && merchantKey && !isAmbiguousMerchant(merchantKey)) {
      const history = recurringHistory.get(merchantKey) || [];
      const recurrence = detectRecurrence(tx.amount, history);
      if (recurrence.isRecurring) {
        return buildResult(
          'Subscriptions',
          null,
          null,
          recurrence.confidence,
          'recurring_pattern',
          thresholds,
          false,
          recurrence.explanation,
          merchantKey,
        );
      }
    }

    // Layer 2: Rules Engine
    for (const rule of rules) {
      if (matchesRule(tx.description_normalized, tx.description_raw, rule)) {
        const rawCategory = rule.category_output ? remapCategory(rule.category_output, tx.description_raw) : null;
        const validated = allowedSet.size > 0 && rawCategory ? validateCategory(rawCategory, allowedSet) : { category: rawCategory, wasRejected: false };

        if (validated.wasRejected) {
          return buildResult(null, rule.method_output, rule.notes_output, 0, 'rule', thresholds, true,
            `Rule "${rule.pattern}" matched but category "${rawCategory}" not in allowed list`, merchantKey);
        }

        return buildResult(validated.category, rule.method_output, rule.notes_output,
          85, 'rule', thresholds, false,
          `Rule match: "${rule.match_type}" pattern "${rule.pattern}"`, merchantKey);
      }
    }

    // Layer 3: CSV-provided category
    if (tx.category) {
      const rawCategory = remapCategory(tx.category, tx.description_raw);
      const validated = allowedSet.size > 0 ? validateCategory(rawCategory, allowedSet) : { category: rawCategory, wasRejected: false };

      if (validated.wasRejected) {
        return buildResult(null, tx.method, tx.notes, 0, 'exact_history', thresholds, true,
          `CSV category "${rawCategory}" not in allowed list`, merchantKey);
      }

      return buildResult(validated.category, tx.method, tx.notes,
        75, 'exact_history', thresholds, false,
        `Category from CSV data: "${rawCategory}"`, merchantKey);
    }

    // No match
    return buildResult(null, null, null, 0, null, thresholds, false,
      'No historical, rule, or CSV match found', merchantKey);
  });
}

function matchesRule(normalized: string, raw: string, rule: RuleRecord): boolean {
  const pattern = rule.pattern.toUpperCase();

  // Check against both normalized and raw descriptions
  const targets = [normalized, raw].filter(Boolean);

  switch (rule.match_type) {
    case 'contains':
      return targets.some(t => t.toUpperCase().includes(pattern));
    case 'equals':
      return targets.some(t => t.toUpperCase() === pattern);
    case 'regex':
      try {
        const re = new RegExp(rule.pattern, 'i');
        return targets.some(t => re.test(t));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function buildResult(
  category: string | null,
  method: string | null,
  notes: string | null,
  confidence: number,
  matchSource: CategorizationResult['match_source'],
  thresholds: Thresholds,
  categoryRejected: boolean = false,
  matchExplanation: string = '',
  merchantKey: string = ''
): CategorizationResult {
  let reviewStatus: CategorizationResult['review_status'];

  if (categoryRejected) {
    reviewStatus = 'needs_review';
  } else if (confidence >= thresholds.auto) {
    // Ambiguous merchants should never auto-approve — cap at 'suggested'
    if (merchantKey && isAmbiguousMerchant(merchantKey)) {
      reviewStatus = 'suggested';
      matchExplanation += ' [Ambiguous merchant — requires manual review]';
    } else {
      reviewStatus = 'auto_categorized';
    }
  } else if (confidence >= thresholds.suggest) {
    reviewStatus = 'suggested';
  } else {
    reviewStatus = 'needs_review';
  }

  return {
    predicted_category: category,
    predicted_method: method,
    predicted_notes: notes,
    confidence,
    match_source: matchSource,
    match_explanation: matchExplanation,
    review_status: reviewStatus,
    category_rejected: categoryRejected,
  };
}

/**
 * Call AI edge function to categorize unmatched transactions.
 */
export async function categorizeWithAI(
  unmatched: { index: number; description_raw: string; description_normalized: string }[],
  mode: 'personal' | 'business',
  ownerId: string,
  allowedCategories: string[]
): Promise<Map<number, { category: string | null; confidence: number; explanation: string }>> {
  const resultMap = new Map<number, { category: string | null; confidence: number; explanation: string }>();
  if (unmatched.length === 0) return resultMap;

  const batchSize = 20;
  for (let i = 0; i < unmatched.length; i += batchSize) {
    const batch = unmatched.slice(i, i + batchSize);
    const descriptions = batch.map((item, idx) => ({
      index: idx,
      raw: item.description_raw,
      normalized: item.description_normalized,
    }));

    try {
      const { data, error } = await supabase.functions.invoke('categorize-ai', {
        body: { descriptions, allowedCategories, mode },
      });

      if (error) {
        console.error('AI categorization error:', error);
        continue;
      }

      const results = data?.results || [];
      for (const r of results) {
        const originalItem = batch[r.index];
        if (originalItem) {
          resultMap.set(originalItem.index, {
            category: r.category,
            confidence: r.confidence,
            explanation: r.explanation,
          });
        }
      }
    } catch (err) {
      console.error('AI categorization batch error:', err);
    }
  }

  return resultMap;
}

/**
 * Update merchant memory after a transaction is approved.
 * Returns false when the write failed (RLS/network) so callers can surface it
 * instead of silently losing the learning signal.
 */
export async function updateMerchantMemory(
  merchantKey: string,
  mode: 'personal' | 'business',
  category: string,
  method: string | null,
  notes: string | null,
  rawExample: string,
  ownerId: string,
  matchSource?: string | null,
): Promise<boolean> {
  const isRecurring = matchSource === 'recurring_pattern';

  const { data: existing, error: readError } = await supabase
    .from('merchant_memory')
    .select('id, times_seen, confidence_weight')
    .eq('merchant_key', merchantKey)
    .eq('mode', mode)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (readError) {
    console.warn('merchant_memory read failed:', readError.message);
    return false;
  }

  if (existing) {
    // Boost confidence more aggressively on manual approval; recurring gets +5 instead of +3
    const bump = isRecurring ? 5 : 3;
    const newWeight = Math.min((existing.confidence_weight || 80) + bump, 99);
    const { error } = await supabase
      .from('merchant_memory')
      .update({
        most_common_category: category,
        most_common_method: method,
        default_note_template: notes,
        times_seen: (existing.times_seen || 1) + 1,
        last_seen: new Date().toISOString(),
        confidence_weight: newWeight,
      })
      .eq('id', existing.id);
    if (error) {
      console.warn('merchant_memory update failed:', error.message);
      return false;
    }
  } else {
    const { error } = await supabase
      .from('merchant_memory')
      .insert({
        merchant_key: merchantKey,
        mode,
        raw_example: rawExample,
        most_common_category: category,
        most_common_method: method,
        default_note_template: notes,
        times_seen: 1,
        // Recurring confirmations start at 90 so subsequent single charges land in Subscriptions
        confidence_weight: isRecurring ? 90 : 82,
        owner_id: ownerId,
      });
    if (error) {
      console.warn('merchant_memory insert failed:', error.message);
      return false;
    }
  }
  return true;
}
