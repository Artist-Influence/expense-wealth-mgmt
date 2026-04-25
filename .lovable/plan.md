## Delete bank-to-bank transfers from personal expenses

### The problem

Personal view currently shows 18 transactions ($41,550 total) like:

> `Online Banking transfer to CHK 5563 Confirmation# XXXXX69389` — $200
> `Online Banking transfer to CHK 5592 Confirmation# XXXXX79343` — $7,100

These are BoA moving money between your own checking accounts (5373 → 5563 / 5592). Not expenses.

The transfer detector already has a pattern for this kind of thing:

```
TRANSFER\s*(?:TO|FROM)\s*(?:SAVINGS|CHECKING|XXXX####)
```

…but it requires the literal word **CHECKING** or an `X####` mask. BoA abbreviates it as `CHK 5563`, which doesn't match — so these rows fall through to the medium-confidence "possible_transfer" bucket and stay counted as expenses.

There are 8 CC payment rows (Amex "MOBILE PAYMENT - THANK YOU" → $23,183) that *are* already correctly excluded — we don't touch those.

### Fix

**1. `src/lib/transfer-detector.ts`** — broaden the high-confidence pattern to recognize BoA's `CHK ####` shorthand and the generic `Online Banking transfer to …` phrasing:

```ts
[/ONLINE\s*BANKING\s*TRANSFER\s*(?:TO|FROM)/i, 'account_transfer'],
[/TRANSFER\s*(?:TO|FROM)\s*(?:SAVINGS|CHECKING|CHK|SAV|(?:X|XXXX?\d{4}))/i, 'account_transfer'],
```

This makes future imports auto-flag these as `is_transfer = true` + `exclude_from_expense_totals = true`, so they never pollute personal expense totals again.

**2. Backfill existing rows** — one SQL update against `transactions_uploaded`:

```sql
UPDATE transactions_uploaded
SET is_transfer = true,
    transfer_type = 'account_transfer',
    exclude_from_expense_totals = true,
    is_non_expense_cash_movement = true,
    treatment_type = 'transfer',
    counts_toward_true_personal_spend = false,
    counts_toward_true_business_spend = false,
    final_category = COALESCE(final_category, 'Internal Transfer'),
    review_status = 'auto_categorized'
WHERE description_raw ~* '(online banking transfer (to|from)|transfer (to|from) (chk|sav)\s*\d+)'
  AND is_transfer = false;
```

That hits all 18 personal rows (and any matching business rows with the same phrasing) in one shot. They stay in the database for audit but stop counting as spend.

**3. Fix pre-existing TypeScript build errors** blocking compile (these are from the previous Income/Expenses edits, not from this work, but the build is currently broken so I'll repair them as part of this turn):

- `src/pages/Expenses.tsx` lines 380, 457, 546 — Supabase `.update(payload as Record<string, any>)` is being rejected by the typed client. Cast the payload to the row type or pass it directly typed instead of `Record<string, any>`.
- `src/pages/Income.tsx` lines 348, 357 — same pattern, same fix.

### Files touched

- `src/lib/transfer-detector.ts` — add the two regex patterns to the high-confidence list
- `src/pages/Expenses.tsx` — fix the 3 type errors on `.update()` calls
- `src/pages/Income.tsx` — fix the 2 type errors on `.update()` calls
- One data UPDATE migration (via the data tool) to backfill the 18 personal rows

### Out of scope

- CC payments (already correctly excluded — leaving alone)
- The 50 business "ONLINE DOMESTIC WIRE FEE" rows currently flagged `possible_transfer` — these are wire **fees**, which *are* real expenses, so they correctly stay as expenses
- No schema changes, no new tables
