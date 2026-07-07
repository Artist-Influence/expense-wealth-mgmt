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

/** Normalize a string for name matching: lowercase, strip everything but a-z0-9. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Detect the payment method from a CSV filename.
 *
 * When saved `methods` are provided we match in two passes:
 *  1. Any method's explicit `match_pattern` (case-insensitive regex, falling
 *     back to substring) — lets power users pin tricky filenames.
 *  2. The method's NAME appearing in the filename. This is what makes it
 *     "just work" for any card you add: name a method "Karat" and a
 *     `karat-2026.csv` upload is recognized without configuring anything.
 *     Most-specific (longest) name wins to avoid a short name shadowing a
 *     longer one.
 * Falls back to the built-in patterns only when no saved methods are given.
 */
export function detectMethodFromFilename(filename: string, methods?: MethodPattern[]): string | null {
  const fnameLower = filename.toLowerCase();
  const fnameNorm = norm(filename);

  if (methods && methods.length > 0) {
    // Pass 1 — explicit patterns.
    for (const m of methods) {
      const pattern = m.match_pattern?.trim();
      if (!pattern) continue;
      try {
        if (new RegExp(pattern, 'i').test(filename)) return m.name;
      } catch {
        if (fnameLower.includes(pattern.toLowerCase())) return m.name;
      }
    }
    // Pass 2 — match by method name (longest first).
    const byNameLength = [...methods].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
    for (const m of byNameLength) {
      const nameNorm = norm(m.name || '');
      if (nameNorm.length >= 3 && fnameNorm.includes(nameNorm)) return m.name;
    }
    return null;
  }

  for (const [pattern, method] of FALLBACK_PATTERNS) {
    if (pattern.test(filename)) return method;
  }
  return null;
}
