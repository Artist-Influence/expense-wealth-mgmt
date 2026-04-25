## Pay stubs landing in expenses instead of income

### What's wrong

5 Deel salary deposits totaling **$27,860.86** got stored in `transactions_uploaded` as personal expenses instead of being routed to the `income_transactions` table. They show up in the personal expenses list mixed with real spend.

```
Deel PEOUAWFD2ZP DES:PAYMENTS ... NTE*ZZZ*0426-SALARY-Clout Kitchen   $6,335.67
Deel PEOP3WZTNTS DES:PAYMENTS ... NTE*ZZZ*0326-SALARY-Clout Kitchen   $7,111.62
Deel PEOCM24DPSO DES:PAYMENTS ... NTE*ZZZ*0326-SALARY-Clout Kitchen   $4,185.62
Deel PEOVYPZIQTS DES:PAYMENTS ... NTE*ZZZ*0226-SALARY-Clout Kitchen   $6,114.39
Deel PEOTLNGN6ZN DES:PAYMENTS ... NTE*ZZZ*0226-SALARY-Clout Kitchen   $4,113.56
```

### Why it slipped through

The CSV importer already has a sign-aware router (`src/lib/transaction-router.ts`) that's supposed to send positive inflows to income. Two failures combined:

1. **BoA's CSV has no `Details` column** (no CREDIT/DEBIT signal), so the router falls back to its description heuristic (`INCOME_DESCRIPTION_HINTS`).
2. The heuristic regex doesn't include `salary`, `deel`, `payroll-` patterns, or the literal `PAYMENTS ID:` ACH stub Deel uses. It only matches generic words like "deposit", "direct deposit", "payroll" (with word boundaries that don't catch `NTE*ZZZ*0226-SALARY-...`).

So a positive-amount row with description `"Deel ... PAYMENTS ID: ... NTE*ZZZ*0226-SALARY-Clout Kitchen"` failed every check and defaulted to `route: 'expense'`.

### Fix

**1. Broaden `INCOME_DESCRIPTION_HINTS` in `src/lib/transaction-router.ts`** so any positive-amount row matching paystub/payroll-provider patterns routes to income:

```ts
const INCOME_DESCRIPTION_HINTS =
  /\b(deposit|payroll|direct\s*deposit|salary|wages|paycheck|payment\s*from|received\s*from|zelle\s*from|venmo\s*from|paypal\s*from|refund|return|reimburs|interest|dividend|cashback|cash\s*back|stripe\s*payout|square\s*deposit|tax\s*refund|deel|gusto|adp|paychex|justworks|rippling|trinet|oasis|onpay|bamboohr)\b|SALARY[-\s]|PAYMENTS\s*ID:/i;
```

This catches:
- Generic words: `salary`, `wages`, `paycheck` (added)
- Payroll providers: `deel`, `gusto`, `adp`, `paychex`, `justworks`, `rippling`, `trinet`, `oasis`, `onpay`, `bamboohr`
- ACH stub patterns: `SALARY-` (matches `NTE*ZZZ*0226-SALARY-Clout Kitchen`) and `PAYMENTS ID:` (Deel's ACH descriptor)

**2. Update `classifyIncome` in `src/lib/income-classifier.ts`** so the `payroll` rule recognizes the same providers (so once routed, they get `income_type: 'payroll'`, `taxable_status: 'taxable'`):

```ts
{ patterns: /\b(payroll|salary|direct\s*deposit|wages|pay\s?check|adp|gusto|paychex|deel|justworks|rippling|trinet|onpay)\b|SALARY[-\s]/i,
  income_type: 'payroll', taxable_status: 'taxable', confidence: 90 },
```

**3. Move the 5 misrouted Deel rows** from `transactions_uploaded` to `income_transactions` via a one-shot data migration:

```sql
-- Insert into income_transactions
INSERT INTO income_transactions (owner_id, date, amount, description_raw, description_normalized,
  income_type, taxable_status, source_account_name, source_file_name, status, mode)
SELECT owner_id, date, ABS(amount), description_raw, description_normalized,
  'payroll', 'taxable', 'BoA 5373', source_file_name, 'needs_review', 'personal'
FROM transactions_uploaded
WHERE description_raw ~* '(SALARY[-\s]|deel.*payments\s*id)'
  AND treatment_type = 'expense'
  AND amount > 0;

-- Delete the misplaced expense rows
DELETE FROM transactions_uploaded
WHERE description_raw ~* '(SALARY[-\s]|deel.*payments\s*id)'
  AND treatment_type = 'expense'
  AND amount > 0;
```

That's 5 rows out of personal expenses, 5 rows into personal income, properly classified as payroll/taxable.

### Files touched

- `src/lib/transaction-router.ts` — broaden `INCOME_DESCRIPTION_HINTS`
- `src/lib/income-classifier.ts` — broaden the `payroll` rule
- One data migration to move the 5 existing Deel rows + delete originals

### Out of scope

- The penny test row (`Penny-test-for-method` $0.02) — it has no SALARY/payroll signal, so it's correctly staying where it is. If you want it moved too, say the word.
- No schema changes. No UI changes. Income page already segments cleanly by mode after the previous fix.
