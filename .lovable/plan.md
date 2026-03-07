

## Plan: UI/UX Refactor — Airtable-Style Expense Workspace

### Overview
Simplify the app to 4 nav items (Expenses, Insights, Memory, Settings), make Expenses the default landing page with an integrated Airtable-style table, add non-transaction filtering, build an Insights page, and move Rules into Settings.

---

### 1. Navigation Restructure

**Modify `src/components/AppNav.tsx`:**
- Change nav items to: Expenses (`/`), Insights (`/insights`), Memory (`/merchants`), Settings (`/settings`)
- Remove Dashboard and Rules as top-level items

**Modify `src/App.tsx`:**
- `/` → Expenses page (new, replaces Dashboard)
- `/insights` → new Insights page
- `/merchants` → Memory (unchanged)
- `/settings` → Settings (unchanged, but with Rules embedded)
- Remove `/workspace/:mode` route
- Remove `/review` route (merged into Expenses)
- Remove `/rules` route

### 2. New Expenses Page (`src/pages/Expenses.tsx`)

Combines Workspace upload + ReviewTable into a single page. This is the core view.

**Top control bar:**
- Personal / Business segmented toggle (replaces route-based mode)
- Upload CSV button (opens dropzone/dialog)
- Search input
- Filter button with filter chips
- Date range selector
- Export button

**Summary chips row:**
- Total rows, Uncategorized, Needs review, Duplicates, Transfers excluded, This month spend

**Airtable-style table:**
- Dense rows (~32px height)
- Columns: checkbox, Date, Description, Amount, Category, Method, Notes, Confidence, Status, Duplicate, Transfer, Source File
- Sticky header + sticky checkbox column
- Sortable columns (click header to sort)
- Inline editable cells (click to edit category/method/notes)
- Bulk actions bar (appears when rows selected): Approve, Mark Transfer, Categorize
- Keyboard support: Enter to save, Escape to cancel, Tab to next field

**Upload integration:**
- "Upload CSV" button opens a sheet/dialog with the CsvUploader dropzone
- FileProgressList renders inside the sheet
- ImportPreviewDialog still shows for mapping confirmation
- After upload completes, table auto-refreshes

**Non-transaction filtering (in CSV parser):**
- Add `isStatementArtifact(description, amount)` function to `csv-parser.ts`
- Filters out: "Beginning balance", "Ending balance", "Total credits/debits", blank/header rows, 0-amount non-merchant rows
- These rows are skipped before insert, counted in batch summary as `artifacts_skipped`

### 3. Non-Transaction Row Filtering

**Modify `src/lib/csv-parser.ts`:**
Add a filter function that rejects rows matching patterns like:
- `/^(beginning|ending|opening|closing)\s+balance/i`
- `/^total\s+(credits|debits|charges)/i`
- `/^(statement|account)\s+(summary|period)/i`
- Blank descriptions
- Rows where amount is 0 and description looks like metadata (not a real merchant)

Apply this filter in `parseCsvFileWithMapping` before returning results.

### 4. Merchant Memory Protection

**Modify `src/pages/Expenses.tsx` (approve logic):**
- Only update merchant memory if:
  - Row is not a transfer (unless explicitly allowed)
  - Row is not a duplicate
  - Row has a real merchant description (not statement metadata)
  - Parse status is 'ok'

### 5. Insights Page (`src/pages/Insights.tsx`)

New page with Personal/Business toggle.

**Sections:**
1. **Spend Overview** — Cards showing: total this month, last month, MoM change, top category, top merchant, transfers excluded total
2. **Spend by Category** — Bar chart (recharts) of category breakdown, monthly trend line chart
3. **Top Merchants** — Table of top merchants by spend
4. **Recurring Charges** — Table: merchant, avg amount, frequency, category, last charged, monthly estimate (detected by grouping same merchant_key with 2+ occurrences)

Data queries will filter by mode, exclude transfers, and only count approved/auto_categorized rows.

### 6. Settings Page Update

**Modify `src/pages/Settings.tsx`:**
- Add an "Advanced Rules" accordion/collapsible section at the bottom
- Embed the full RulesEngine UI (rule list, add/edit/delete, tester) inside this section
- Remove `src/pages/RulesEngine.tsx` as standalone page

### 7. Files Changed

| File | Action |
|------|--------|
| `src/pages/Expenses.tsx` | **New** — Main expenses page with upload + table |
| `src/pages/Insights.tsx` | **New** — Spend insights page |
| `src/components/AppNav.tsx` | **Modified** — New nav structure |
| `src/App.tsx` | **Modified** — New routes |
| `src/lib/csv-parser.ts` | **Modified** — Add non-transaction filtering |
| `src/pages/Settings.tsx` | **Modified** — Embed Rules section |
| `src/pages/Dashboard.tsx` | **Deleted** |
| `src/pages/RulesEngine.tsx` | **Deleted** (content moves to Settings) |
| `src/pages/Workspace.tsx` | **Deleted** (content moves to Expenses) |
| `src/pages/ReviewTable.tsx` | **Deleted** (content moves to Expenses) |
| `src/pages/MerchantMemory.tsx` | **Minor** — Keep as-is |
| `src/index.css` | **Modified** — Add dense table styles |
| `src/components/ExpensesTable.tsx` | **New** — Airtable-style table component |
| `src/components/ExpensesSummary.tsx` | **New** — Summary chips component |
| `src/components/UploadSheet.tsx` | **New** — Sheet wrapper for upload flow |

### Implementation Order
1. Non-transaction filtering in csv-parser
2. New Expenses page with integrated table + upload
3. New Insights page
4. Settings with embedded Rules
5. Nav + routing updates
6. Remove old pages

