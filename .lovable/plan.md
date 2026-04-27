## Issue

Wealthfront rows are bucketing into "Other Brokerage" instead of their own "Wealthfront" sub-row.

## Root cause

The Wealthfront ACH descriptions look like:
- `description_raw`: `"Wealthfront DES:EDI PYMNTS ID:… INDN:Jared Rapoza CO ID:… WEB"`
- `description_normalized`: `"PYMNTS ID:… INDN:JARED RAPOZA WEB"` ← merchant name stripped

The `wealthDestination()` helper currently does `description_normalized || description_raw`, so it only sees the normalized string — which no longer contains "Wealthfront". The rows still get caught as savings (because `transfer_type='brokerage_transfer'` is set), but they fall through to the "Other Brokerage" fallback bucket.

## Fix

In `src/pages/Insights.tsx`, change `wealthDestination()` to test the regex against **both** fields concatenated, not just the normalized one:

```ts
const haystack = `${t.description_raw || ''} ${t.description_normalized || ''}`.trim();
```

Same logic applies to any other destination whose name gets stripped during normalization (Gemini and Dub already work because their merchant strings survive normalization, but this defensively covers all of them).

## Files affected

- `src/pages/Insights.tsx` — `wealthDestination()` helper only (~3 lines).

No schema, no other logic, no other rows change. After the fix, the YoY breakdown will show:
- Wealthfront $6,600
- Gemini $5,600
- Dub $5,400

instead of the current "Other Brokerage $6,600 / Gemini $5,600 / Dub $5,400".