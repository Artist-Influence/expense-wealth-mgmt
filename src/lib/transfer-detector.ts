const TRANSFER_PATTERNS: [RegExp, string][] = [
  // Credit card payments
  [/PAYMENT\s*-?\s*THANK\s*YOU/i, 'credit_card_payment'],
  [/ONLINE\s*PAYMENT/i, 'credit_card_payment'],
  [/CREDIT\s*CARD\s*PAYMENT/i, 'credit_card_payment'],
  [/AUTOPAY\s*PAYMENT/i, 'credit_card_payment'],
  [/AUTO\s*PAY/i, 'credit_card_payment'],
  [/ACH\s*PAYMENT/i, 'credit_card_payment'],
  [/AMEX\s*PAYMENT/i, 'credit_card_payment'],
  [/BOA\s*PAYMENT/i, 'credit_card_payment'],
  [/CHASE\s*PAYMENT/i, 'credit_card_payment'],
  [/CARD\s*PAYMENT/i, 'credit_card_payment'],
  [/(?:^|\s)PMT\s*(?:RECEIVED|THANK|REC'?D)/i, 'credit_card_payment'],
  [/(?:^|\s)PYMT\s*(?:RECEIVED|THANK|REC'?D)/i, 'credit_card_payment'],
  [/PAYMENT\s*RECEIVED/i, 'credit_card_payment'],
  [/TO\s*CREDIT\s*CARD/i, 'credit_card_payment'],
  [/FROM\s*CHECKING/i, 'credit_card_payment'],
  [/BALANCE\s*PAY/i, 'credit_card_payment'],
  [/PAYMENT\s*TO\s*.*CARD\s*ENDING/i, 'credit_card_payment'],
  [/ONLINE\s*ACH\s*PAYMENT\s*TO/i, 'credit_card_payment'],

  // Account transfers
  [/TRANSFER\s*TO/i, 'account_transfer'],
  [/TRANSFER\s*FROM/i, 'account_transfer'],
  [/INTERNAL\s*TRANSFER/i, 'account_transfer'],
  [/FUNDS\s*TRANSFER/i, 'account_transfer'],
  [/WIRE\s*TRANSFER/i, 'account_transfer'],
  [/XFER\b/i, 'account_transfer'],
  [/SAVE\s*AS\s*YOU\s*GO/i, 'account_transfer'],
  [/SAVINGS\s*TRANSFER/i, 'account_transfer'],
  [/ONLINE\s*DOMESTIC\s*WIRE/i, 'account_transfer'],
];

export interface TransferDetectionResult {
  isTransfer: boolean;
  transferType: 'credit_card_payment' | 'account_transfer' | 'unknown_transfer' | null;
}

export function detectTransfer(description: string): TransferDetectionResult {
  if (!description) return { isTransfer: false, transferType: null };

  for (const [pattern, type] of TRANSFER_PATTERNS) {
    if (pattern.test(description)) {
      return {
        isTransfer: true,
        transferType: type as TransferDetectionResult['transferType'],
      };
    }
  }

  return { isTransfer: false, transferType: null };
}
