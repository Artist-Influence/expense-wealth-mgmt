

## Plan: Auto-Generate Advanced Rules from Seeded Data

### Problem
The approved plan to auto-generate categorization rules from historical CSVs hasn't been implemented yet. You also want it to work for data that's **already been seeded** (existing merchant memory), not just future uploads.

### Changes

**`src/pages/Settings.tsx`**

1. **Add rule generation to `handleSeedConfirm`** — After seeding merchants and categories, analyze the parsed transactions: group descriptions by category, extract common keywords (appearing in 2+ merchants per category, min 3 chars), and insert them as `categorization_rules` with `match_type: 'contains'`, priority 200. Skip duplicates by checking existing rules first.

2. **Add "Generate Rules from Memory" button** — A new button in the Historical Seed section that reads existing `merchant_memory` for the selected mode, groups by `most_common_category`, extracts common keywords from `raw_example`/`merchant_key`, and creates rules the same way. This covers already-uploaded data without re-uploading.

3. **Also clear auto-generated rules in `clearSeededData`** — When clearing seeded data, also delete rules with priority 200 (the auto-generated ones) so re-seeding starts fresh.

### Rule Generation Logic (shared helper)
```
- Group merchants by category
- For each category with 2+ merchants, tokenize merchant keys into words
- Find words appearing in 2+ merchants (min 3 chars, exclude generic words like "THE", "AND", "INC")
- Create a "contains" rule for each keyword → category
- Skip if rule already exists (same pattern + category + mode)
```

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Settings.tsx` | Add rule generation in `handleSeedConfirm`; add "Generate Rules from Memory" button; clear auto-rules on data clear |

