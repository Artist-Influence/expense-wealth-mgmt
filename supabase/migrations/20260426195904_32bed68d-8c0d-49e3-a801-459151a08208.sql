-- 1. Amex credit card payments — paying off the card is not new spending
UPDATE public.transactions_uploaded
SET is_transfer = true,
    transfer_type = 'credit_card_payment',
    exclude_from_expense_totals = true,
    counts_toward_true_personal_spend = false,
    is_non_expense_cash_movement = true,
    treatment_type = 'credit_card_payment',
    final_category = COALESCE(final_category, 'Card Payment'),
    counts_as_tax_deduction = false,
    match_explanation = COALESCE(match_explanation, '') || ' [auto-fix 2026-04-26: Amex card payment excluded from spend]'
WHERE mode = 'personal'
  AND counts_toward_true_personal_spend = true
  AND description_raw ILIKE '%AMERICAN EXPRESS%';

-- 2. Brokerage / investment transfers — wealth movement, not spend
UPDATE public.transactions_uploaded
SET is_transfer = true,
    transfer_type = 'brokerage_transfer',
    exclude_from_expense_totals = true,
    counts_toward_true_personal_spend = false,
    is_non_expense_cash_movement = true,
    treatment_type = 'transfer',
    final_category = COALESCE(final_category, 'Investment'),
    counts_as_tax_deduction = false,
    match_explanation = COALESCE(match_explanation, '') || ' [auto-fix 2026-04-26: brokerage/investment transfer excluded from spend]'
WHERE mode = 'personal'
  AND counts_toward_true_personal_spend = true
  AND (
    description_raw ILIKE '%Wealthfront%'
    OR description_raw ILIKE '%Betterment%'
    OR description_raw ILIKE '%DUB (ECFI)%'
    OR description_raw ILIKE '%DUB(ECFI)%'
    OR description_raw ILIKE '%Gemini Trust%'
    OR description_raw ILIKE '%Robinhood%'
    OR description_raw ILIKE '%Coinbase%'
    OR description_raw ILIKE '%Fidelity%'
    OR description_raw ILIKE '%Charles Schwab%'
    OR description_raw ILIKE '%Vanguard%'
    OR description_raw ILIKE '%Kraken%'
    OR description_raw ILIKE '%Binance%'
  );

-- 3. Inter-bank transfers / Zelle outgoing not yet flagged
UPDATE public.transactions_uploaded
SET is_transfer = true,
    transfer_type = COALESCE(NULLIF(transfer_type, ''), 'account_transfer'),
    exclude_from_expense_totals = true,
    counts_toward_true_personal_spend = false,
    is_non_expense_cash_movement = true,
    treatment_type = 'transfer',
    counts_as_tax_deduction = false,
    match_explanation = COALESCE(match_explanation, '') || ' [auto-fix 2026-04-26: bank transfer / Zelle excluded from spend]'
WHERE mode = 'personal'
  AND counts_toward_true_personal_spend = true
  AND (
    description_raw ILIKE '%ZELLE%'
    OR description_raw ILIKE '%TRANSFER%'
    OR description_raw ILIKE '%XFER%'
  );