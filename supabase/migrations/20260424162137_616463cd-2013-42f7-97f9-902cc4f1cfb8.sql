-- Backfill: route misclassified inflows out of the expenses table.
-- Uses source_row_json (the original CSV row) to identify inflows that lost
-- their sign because parseAmount used Math.abs. We recover the bucket from
-- Details ('CREDIT'/'DEBIT' on checking) and Type ('Payment'/'Return' on CC).

-- 1. Checking-account CREDIT rows (positive deposits) → income_transactions.
--    Classify income_type heuristically from the description.
INSERT INTO public.income_transactions (
  owner_id, date, amount, description_raw, description_normalized,
  income_type, taxable_status, source_account_name, source_file_name,
  upload_batch_id, status, notes
)
SELECT
  t.owner_id,
  t.date,
  ABS(t.amount) AS amount,
  t.description_raw,
  t.description_normalized,
  CASE
    WHEN t.description_raw ~* '\m(payroll|salary|direct deposit|wages|pay\s?check|adp|gusto|paychex)\M' THEN 'payroll'
    WHEN t.description_raw ~* '\m(reimbursement|expense repay|expense reimb|reimburse)\M'              THEN 'reimbursement'
    WHEN t.description_raw ~* '\m(refund|return|cashback|cash back)\M'                                  THEN 'refund'
    WHEN t.description_raw ~* '\m(zelle|venmo|paypal|wire|xfer|transfer)\M'                             THEN 'transfer'
    WHEN t.description_raw ~* '\m(interest|dividend|apy|yield)\M'                                       THEN 'interest'
    WHEN t.description_raw ~* '\m(tax refund|irs|state tax|federal tax)\M'                              THEN 'tax_refund'
    WHEN t.description_raw ~* '\m(invoice|client|consulting|freelance|contract|revenue|stripe|square|intuit|deposit)\M' THEN 'business_revenue'
    WHEN t.description_raw ~* '\m(loan|draw|line of credit|loc proceed)\M'                              THEN 'loan_proceeds'
    ELSE 'other'
  END AS income_type,
  CASE
    WHEN t.description_raw ~* '\m(payroll|salary|wages|pay\s?check|interest|dividend|invoice|consulting|freelance|contract|revenue|stripe|square|intuit|deposit)\M' THEN 'taxable'
    WHEN t.description_raw ~* '\m(reimbursement|refund|return|tax refund|loan|draw)\M'                  THEN 'non_taxable'
    ELSE 'unknown'
  END AS taxable_status,
  NULLIF(t.predicted_method, '') AS source_account_name,
  t.source_file_name,
  t.upload_batch_id,
  'needs_review' AS status,
  'Backfilled from expenses (was a positive CREDIT in the source CSV)' AS notes
FROM public.transactions_uploaded t
WHERE t.source_row_json ? 'Amount'
  AND (t.source_row_json->>'Amount')::numeric > 0
  AND UPPER(COALESCE(t.source_row_json->>'Details', '')) = 'CREDIT';

-- 2. Delete those checking-credit rows from the expenses table now that they
--    live in income_transactions.
DELETE FROM public.transactions_uploaded t
WHERE t.source_row_json ? 'Amount'
  AND (t.source_row_json->>'Amount')::numeric > 0
  AND UPPER(COALESCE(t.source_row_json->>'Details', '')) = 'CREDIT';

-- 3. Credit-card "Payment Thank You" rows → mark as transfers (CC payoff).
UPDATE public.transactions_uploaded t
SET
  is_transfer = true,
  transfer_type = 'credit_card_payment',
  treatment_type = 'credit_card_payment',
  exclude_from_expense_totals = true,
  is_non_expense_cash_movement = true,
  counts_toward_true_personal_spend = false,
  counts_toward_true_business_spend = false
WHERE t.source_row_json ? 'Type'
  AND t.source_row_json->>'Type' = 'Payment'
  AND (t.source_row_json->>'Amount')::numeric > 0;

-- 4. Credit-card "Return" rows → mark as refunds (don't count toward spend,
--    but stay visible as a negative-spend marker in the expenses table).
UPDATE public.transactions_uploaded t
SET
  treatment_type = 'refund',
  counts_toward_true_personal_spend = false,
  counts_toward_true_business_spend = false
WHERE t.source_row_json ? 'Type'
  AND t.source_row_json->>'Type' = 'Return'
  AND (t.source_row_json->>'Amount')::numeric > 0;