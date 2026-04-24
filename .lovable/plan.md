# Fix Income Defaults & Filters, Insights Expenses, Remove Reimbursements, Compact Wealth

## 1. Income — show all dates by default, fix preset filter

**Problem:** Cards show "This Month" only by default (~$68k) instead of all data. Preset buttons (Year to Date, Last 30 Days, etc.) don't appear to update the filter visibly because the cards still default to month when no filter is set.

**Fix in `src/pages/Income.tsx`:**
- `summaryCards` memo: when no `dateFrom`/`dateTo`, fall back to **all transactions** (not `thisMonth`). So fresh load shows the real all-time numbers.
- Header subtitle: `Summary: {dateActive ? dateLabel : 'All Dates'}`.
- Default `dateLabel` already `'All Dates'` — confirm it stays.
- Verify `applyYTD`, `applyThisMonth`, `applyLastMonth`, `applyLastNDays`, `applyLastYear`, `applyMonth` all set `dateFrom`/`dateTo` AND a label — they do. The only reason they "don't work" was that the user was looking at the cards which ignored the filter. Once cards read the filter (already wired in last fix), presets will visibly drive everything.

## 2. Insights — expenses missing

**Root cause:** `Insights.tsx` defaults to `mode: 'personal'`, but the DB only has **business** transactions (781 rows, $428k). Personal mode → 0 expenses → empty charts.

**Fix in `src/pages/Insights.tsx`:**
- Auto-detect default mode on first load: query both modes' counts, pick whichever has more rows. If both 0, default to `business`.
- Implement as a tiny `useEffect` that runs once after `user` is set: do `count: 'exact', head: true` for each mode, then `setMode(personalCount >= businessCount ? 'personal' : 'business')`.
- Keep the existing Personal/Business tab toggle so the user can switch.

## 3. Remove Reimbursements feature surface

**Approach:** Hide UI, keep DB columns intact (no migrations) so we don't break historic exports/queries.

**Changes:**
- **`src/components/AppNav.tsx`**: remove the `/reimbursements` nav item.
- **`src/App.tsx`**: remove `Reimbursements` import and the `/reimbursements` route. (Page file stays on disk, just unreachable.)
- **`src/pages/Income.tsx`**:
  - Remove `reimbursementGroups` state, `fetchReimbursementGroups`, `showMatchDialog`, `matchingTxId`, `openMatchDialog`, `matchToGroup`, `unlinkFromGroup`.
  - Remove the "Reimbursements" summary card.
  - Remove the Match-to-Reimbursement dialog and the link/unlink action buttons in the table Actions column.
  - Drop `'reimbursement'` from `INCOME_TYPE_OPTIONS` so users can't classify new income as reimbursement.
- **`src/pages/Expenses.tsx`**:
  - Remove the "Reimbursable/Work" mode tab and `reimbursable_work` from `TransactionMode`.
  - Remove the "Reimbursable" extra filter option, the "→ Reimburse" bulk-switch button, the `pendingReimbursable` stat card, and the per-row "reimbursed/partial/submitted/pending" badges.
  - Stop writing `is_reimbursable`/`reimbursement_status`/`reimbursable_to` from manual classify/edit paths (set defaults on insert only).
- **`src/pages/CloseMonth.tsx`**: remove step 2 ("Confirm Reimbursements") from `steps` array; renumber. Remove `pendingReimb` query and its UI.
- **`src/pages/Accountant.tsx`**: remove `'reimbursement_report'` from `ExportType`, the EXPORT_TYPES entry, the `reimbursements` query, and its case in the export switch. Year-end summary: drop the "Reimbursement Inflows" and "Reimbursable Expenses (fronted)" rows (or set to 0 silently — simpler to just remove the lines).
- **Tax page** (`src/pages/Tax.tsx` line 363-365): drop the reimbursement taxable-warning block.
- **`src/lib/income-classifier.ts`**: keep the regex so legacy data classifies, but the `'reimbursement'` option no longer appears in the UI. Acceptable — no breakage.

## 4. Wealth — compact for one-screen fit (1042×686)

**Reading the user again:** "wealth ui/ux looks the same … themodal cards are way too large." → They mean the **page cards** (summary tiles + per-account tiles), which they're calling "modal" loosely. Page currently overflows because of large cards, big gaps, and big section headings.

**Fix in `src/pages/Wealth.tsx`:**
- Container: `py-6 space-y-6` → `py-4 space-y-3`.
- Title row: `text-2xl` → `text-xl`; smaller "Add Account" button.
- **Summary cards** (Total Balance / Contributions YTD / Yearly Target):
  - `gap-4` → `gap-2`.
  - `CardHeader`/`CardContent`: tighten with `p-3`, `pb-1`.
  - Label `text-sm` → `text-[11px]`; value `text-2xl` → `text-lg`.
- **Group section headers**: `text-sm` → `text-[10px]`, less margin.
- **Account cards grid**: `gap-4` → `gap-2`. Card body: `p-3`, balance `text-xl` → `text-base`, badges/labels already small. Remove "Updated …" line (low value, costs a row). Hide "Monthly target" line when "Yearly target" is shown (redundant).
- Keep responsive grid the same (`md:grid-cols-2 lg:grid-cols-3`).

**Goal:** with 1–6 accounts, the whole page fits in 686px without scroll.

## QA
- `/income` on first load: cards show all-dates totals (~$298k inflows, ~$225k revenue). Click "This Month" preset → drops to ~$68k. "Year to Date" → ~$298k.
- `/insights` Spending tab: expense charts populate (business data shown), Personal/Business toggle still works.
- No "Reimburse" tab in nav. `/reimbursements` URL → 404. Income/Expenses/Close/Accountant pages render without reimbursement UI or runtime errors.
- `/wealth` at 1042×686: title, 3 summary cards, all account cards visible without vertical scroll.
