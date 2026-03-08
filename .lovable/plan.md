

## Plan: Edit UX Overhaul + AI-Assisted Categorization

### Part 1 — Transaction Detail Drawer

**Current state**: Clicking edit turns 3 inline cells into tiny inputs. Description is truncated to 220px. No visibility into match explanation, normalized key, confidence reasoning, or flags.

**Change**: Replace inline editing with a right-side Sheet (drawer) that opens when clicking Edit or a row. The main table stays unchanged as a dense spreadsheet view with one addition — a tooltip on hover for descriptions.

#### New Component: `src/components/TransactionDetailDrawer.tsx`

A wide right-side drawer (sm:max-w-lg) containing:
- **Header**: Date, amount, status badge
- **Full raw description** (unwrapped, full text)
- **Normalized merchant key** (read-only display)
- **Match explanation** (why it was categorized — from a new `match_explanation` column or derived from `match_source`)
- **Category dropdown** (Select from allowed categories)
- **Method input**
- **Notes textarea**
- **Confidence score** with visual indicator
- **Flags section**: transfer badge, duplicate badge, parse error, category rejected
- **Source file name**
- **Actions**: Save, Approve, Mark Transfer, Cancel

#### Table Changes in `src/pages/Expenses.tsx`

- Remove inline editing logic (`editingId`, `editValues` state for inline inputs)
- Add `detailTx` state for which transaction is open in the drawer
- Click Edit icon → opens drawer with that transaction
- Description column: add `title` attribute (already exists) + increase max-width slightly
- Keep spreadsheet density

#### Database Changes

- Add `match_explanation` column to `transactions_uploaded` (text, nullable) to persist the explanation string from the categorization engine
- Update `review_status` check constraint to include `ai_suggested`

### Part 2 — AI-Assisted Categorization (Layer 5)

**Current state**: After layers 1–4 (exact match, partial match, rules, CSV category), unmatched rows go straight to `needs_review` with confidence 0.

**Change**: Add Layer 5 — call Lovable AI via an edge function to infer the category from the raw description + allowed category list.

#### New Edge Function: `supabase/functions/categorize-ai/index.ts`

- Accepts: `{ descriptions: string[], allowedCategories: string[], mode: string }`
- Calls Lovable AI gateway with a prompt that:
  - Lists the allowed categories
  - Asks the model to pick the best category for each description
  - Returns structured output via tool calling: `{ category, confidence, explanation }`
- Uses `google/gemini-3-flash-preview` for speed
- Batches up to 20 descriptions per call
- Returns array of `{ category: string | null, confidence: number, explanation: string }`

#### Changes to `src/lib/categorization-engine.ts`

- Add new export: `categorizeWithAI(unmatched: { index: number, description_raw: string, description_normalized: string }[], mode, ownerId, allowedCategories) → Promise<Map<number, { category, confidence, explanation }>>`
- This calls the edge function and validates results against allowed categories
- New match_source value: `'ai'` (already in the constraint)
- New review_status: `'ai_suggested'` (needs constraint update)

#### Changes to `src/pages/Expenses.tsx` (processFile)

After `categorizeTransactions()` returns, collect rows that got `needs_review` with no predicted category. If any exist and AI is enabled in settings (`ai_enabled`), call the AI edge function in batches. Merge AI results back: set `predicted_category`, `confidence`, `match_source: 'ai'`, `review_status: 'ai_suggested'`, and `match_explanation`.

### Database Migrations

1. Add `match_explanation` column:
```sql
ALTER TABLE public.transactions_uploaded 
  ADD COLUMN IF NOT EXISTS match_explanation text;
```

2. Update `review_status` constraint to include `ai_suggested`:
```sql
ALTER TABLE public.transactions_uploaded 
  DROP CONSTRAINT transactions_uploaded_review_status_check;
ALTER TABLE public.transactions_uploaded 
  ADD CONSTRAINT transactions_uploaded_review_status_check 
  CHECK (review_status = ANY (ARRAY[
    'auto_categorized', 'suggested', 'ai_suggested', 
    'needs_review', 'approved', 'edited'
  ]));
```

### Files Changed

| File | Change |
|------|--------|
| `src/components/TransactionDetailDrawer.tsx` | New — full detail drawer with all fields, category dropdown, match explanation, flags, save/approve actions |
| `src/pages/Expenses.tsx` | Replace inline edit with drawer; add AI categorization step in processFile; add `ai_suggested` to status filter; store `match_explanation` on insert |
| `supabase/functions/categorize-ai/index.ts` | New — edge function calling Lovable AI to infer categories from descriptions |
| `src/lib/categorization-engine.ts` | Add `categorizeWithAI` export; update `CategorizationResult` for ai_suggested |
| DB migration | Add `match_explanation` column; update `review_status` constraint |

### Summary

The edit experience becomes a wide detail drawer showing everything about the transaction including why it was categorized. AI fills in the gap for unmatched rows before they reach Needs Review, using only allowed categories. The status filter gains an "AI Suggested" option so you can review AI decisions separately.

