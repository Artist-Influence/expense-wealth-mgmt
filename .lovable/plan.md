# Recurring Charge Detection → Auto-categorize as Subscriptions

Add a new layer to the categorization pipeline that detects recurring charges (same merchant, same amount, regular cadence) and proposes **Subscriptions** as the category — boosting confidence and writing the recurrence signal back to merchant memory so future single charges from that merchant inherit the category instantly.

## How it will behave

When a CSV is imported, after merchant memory + rules + CSV-category match (and before AI fallback), each new transaction is checked against the user's existing transaction history:

1. Find prior transactions with the same `merchant_key`, in the last **180 days**.
2. If we find **≥3 prior charges** AND **amount stability** holds AND **cadence matches a known interval**, mark this charge as recurring.
3. Apply category **Subscriptions** (only if Subscriptions is in the user's allowed category list — it already is for both `personal` and `business`).
4. Apply ambiguous-merchant guardrail: PayPal, Venmo, Zelle, Amazon, Square, Stripe, Walmart, Costco, Target, Apple, Google → **never** auto-flag as recurring (those rails carry many one-offs at lookalike amounts).
5. Boost merchant memory: when a recurring match is confirmed, write/update `merchant_memory` so the merchant inherits Subscriptions for ALL future single charges, not just recurring ones.

## Detection rules

A merchant is "recurring" if:

- **Count**: ≥ 3 prior transactions with the same `merchant_key` in last 180 days.
- **Amount stability** (one of):
  - All amounts within ±$1.00 of the median, OR
  - Coefficient of variation (stdev / mean) < 0.10 (10%)
- **Cadence**: average days between consecutive charges falls into one of:
  - weekly: 6–8 days
  - biweekly: 13–16 days
  - monthly: 25–35 days
  - quarterly: 85–100 days
  - annual: 350–380 days
- **Not ambiguous merchant**: skip pass-through merchants entirely.
- **New transaction's amount** is also within ±10% of the recurring median (so a one-off $500 Spotify charge wouldn't get tagged just because $9.99 Spotify is recurring).

Confidence score:
- Base 88, +2 per detected charge above 3 (capped at 96).
- Auto-categorize if ≥ user's `auto_threshold` (default 90), else suggest.

## What the user sees

- New transactions from recurring merchants are tagged **Subscriptions** automatically with a `match_explanation` like:
  > "Recurring monthly @ $14.99 (6 prior charges, ±$0.00, ~30d cadence)"
- `match_source` set to a new value: `recurring_pattern`.
- A new badge **🔁 Recurring** appears in the Expenses table next to the category for these rows (subtle, opt-out friendly).
- The detection runs only at import time (not retroactively on existing rows for now).

## Technical changes

### 1. New file: `src/lib/recurrence-detector.ts`
Pure function `detectRecurrence(merchantKey, amount, history)` returning:
```ts
{ isRecurring: boolean; cadence?: 'weekly'|'biweekly'|'monthly'|'quarterly'|'annual'; median: number; count: number; confidence: number; explanation: string }
```
No DB access — caller passes pre-loaded history.

### 2. `src/lib/categorization-engine.ts`
- Add a new optional argument: `recurringHistory: Map<string, { date: string; amount: number }[]>` (merchant_key → prior charges).
- Add Layer 1.7 (between partial memory match and rules):
  ```ts
  if (recurringHistory) {
    const history = recurringHistory.get(merchantKey) || [];
    const r = detectRecurrence(merchantKey, tx.amount, history);
    if (r.isRecurring && allowedSet.has('Subscriptions') && !isAmbiguousMerchant(merchantKey)) {
      const validated = validateCategory('Subscriptions', allowedSet);
      return buildResult(validated.category, null, null, r.confidence,
        'recurring_pattern', thresholds, false, r.explanation, merchantKey);
    }
  }
  ```
- Extend `match_source` union to include `'recurring_pattern'`.

### 3. `src/pages/Expenses.tsx` (import flow, ~line 838)
Before calling `categorizeTransactions`, fetch the user's last 180 days of transactions for the relevant `merchant_key`s and build the history map:
```ts
const merchantKeys = [...new Set(rowsToInsert.map(r => r.merchant_key).filter(Boolean))];
const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
const { data: priorTx } = await supabase
  .from('transactions_uploaded')
  .select('description_normalized, amount, date')
  .eq('owner_id', user.id)
  .gte('date', since)
  .not('amount', 'is', null);
// Build map from merchant_key → [{date, amount}, …] using generateMerchantKey on description_normalized
```
Pass that map into `categorizeTransactions`.

### 4. After approval — boost merchant memory
In `updateMerchantMemory`, when called for a `recurring_pattern` match, give it an extra confidence bump (start at 90 instead of 82) so future single charges from that merchant land in Subscriptions confidently. This requires passing the match_source through to the approval handler in Expenses.tsx (already available on the row).

### 5. UI badge in `src/pages/Expenses.tsx`
Add a small "🔁" pill next to the category column when `match_source === 'recurring_pattern'`. One-line conditional render.

## Out of scope (for now — easy follow-ups)

- **Retroactive sweep** of already-imported rows. Could add a "Re-scan for recurring" button on the Expenses page if desired.
- **User-configurable thresholds** (e.g., minimum count, amount tolerance). Hardcoded to sensible defaults for v1.
- **Cross-account dedup**: if same Netflix charge appears on two cards, treated as separate streams (correct for cadence detection anyway).
- **"Subscription canceled" detection** (no charge for 2 expected cycles). Pure analytics for later.

## Database

No schema changes required. The existing `match_source` text column accepts the new value. No new tables, no migration.
