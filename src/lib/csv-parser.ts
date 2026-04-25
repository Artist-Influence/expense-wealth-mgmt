import Papa from 'papaparse';
import { normalizeDescription, generateMerchantKey, remapCategory, parseAmount, parseDate } from './normalizer';

export interface ParsedTransaction {
  date: string | null;
  description_raw: string;
  description_normalized: string;
  merchant_key: string;
  amount: number;
  category: string | null;
  method: string | null;
  notes: string | null;
  source_row_json: Record<string, string>;
  parse_status: 'ok' | 'parse_error';
  parse_error: string | null;
}

export interface ColumnMapping {
  description: string | null;
  amount: string | null;
  date: string | null;
  category: string | null;
  method: string | null;
  notes: string | null;
}

export interface ParsePreview {
  headers: string[];
  mapping: ColumnMapping;
  rowCount: number;
  sampleRows: Record<string, string>[];
  unmappedRequired: string[];
}

interface CsvRow {
  [key: string]: string;
}

const DESCRIPTION_CANDIDATES = ['short description', 'description', 'desc', 'merchant', 'vendor', 'store', 'name', 'memo', 'transaction description', 'payee'];
const AMOUNT_CANDIDATES = ['total', 'amount', 'debit', 'credit', 'value', 'sum', 'transaction amount'];
const DATE_CANDIDATES = ['date & time', 'date', 'transaction date', 'post date', 'posted date', 'trans date'];
const CATEGORY_CANDIDATES = ['category', 'expense type', 'expense category', 'sub-category', 'subcategory', 'tags'];
const METHOD_CANDIDATES = ['method', 'payment method', 'card', 'card used', 'paid with', 'account', 'source'];
const NOTES_CANDIDATES = ['notes', 'note', 'memo', 'comment', 'comments', 'reference'];

const STATEMENT_ARTIFACT_PATTERNS = [
  /^(beginning|ending|opening|closing)\s+balance/i,
  /^total\s+(credits|debits|charges|fees|interest|payments)/i,
  /^(statement|account)\s+(summary|period|ending|opening|balance)/i,
  /^(interest|fee|finance)\s+charge/i,
  /^(minimum|previous|new)\s+(payment|balance)/i,
  /^(credit|debit)\s+adjustments?$/i,
  /^balance\s+(forward|brought|carried)/i,
  /^(days?\s+in\s+billing|billing\s+period)/i,
  /^(annual|monthly)\s+percentage/i,
  /^\s*$/,
];

/**
 * Returns true if the row is statement metadata, not a real transaction.
 */
export function isStatementArtifact(description: string, amount: number): boolean {
  const trimmed = (description || '').trim();
  if (!trimmed) return true;
  for (const pattern of STATEMENT_ARTIFACT_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  // 0-amount rows with non-merchant-looking descriptions
  if (amount === 0 && trimmed.length < 5) return true;
  return false;
}

/**
 * 3-tier matching: exact → starts-with → contains
 */
function findColumn(headers: string[], candidates: string[]): string | null {
  const cleanHeaders = headers.map(h => h.replace(/^\uFEFF/, '').trim());
  
  for (const candidate of candidates) {
    const idx = cleanHeaders.findIndex(h => h.toLowerCase() === candidate.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  for (const candidate of candidates) {
    const idx = cleanHeaders.findIndex(h => h.toLowerCase().startsWith(candidate.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  for (const candidate of candidates) {
    const idx = cleanHeaders.findIndex(h => h.toLowerCase().includes(candidate.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

/**
 * Some bank CSVs (Bank of America, Chase, Wells Fargo, etc.) prepend a summary
 * block (Beginning Balance, Total Credits, etc.) above the real transaction
 * header row. PapaParse would otherwise read that summary as the header.
 *
 * Scans the first ~25 lines and returns the index of the first line that looks
 * like a real transaction header — defined as a CSV row whose cells contain
 * BOTH a date-ish token AND a description-ish token (and ideally amount).
 * Returns 0 (no trim) if no obvious header is found.
 */
function findHeaderLineIndex(text: string): number {
  const lines = text.split(/\r?\n/);
  const scanLimit = Math.min(lines.length, 25);

  const dateTokens = DATE_CANDIDATES.map(t => t.toLowerCase());
  const descTokens = DESCRIPTION_CANDIDATES.map(t => t.toLowerCase());
  const amountTokens = AMOUNT_CANDIDATES.map(t => t.toLowerCase());

  for (let i = 0; i < scanLimit; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    // Quick CSV split (header sniffing only — full parse not needed)
    const cells = line
      .split(',')
      .map(c => c.replace(/^\s*"?|"?\s*$/g, '').trim().toLowerCase())
      .filter(c => c.length > 0);
    if (cells.length < 2) continue;

    const matchesAny = (cell: string, tokens: string[]) =>
      tokens.some(t => cell === t || cell.startsWith(t));

    const hasDate = cells.some(c => matchesAny(c, dateTokens));
    const hasDesc = cells.some(c => matchesAny(c, descTokens));
    const hasAmount = cells.some(c => matchesAny(c, amountTokens));

    // Real transaction header: needs Date + Description + Amount
    if (hasDate && hasDesc && hasAmount) {
      return i;
    }
  }
  return 0;
}

/**
 * Strips any pre-header summary block (BoA-style "Beginning Balance" rows, etc.)
 * so PapaParse sees the real transaction header as row 1.
 */
function trimToTransactionHeader(text: string): string {
  const idx = findHeaderLineIndex(text);
  if (idx === 0) return text;
  return text.split(/\r?\n/).slice(idx).join('\n');
}

export function previewCsvFile(file: File): Promise<ParsePreview> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = trimToTransactionHeader(stripBom(e.target?.result as string || ''));
      Papa.parse<CsvRow>(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            reject(new Error('No data found in CSV'));
            return;
          }
          const headers = Object.keys(results.data[0]).map(h => h.replace(/^\uFEFF/, '').trim());
          const rawHeaders = Object.keys(results.data[0]);
          const mapping: ColumnMapping = {
            description: findColumn(rawHeaders, DESCRIPTION_CANDIDATES),
            amount: findColumn(rawHeaders, AMOUNT_CANDIDATES),
            date: findColumn(rawHeaders, DATE_CANDIDATES),
            category: findColumn(rawHeaders, CATEGORY_CANDIDATES),
            method: findColumn(rawHeaders, METHOD_CANDIDATES),
            notes: findColumn(rawHeaders, NOTES_CANDIDATES),
          };
          const unmappedRequired: string[] = [];
          if (!mapping.description) unmappedRequired.push('Description');
          if (!mapping.amount) unmappedRequired.push('Amount');
          if (!mapping.date) unmappedRequired.push('Date');
          resolve({ headers, mapping, rowCount: results.data.length, sampleRows: results.data.slice(0, 3), unmappedRequired });
        },
        error: (error) => reject(new Error(`CSV parse error: ${error.message}`)),
      });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function parseCsvFileWithMapping(file: File, mapping: ColumnMapping): Promise<ParsedTransaction[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = stripBom(e.target?.result as string || '');
      Papa.parse<CsvRow>(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            reject(new Error('No data found in CSV'));
            return;
          }

          const transactions: ParsedTransaction[] = results.data
            .filter(row => {
              const desc = mapping.description ? (row[mapping.description] || '').trim() : '';
              const total = mapping.amount ? (row[mapping.amount] || '').trim() : '';
              return desc || total;
            })
            .map(row => {
              const errors: string[] = [];
              const rawDesc = mapping.description ? (row[mapping.description] || '').trim() : '';
              const rawAmount = mapping.amount ? (row[mapping.amount] || '').trim() : '';
              const rawDate = mapping.date ? (row[mapping.date] || '').trim() : '';

              if (!rawDesc) errors.push('Missing description');
              if (!rawAmount) errors.push('Missing amount');

              const parsedDate = rawDate ? parseDate(rawDate) : null;
              if (rawDate && !parsedDate) errors.push(`Unparseable date: ${rawDate}`);

              const amount = rawAmount ? parseAmount(rawAmount) : 0;
              if (rawAmount && amount === 0 && rawAmount !== '0' && rawAmount !== '$0.00') {
                errors.push(`Unparseable amount: ${rawAmount}`);
              }

              const normalized = normalizeDescription(rawDesc);
              const merchantKey = generateMerchantKey(normalized);
              const rawCategory = mapping.category ? (row[mapping.category] || '').trim() : '';
              const category = rawCategory ? remapCategory(rawCategory, rawDesc) : null;

              // Check for statement artifacts
              if (isStatementArtifact(rawDesc, amount)) {
                return null; // will be filtered out
              }

              const hasErrors = errors.length > 0 && !rawDesc && !rawAmount;

              return {
                date: parsedDate,
                description_raw: rawDesc,
                description_normalized: normalized,
                merchant_key: merchantKey,
                amount,
                category,
                method: mapping.method ? (row[mapping.method] || '').trim() || null : null,
                notes: mapping.notes ? (row[mapping.notes] || '').trim() || null : null,
                source_row_json: { ...row },
                parse_status: (hasErrors ? 'parse_error' : 'ok') as 'ok' | 'parse_error',
                parse_error: errors.length > 0 ? errors.join('; ') : null,
              };
            })
            .filter((tx): tx is ParsedTransaction => tx !== null);

          resolve(transactions);
        },
        error: (error) => reject(new Error(`CSV parse error: ${error.message}`)),
      });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function parseCsvFile(file: File): Promise<ParsedTransaction[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = stripBom(e.target?.result as string || '');
      Papa.parse<CsvRow>(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data || results.data.length === 0) {
            reject(new Error('No data found in CSV'));
            return;
          }
          const rawHeaders = Object.keys(results.data[0]);
          const descCol = findColumn(rawHeaders, DESCRIPTION_CANDIDATES);
          const totalCol = findColumn(rawHeaders, AMOUNT_CANDIDATES);
          const dateCol = findColumn(rawHeaders, DATE_CANDIDATES);
          const categoryCol = findColumn(rawHeaders, CATEGORY_CANDIDATES);
          const methodCol = findColumn(rawHeaders, METHOD_CANDIDATES);
          const notesCol = findColumn(rawHeaders, NOTES_CANDIDATES);

          if (!descCol && !totalCol) {
            reject(new Error('CSV must have at least a Description or Total column'));
            return;
          }

          const transactions: ParsedTransaction[] = results.data
            .filter(row => {
              const desc = descCol ? row[descCol] : '';
              const total = totalCol ? row[totalCol] : '';
              return desc || total;
            })
            .reduce<ParsedTransaction[]>((acc, row) => {
              const rawDesc = descCol ? (row[descCol] || '').trim() : '';
              const amount = totalCol ? parseAmount(row[totalCol] || '') : 0;
              if (isStatementArtifact(rawDesc, amount)) return acc;

              const normalized = normalizeDescription(rawDesc);
              const merchantKey = generateMerchantKey(normalized);
              const rawCategory = categoryCol ? (row[categoryCol] || '').trim() : null;
              const category = rawCategory ? remapCategory(rawCategory, rawDesc) : null;

              acc.push({
                date: dateCol ? parseDate(row[dateCol] || '') : null,
                description_raw: rawDesc,
                description_normalized: normalized,
                merchant_key: merchantKey,
                amount,
                category,
                method: methodCol ? (row[methodCol] || '').trim() || null : null,
                notes: notesCol ? (row[notesCol] || '').trim() || null : null,
                source_row_json: { ...row },
                parse_status: 'ok',
                parse_error: null,
              });
              return acc;
            }, []);

          resolve(transactions);
        },
        error: (error: any) => reject(new Error(`CSV parse error: ${error.message}`)),
      });
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}