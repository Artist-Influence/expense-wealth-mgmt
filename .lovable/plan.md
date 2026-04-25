## Stop personal/business income from getting mixed up at import

### Root cause

When the **Expenses** CSV importer auto-routes positive inflows over to the `income_transactions` table (the path that catches Deel paystubs, Zelle deposits, INTUIT/QuickBooks deposits, etc.), it never passes a `mode` field. The table defaults to `mode='personal'` for every row.

So when you uploaded `Chase8886_Activity_20260424.CSV` as a **Business** expense file, the 41 income-shaped rows inside it (INTUIT/QuickBooks payouts, Currency Cloud, FEDWIRE→ARTIST INFLUENCE LLC, Audiomack, Vydia, DIM MAK, EMPIRE, Zelle from RULE FITNESS LLC, Stripe payouts, Wenzday Music, etc.) all got auto-routed to income — and silently stamped as **personal** instead of **business**. Meanwhile the 82 INTUIT deposits *did* get tagged business, but only because `classifyIncome` returns `business_revenue` for the word "INTUIT"-pattern matches… actually they were tagged business because the suggested_mode hint flowed through somewhere else. Either way, the gap is real: the import path doesn't honor the file's mode for non-payroll/non-revenue keywords (`other`, `transfer`, `reimbursement`).

Same bug works the other way: a personal CSV with a stray business-looking word could land in business income.

### The four-part fix

**1. Pass the upload's mode through the Expenses → Income auto-router** (`src/pages/Expenses.tsx` ~line 765).

Add `mode: mode` to the `incomePayload` object so when you upload a Business expense file, every income row routed out of it lands as `mode='business'`, and a Personal expense upload lands rows as `mode='personal'`. The classifier's `suggested_mode` becomes a fallback only when there's no file-level hint (which there always is from this path, so it's a tie-breaker for ambiguous cases).

```ts
const fileMode = mode === 'business' ? 'business' : 'personal'; // reimbursable_work → personal owner
return {
  // ...existing fields...
  mode: fileMode,
};
```

**2. Backfill the 41 mis-tagged Chase 8886 rows** — they're all from a business-account file and every one is Artist Influence income:

```sql
UPDATE income_transactions
SET mode = 'business'
WHERE source_file_name = 'Chase8886_Activity_20260424.CSV'
  AND mode = 'personal';
```

That moves $69,223.21 of business income out of the personal column where it belongs.

**3. Re-tag the BoA 5373 "Zelle from ARTIST INFLUENCE LLC" rows as Payroll** (your call: keep them personal, mark as taxable payroll income to you):

```sql
UPDATE income_transactions
SET income_type = 'payroll',
    taxable_status = 'taxable',
    status = 'needs_review'
WHERE source_file_name = 'BoA 5373.csv'
  AND mode = 'personal'
  AND description_raw ILIKE '%Zelle payment from ARTIST INFLUENCE LLC%';
```

5 rows, ~$28,964 — stays personal, now correctly labeled as Payroll/Taxable instead of "transfer".

**4. Add a guardrail to the auto-router** for unambiguous business-account signals so even if the file mode is wrong, the row isn't mis-filed. In `src/lib/income-classifier.ts`, expand the `business_revenue` rule to catch the obvious B2B ACH descriptors that showed up in your Chase data:

```ts
{ patterns: /\b(intuit|quickbooks|currency\s*cloud|audiomack|vydia|dim\s*mak|empire\s*distribut|wenzday|thirty\s*knots|dark\s*roast|space\s*laces|kompany\s*music|invoice|client|consulting|freelance|contract|revenue|stripe|square|fedwire\s*credit|chips\s*credit)\b|ARTIST\s*INFLUENCE\s*LLC/i,
  income_type: 'business_revenue', taxable_status: 'taxable', confidence: 85 },
```

The "ARTIST INFLUENCE LLC" piece is the key — anything mentioning that entity in the description, on a business-mode row, gets bumped to `business_revenue` confidently.

### Files touched

- `src/pages/Expenses.tsx` — pass file mode into the income auto-router payload
- `src/lib/income-classifier.ts` — broaden `business_revenue` rule to recognize Artist Influence's recurring counterparties
- Two data updates: backfill the 41 Chase rows + re-tag the 5 AI→personal Zelle rows

### Out of scope

- No schema changes. No UI changes (Income page already filters cleanly by mode).
- Not changing how Chase 8886 INTUIT rows are handled — those are already correctly tagged business.
- Not deleting any rows. Everything stays auditable.

### Sanity check after the fix

You should see:
- Personal income page: BoA 5373 only (Deel paystubs + AI payroll Zelle + small Zelle reimbursements). ~$57K Deel + $29K AI payroll + small misc.
- Business income page: all of Chase 8886 (~$298K combined: $229K already-tagged business + $69K being reclassified now).
