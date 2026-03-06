/**
 * Normalize transaction descriptions for matching.
 * Strips transaction IDs, random strings, extra whitespace, and bank metadata.
 */
export function normalizeDescription(raw: string): string {
  if (!raw) return '';
  
  let normalized = raw.toUpperCase().trim();
  
  // Remove common transaction ID patterns
  normalized = normalized.replace(/\b(CONF#|JPM|TRN:|TRACE#:|EED:|IND ID:|CO ID:|SEC:|ORIG ID:)\s*[\w#*]+/gi, '');
  normalized = normalized.replace(/\b\d{10,}\b/g, ''); // long numeric strings
  normalized = normalized.replace(/\b[A-Z0-9]{8,}[A-Z]{2}\b/g, ''); // alphanumeric IDs like JPM99bfmb9ru
  normalized = normalized.replace(/#\w+/g, ''); // hash IDs
  normalized = normalized.replace(/\*\w+/g, match => {
    // Keep FACEBK * type patterns but remove random suffixes
    if (match.length > 6) return '';
    return match;
  });
  
  // Remove bank metadata noise
  normalized = normalized.replace(/ORIG CO NAME:.*?(TRACE|EED|IND|TRN|$)/gi, '');
  normalized = normalized.replace(/DESC DATE:\d+/gi, '');
  normalized = normalized.replace(/CO ENTRY DESCR:\w+/gi, '');
  normalized = normalized.replace(/INDN?:\S+/gi, '');
  normalized = normalized.replace(/\bXXXXX\w*/g, '');
  normalized = normalized.replace(/\bDES:\w+/g, '');
  
  // Remove dates in various formats
  normalized = normalized.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, '');
  
  // Remove location suffixes (state codes)
  normalized = normalized.replace(/\s{2,}[A-Z]{2}\s*$/g, '');
  
  // Clean up AplPay prefix
  normalized = normalized.replace(/^APLPAY\s+/i, '');
  
  // Clean up extra spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Generate a merchant key from a normalized description.
 * Used for merchant memory lookup.
 */
export function generateMerchantKey(normalized: string): string {
  if (!normalized) return '';
  
  let key = normalized;
  
  // For FACEBK/META entries, normalize to just FACEBK
  if (key.includes('FACEBK') || key.includes('FACEBOOK')) {
    return 'FACEBK';
  }
  if (key.includes('TIKTOK')) return 'TIKTOK ADS';
  if (key.includes('UBER') && key.includes('EATS')) return 'UBER EATS';
  if (key.includes('UBER') && key.includes('TRIP')) return 'UBER TRIP';
  if (key.includes('LYFT')) return 'LYFT';
  if (key.includes('INTUIT') && key.includes('QBOOKS')) return 'INTUIT QBOOKS';
  if (key.includes('INTUIT') && (key.includes('TRAN FEE') || key.includes('PYMT'))) return 'INTUIT FEE';
  if (key.includes('AIRTABLE')) return 'AIRTABLE';
  if (key.includes('OPENAI')) return 'OPENAI';
  if (key.includes('GOOGLE')) return 'GOOGLE ADS';
  
  // For Zelle payments, extract recipient name
  const zelleMatch = key.match(/ZELLE PAYMENT (?:TO|FROM)\s+([A-Z\s]+?)(?:\s+JPM|\s+CONF|\s+\d|$)/i);
  if (zelleMatch) {
    return `ZELLE ${zelleMatch[1].trim()}`;
  }
  
  // Take first meaningful words (up to 30 chars)
  key = key.replace(/[^A-Z0-9\s'-]/g, '').trim();
  if (key.length > 30) key = key.substring(0, 30).trim();
  
  return key || normalized.substring(0, 30);
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
    // Apply remapping to the first part
    return remapCategory(parts[0], description);
  }
  
  return category;
}

/**
 * Parse amount from CSV, handling negative signs and dollar signs.
 */
export function parseAmount(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.abs(num);
}

/**
 * Parse date from various formats.
 */
export function parseDate(value: string): string | null {
  if (!value) return null;
  
  // Handle M/D/YYYY or MM/DD/YYYY
  const parts = value.split('/');
  if (parts.length === 3) {
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }
  
  // Try ISO format
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  
  return null;
}
