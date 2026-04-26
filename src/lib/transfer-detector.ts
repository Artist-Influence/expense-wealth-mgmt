export type TransferConfidence = 'high' | 'medium' | 'low';

const HIGH_CONFIDENCE_PATTERNS: [RegExp, string][] = [
  // Credit card payments — unambiguous inter-account movements
  [/PAYMENT\s*-?\s*THANK\s*YOU/i, 'credit_card_payment'],
  [/AUTOPAY\s*PAYMENT/i, 'credit_card_payment'],
  [/AUTO\s*PAY\s*(?:PAYMENT|PMT)/i, 'credit_card_payment'],
  [/AMEX\s*(?:EPAYMENT|PAYMENT)/i, 'credit_card_payment'],
  [/AMERICAN\s*EXPRESS\s*DES:?\s*ACH\s*P(?:M|Y)?T/i, 'credit_card_payment'],
  [/CHASE\s*CREDIT\s*(?:CRD|CARD)\s*(?:EPAY|AUTOPAY|PMT|PAYMENT)/i, 'credit_card_payment'],
  [/(?:DISCOVER|CITI(?:CARDS|BANK)?|CAPITAL\s*ONE|BARCLAY(?:CARD)?|US\s*BANK\s*CARD)\s*(?:CARD\s*)?(?:DES:?\s*)?(?:ACH\s*)?(?:PMT|PAYMENT|EPAY|AUTOPAY)/i, 'credit_card_payment'],
  [/(?:^|\s)(?:PMT|PYMT)\s*(?:RECEIVED|THANK|REC'?D)/i, 'credit_card_payment'],
  [/PAYMENT\s*RECEIVED\s*-?\s*THANK/i, 'credit_card_payment'],
  [/TO\s*CREDIT\s*CARD/i, 'credit_card_payment'],

  [/PAYMENT\s*TO\s*.*CARD\s*ENDING/i, 'credit_card_payment'],
  [/ONLINE\s*PAYMENT\s*-?\s*THANK/i, 'credit_card_payment'],

  // Internal account transfers — unambiguous
  [/INTERNAL\s*TRANSFER/i, 'account_transfer'],
  [/SAVE\s*AS\s*YOU\s*GO/i, 'account_transfer'],
  [/SAVINGS\s*TRANSFER/i, 'account_transfer'],
  [/ONLINE\s*BANKING\s*TRANSFER\s*(?:TO|FROM)/i, 'account_transfer'],
  [/TRANSFER\s*(?:TO|FROM)\s*(?:SAVINGS|CHECKING|CHK|SAV|(?:X|XXXX?\d{4}))/i, 'account_transfer'],

  // Brokerage / investment transfers — money movement into wealth, not spend
  [/\bWEALTHFRONT\b/i, 'brokerage_transfer'],
  [/\bBETTERMENT\b/i, 'brokerage_transfer'],
  [/\bROBINHOOD\b/i, 'brokerage_transfer'],
  [/\bCOINBASE\b/i, 'brokerage_transfer'],
  [/GEMINI\s*TRUST/i, 'brokerage_transfer'],
  [/\bDUB\s*\(?ECFI\)?/i, 'brokerage_transfer'],
  [/\bFIDELITY\b/i, 'brokerage_transfer'],
  [/\bVANGUARD\b/i, 'brokerage_transfer'],
  [/(?:CHARLES\s*)?SCHWAB/i, 'brokerage_transfer'],
  [/\bE\*?TRADE\b/i, 'brokerage_transfer'],
  [/\bKRAKEN\b/i, 'brokerage_transfer'],
  [/\bBINANCE\b/i, 'brokerage_transfer'],
];

const MEDIUM_CONFIDENCE_PATTERNS: [RegExp, string][] = [
  // These CAN be real expenses — flag for review but don't auto-exclude
  [/BALANCE\s*PAY(?:MENT)?/i, 'possible_transfer'],
  [/WIRE\s*TRANSFER/i, 'possible_transfer'],
  [/FUNDS\s*TRANSFER/i, 'possible_transfer'],
  [/ONLINE\s*DOMESTIC\s*WIRE/i, 'possible_transfer'],
  [/ACH\s*(?:CREDIT|DEBIT)\s*(?:PAYMENT|PMT)/i, 'possible_transfer'],
  [/TRANSFER\s*(?:TO|FROM)\b/i, 'possible_transfer'],
  [/XFER\s+(?:TO|FROM|IN|OUT)\b/i, 'possible_transfer'],
];

const LOW_CONFIDENCE_PATTERNS: [RegExp, string][] = [
  [/\bXFER\b/i, 'possible_transfer'],
  [/FROM\s*CHECKING/i, 'possible_transfer'],
];

export interface TransferDetectionResult {
  isTransfer: boolean;
  transferType: 'credit_card_payment' | 'account_transfer' | 'brokerage_transfer' | 'possible_transfer' | 'unknown_transfer' | null;
  transferConfidence: TransferConfidence | null;
}

export function detectTransfer(description: string): TransferDetectionResult {
  if (!description) return { isTransfer: false, transferType: null, transferConfidence: null };

  for (const [pattern, type] of HIGH_CONFIDENCE_PATTERNS) {
    if (pattern.test(description)) {
      return {
        isTransfer: true,
        transferType: type as TransferDetectionResult['transferType'],
        transferConfidence: 'high',
      };
    }
  }

  for (const [pattern, type] of MEDIUM_CONFIDENCE_PATTERNS) {
    if (pattern.test(description)) {
      return {
        isTransfer: false,
        transferType: 'possible_transfer',
        transferConfidence: 'medium',
      };
    }
  }

  for (const [pattern] of LOW_CONFIDENCE_PATTERNS) {
    if (pattern.test(description)) {
      return {
        isTransfer: false,
        transferType: 'possible_transfer',
        transferConfidence: 'low',
      };
    }
  }

  return { isTransfer: false, transferType: null, transferConfidence: null };
}
