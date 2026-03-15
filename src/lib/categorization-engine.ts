import { supabase } from '@/integrations/supabase/client';
import type { ParsedTransaction } from './csv-parser';
import { generateMerchantKey, remapCategory } from './normalizer';

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
  match_source: 'exact_history' | 'normalized_history' | 'partial_history' | 'rule' | 'ai' | null;
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
  allowedCategories: string[] = []
): Promise<CategorizationResult[]> {
  const allowedSet = new Set(allowedCategories);

  // Load merchant memory for this mode
  const { data: memoryData } = await supabase
    .from('merchant_memory')
    .select('merchant_key, most_common_category, most_common_method, default_note_template, confidence_weight, times_seen')
    .eq('mode', mode)
    .eq('owner_id', ownerId);

  const memoryMap = new Map<string, MerchantMemoryRecord>();
  (memoryData || []).forEach(m => {
    memoryMap.set(m.merchant_key, m as MerchantMemoryRecord);
  });

  // Load rules
  const { data: rulesData } = await supabase
    .from('categorization_rules')
    .select('match_type, pattern, category_output, method_output, notes_output, priority')
    .or(`mode.eq.${mode},mode.eq.both`)
    .eq('is_active', true)
    .eq('owner_id', ownerId)
    .order('priority', { ascending: true });

  const rules = (rulesData || []) as RuleRecord[];

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
 */
export async function updateMerchantMemory(
  merchantKey: string,
  mode: 'personal' | 'business',
  category: string,
  method: string | null,
  notes: string | null,
  rawExample: string,
  ownerId: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('merchant_memory')
    .select('id, times_seen, confidence_weight')
    .eq('merchant_key', merchantKey)
    .eq('mode', mode)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (existing) {
    // Boost confidence more aggressively on manual approval
    const newWeight = Math.min((existing.confidence_weight || 80) + 3, 99);
    await supabase
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
  } else {
    await supabase
      .from('merchant_memory')
      .insert({
        merchant_key: merchantKey,
        mode,
        raw_example: rawExample,
        most_common_category: category,
        most_common_method: method,
        default_note_template: notes,
        times_seen: 1,
        confidence_weight: 82, // Start slightly higher for manual approvals
        owner_id: ownerId,
      });
  }
}
