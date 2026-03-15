# Expense Memory — Complete App Guide

## 1. What It Is

Expense Memory is a **private, single-user finance control app** for one person (Jared, `jared@artistinfluence.com`). It is not a multi-tenant SaaS — it's a personal tool for managing cash flow across personal life, a business (Artist Influence), and reimbursable work expenses.

The core value proposition: **Import raw bank/credit card CSVs → the app learns your merchants over time → categorization becomes increasingly automatic → export clean, bookkeeping-ready data.**

---

## 2. Technology Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **UI Library**: shadcn/ui components (dark glassmorphism theme)
- **Backend**: Lovable Cloud (Supabase under the hood)
  - PostgreSQL database with Row-Level Security on every table
  - Edge Functions (Deno) for AI categorization
  - No external auth provider — uses Supabase Auth with email/password
- **AI**: Lovable AI gateway (Google Gemini 3 Flash Preview) for transaction categorization
- **CSV Parsing**: PapaParse
- **Charts**: Recharts
- **State**: React Query for server state, local `useState` for UI state

---

## 3. Authentication & Access Control

- **Hard-locked to a single email** (`jared@artistinfluence.com`) in `useAuth.ts`
- Login page: email + password form, rejects any other email before even hitting the auth server
- `AuthGuard` component wraps all routes — redirects unauthenticated users to `/login`
- No signup flow, no password reset UI — this is intentional for a private tool
- Session persists via Supabase auth cookies/localStorage

---

## 4. Navigation Structure

11 top-level pages in a horizontal nav bar:

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Expenses | Primary workspace — import, review, categorize, approve transactions |
| `/income` | Income | Track inflows, classify by type, match reimbursements |
| `/insights` | Insights | Automated spend analytics, charts, trends |
| `/reimbursements` | Reimburse | Track expenses you fronted, group into reports |
| `/wealth` | Wealth | Investment account tracker with contribution targets |
| `/allocations` | Allocate | Monthly cash allocation planner |
| `/tax` | Tax | Tax reserve calculator (Federal/NYS/NYC) |
| `/merchants` | Memory | View/edit learned merchant categorization memory |
| `/accountant` | Accountant | Export accountant-ready reports (6 types) |
| `/close-month` | Close | Guided 6-step monthly close workflow |
| `/settings` | Settings | Categories, thresholds, rules, historical seeding |

Nav includes a **live badge** on Expenses showing the count of transactions needing review (refreshes every 30 seconds).

---

## 5. Core Flow: Expense Import & Categorization

This is the heart of the app. Here's the complete pipeline:

### Step 1: CSV Upload
- User drops one or more CSV files onto the `CsvUploader` component
- Each file is parsed with PapaParse to extract headers
- `ImportPreviewDialog` opens showing detected columns and auto-mapped fields (description, amount, date, category, method, notes)
- User can adjust column mappings before confirming
- Payment method is auto-detected from filename (e.g., "chase_visa_jan.csv" → "Chase Visa")

### Step 2: Parsing & Normalization
- `csv-parser.ts` parses each row using the confirmed mapping
- `normalizer.ts` processes raw descriptions:
  - Extracts real merchant names from ACH metadata (e.g., `ORIG CO NAME: SPOTIFY` → `SPOTIFY`)
  - Strips transaction IDs, bank transport words, and noise
  - Generates a stable `merchant_key` for matching
- Statement artifacts (e.g., "Beginning Balance", "Total Credits") are automatically filtered out via regex patterns

### Step 3: Duplicate Detection
- **Exact duplicates**: Fingerprint = `mode|date|amount|normalized_description`. If it matches an existing transaction, the row is skipped entirely.
- **Near duplicates**: Same amount + similar description + date within 3 days = flagged as `possible_duplicate` but still imported with a warning badge.
- Both behaviors are configurable toggles in Settings.

### Step 4: Transfer Detection
- `transfer-detector.ts` checks descriptions against 30+ regex patterns for credit card payments, account transfers, wire transfers, etc.
- Detected transfers are automatically flagged with `is_transfer: true` and excluded from expense totals
- Transfer transactions get their spend tracking booleans set to `false`

### Step 5: 5-Layer Categorization Engine
The `categorization-engine.ts` runs each transaction through 5 layers in order:

1. **Exact Merchant Memory Match** — Looks up the normalized `merchant_key` in the `merchant_memory` table. If found, uses the stored category/method/notes. Confidence is boosted by `times_seen` (e.g., a merchant seen 5+ times gets confidence 95+).

2. **Partial/Fuzzy Merchant Match** — If no exact match, checks if the merchant key partially contains (or is contained by) any known merchant key. Requires 50%+ overlap. Lower confidence (capped at 89).

3. **Rules Engine** — Checks the `categorization_rules` table. Each rule has a `match_type` (contains, equals, regex), a `pattern`, and output fields. Rules check both raw AND normalized descriptions. Priority ordering is respected.

4. **CSV Category Passthrough** — If the CSV itself had a category column and it's in the allowed category list, it's used with 75% confidence.

5. **AI Categorization** — For remaining unmatched transactions (if AI is enabled in Settings), batches of up to 20 descriptions are sent to the `categorize-ai` edge function. This calls Google Gemini via Lovable AI gateway. AI returns: category, confidence (capped at 95), inferred merchant name, suggested mode, suggested tax treatment, and whether it's likely reimbursable.

### Step 6: Review Status Assignment
Based on confidence and thresholds (configurable in Settings, default auto=90, suggest=70):
- **`auto_categorized`** (confidence ≥ auto threshold): Category is pre-filled, auto-approved if confidence ≥ 95 and match source is exact/normalized history
- **`suggested`** (confidence ≥ suggest threshold): Category is suggested but needs user approval
- **`ai_suggested`**: AI provided a category with confidence ≥ 80
- **`needs_review`**: No match found, or confidence below suggest threshold

### Step 7: Database Insert
- All rows are inserted into `transactions_uploaded` with full metadata
- An `upload_batches` record is created tracking file-level stats
- V2 mode defaults are applied based on the selected transaction mode (personal/business/reimbursable_work)

---

## 6. Transaction Review Workflow

### The Expenses Table (Airtable-style)
- Dense spreadsheet layout: Date, Description (truncated), Amount, Category, Confidence pill, Status badge, Mode badge
- Sortable columns (date, description, amount, category, confidence)
- Filterable by: review status, transfers, possible duplicates, parse errors, excluded, uncategorized, reimbursable
- Full-text search across descriptions and categories
- Mode switcher: Personal / Business / Reimbursable/Work (each loads its own transaction set)

### Summary Stats Row
- Total transactions count
- Needs Review count
- Total Cash Out
- True Personal/Business Spend (excludes transfers, non-expense movements)
- Pending Reimbursable amount

### Bulk Actions (when rows are selected)
- **Approve** — Approves all selected, updates merchant memory
- **Mark as Transfer** — Sets transfer flags, excludes from totals
- **Switch Mode** — Moves to Personal/Business/Reimbursable with correct downstream field updates
- **Delete** — With confirmation dialog; cleans up orphaned upload batches
- **Approve All Suggested** — One-click approves all `suggested`/`ai_suggested` rows

### Transaction Detail Drawer
Opens via row click. Shows:
- Raw description + normalized version + merchant key
- Match source badge with icon (History, Rule, AI, etc.)
- Match explanation text (human-readable reasoning)
- Confidence score
- Editable fields: Category (dropdown from allowed list), Method, Notes
- Mode switcher (Personal/Business/Reimburse) that auto-updates downstream fields
- V2 fields: Economic Owner, Treatment Type, Tax Treatment, Reimbursable toggle, Business Purpose, Client/Project Tag
- Flag indicators: Transfer, Possible Duplicate, Parse Error, Source File
- Actions: Save, Approve, Toggle Transfer
- **Guardrail**: Saving without a category keeps the transaction in `needs_review` status

### Merchant Memory Updates
When a transaction is approved or saved:
- If it's a valid expense (not a transfer, not a duplicate, not a statement artifact)
- The merchant key + category + method + notes are upserted into `merchant_memory`
- `times_seen` is incremented, `confidence_weight` is boosted
- This feeds back into Layer 1 of the categorization engine for future imports

---

## 7. Income Page

- CSV import with PapaParse (auto-maps date/description/amount columns)
- **Duplicate detection**: Fingerprint-based dedup (date + amount + normalized description)
- **Auto-classification**: `income-classifier.ts` uses regex rules to classify income type (payroll, reimbursement, refund, transfer, interest, business revenue, etc.) and taxable status
- Manual entry form for ad-hoc income
- Inline editing of income type and taxable status per row
- Bulk actions: set type, set taxable status, approve, delete (with confirmation)
- **Reimbursement matching**: Can link income transactions to pending reimbursement groups
- Summary cards show current month totals: Total Inflows, Taxable, Non-Taxable, Reimbursements, Business Revenue, Payroll
- CSV export

---

## 8. Insights Page

Three tabs:

### Spending Tab
- This Month vs Last Month comparison with MoM % change
- Top category and top merchant cards
- Transfers excluded amount
- Category breakdown bar chart
- Top 10 merchants table
- Monthly spend trend line chart
- Recurring charges detection (identifies subscriptions by frequency analysis: monthly, weekly, biweekly, quarterly, annual)

### Income & Savings Tab
- Income vs Expenses bar chart (last 12 months)
- Savings rate cards (current month, trailing 3-month)
- Year-over-year comparison (income change %, expense change %)
- **Note**: Income totals are cross-mode (not filtered by personal/business), while expenses are filtered by the selected mode

### Trends Tab
- Top 6 category spending trends over time (line charts)
- Payment method breakdown (pie chart)
- Data quality summary (approval rate, needs review count, uncategorized count)

---

## 9. Reimbursements Page

- Shows all transactions where `is_reimbursable = true`
- Tab filters: Pending, Submitted, Reimbursed, All
- Summary cards: Pending total, Submitted total, Reimbursed This Month, Overdue (submitted 30+ days ago)
- **Report Groups**: Bundle selected expenses into a reimbursement group with title, "reimbursable to" field, and notes
- Group status workflow: pending → submitted → reimbursed
- Updating group status cascades to all linked transactions
- Aging indicator shows days since transaction date
- CSV export formatted as expense report
- Detail drawer for editing individual transactions

---

## 10. Wealth Page

- Investment account tracker with CRUD
- Account types: Roth IRA, Traditional IRA, Brokerage, Crypto, Collectibles, Savings, Other
- Grouped display by category (Retirement, Brokerage, Alternative, Other)
- Each account card shows: balance, contribution progress bar (YTD vs yearly target), monthly target, "last updated" timestamp
- Add/Edit dialog with all fields including notes
- Delete with AlertDialog confirmation
- Summary cards: Total Balance, Contributions YTD, Yearly Target

---

## 11. Allocations Page

- Monthly cash allocation planner
- Auto-pulls: month's income, month's expenses, tax reserve suggestion (from tax profile rates)
- Creates an `allocation_plans` record with calculated free cash (income - expenses - tax reserve - emergency fund)
- Line items: target account + amount + notes + executed checkbox
- Linked to investment accounts for target selection
- Plan statuses: draft → finalized → executed
- Navigate between months

---

## 12. Tax Page

- Tax profile setup: filing status, state/city, reserve percentages (Federal/NYS/NYC), income source toggles
- Real-time calculations: Taxable Income YTD → minus Deductions → Adjusted Income → Reserve targets per jurisdiction
- Reserve Gap = Total Target − (W2 Withholding + Estimated Payments + Tracked Tax Payments)
- Three breakdown tabs: Income by Type, Deductions by Category, Tax Payments Made
- Data is pulled live from `income_transactions` (taxable income) and `transactions_uploaded` (deductions via `counts_as_tax_deduction`, tax payments via `treatment_type`)

---

## 13. Merchant Memory Page

- View all learned merchant mappings (sorted by times_seen, limited to 200)
- Search by key, raw example, or category
- Inline edit: change category, method, or notes for a merchant
- Delete with confirmation
- Shows count and limit warning when 200 records reached

---

## 14. Accountant Page

6 export types, each generating a downloadable CSV:
1. **Expense Ledger** — All approved expenses with categories, methods, notes
2. **Income Ledger** — All income with type and taxable status
3. **Reimbursement Report** — Groups with status and amounts
4. **Tax Deductions** — Deductible expenses grouped by category
5. **Tax Payments** — Tax payment transactions made
6. **Year-End Summary** — Combined income, expenses, deductions, net position

Period selector: Month / Quarter / Year with date range picker. Preview table before download.

---

## 15. Close Month Page

Guided 6-step monthly close wizard:
1. **Review Exceptions** — Shows count of `needs_review` transactions for the month, links to Expenses
2. **Confirm Reimbursements** — Shows pending reimbursement groups, links to Reimbursements
3. **Check Tax Reserves** — Shows month income and suggested reserve, links to Tax
4. **Review Allocations** — Shows allocation plan status, links to Allocations
5. **Generate Exports** — Links to Accountant page
6. **Mark Complete** — Summary + confirmation (requires all 5 prior steps)

Progress bar tracks completion. Month selector for closing any of the last 12 months.

---

## 16. Settings Page

### Categories
- Separate lists for Personal and Business categories
- Add with dedup check (case-insensitive)
- Delete with AlertDialog confirmation

### Confidence Thresholds
- Auto-categorize threshold (default 90) — above this, transactions are auto-categorized
- Suggest threshold (default 70) — above this, suggestions are shown
- Separate sliders for Personal and Business modes

### Toggles
- AI categorization enabled/disabled
- Prevent exact duplicates
- Flag possible duplicates
- Exclude transfers from totals

### Historical Seeding
- Upload a pre-categorized CSV to seed merchant memory and auto-generate rules
- `SeedMappingDialog` for column mapping
- Auto-generates `categorization_rules` by finding common words across merchants in the same category
- Separate seed flows for Personal expenses, Business expenses, Personal income, Business income
- "Clear All" button to wipe seeded data for a mode

### Rules Engine
- Create/edit/delete categorization rules
- Match types: contains, equals, regex
- Each rule has: name, mode (personal/business/both), pattern, category output, method output, notes output, priority, active toggle
- Rule tester: type a description and see which rule matches
- "Generate Rules from Memory" button to auto-create rules from existing merchant memory

---

## 17. What's Automated vs Manual

### Fully Automated (no user action needed)
- Column auto-detection in CSV import
- Statement artifact filtering
- Description normalization and merchant key generation
- Transfer detection (30+ patterns)
- Exact duplicate skipping
- Near-duplicate flagging
- 5-layer categorization engine execution
- Merchant memory updates on approve/save
- Income type classification on import
- Auto-approval of 95%+ confidence exact merchant matches
- Review count badge in nav (live refresh)

### Semi-Automated (user confirms)
- Column mapping (auto-suggested, user confirms)
- Category suggestions (shown in table, user approves)
- AI suggestions (shown with explanation, user approves)
- Reimbursement group matching (suggested, user confirms)
- Allocation plan (pre-calculated, user adjusts and saves)

### Fully Manual
- Adding new categories
- Creating categorization rules (though auto-generation from seeding exists)
- Editing transaction details (mode, tax treatment, business purpose, etc.)
- Creating reimbursement report groups
- Adding/editing investment accounts
- Setting up tax profile
- Walking through Close Month steps
- Manual income entry
- Adjusting confidence thresholds
- Seeding historical data

---

## 18. UI/UX Design Language

- **Theme**: Dark mode glassmorphism with charcoal/graphite background (`hsl(220, 20%, 7%)`)
- **Glass panels**: `backdrop-blur-xl`, semi-transparent card backgrounds, subtle border glow
- **Typography**: JetBrains Mono for numbers/data, Inter for text
- **Color system**:
  - Primary: Blue (`hsl(225, 70%, 55%)`)
  - Success: Green (`hsl(145, 40%, 42%)`)
  - Warning: Amber (`hsl(38, 80%, 55%)`)
  - Destructive: Red (`hsl(0, 55%, 50%)`)
- **Confidence pills**: Green (90+), Amber (70-89), Red (<70)
- **Status badges**: Green (auto/approved), Amber (suggested), Red (needs review), Blue (edited)
- **Layout**: Dense, data-first Airtable-style tables on primary screens; card-based layouts for dashboards
- **Interactions**: Hover-to-reveal edit buttons, inline editing where possible, right-side drawers for detail views
- **Mobile**: Horizontal scroll on nav, responsive grid breakpoints on cards

---

## 19. Database Schema Summary

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `transactions_uploaded` | All expense transactions | 40+ columns including V2 fields for mode, tax, reimbursement |
| `income_transactions` | All income transactions | Type, taxable status, linked reimbursement group |
| `merchant_memory` | Learned merchant → category mappings | merchant_key, category, method, times_seen, confidence_weight |
| `categorization_rules` | Pattern-based rules for auto-categorization | match_type, pattern, category_output, priority |
| `category_options` | Allowed categories per mode | mode, category_name, sort_order |
| `app_settings` | User preferences and thresholds | thresholds, toggles, flags |
| `upload_batches` | Import session records | file stats, detected headers, mapped columns |
| `investment_accounts` | Wealth tracker accounts | balances, targets, contributions |
| `allocation_plans` | Monthly allocation plans | income, expenses, reserves, free cash |
| `allocation_line_items` | Individual allocation entries | target account, amount, executed |
| `reimbursement_groups` | Expense report bundles | status, totals, dates |
| `tax_profiles` | Tax configuration | filing status, reserve percentages, withholding |
| `profiles` | User profile | email, is_owner flag |

All tables have owner_id-based RLS policies.

---

## 20. Edge Function

One edge function: `categorize-ai`
- Accepts batches of up to 20 transaction descriptions
- Uses Google Gemini 3 Flash Preview via Lovable AI gateway
- Returns structured output via function calling: category, confidence (capped at 95), explanation, inferred merchant, suggested mode, suggested tax treatment, likely reimbursable flag
- Validates returned categories against the allowed list
- Graceful error handling for rate limits (429), payment required (402)
