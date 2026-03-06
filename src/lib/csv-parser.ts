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
}

interface CsvRow {
  [key: string]: string;
}

function findColumn(headers: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const found = headers.find(h => h.toLowerCase().trim() === candidate.toLowerCase());
    if (found) return found;
  }
  return null;
}

export function parseCsvFile(file: File): Promise<ParsedTransaction[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          reject(new Error('No data found in CSV'));
          return;
        }

        const headers = Object.keys(results.data[0]);
        const descCol = findColumn(headers, ['Short Description', 'Description', 'short description']);
        const totalCol = findColumn(headers, ['Total', 'Amount', 'total', 'amount']);
        const dateCol = findColumn(headers, ['Date & Time', 'Date', 'date & time', 'date']);
        const categoryCol = findColumn(headers, ['Category', 'category']);
        const methodCol = findColumn(headers, ['Method', 'method']);
        const notesCol = findColumn(headers, ['Notes', 'notes']);

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
          .map(row => {
            const rawDesc = descCol ? (row[descCol] || '').trim() : '';
            const normalized = normalizeDescription(rawDesc);
            const merchantKey = generateMerchantKey(normalized);
            const rawCategory = categoryCol ? (row[categoryCol] || '').trim() : null;
            const category = rawCategory ? remapCategory(rawCategory, rawDesc) : null;

            return {
              date: dateCol ? parseDate(row[dateCol] || '') : null,
              description_raw: rawDesc,
              description_normalized: normalized,
              merchant_key: merchantKey,
              amount: totalCol ? parseAmount(row[totalCol] || '') : 0,
              category,
              method: methodCol ? (row[methodCol] || '').trim() || null : null,
              notes: notesCol ? (row[notesCol] || '').trim() || null : null,
            };
          });

        resolve(transactions);
      },
      error: (error) => {
        reject(new Error(`CSV parse error: ${error.message}`));
      },
    });
  });
}
