## Goal

Turn the `/assistant` chatbot into a finance analyst that **calculates first, explains second**. The AI never invents numbers — it only narrates results returned by deterministic backend functions, always states the date range/scope, separates profit vs cash flow vs transfers, and flags messy data.

Grounded in your real data: 1,884 expense rows + 224 income rows (Dec 2025–Jun 2026), 36 cash-balance snapshots, 4 investment accounts. Today `treatment_type` only knows expense/transfer/credit_card_payment/refund, and business↔personal moves are generic `account_transfer`. We will add the missing classifications.

---

## Layer 1 — Add missing transaction classifications (migration + reclass)

Extend `transactions_uploaded.treatment_type` usage with new values (kept as text, no enum change needed): `owner_draw`, `owner_contribution`, `loan_proceeds`, `loan_repayment`, `tax_payment`, `payroll`, `contractor`, `investment`. Add helper columns:

- `is_internal_transfer boolean default false`
- `linked_transaction_id uuid` (paired transfers)
- `direction text` (inflow/outflow, derived from sign)
- `recurring_group_id uuid`, `recurrence_frequency text`, `expected_next_date date`

A one-time backfill (SQL + a reclass pass in the edge function/script) sets:
- Business→personal `account_transfer` → `owner_draw`; personal→business → `owner_contribution` (detected by `economic_owner` change + transfer pairing).
- Loan keywords (loan, SBA, advance, line of credit) → `loan_proceeds` (inflow) / `loan_repayment` (outflow).
- Tax keywords (IRS, NYS DTF, franchise tax, estimated tax) → `tax_payment`.
- Payroll/contractor keywords → `payroll`/`contractor`.
- Transfer pairing: match opposite-sign rows, equal/near amount, dates within 0–3 days, transfer-like descriptions → set `is_internal_transfer=true` + link both `linked_transaction_id`.

Import-time classification (in `categorization-engine.ts` / `transfer-detector.ts`) applies the same rules to new CSVs so future imports are correct.

## Layer 2 — Deterministic calculation module (edge function)

New file `supabase/functions/assistant-chat/finance.ts` exporting pure functions that take `(supabase, ownerId, params)` and return structured numbers. These encode the accounting rules so the AI can't get them wrong:

- `getIncomeSummary` — gross_income, true_operating_income, refunds, reimbursements, loan_proceeds, owner_contributions, excluded_inflows, by_source/account/month.
- `getExpenseSummary` — total/operating/personal/business expenses, tax_payments, debt_payments, credit_card_payments, transfers_out, excluded_outflows, by_category/vendor/account/month.
- `getProfitAndLoss` — gross_revenue, operating_expenses, net_operating_profit, owner_draws, taxes_paid, estimated_tax_reserve, net_cash_after_draws, margin, biggest_categories, MoM change.
- `getCashFlow` — starting/ending cash (from `account_balance_snapshots`), net change, cash in/out, operating vs transfers/debt/owner-draws split.
- `getNetWorth` — **assets-only** (cash snapshots + investment_accounts), with explicit `liabilities_tracked: false` warning baked in.
- `getRunway` — available cash, 3mo/6mo avg burn, runway_months, upcoming recurring, warning flags.
- `getCategoryDrilldown` / `getMerchantDrilldown` — totals, counts, avg size, top merchants/related txns, MoM.
- `getRecurring` — subscriptions/fixed overhead via `recurring_group_id` + cadence (reuse `recurrence-detector.ts` logic).
- `getAnomalies` — categories/merchants up >X% MoM, unusually large txns, income drops, possible duplicates.
- `getAffordability(amount)` — combines available cash, avg personal+business burn, upcoming fixed expenses, tax reserve, min cash buffer → "yes / no / yes-but" verdict.
- `getDataQuality` — uncategorized count + value, % of volume/value, unmatched transfers, needs_review count.

Every function honors existing integrity rules (only `COUNTED_STATUSES`, exclude split-parents, exclude transfers/non-expense movements from spend) and returns a `_debug` block: rows included/excluded, filters, warnings.

## Layer 3 — Expose as AI tools + harden the prompt

Replace the current thin tools with tools that wrap the Layer-2 functions (`income_summary`, `expense_summary`, `profit_and_loss`, `cash_flow`, `net_worth`, `runway`, `category_drilldown`, `merchant_drilldown`, `recurring`, `anomalies`, `affordability`, `data_quality`), keeping `get_today`.

Rewrite `PLATFORM_GUIDE` with explicit rules:
- **Intent → date → scope → function → answer.** Always call a tool; never invent figures.
- **Default definitions:** "make" = gross income then net operating profit; "spend" = true expenses excluding transfers/CC payments (mention total outflow if different); "profit" = business income − business operating expenses (exclude draws/transfers/CC/loans/contributions); "cash flow" = all movement, broken out; "take home" = owner draws + owner payroll; "net worth" = assets minus liabilities (note liabilities not tracked); "afford" = use affordability function, not raw balance.
- **Guardrails:** auto-append warnings when uncategorized >5% of value/volume, transfers unmatched, CC import assumed, taxes excluded, cash-basis only, or N txns need review.
- **Response format:** answer sentence first → bulleted breakdown → one insight → warning if needed.

## Layer 4 — Per-answer audit/debug panel (chat UI)

In `AssistantChat.tsx`, add a collapsible **Audit** panel under each assistant message that reads the `_debug` blocks from that message's tool outputs and shows: parsed intent, date range, filters/scope, function(s) called, rows included/excluded, uncategorized/transfer counts, confidence/data warnings. Built from the existing AI Elements `Tool` parts (no new backend channel needed). Hidden behind a small "Why this answer?" toggle so it doesn't clutter normal use.

## Layer 5 — Saved finance preferences

Add a `finance_preferences` row (extend `app_settings` or a new table) for: min personal/business cash buffer, tax reserve %, monthly savings goal, personal/business spend targets, categories excluded from reports, cash vs accrual basis. The affordability/runway/tax functions read these; a small section in `/settings` lets you edit them.

## Deploy & verify

- Run migration, backfill reclass, redeploy `assistant-chat`.
- Test each scenario from the spec (business income, personal spend, profit, "why did cash go down", Amex spend, owner draw, CC payment, loan proceeds, refund, uncategorized warning) via direct edge-function calls and confirm numbers match SQL and the audit panel reflects the right filters.

---

### Technical notes
- No enum migration required — `treatment_type` is already free text; we add new allowed values + helper columns and GRANTs stay unchanged (columns added to existing table).
- Net worth is assets-only by your choice; the tool hard-codes a "liabilities not tracked" warning so the AI always discloses it.
- Recurring/anomaly logic reuses `recurrence-detector.ts` rather than reinventing it.
- All AI calls, tools, and prompts stay server-side in the edge function; the client only renders streamed parts + the audit panel.
