# Add Category Filter to Expenses

Add a third filter dropdown next to the existing Status and Filter dropdowns on the Expenses page so you can narrow the table down to a single category (e.g. only "Substances" or only "Software").

## What you'll see

A new "Category" dropdown next to the Status and Filter selectors above the expenses table. Options:
- **All Categories** (default)
- **Uncategorized** (no final or predicted category)
- One entry per active category from your category list (e.g. Substances, Software, Travel, etc.), sorted by your existing `sort_order`.

Selecting one filters the table to rows whose `final_category` (or `predicted_category` if no final is set) matches. The filter combines with the existing Status / Filter / search controls.

## Technical changes (single file: `src/pages/Expenses.tsx`)

1. Add state: `const [categoryFilter, setCategoryFilter] = useState<string>('all');`
2. Extend the `filtered` useMemo to apply:
   ```ts
   if (categoryFilter !== 'all') {
     const effective = tx.final_category || tx.predicted_category || '';
     if (categoryFilter === '__uncategorized__') {
       if (effective) return false;
     } else if (effective !== categoryFilter) {
       return false;
     }
   }
   ```
3. Add the filter to the useMemo dependency array.
4. Insert a new `<Select>` in the filters toolbar (after the existing extraFilter Select, ~line 1074), populated from the existing `categories` state already loaded by `loadCategories()` — no new query needed.
5. Reuse the same `glass-input` styling and an `h-8` trigger to match the other two dropdowns.

No database changes, no new components, no new dependencies.