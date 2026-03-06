const METHOD_PATTERNS: [RegExp, string][] = [
  [/amex[\s_-]*platinum/i, 'Amex Platinum'],
  [/bo?a[\s_-]*5563/i, 'BoA 5563'],
  [/bo?a[\s_-]*5592/i, 'BoA 5592'],
  [/bo?a[\s_-]*5573/i, 'BoA 5573'],
  [/bo?a[\s_-]*credit/i, 'BoA Credit Card'],
  [/chase[\s_-]*2662/i, 'Chase Credit Card'],
  [/chase[\s_-]*8886/i, 'Chase Checking/Debit'],
];

export function detectMethodFromFilename(filename: string): string | null {
  for (const [pattern, method] of METHOD_PATTERNS) {
    if (pattern.test(filename)) return method;
  }
  return null;
}
