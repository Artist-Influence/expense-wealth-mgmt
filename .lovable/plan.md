# Add New Category from Dropdown

Currently categories can only be added via the Settings page. This plan adds an **"+ Add new category…"** option at the bottom of every category `<Select>` so you can create one inline while categorizing a transaction.

## Where the option will appear

Three category dropdowns get the new affordance:

1. **Expenses table — inline category cell** (`src/pages/Expenses.tsx`, line ~1474) — the per-row dropdown used to set/change a transaction's category
2. **Transaction Detail Drawer** (`src/components/TransactionDetailDrawer.tsx`, line ~294) — the right-side editor
3. **Split Transaction Dialog** (`src/components/SplitTransactionDialog.tsx`, line ~199) — when splitting a transaction across multiple categories

The **filter dropdown** at line 1208 (used to *filter* the table by category) will NOT get this — it's a query control, not a value editor.

## How it will work

Bottom of each category `<SelectContent>`:

```text
─────────────────
Groceries
Subscriptions
Utilities
...
─────────────────
+ Add new category…
```

Selecting **"+ Add new category…"** opens a small inline dialog (reusing the existing shadcn `Dialog`) with:
- A text input (autofocused)
- The detected mode shown as context ("Adding to *Personal* categories")
- **Cancel** / **Create** buttons

On **Create**:
1. Trim + validate the name (non-empty, not a duplicate of an existing category in that mode — case-insensitive check)
2. Insert into `category_options` (mode = current `categoryMode`, sort_order = current count, owner_id = user.id, is_active = true)
3. Refresh the local `categories` list in the parent page
4. Auto-select the newly created category as the value of the dropdown that opened the dialog
5. Toast: "Category added"

Errors (duplicate, empty, DB failure) show a toast and keep the dialog open.

## Implementation details

### New shared component: `src/components/AddCategoryDialog.tsx`
Small controlled dialog with:
- Props: `open`, `onClose`, `mode` ('personal' | 'business'), `existingCategories: string[]`, `onCreated: (newCategoryName: string) => void`
- Handles the Supabase insert and validation internally
- Emits the created name back so the caller can set it as the selected value

### `src/pages/Expenses.tsx`
- Add state: `addCategoryDialogOpen`, `pendingCategoryTarget` (which transaction row triggered it)
- In the inline cell `<Select>` (line ~1474), append a `<SelectItem value="__add_new__">` styled with primary color and a `+` icon
- In `onValueChange`, intercept `__add_new__` → open dialog instead of saving
- On dialog `onCreated(name)` → call existing `handleFieldChange(tx.id, 'category', name)` for the pending row, refresh `categories`
- Same pattern for the filter? **No** — only for the editable cells
- Pass `categories` and an `onCategoryAdded` refresh callback into the drawer and split dialog (which they already render)

### `src/components/TransactionDetailDrawer.tsx`
- Add prop: `onAddCategory?: () => void` (or include the dialog inline, but keeping it in the parent page is cleaner so the parent owns the categories list)
- Add `<SelectItem value="__add_new__">+ Add new category…</SelectItem>` at the bottom
- Intercept in `onValueChange`: if `__add_new__`, call `onAddCategory()` and don't update `editValues.category`
- After parent creates the category and refreshes, the new name is available in the `categories` prop and the user can pick it (or the parent can auto-pick by passing back through a separate `pendingCategorySelection` prop)

### `src/components/SplitTransactionDialog.tsx`
- Same pattern as the drawer: append the "+ Add new category…" item, intercept the value, and use a parent-owned dialog
- Track which split row triggered it so the new category is auto-applied to that row

### Database
- No schema changes — `category_options` already supports this exact use case (it's what the Settings page writes to)
- Insert pattern matches the existing one in `src/pages/Settings.tsx` line 185

## Out of scope
- Editing or deleting categories from the dropdown (still done in Settings)
- Reordering (still done in Settings)
- Adding to the *filter* dropdown (intentionally — filters shouldn't create data)
- Income categories (Income page doesn't have an editable category dropdown today)
