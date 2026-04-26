# Fix Personal Cash-Out Math

## Root cause

After investigation, the **$88,690 "Personal Cash Out" is not a duplicate or numeric overflow issue** — it's a classification problem. There are **zero exact-duplicate expense rows**. The total is being inflated by money movements that should not count as spending:

| Category | Amount | Why it's wrong |
|---|---|---|
| Amex card payments (10 rows) | **$24,639** | Paying off Amex ≠ spending. The original purchases are already counted on Amex statements. |
| Brokerage transfers (Wealthfront / Gemini / DUB) | **$17,600** | Money moving into investment accounts — net worth shift, not spend. |
| Zelle / bank transfers | **$1,390** | Inter-account movement. |
| **Total over-count** | **~$43,629** | |
| **True personal spend after fix** | **~$45,062** | (down from $88,690) |

The transfer detector in `src/lib/transfer-detector.ts` doesn't recognize `AMERICAN EXPRESS DES:ACH PMT` (BoA's format for Amex payments) or any brokerage transfer patterns, so every new import will keep mis-classifying them.

## What I'll do

### 1. One-time data cleanup (SQL)
Re-classify the existing mis-categorized rows in `transactions_uploaded` so they're excluded from spend totals but preserved for audit:

- **Amex payments** (`description_raw ILIKE '%AMERICAN EXPRESS%'`) → mark `is_transfer=true`, `transfer_type='card_payment'`, `exclude_from_expense_totals=true`, `counts_toward_true_personal_spend=false`, `is_non_expense_cash_movement=true`, set category to "Card Payment".
- **Brokerage transfers** (Wealthfront, Gemini, DUB, Robinhood, Coinbase, Fidelity, Schwab, Vanguard) → same flags with `transfer_type='investment_transfer'`, category "Investment".
- **Zelle / inter-bank transfers** that aren't already flagged → `transfer_type='bank_transfer'`, excluded from spend.

### 2. Harden `src/lib/transfer-detector.ts` so future imports auto-detect these
Add high-confidence patterns:
- `AMERICAN\s*EXPRESS\s*DES:?\s*ACH\s*PMT` → `credit_card_payment`
- `CHASE\s*CREDIT\s*CRD\s*(?:EPAY|AUTOPAY)` → `credit_card_payment`  
- `(?:DISCOVER|CITI|CAPITAL\s*ONE)\s*(?:CARD\s*)?(?:PMT|PAYMENT)` → `credit_card_payment`
- `(?:WEALTHFRONT|BETTERMENT|ROBINHOOD|COINBASE|GEMINI\s*TRUST|DUB\s*\(ECFI\)|FIDELITY|VANGUARD|SCHWAB)` → new type `brokerage_transfer`
- Add `'brokerage_transfer'` to the `transferType` union and route it through the same exclusion logic that handles `account_transfer`.

### 3. Verify
Re-query personal spend and confirm it lands near **$45k**, then refresh the Insights / Personal Cash Out card.

## Files affected
- **Database**: ~26 row updates in `transactions_uploaded` (Amex + brokerage + transfers — no rows deleted, just re-flagged so the audit trail is preserved).
- **Code**: `src/lib/transfer-detector.ts` — add ~5 new regex patterns and one new `transferType` value.
- Wherever `transferType` is consumed (router/expense exclusion logic) — add the new `brokerage_transfer` to any switch statements treating transfers as non-expense.

## What I'll NOT change
- No schema migration needed — `amount` is already `numeric`, no overflow.
- No income changes — those duplicates were already cleaned.
- I won't hard-delete the mis-classified rows; flagging them keeps the audit history intact and makes it reversible if any are actual spend.
