# Sign-Aware Inflow Routing — Move Misclassified Income Out of Expenses

## The Problem

`parseAmount` in `src/lib/normalizer.ts` always calls `Math.abs(num)`. Every CSV amount is stored as a positive number, so the system can't tell a $7,000 deposit apart from a $7,000 charge once it's in the database.

In your data right now (Chase8886 checking + Chase2662 credit card):
- **137 rows totaling ~$370,000** have a positive value in the original CSV (i.e. money came IN) but live in the Expenses table inflating "true spend".
- Examples: INTUIT/QuickBooks deposits, Zelle payments received, Chase Travel returns, Whop content rewards, "Payment Thank You" credit-card payoffs.

Three different inflow types are mixed together and need different treatment:

| CSV signal | Real meaning | Where it belongs |
|---|---|---|
| Checking, positive amount, `Details=CREDIT` | Money received (revenue / refund / reimbursement / interest) | **`income_transactions`** |
| Credit card, `Type=Payment` (e.g. "Payment Thank You") | Paying off the card from checking | **Stay in `transactions_uploaded`, flag as transfer** (the matching debit on checking is the real cash movement) |
| Credit card, `Type=Return` | Refund posted to card | **Stay in `transactions_uploaded`, mark as refund** (reduces spend, doesn't create income) |

## Plan

### 1. Stop destroying the sign at the source
**`src/lib/normalizer.ts`** — `parseAmount` returns the signed number (drop `Math.abs`). All downstream amount comparisons currently use `Math.abs(t.amount)`, so display stays the same.

### 2. Add a sign-aware router in the CSV pipeline
**`src/lib/transaction-router.ts`** (new) — `routeTransaction(parsed, sourceFileType)` returns one of:

- `route: 'income'` with `{ income_type, taxable_status }` from the existing income classifier
- `route: 'expense'` (normal debit)
- `route: 'cc_payment_transfer'` (credit card payoff → flag is_transfer + treatment_type='credit_card_payment')
- `route: 'refund'` (CC return → keep in expenses, treatment_type='refund', counts as negative spend)

Decision logic:
- If `Details = 'CREDIT'` AND original amount > 0 → income (checking deposit)
- If `Type = 'Payment'` on a CC file → cc_payment_transfer
- If `Type = 'Return'` on a CC file → refund
- Heuristic fallback when those columns are missing: positive amount + a sender-like description ("from", "deposit", "payroll", "Zelle from") → income
- Otherwise → expense

The CC vs. checking detection uses the parser's existing `source_row_json`: presence of `Type = 'Sale' | 'Return' | 'Payment'` is the credit-card pattern; presence of `Details = 'CREDIT' | 'DEBIT'` is the checking pattern.

### 3. Wire the router into the Expenses upload flow
**`src/pages/Expenses.tsx`** — after `parseCsvFileWithMapping` returns rows, split them:
- Income-routed rows → `insert into income_transactions` (run through `classifyIncome`, set `status='needs_review'`).
- CC-payment-transfer rows → insert into `transactions_uploaded` with `is_transfer=true`, `transfer_type='credit_card_payment'`, `treatment_type='credit_card_payment'`, `exclude_from_expense_totals=true`, `is_non_expense_cash_movement=true`.
- Refund rows → insert into `transactions_uploaded` with `treatment_type='refund'`, `counts_toward_true_personal_spend=false`.
- Everything else → existing path.

The user-facing toast becomes: "Imported 320 expenses, 14 refunds, 8 card payments (transfers), 116 income rows."

### 4. Backfill the 137 misclassified rows already in the database
A one-shot data fix using `source_row_json` (which still has the original signed amount and Details/Type):

- **Checking CREDIT rows (the bulk of the $370K)** → INSERT into `income_transactions` with `classifyIncome(description)`, then DELETE from `transactions_uploaded`. Preserve date, amount (absolute), description, source_file_name, upload_batch_id, owner_id.
- **Credit-card "Payment Thank You" rows** → UPDATE in place: `is_transfer=true, transfer_type='credit_card_payment', treatment_type='credit_card_payment', exclude_from_expense_totals=true, is_non_expense_cash_movement=true, counts_toward_true_personal_spend=false, counts_toward_true_business_spend=false`.
- **Credit-card "Return" rows** → UPDATE in place: `treatment_type='refund', counts_toward_true_personal_spend=false, counts_toward_true_business_spend=false`. Keep visible as a negative-spend marker; your Insights True Spend already filters by `counts_toward_true_*`.

Run as one Supabase migration so it's idempotent and reversible. Show before/after counts.

### 5. Guardrails going forward
- **Transfer detector update**: add `Type = 'Payment'` (on a CC file) to the high-confidence transfer signals so future uploads catch it even if the sign-router misses.
- **Income side**: when income CSV uploads contain a negative row (refund issued, money out), route those into `transactions_uploaded` as a refund instead of silently importing as negative income.
- **UI surfacing**: after import, the import-result dialog shows the four routing buckets so you can sanity-check.

## Files Changed

| File | Change |
|---|---|
| `src/lib/normalizer.ts` | `parseAmount` keeps sign |
| `src/lib/transaction-router.ts` | New — sign-aware classifier |
| `src/lib/transfer-detector.ts` | Add CC payoff pattern |
| `src/pages/Expenses.tsx` | Route rows on import; show 4-bucket toast |
| `src/pages/Income.tsx` | Re-route negative income rows to expenses |
| `supabase/migrations/<ts>_backfill_misclassified_inflows.sql` | One-shot fix for the 137 rows |

## Out of Scope

- Reconciling individual CC "Payment Thank You" rows to their matching checking debit (the existing transfer-pair detector already handles that on the next upload — flagging both sides is enough).
- Changing the existing `Math.abs(t.amount)` display calls — all reporting code keeps using absolute values for totals; the sign is only used at routing time.
