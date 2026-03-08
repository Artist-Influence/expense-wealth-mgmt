

## Plan: Improve Matching & Reduce Unnecessary Needs Review

### Root Cause Analysis

The biggest problem is in `normalizeDescription()` — line 22 strips the **entire** `ORIG CO NAME:...` block including the actual merchant name. So descriptions like `ORIG CO NAME:INTUIT 93746543 ... IND NAME:JARED RAPOZA` normalize to just `NAME:JARED RAPOZA` (from the IND NAME portion), losing the real merchant identity (INTUIT).

Similarly, many Chase checking ACH rows all normalize to the same useless key like `NAME:JARED RAPOZA` or empty string, making merchant memory matching impossible.

### Changes

#### 1. `src/lib/normalizer.ts` — Rewrite normalization + entity extraction

**`normalizeDescription`**: Instead of stripping ORIG CO NAME entirely, **extract the merchant name from it** first. New approach:
- Extract entity from `ORIG CO NAME:(\w[\w\s]*)` before stripping metadata
- Extract entity from `IND NAME:(\w[\w\s]*)` as secondary
- Strip all the noise (`ORIG ID:`, `TRACE#:`, `EED:`, `SEC:`, `CO ENTRY DESCR:`, `TRN:`, `DESC DATE:`, `IND ID:`) but **keep** the extracted entity names
- Clean result: `ORIG CO NAME:INTUIT 93746543 ... IND NAME:JARED RAPOZA` → `INTUIT`

**`generateMerchantKey`**: Expand alias map significantly:
- `INTUIT` (covers INTUIT PAYROLL, INTUIT TRAN FEE, QB) → contextual aliases: `INTUIT FEE`, `INTUIT PAYROLL`, `INTUIT DEPOSIT`
- `PAYPAL` (covers PAYPAL INST XFER, PAYPAL *vendor) → `PAYPAL` or extract the vendor after `*`
- `GOOGLE` → differentiate `GOOGLE ADS`, `GOOGLE ONE`, `GOOGLE WORKSPACE`
- `WHOP` / `WHOP.COM` → `WHOPCOM`
- `VERIZON` → `VERIZON`
- `ZELLE` → `ZELLE <RECIPIENT>`
- `WISE` → `WISE`
- Chase/BoA payment patterns → `TRANSFER` key
- Handle `IND NAME:ARTIST INFLUENCE` properly

Add new helper: **`extractEntity(raw: string): string`** — dedicated function to pull the real merchant/payee from ACH-style descriptions before normalization.

#### 2. `src/lib/categorization-engine.ts` — Add fuzzy matching + match explanation

**Layer 1.5: Partial/fuzzy merchant memory matching**. After exact key lookup fails:
- Iterate memory map and check if the transaction's merchant key is a substring of a memory key (or vice versa)
- Check if the raw description contains any memory key
- Apply slightly lower confidence (75 vs 80+) for partial matches

**Add `match_explanation` field** to `CategorizationResult`:
- `'exact_merchant_key'`, `'partial_merchant_match'`, `'alias_match'`, `'rule_contains'`, `'csv_category'`, `'no_match'`

**Confidence boost for consistent history**: When `times_seen >= 5`, bump confidence to 92+ (above auto threshold). Current formula already does this but base weight of 80 + (5*2=10) bonus = 90, which equals the auto threshold. Adjust so 3+ sees with same category hits suggest, 5+ hits auto.

**Rules engine also searches raw description**, not just normalized (already partially done but the normalized is broken, so raw fallback matters more).

#### 3. `src/lib/transfer-detector.ts` — Add patterns for ACH/wire descriptions

Add patterns for:
- `PAYMENT TO .* CARD ENDING` → credit_card_payment
- `ONLINE ACH PAYMENT TO \(_` → credit_card_payment  
- `ONLINE DOMESTIC WIRE` (fee vs transfer distinction — fee rows are small amounts like $15-25)

#### 4. Update `CategorizationResult` interface

Add `match_explanation: string` field that stores a human-readable reason for the categorization decision. This gets stored in `predicted_notes` or a new display field.

### Files Changed

| File | Change |
|------|--------|
| `src/lib/normalizer.ts` | Rewrite `normalizeDescription` to extract entity from ORIG CO NAME/IND NAME before stripping; expand `generateMerchantKey` alias map; add `extractEntity` helper |
| `src/lib/categorization-engine.ts` | Add partial/fuzzy memory matching as Layer 1.5; add `match_explanation` to result; boost confidence for 3+/5+ consistent matches |
| `src/lib/transfer-detector.ts` | Add patterns for `PAYMENT TO.*CARD ENDING`, `ONLINE ACH PAYMENT TO` |

### Not Changed
- Database schema — no changes needed
- Expenses.tsx — the match_explanation can piggyback on existing `match_source` field display
- Settings.tsx — no changes needed

