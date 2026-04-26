export interface IncomeClassification {
  income_type: string;
  taxable_status: string;
  confidence: number;
  suggested_mode: 'personal' | 'business';
}

// Income types that should NOT count as "earned income" for tax reserves,
// allocation math, savings rate, etc. Centralized so all pages stay in sync.
export const NON_EARNING_TYPES = [
  'transfer',
  'refund',
  'reimbursement',
  'loan_proceeds',
  'owner_contribution',
  'tax_refund',
  'personal_repayment', // Friend/family paying you back; not income.
] as const;

export function isEarnedIncome(income_type: string | null | undefined): boolean {
  if (!income_type) return true; // unknown defaults to earned (forces user review)
  return !(NON_EARNING_TYPES as readonly string[]).includes(income_type);
}

const BUSINESS_TYPES = new Set(['business_revenue', 'owner_contribution', 'loan_proceeds']);

// ─── Rule order matters. More specific / higher-confidence patterns first. ───
// Key fix: B2B revenue markers (FEDWIRE/CHIPS to ARTIST INFLUENCE LLC, named
// merchants, Stripe payouts) MUST match before the generic
// transfer/zelle/venmo/wire bucket — otherwise real revenue gets tagged
// non-taxable and disappears from the Tax page.
const RULES: { patterns: RegExp; income_type: string; taxable_status: string; confidence: number }[] = [
  // 1. Payroll providers (highest specificity — these are unambiguous)
  { patterns: /\b(payroll|salary|direct\s*deposit|wages|pay\s?check|adp|gusto|paychex|deel|justworks|rippling|trinet|onpay|bamboohr)\b|SALARY[-\s]/i, income_type: 'payroll', taxable_status: 'taxable', confidence: 90 },

  // 2. Tax refund (very specific — must come before generic refund)
  { patterns: /\b(tax\s*refund|irs\s*treas|state\s*tax\s*refund|federal\s*tax\s*refund)\b/i, income_type: 'tax_refund', taxable_status: 'non_taxable', confidence: 90 },

  // 3. Reimbursement (specific)
  { patterns: /\b(reimbursement|expense\s*repay|expense\s*reimb|reimburse)\b/i, income_type: 'reimbursement', taxable_status: 'non_taxable', confidence: 85 },

  // 4. Refund / cashback (specific)
  { patterns: /\b(refund|return\s*credit|cashback|cash\s*back|chargeback)\b/i, income_type: 'refund', taxable_status: 'non_taxable', confidence: 80 },

  // 5. Interest / dividends (specific)
  { patterns: /\b(interest\s*paid|interest\s*earned|dividend|apy|yield|cd\s*matur)\b/i, income_type: 'interest', taxable_status: 'taxable', confidence: 85 },

  // 6. Owner / capital contribution (must come before transfer; "transfer from owner" should be owner_contribution)
  { patterns: /\b(owner\s*contrib|capital\s*contrib|equity\s*inject|owner\s*draw\s*deposit)\b/i, income_type: 'owner_contribution', taxable_status: 'non_taxable', confidence: 80 },

  // 7. Loan proceeds
  { patterns: /\b(loan\s*proceed|line\s*of\s*credit|loc\s*proceed|loan\s*disburs|sba\s*loan)\b/i, income_type: 'loan_proceeds', taxable_status: 'non_taxable', confidence: 80 },

  // 8. BUSINESS REVENUE — runs BEFORE generic transfer rule.
  //    Catches:
  //    - Named recurring counterparties from Chase 8886 history
  //    - Wire-rail revenue (FEDWIRE CREDIT / CHIPS CREDIT) where description names the LLC
  //    - Stripe / Square payouts (these are revenue, not transfers, even if Stripe calls them "TRANSFER")
  //    - QuickBooks / INTUIT payment processor deposits
  //    - Generic invoice/client/consulting/freelance/contract/revenue language
  {
    patterns: /\b(intuit|quickbooks|currency\s*cloud|audiomack|vydia|dim\s*mak|empire\s*distribut|wenzday|thirty\s*knots|dark\s*roast|space\s*laces|kompany|rule\s*fitness|invoice|client|consulting|freelance|contract|revenue|stripe\s*(transfer|payout)?|square\s*(payout|inc)?)\b|FEDWIRE\s*CREDIT|CHIPS\s*CREDIT|ARTIST\s*INFLUENCE\s*LLC/i,
    income_type: 'business_revenue', taxable_status: 'taxable', confidence: 85,
  },

  // 9. Internal account-to-account transfers — TIGHTENED.
  //    Only fires on explicit own-account language. Generic Zelle/Venmo/PayPal
  //    falls through to "other" with unknown taxable_status so user reviews.
  {
    patterns: /\b(online\s*banking\s*transfer|internal\s*transfer|account\s*transfer|transfer\s*from\s*(chk|sav|checking|savings|chase|boa|bofa|bank\s*of\s*america)|transfer\s*to\s*(chk|sav|checking|savings|chase|boa|bofa|bank\s*of\s*america)|from\s*chk\s*\d|to\s*chk\s*\d|from\s*sav\s*\d|to\s*sav\s*\d|payment\s*from\s*chk|payment\s*to\s*chk|xfer\s*(from|to))\b/i,
    income_type: 'transfer', taxable_status: 'non_taxable', confidence: 85,
  },
];

export function classifyIncome(description: string): IncomeClassification {
  const desc = description || '';
  for (const rule of RULES) {
    if (rule.patterns.test(desc)) {
      return {
        income_type: rule.income_type,
        taxable_status: rule.taxable_status,
        confidence: rule.confidence,
        suggested_mode: BUSINESS_TYPES.has(rule.income_type) ? 'business' : 'personal',
      };
    }
  }
  return { income_type: 'other', taxable_status: 'unknown', confidence: 0, suggested_mode: 'personal' };
}

export const INCOME_TYPE_OPTIONS = [
  { value: 'payroll', label: 'Payroll' },
  { value: 'business_revenue', label: 'Business Revenue' },
  { value: 'refund', label: 'Refund' },
  { value: 'interest', label: 'Interest / Dividend' },
  { value: 'tax_refund', label: 'Tax Refund' },
  { value: 'reimbursement', label: 'Reimbursement' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'personal_repayment', label: 'Personal Repayment / Owed' },
  { value: 'owner_contribution', label: 'Owner Contribution' },
  { value: 'loan_proceeds', label: 'Loan Proceeds' },
  { value: 'other', label: 'Other' },
];

// Note: 'partially_taxable' removed — it was never multiplied by a percentage
// in the Tax page math (it counted as 100%). Use 'taxable' or 'non_taxable'.
export const TAXABLE_STATUS_OPTIONS = [
  { value: 'taxable', label: 'Taxable' },
  { value: 'non_taxable', label: 'Non-Taxable' },
  { value: 'unknown', label: 'Unknown' },
];

export const MODE_OPTIONS = [
  { value: 'personal', label: 'Personal' },
  { value: 'business', label: 'Business' },
];
