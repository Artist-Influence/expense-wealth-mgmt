export interface IncomeClassification {
  income_type: string;
  taxable_status: string;
  confidence: number;
}

const RULES: { patterns: RegExp; income_type: string; taxable_status: string; confidence: number }[] = [
  { patterns: /\b(payroll|salary|direct deposit|wages|pay\s?check|adp|gusto|paychex)\b/i, income_type: 'payroll', taxable_status: 'taxable', confidence: 90 },
  { patterns: /\b(reimbursement|expense repay|expense reimb|reimburse)\b/i, income_type: 'reimbursement', taxable_status: 'non_taxable', confidence: 85 },
  { patterns: /\b(refund|return|credit|cashback|cash back)\b/i, income_type: 'refund', taxable_status: 'non_taxable', confidence: 80 },
  { patterns: /\b(transfer|xfer|zelle|venmo|paypal|wire)\b/i, income_type: 'transfer', taxable_status: 'non_taxable', confidence: 75 },
  { patterns: /\b(interest|dividend|apy|yield)\b/i, income_type: 'interest', taxable_status: 'taxable', confidence: 85 },
  { patterns: /\b(tax refund|irs|state tax|federal tax)\b/i, income_type: 'tax_refund', taxable_status: 'non_taxable', confidence: 90 },
  { patterns: /\b(invoice|client|consulting|freelance|contract|revenue|stripe|square)\b/i, income_type: 'business_revenue', taxable_status: 'taxable', confidence: 80 },
  { patterns: /\b(loan|draw|line of credit|loc proceed)\b/i, income_type: 'loan_proceeds', taxable_status: 'non_taxable', confidence: 75 },
  { patterns: /\b(owner contrib|capital contrib|equity inject)\b/i, income_type: 'owner_contribution', taxable_status: 'non_taxable', confidence: 75 },
];

export function classifyIncome(description: string): IncomeClassification {
  const text = (description || '').toLowerCase();
  for (const rule of RULES) {
    if (rule.patterns.test(text)) {
      return { income_type: rule.income_type, taxable_status: rule.taxable_status, confidence: rule.confidence };
    }
  }
  return { income_type: 'other', taxable_status: 'unknown', confidence: 0 };
}

export const INCOME_TYPE_OPTIONS = [
  { value: 'payroll', label: 'Payroll' },
  { value: 'business_revenue', label: 'Business Revenue' },
  { value: 'refund', label: 'Refund' },
  { value: 'interest', label: 'Interest / Dividend' },
  { value: 'tax_refund', label: 'Tax Refund' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'owner_contribution', label: 'Owner Contribution' },
  { value: 'loan_proceeds', label: 'Loan Proceeds' },
  { value: 'other', label: 'Other' },
];

export const TAXABLE_STATUS_OPTIONS = [
  { value: 'taxable', label: 'Taxable' },
  { value: 'non_taxable', label: 'Non-Taxable' },
  { value: 'partially_taxable', label: 'Partially Taxable' },
  { value: 'unknown', label: 'Unknown' },
];
