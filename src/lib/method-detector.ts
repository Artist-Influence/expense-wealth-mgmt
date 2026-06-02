export interface MethodPattern {
  name: string;
  match_pattern: string | null;
}

// Fallback built-in patterns (also seeded into the payment_methods table).
// Used only when no saved methods are provided.
const FALLBACK_PATTERNS: [RegExp, string][] = [
  [/amex[\s_-]*platinum/i, 'Amex Platinum'],
  [/bo?a[\s_-]*5563/i, 'BoA 5563'],
  [/bo?a[\s_-]*5592/i, 'BoA 5592'],
  [/bo?a[\s_-]*5573/i, 'BoA 5573'],
  [/bo?a[\s_-]*5373/i, 'BoA 5373'],
  [/bo?a[\s_-]*credit/i, 'BoA Credit Card'],
  [/chase[\s_-]*2662/i, 'Chase Credit Card'],
  [/chase[\s_-]*8886/i, 'Chase Checking/Debit'],
];

/**
 * Detect the payment method from a CSV filename.
 * When `methods` (saved payment methods) are provided, their `match_pattern`
 * is used (treated as a case-insensitive regex, falling back to substring
 * matching if the pattern is not valid regex). Otherwise the built-in
 * fallback patterns are used.
 */
export function detectMethodFromFilename(filename: string, methods?: MethodPattern[]): string | null {
  if (methods && methods.length > 0) {
    for (const m of methods) {
      const pattern = m.match_pattern?.trim();
      if (!pattern) continue;
      try {
        if (new RegExp(pattern, 'i').test(filename)) return m.name;
      } catch {
        if (filename.toLowerCase().includes(pattern.toLowerCase())) return m.name;
      }
    }
    return null;
  }

  for (const [pattern, method] of FALLBACK_PATTERNS) {
    if (pattern.test(filename)) return method;
  }
  return null;
}
