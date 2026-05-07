## Problem

Contributions YTD shows $0 (or too low) for Gemini, Dub, Collectr, and there's no Wealthfront account at all. Two issues:

### 1. Parentheses in auto_track_pattern break PostgREST queries

Dub's pattern is `dub (ecfi)`. The code builds a Supabase `.or()` filter like:
```
description_normalized.ilike.%dub (ecfi)%,description_raw.ilike.%dub (ecfi)%
```
PostgREST uses parentheses `()` as grouping operators inside `.or()`. The literal parens in "dub (ecfi)" corrupt the filter syntax, causing the query to silently fail and return no matches. This means Dub always shows $0.

**Fix**: Escape or strip parentheses from patterns before building the `.or()` filter. The safe approach is to replace `(` and `)` with wildcards or remove them, since ILIKE matching doesn't need exact paren matches for these merchant names.

### 2. Missing Wealthfront account

There's no Wealthfront investment account in the database, despite $8,000 in matching expenses YTD. The `DEFAULT_AUTO_ACCOUNTS` seed list includes Wealthfront, but auto-seeding only runs when you click "Sync from Expenses". Even then, `contributions_ytd` on the DB row stays at 0 because the live query recalculates — but the account needs to exist first.

**Fix**: No code change needed for this — clicking "Sync from Expenses" will create it. But the parentheses fix must land first so contributions actually calculate.

### 3. Broader pattern sanitization

The `safe` transform only strips `%` and `,` but not PostgREST-special characters like `(`, `)`, and `.`. All three need stripping.

## Changes

**File: `src/pages/Wealth.tsx`** — two locations (the `liveYtdMap` query and the `sync` mutation) both build `.or()` filters the same way. In both, update the sanitization:

```typescript
// Before:
const safe = t.replace(/[%,]/g, ' ');
// After:  
const safe = t.replace(/[%,().]/g, ' ').trim();
```

This ensures patterns like `dub (ecfi)` become `dub  ecfi ` which ILIKE handles correctly as a substring match.
