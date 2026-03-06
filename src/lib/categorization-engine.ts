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
  match_source: 'exact_history' | 'normalized_history' | 'rule' | 'ai' | null;
  review_status: 'auto_categorized' | 'suggested' | 'needs_review';
}

interface Thresholds {
  auto: number;
  suggest: number;
}

export async function categorizeTransactions(
  transactions: ParsedTransaction[],
  mode: 'personal' | 'business',
  ownerId: string,
  thresholds: Thresholds = { auto: 90, suggest: 70 }
): Promise<CategorizationResult[]> {
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
    // Layer 1: Historical Memory
    const merchantKey = tx.merchant_key || generateMerchantKey(tx.description_normalized);
    const memory = memoryMap.get(merchantKey);

    if (memory && memory.most_common_category) {
      const baseConfidence = Math.min(memory.confidence_weight, 99);
      const timesBonus = Math.min(memory.times_seen * 2, 10);
      const confidence = Math.min(baseConfidence + timesBonus, 99);
      
      const category = remapCategory(memory.most_common_category, tx.description_raw);

      return buildResult(
        category,
        memory.most_common_method,
        memory.default_note_template,
        confidence,
        memory.times_seen > 1 ? 'exact_history' : 'normalized_history',
        thresholds
      );
    }

    // Layer 2: Rules Engine
    for (const rule of rules) {
      if (matchesRule(tx.description_normalized, tx.description_raw, rule)) {
        const category = rule.category_output ? remapCategory(rule.category_output, tx.description_raw) : null;
        return buildResult(
          category,
          rule.method_output,
          rule.notes_output,
          85,
          'rule',
          thresholds
        );
      }
    }

    // Layer 3: Use CSV-provided category if available
    if (tx.category) {
      const category = remapCategory(tx.category, tx.description_raw);
      return buildResult(
        category,
        tx.method,
        tx.notes,
        75,
        'exact_history',
        thresholds
      );
    }

    // No match
    return buildResult(null, null, null, 0, null, thresholds);
  });
}

function matchesRule(normalized: string, raw: string, rule: RuleRecord): boolean {
  const target = normalized || raw;
  const pattern = rule.pattern.toUpperCase();

  switch (rule.match_type) {
    case 'contains':
      return target.toUpperCase().includes(pattern);
    case 'equals':
      return target.toUpperCase() === pattern;
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(target);
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
  thresholds: Thresholds
): CategorizationResult {
  let reviewStatus: CategorizationResult['review_status'];
  
  if (confidence >= thresholds.auto) {
    reviewStatus = 'auto_categorized';
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
    review_status: reviewStatus,
  };
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
    const newWeight = Math.min((existing.confidence_weight || 80) + 2, 99);
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
        confidence_weight: 80,
        owner_id: ownerId,
      });
  }
}
