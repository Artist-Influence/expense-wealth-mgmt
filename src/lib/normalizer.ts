/**
 * Extract the real merchant/payee entity from ACH-style bank descriptions.
 * Handles ORIG CO NAME, IND NAME, and similar bank metadata patterns.
 */
export function extractEntity(raw: string): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();

  // Extract from ORIG CO NAME: — this is the primary merchant identifier in ACH rows
  const origCoMatch = upper.match(/ORIG CO NAME:\s*([A-Z0-9][\w\s&'./-]*?)(?:\s+(?:ORIG|TRACE|EED|IND|TRN|SEC|CO ENTRY|DESC DATE|\d{6,})|$)/);
  if (origCoMatch) {
    const entity = origCoMatch[1].replace(/\s+/g, ' ').trim();
    // Strip trailing numeric IDs from entity
    return entity.replace(/\s+\d{5,}$/, '').trim();
  }

  // Extract from IND NAME: — secondary identifier (often the person/recipient)
  const indNameMatch = upper.match(/IND NAME:\s*([A-Z][\w\s&'./-]*?)(?:\s+(?:ORIG|TRACE|EED|TRN|SEC|CO ENTRY|DESC DATE|IND ID|\d{6,})|$)/);
  if (indNameMatch) {
    return indNameMatch[1].replace(/\s+/g, ' ').trim();
  }

  return null;
}

/**
 * Normalize transaction descriptions for matching.
 * Extracts merchant entity first, then strips noise.
 */
export function normalizeDescription(raw: string): string {
  if (!raw) return '';

  let normalized = raw.toUpperCase().trim();

  // Step 1: Extract the real entity from ACH-style descriptions BEFORE stripping
  const entity = extractEntity(raw);

  // Step 2: Strip all bank metadata noise fields
  // Remove ORIG CO NAME block (we already extracted from it)
  normalized = normalized.replace(/ORIG CO NAME:\s*[^|]*?(?=\s+(?:ORIG ID|TRACE|EED|IND|TRN|SEC|CO ENTRY|DESC DATE)|$)/gi, '');
  // Remove other metadata fields
  normalized = normalized.replace(/\b(ORIG ID|TRACE#?|EED|IND ID|CO ID|SEC|TRN|CONF#?|CO ENTRY DESCR)[:\s]*[\w#*-]*/gi, '');
  normalized = normalized.replace(/IND NAME:\s*[A-Z][\w\s&'./-]*?(?=\s+(?:ORIG|TRACE|EED|TRN|SEC|CO ENTRY|DESC DATE|IND ID|\d{6,})|$)/gi, '');
  normalized = normalized.replace(/DESC DATE:\s*\d+/gi, '');

  // Remove common bank transport words. CREDIT/DEBIT only strip as part of
  // card/txn-type phrases or at the end — merchants like CREDIT KARMA keep theirs.
  normalized = normalized.replace(/\b(ONLINE|ACH|PENDING|VIA)\b/gi, '');
  normalized = normalized.replace(/\b(CREDIT|DEBIT)\s+(CARD|PURCHASE|PAYMENT|MEMO|PIN)\b/gi, '');
  normalized = normalized.replace(/\s+(CREDIT|DEBIT)\s*$/gi, '');

  // Remove long numeric strings (transaction IDs)
  normalized = normalized.replace(/\b\d{8,}\b/g, '');
  // Remove alphanumeric IDs like JPM99bfmb9ru — must contain a digit, or real
  // merchant words (SQUARESPACE, CRUNCHYROLL) get erased and fingerprints collide.
  normalized = normalized.replace(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{8,}[A-Z]{2}\b/g, '');
  // Remove hash IDs
  normalized = normalized.replace(/#\w+/g, '');
  // Star suffixes: random ids (contain digits) are noise; alpha suffixes are the
  // seller's actual name (SQ *COFFEEHOUSE) and must survive as words.
  normalized = normalized.replace(/\*(\w+)/g, (_m, word: string) =>
    /\d/.test(word) ? '' : ` ${word}`,
  );

  // Remove masked account numbers
  normalized = normalized.replace(/\bXXXXX\w*/g, '');
  normalized = normalized.replace(/\bDES:\w+/g, '');
  normalized = normalized.replace(/ENDING\s*(?:IN\s*)?\d+/gi, '');
  normalized = normalized.replace(/CARD\s*ENDING\s*\d*/gi, '');
  normalized = normalized.replace(/ACCOUNT\s*ENDING\s*\d*/gi, '');

  // Remove dates in various formats
  normalized = normalized.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, '');

  // Remove location suffixes (state codes at end)
  normalized = normalized.replace(/\s{2,}[A-Z]{2}\s*$/g, '');

  // Clean up AplPay prefix
  normalized = normalized.replace(/^APLPAY\s+/i, '');

  // Clean up extra spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Step 3: If we extracted a meaningful entity and the normalized result is short/empty,
  // prefer the entity
  if (entity && entity.length > 2) {
    // If normalized is mostly noise or very short, use entity
    if (!normalized || normalized.length < 4 || normalized === entity) {
      return entity;
    }
    // If the entity isn't already present in normalized, prepend it
    if (!normalized.includes(entity)) {
      return `${entity} ${normalized}`.trim();
    }
  }

  // Never return empty for a non-empty input: an empty key would collide
  // fingerprints across totally different merchants. Fall back to the raw
  // description, minimally cleaned.
  if (!normalized) {
    return raw.toUpperCase().replace(/\s+/g, ' ').trim();
  }

  return normalized;
}

/**
 * Alias map: maps known merchant patterns to canonical keys.
 * Each entry: [test function, canonical key generator]
 */
const MERCHANT_ALIASES: [((key: string) => boolean), ((key: string) => string)][] = [
  // Facebook / Meta
  [k => k.includes('FACEBK') || k.includes('FACEBOOK') || k.includes('META PLATFORMS'), () => 'FACEBK'],

  // TikTok
  [k => k.includes('TIKTOK'), () => 'TIKTOK ADS'],

  // Uber
  [k => k.includes('UBER') && k.includes('EATS'), () => 'UBER EATS'],
  [k => k.includes('UBER') && (k.includes('TRIP') || k.includes('RIDE')), () => 'UBER TRIP'],
  [k => k.includes('UBER') && !k.includes('EATS') && !k.includes('TRIP') && !k.includes('RIDE'), () => 'UBER'],

  // Lyft
  [k => k.includes('LYFT'), () => 'LYFT'],

  // Intuit / QuickBooks
  [k => (k.includes('INTUIT') || k.includes('QUICKBOOKS') || k.includes('QB PAYROLL') || k.includes('QBOOKS')) && (k.includes('PAYROLL') || k.includes('QB PAYROLL')), () => 'INTUIT PAYROLL'],
  [k => (k.includes('INTUIT') || k.includes('QUICKBOOKS') || k.includes('QBOOKS')) && (k.includes('TRAN FEE') || k.includes('FEE') || k.includes('PYMT')), () => 'INTUIT FEE'],
  [k => (k.includes('INTUIT') || k.includes('QUICKBOOKS') || k.includes('QBOOKS')) && k.includes('DEPOSIT'), () => 'INTUIT DEPOSIT'],
  [k => k.includes('INTUIT') || k.includes('QUICKBOOKS') || k.includes('QBOOKS') || k.includes('QB PAYROLL'), () => 'INTUIT'],

  // PayPal
  [k => k.includes('PAYPAL'), () => 'PAYPAL'],

  // Google
  [k => k.includes('GOOGLE') && k.includes('ONE'), () => 'GOOGLE ONE'],
  [k => k.includes('GOOGLE') && (k.includes('CLOUD') || k.includes('WORKSPACE')), () => 'GOOGLE CLOUD'],
  [k => k.includes('GOOGLE') && k.includes('ADS'), () => 'GOOGLE ADS'],
  [k => k.includes('GOOGLE'), () => 'GOOGLE'],

  // Airtable
  [k => k.includes('AIRTABLE'), () => 'AIRTABLE'],

  // OpenAI
  [k => k.includes('OPENAI') || k.includes('CHATGPT'), () => 'OPENAI'],

  // Whop
  [k => k.includes('WHOP'), () => 'WHOPCOM'],

  // Verizon
  [k => k.includes('VERIZON'), () => 'VERIZON'],

  // Wise
  [k => k.includes('WISE') && !k.includes('OTHERWISE'), () => 'WISE'],

  // Zelle — extract recipient
  [k => k.includes('ZELLE'), k => {
    const zelleMatch = k.match(/ZELLE\s*(?:PAYMENT\s*)?(?:TO|FROM)\s+([A-Z\s]+?)(?:\s+JPM|\s+CONF|\s+\d|$)/i);
    if (zelleMatch) return `ZELLE ${zelleMatch[1].trim()}`;
    return 'ZELLE';
  }],

  // Venmo
  [k => k.includes('VENMO'), () => 'VENMO'],

  // Amazon
  [k => k.includes('AMAZON') || k.includes('AMZN'), () => 'AMAZON'],

  // Apple — token-bounded so APPLEBEES et al. keep their own identity
  [k => /\bAPPLE\b/.test(k) && k.includes('STORAGE'), () => 'APPLE STORAGE'],
  [k => /\bAPPLE\b/.test(k), () => 'APPLE'],

  // Stripe
  [k => k.includes('STRIPE'), () => 'STRIPE'],

  // Square the processor only (leading token). TIMES SQUARE PARKING and
  // individual SQ sellers keep their own keys.
  [k => /^SQUARE\b/.test(k), () => 'SQUARE'],

  // Shopify
  [k => k.includes('SHOPIFY'), () => 'SHOPIFY'],
];

/**
 * Generate a merchant key from a normalized description.
 * Uses alias matching for known merchants, then falls back to truncation.
 */
export function generateMerchantKey(normalized: string): string {
  if (!normalized) return '';

  const key = normalized.toUpperCase().trim();

  // Check alias map
  for (const [test, getKey] of MERCHANT_ALIASES) {
    if (test(key)) {
      return getKey(key);
    }
  }

  // For remaining descriptions, clean and truncate
  let result = key.replace(/[^A-Z0-9\s'-]/g, '').trim();
  if (result.length > 30) result = result.substring(0, 30).trim();

  return result || normalized.substring(0, 30);
}

/**
 * Apply category remapping rules.
 */
export function remapCategory(category: string, description: string): string {
  const descUpper = (description || '').toUpperCase();
  const catUpper = (category || '').toUpperCase();

  // Cannabis → Substances
  if (catUpper.includes('CANNABIS') || descUpper.includes('CANNABIS') ||
      descUpper.includes('DISPENSARY') || descUpper.includes('DREAM BUDZ')) {
    return 'Substances';
  }

  // Pokemon → Investment
  if (catUpper.includes('POKEMON') || descUpper.includes('POKEMON') ||
      descUpper.includes('POKE COURT')) {
    return 'Investment';
  }

  // Clean up multi-select categories (take first one)
  if (category && category.includes(',')) {
    const parts = category.split(',').map(s => s.trim());
    return remapCategory(parts[0], description);
  }

  return category;
}

/**
 * Parse amount from CSV, handling dollar signs, accounting negatives
 * "(123.45)", trailing minus "123.45-", and European "1.234,56".
 */
export function parseAmount(value: string): number {
  if (!value) return 0;
  let cleaned = value.trim();
  let negative = false;

  const paren = cleaned.match(/^\((.*)\)$/);
  if (paren) {
    negative = true;
    cleaned = paren[1];
  }
  if (/-\s*$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.replace(/-\s*$/, '');
  }

  // European decimal comma (dot thousands + comma cents) — unambiguous shape only.
  const bare = cleaned.replace(/[$\s]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(bare)) {
    cleaned = bare.replace(/\./g, '').replace(',', '.');
  }

  const num = parseFloat(cleaned.replace(/[$,\s]/g, ''));
  if (isNaN(num)) return 0;
  return negative ? -Math.abs(num) : num;
}

/**
 * Parse date from various formats to a local YYYY-MM-DD string.
 * Never round-trips through UTC (toISOString shifts a day in negative-offset
 * timezones) and strips time-of-day suffixes before parsing.
 */
export function parseDate(value: string): string | null {
  if (!value) return null;
  let v = value.trim();

  // Drop a trailing time component: "6/15/2024 3:45 PM", "2024-06-15 23:30:00"
  v = v.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, '').trim();

  // M/D/YYYY or MM/DD/YY — validated numerically
  const parts = v.split('/');
  if (parts.length === 3) {
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    let yearStr = parts[2].trim();
    if (/^\d{2}$/.test(yearStr)) yearStr = '20' + yearStr;
    const year = parseInt(yearStr, 10);
    if (
      month >= 1 && month <= 12 &&
      day >= 1 && day <= 31 &&
      year >= 1970 && year <= 2100
    ) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return null;
  }

  // Already ISO — take as-is
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const m = parseInt(iso[2], 10);
    const d = parseInt(iso[3], 10);
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? v : null;
  }

  // Word dates ("June 15, 2024", "15-Jun-2024") — format from LOCAL components.
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  return null;
}
