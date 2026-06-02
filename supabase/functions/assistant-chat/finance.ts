/**
 * Deterministic finance calculation module for the in-app assistant.
 *
 * Every function here returns hard numbers computed under strict accounting
 * rules so the LLM never has to do math (and can never hallucinate figures).
 * Each result carries a `_debug` block describing exactly what was included,
 * excluded, and any data-quality warnings — surfaced in the chat audit panel.
 *
 * Data realities this module is built around:
 *  - All `transactions_uploaded.amount` values are stored POSITIVE; money
 *    direction comes from `treatment_type` / `direction`, never the sign.
 *  - Only reviewed rows count toward totals (COUNTED_STATUSES).
 *  - Split-parent rows, transfers and non-expense cash movements are excluded
 *    from true spend.
 *  - Net worth is ASSETS-ONLY (cash snapshots + investments); liabilities are
 *    not tracked, so every net-worth result says so.
 */

// deno-lint-ignore-file no-explicit-any

export const COUNTED_STATUSES = [
  "approved",
  "auto_categorized",
  "edited",
  "suggested",
  "ai_suggested",
];

export type Scope = "business" | "personal" | "all";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const sumAbs = (rows: any[], pick = (r: any) => r.amount) =>
  rows.reduce((s, r) => s + Math.abs(Number(pick(r)) || 0), 0);

const TXN_FIELDS =
  "id, date, amount, mode, transaction_mode, economic_owner, treatment_type, direction, " +
  "is_transfer, is_internal_transfer, is_non_expense_cash_movement, exclude_from_expense_totals, " +
  "is_split_parent, review_status, final_category, predicted_category, transfer_type, " +
  "description_raw, description_normalized";

const catOf = (r: any) => r.final_category ?? r.predicted_category ?? "Uncategorized";
const merchantOf = (r: any) =>
  (r.description_normalized || r.description_raw || "Unknown").trim();

function modeFilter(q: any, scope?: Scope) {
  if (scope === "business") return q.eq("mode", "business");
  if (scope === "personal") return q.eq("mode", "personal");
  return q;
}

function applyRange(q: any, start?: string, end?: string) {
  if (start) q = q.gte("date", start);
  if (end) q = q.lte("date", end);
  return q;
}

/** A true, counted expense (excludes transfers, CC payments, non-expense moves). */
function isTrueExpense(r: any): boolean {
  return (
    r.treatment_type === "expense" &&
    !r.is_transfer &&
    !r.is_non_expense_cash_movement &&
    !r.exclude_from_expense_totals
  );
}

/** Prior period of equal length ending the day before `start`. */
function prevRange(start?: string, end?: string): { start?: string; end?: string } {
  if (!start || !end) return {};
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const lenDays = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(s.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (lenDays - 1) * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return { start: ymd(prevStart), end: ymd(prevEnd) };
}

function pctChange(curr: number, prev: number): number | null {
  if (!prev) return null;
  return r2(((curr - prev) / Math.abs(prev)) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch ALL rows for a query builder, paging past PostgREST's 1000-row cap.
 * `build()` must return a fresh query builder each call so .range() applies cleanly.
 */
async function fetchAll(build: () => any): Promise<any[]> {
  const PAGE = 1000;
  const out: any[] = [];
  let from = 0;
  // Hard ceiling to avoid runaway loops on bad inputs.
  for (let guard = 0; guard < 50; guard++) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function loadCountedTxns(
  supabase: any,
  ownerId: string,
  opts: { start?: string; end?: string; scope?: Scope } = {},
): Promise<any[]> {
  return fetchAll(() => {
    let q = supabase
      .from("transactions_uploaded")
      .select(TXN_FIELDS)
      .eq("owner_id", ownerId)
      .eq("is_split_parent", false)
      .in("review_status", COUNTED_STATUSES)
      .order("date", { ascending: true });
    q = modeFilter(q, opts.scope);
    q = applyRange(q, opts.start, opts.end);
    return q;
  });
}

async function loadIncome(
  supabase: any,
  ownerId: string,
  opts: { start?: string; end?: string; scope?: Scope } = {},
): Promise<any[]> {
  return fetchAll(() => {
    let q = supabase
      .from("income_transactions")
      .select("date, amount, mode, income_type, taxable_status, status, description_raw, source_account_name")
      .eq("owner_id", ownerId)
      .neq("status", "needs_review")
      .order("date", { ascending: true });
    if (opts.scope === "business") q = q.eq("mode", "business");
    if (opts.scope === "personal") q = q.eq("mode", "personal");
    q = applyRange(q, opts.start, opts.end);
    return q;
  });
}

/** Total cash across all accounts as of a date (latest snapshot per account ≤ date). */
async function cashAsOf(supabase: any, ownerId: string, asOf?: string): Promise<number> {
  let q = supabase
    .from("account_balance_snapshots")
    .select("account_id, as_of_date, balance")
    .eq("owner_id", ownerId)
    .order("as_of_date", { ascending: false });
  if (asOf) q = q.lte("as_of_date", asOf);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  const latest: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!(row.account_id in latest)) latest[row.account_id] = Number(row.balance) || 0;
  }
  return Object.values(latest).reduce((s, b) => s + b, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Income / Expense classification buckets
// ─────────────────────────────────────────────────────────────────────────────

const INCOME_EXCLUDED_TYPES = /reimburs|refund|transfer|loan|owner.?contrib/i;
const REIMB_TYPE = /reimburs/i;
const REFUND_TYPE = /refund/i;
const LOAN_TYPE = /loan|proceeds|advance/i;
const CONTRIB_TYPE = /owner.?contrib|capital/i;

// ─────────────────────────────────────────────────────────────────────────────
// Data quality
// ─────────────────────────────────────────────────────────────────────────────

export async function getDataQuality(
  supabase: any,
  ownerId: string,
  params: { start_date?: string; end_date?: string; scope?: Scope } = {},
) {
  const { start_date: start, end_date: end, scope } = params;
  // All rows in range (no status filter) for the quality picture.
  let rows: any[];
  try {
    rows = await fetchAll(() => {
      let q = supabase
        .from("transactions_uploaded")
        .select("amount, review_status, final_category, predicted_category, is_transfer, is_internal_transfer, linked_transaction_id, is_split_parent")
        .eq("owner_id", ownerId)
        .eq("is_split_parent", false)
        .order("date", { ascending: true });
      q = modeFilter(q, scope);
      q = applyRange(q, start, end);
      return q;
    });
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const rows = data ?? [];
  const totalCount = rows.length;
  const totalValue = sumAbs(rows);
  const uncategorized = rows.filter(
    (r: any) => !r.final_category && !r.predicted_category,
  );
  const needsReview = rows.filter((r: any) => r.review_status === "needs_review");
  const unmatchedTransfers = rows.filter(
    (r: any) => r.is_transfer && !r.linked_transaction_id,
  );
  const uncatValue = sumAbs(uncategorized);
  const pctCount = totalCount ? r2((uncategorized.length / totalCount) * 100) : 0;
  const pctValue = totalValue ? r2((uncatValue / totalValue) * 100) : 0;

  const warnings: string[] = [];
  if (pctCount > 5 || pctValue > 5)
    warnings.push(
      `${uncategorized.length} uncategorized transactions ($${r2(uncatValue)}, ${pctValue}% of value) — clean these up before relying fully on totals.`,
    );
  if (needsReview.length)
    warnings.push(`${needsReview.length} transactions still need review and are excluded from totals.`);
  if (unmatchedTransfers.length)
    warnings.push(`${unmatchedTransfers.length} transfers are not matched to a pair — transfer totals may be imperfect.`);

  return {
    range: { start, end, scope: scope ?? "all" },
    total_transactions: totalCount,
    total_value: r2(totalValue),
    uncategorized_count: uncategorized.length,
    uncategorized_value: r2(uncatValue),
    uncategorized_pct_count: pctCount,
    uncategorized_pct_value: pctValue,
    needs_review_count: needsReview.length,
    unmatched_transfers: unmatchedTransfers.length,
    reliable: pctValue <= 5 && pctCount <= 5,
    warnings,
    _debug: {
      function: "getDataQuality",
      filters: { start, end, scope: scope ?? "all" },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Income summary
// ─────────────────────────────────────────────────────────────────────────────

export async function getIncomeSummary(
  supabase: any,
  ownerId: string,
  params: { start_date?: string; end_date?: string; scope?: Scope } = {},
) {
  const { start_date: start, end_date: end, scope } = params;
  let rows: any[];
  try {
    rows = await loadIncome(supabase, ownerId, { start, end, scope });
  } catch (e) {
    return { error: String((e as Error).message) };
  }

  let gross = 0, refunds = 0, reimbursements = 0, loans = 0, contributions = 0, operating = 0;
  const bySource: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  for (const r of rows) {
    const amt = Math.abs(Number(r.amount) || 0);
    const t = String(r.income_type || "other");
    gross += amt;
    if (REIMB_TYPE.test(t)) reimbursements += amt;
    else if (REFUND_TYPE.test(t)) refunds += amt;
    else if (LOAN_TYPE.test(t)) loans += amt;
    else if (CONTRIB_TYPE.test(t)) contributions += amt;
    else operating += amt;
    const src = (r.source_account_name || "Unknown").trim();
    bySource[src] = (bySource[src] || 0) + amt;
    const m = (r.date || "").slice(0, 7);
    if (m) byMonth[m] = (byMonth[m] || 0) + amt;
  }

  const dq = await getDataQuality(supabase, ownerId, { start_date: start, end_date: end, scope });

  return {
    range: { start, end, scope: scope ?? "all" },
    gross_income: r2(gross),
    true_operating_income: r2(operating),
    refunds_received: r2(refunds),
    reimbursements_received: r2(reimbursements),
    loan_proceeds: r2(loans),
    owner_contributions: r2(contributions),
    excluded_inflows: r2(refunds + reimbursements + loans + contributions),
    income_by_source: Object.entries(bySource)
      .map(([source, amount]) => ({ source, amount: r2(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 25),
    income_by_month: Object.entries(byMonth)
      .map(([month, amount]) => ({ month, amount: r2(amount) }))
      .sort((a, b) => (a.month < b.month ? -1 : 1)),
    transaction_count: rows.length,
    warnings: (dq as any).warnings ?? [],
    _debug: {
      function: "getIncomeSummary",
      filters: { start, end, scope: scope ?? "all" },
      rows_included: rows.length,
      note: "Operating income excludes reimbursements, refunds, loan proceeds and owner contributions.",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expense summary
// ─────────────────────────────────────────────────────────────────────────────

export async function getExpenseSummary(
  supabase: any,
  ownerId: string,
  params: { start_date?: string; end_date?: string; scope?: Scope } = {},
) {
  const { start_date: start, end_date: end, scope } = params;
  let rows: any[];
  try {
    rows = await loadCountedTxns(supabase, ownerId, { start, end, scope });
  } catch (e) {
    return { error: String((e as Error).message) };
  }

  const trueExp = rows.filter(isTrueExpense);
  const taxPayments = rows.filter((r) => r.treatment_type === "tax_payment");
  const ccPayments = rows.filter(
    (r) => r.treatment_type === "credit_card_payment" || r.transfer_type === "credit_card_payment",
  );
  const debtPayments = rows.filter((r) =>
    ["loan_repayment", "debt_payment"].includes(r.treatment_type),
  );
  const transfersOut = rows.filter(
    (r) => (r.is_transfer || r.treatment_type === "transfer" || r.treatment_type === "owner_draw") &&
      r.transfer_type !== "credit_card_payment" && r.treatment_type !== "credit_card_payment",
  );

  const total = sumAbs(trueExp);
  const byCategory: Record<string, number> = {};
  const byVendor: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  for (const r of trueExp) {
    const amt = Math.abs(Number(r.amount) || 0);
    byCategory[catOf(r)] = (byCategory[catOf(r)] || 0) + amt;
    byVendor[merchantOf(r)] = (byVendor[merchantOf(r)] || 0) + amt;
    const m = (r.date || "").slice(0, 7);
    if (m) byMonth[m] = (byMonth[m] || 0) + amt;
  }

  const personal = sumAbs(trueExp.filter((r) => r.mode === "personal"));
  const business = sumAbs(trueExp.filter((r) => r.mode === "business"));

  const dq = await getDataQuality(supabase, ownerId, { start_date: start, end_date: end, scope });

  return {
    range: { start, end, scope: scope ?? "all" },
    total_expenses: r2(total),
    operating_expenses: r2(total),
    personal_expenses: r2(personal),
    business_expenses: r2(business),
    tax_payments: r2(sumAbs(taxPayments)),
    debt_payments: r2(sumAbs(debtPayments)),
    credit_card_payments: r2(sumAbs(ccPayments)),
    transfers_out: r2(sumAbs(transfersOut)),
    excluded_outflows: r2(sumAbs(ccPayments) + sumAbs(transfersOut)),
    expenses_by_category: Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount: r2(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 25),
    expenses_by_vendor: Object.entries(byVendor)
      .map(([vendor, amount]) => ({ vendor, amount: r2(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 25),
    expenses_by_month: Object.entries(byMonth)
      .map(([month, amount]) => ({ month, amount: r2(amount) }))
      .sort((a, b) => (a.month < b.month ? -1 : 1)),
    transaction_count: trueExp.length,
    warnings: (dq as any).warnings ?? [],
    _debug: {
      function: "getExpenseSummary",
      filters: { start, end, scope: scope ?? "all" },
      rows_loaded: rows.length,
      true_expense_rows: trueExp.length,
      excluded: {
        credit_card_payments: ccPayments.length,
        transfers: transfersOut.length,
        tax_payments: taxPayments.length,
        debt_payments: debtPayments.length,
      },
      note: "total_expenses counts true expenses only (excludes transfers, CC payments, tax & debt payments).",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profit & Loss (business)
// ─────────────────────────────────────────────────────────────────────────────

export async function getProfitAndLoss(
  supabase: any,
  ownerId: string,
  params: { start_date?: string; end_date?: string; tax_reserve_percent?: number } = {},
) {
  const { start_date: start, end_date: end } = params;
  const reservePct = params.tax_reserve_percent ?? 30;

  const inc = await getIncomeSummary(supabase, ownerId, { start_date: start, end_date: end, scope: "business" });
  const exp = await getExpenseSummary(supabase, ownerId, { start_date: start, end_date: end, scope: "business" });
  if ((inc as any).error) return inc;
  if ((exp as any).error) return exp;

  const revenue = (inc as any).true_operating_income as number;
  const opex = (exp as any).operating_expenses as number;
  const netProfit = r2(revenue - opex);
  const ownerDraws = (exp as any).transfers_out as number; // business internal transfers out (estimate)
  const taxesPaid = (exp as any).tax_payments as number;
  const reserve = r2(Math.max(0, netProfit) * (reservePct / 100));
  const netAfter = r2(netProfit - ownerDraws - reserve);

  // Month-over-month vs previous equal-length period.
  const prev = prevRange(start, end);
  let mom: number | null = null;
  if (prev.start) {
    const pInc = await getIncomeSummary(supabase, ownerId, { start_date: prev.start, end_date: prev.end, scope: "business" });
    const pExp = await getExpenseSummary(supabase, ownerId, { start_date: prev.start, end_date: prev.end, scope: "business" });
    const prevProfit = ((pInc as any).true_operating_income || 0) - ((pExp as any).operating_expenses || 0);
    mom = pctChange(netProfit, prevProfit);
  }

  return {
    range: { start, end, scope: "business" },
    gross_revenue: r2(revenue),
    operating_expenses: r2(opex),
    net_operating_profit: netProfit,
    profit_margin: revenue ? r2((netProfit / revenue) * 100) : null,
    owner_draws_estimate: r2(ownerDraws),
    taxes_paid: r2(taxesPaid),
    estimated_tax_reserve: reserve,
    tax_reserve_percent: reservePct,
    net_cash_after_owner_draws_and_reserve: netAfter,
    biggest_expense_categories: (exp as any).expenses_by_category?.slice(0, 8) ?? [],
    month_over_month_profit_change_pct: mom,
    warnings: [
      ...((exp as any).warnings ?? []),
      "Owner draws are estimated from business→outside internal transfers and may be imprecise.",
      "Profit excludes owner draws, transfers, credit-card payments, loan proceeds and owner contributions.",
    ],
    _debug: {
      function: "getProfitAndLoss",
      filters: { start, end, scope: "business" },
      formula: "net_operating_profit = business operating income − business operating expenses",
      prev_period: prev,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash flow
// ─────────────────────────────────────────────────────────────────────────────

export async function getCashFlow(
  supabase: any,
  ownerId: string,
  params: { start_date?: string; end_date?: string; scope?: Scope } = {},
) {
  const { start_date: start, end_date: end, scope } = params;
  let txns: any[];
  try {
    txns = await loadCountedTxns(supabase, ownerId, { start, end, scope });
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const income = await getIncomeSummary(supabase, ownerId, { start_date: start, end_date: end, scope });

  const trueExp = txns.filter(isTrueExpense);
  const ccPayments = txns.filter(
    (r) => r.treatment_type === "credit_card_payment" || r.transfer_type === "credit_card_payment",
  );
  const taxPayments = txns.filter((r) => r.treatment_type === "tax_payment");
  const debtPayments = txns.filter((r) => ["loan_repayment", "debt_payment"].includes(r.treatment_type));
  const draws = txns.filter((r) => r.treatment_type === "owner_draw" || (r.is_transfer && r.mode === "business"));
  const otherTransfers = txns.filter(
    (r) => r.is_transfer && r.transfer_type !== "credit_card_payment" && r.mode !== "business",
  );

  const operatingIn = (income as any).true_operating_income || 0;
  const otherIn = (income as any).excluded_inflows || 0;
  const operatingOut = sumAbs(trueExp);
  const totalIn = operatingIn + otherIn;
  const totalOut =
    operatingOut + sumAbs(ccPayments) + sumAbs(taxPayments) + sumAbs(debtPayments) + sumAbs(draws);

  let startingCash: number | null = null;
  let endingCash: number | null = null;
  try {
    if (start) startingCash = await cashAsOf(supabase, ownerId, start);
    endingCash = await cashAsOf(supabase, ownerId, end);
  } catch { /* snapshots optional */ }

  return {
    range: { start, end, scope: scope ?? "all" },
    starting_cash_balance: startingCash == null ? null : r2(startingCash),
    ending_cash_balance: endingCash == null ? null : r2(endingCash),
    net_cash_change_from_snapshots:
      startingCash == null || endingCash == null ? null : r2(endingCash - startingCash),
    total_cash_in: r2(totalIn),
    total_cash_out: r2(totalOut),
    net_cash_change_computed: r2(totalIn - totalOut),
    operating_cash_in: r2(operatingIn),
    operating_cash_out: r2(operatingOut),
    credit_card_payments: r2(sumAbs(ccPayments)),
    tax_payments: r2(sumAbs(taxPayments)),
    debt_payments: r2(sumAbs(debtPayments)),
    owner_draws_estimate: r2(sumAbs(draws)),
    other_transfers: r2(sumAbs(otherTransfers)),
    warnings: [
      "Cash-out includes true expenses, credit-card payments, taxes, debt payments and owner draws.",
      "Snapshot balances depend on uploaded account balance snapshots being current.",
      ...((income as any).warnings ?? []),
    ],
    _debug: {
      function: "getCashFlow",
      filters: { start, end, scope: scope ?? "all" },
      counts: {
        true_expenses: trueExp.length,
        cc_payments: ccPayments.length,
        tax_payments: taxPayments.length,
        debt_payments: debtPayments.length,
        owner_draws: draws.length,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Net worth (assets-only)
// ─────────────────────────────────────────────────────────────────────────────

export async function getNetWorth(
  supabase: any,
  ownerId: string,
  params: { as_of?: string } = {},
) {
  const asOf = params.as_of;
  let cash = 0;
  try {
    cash = await cashAsOf(supabase, ownerId, asOf);
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const { data: inv, error } = await supabase
    .from("investment_accounts")
    .select("account_name, account_type, mode, current_balance")
    .eq("owner_id", ownerId)
    .eq("is_active", true);
  if (error) return { error: error.message };
  const investments = (inv ?? []).reduce((s: number, a: any) => s + (Number(a.current_balance) || 0), 0);

  // MoM: cash ~30 days earlier (investments treated as static).
  let prevNet: number | null = null;
  try {
    const base = asOf ? new Date(asOf + "T00:00:00Z") : new Date();
    const prior = new Date(base.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const prevCash = await cashAsOf(supabase, ownerId, prior);
    prevNet = prevCash + investments;
  } catch { /* ignore */ }

  const totalAssets = r2(cash + investments);
  return {
    as_of: asOf ?? "today",
    total_assets: totalAssets,
    total_liabilities: 0,
    net_worth: totalAssets,
    cash: r2(cash),
    investments: r2(investments),
    liabilities_tracked: false,
    month_over_month_net_worth_change: prevNet == null ? null : r2(totalAssets - prevNet),
    warnings: [
      "Net worth is ASSETS-ONLY: credit-card balances and loans are NOT tracked, so true net worth is lower than this figure.",
    ],
    _debug: {
      function: "getNetWorth",
      sources: "cash = latest account_balance_snapshots per account; investments = active investment_accounts",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recurring detection (ported pure logic)
// ─────────────────────────────────────────────────────────────────────────────

const CADENCE_BANDS = [
  { name: "weekly", min: 6, max: 8 },
  { name: "biweekly", min: 13, max: 16 },
  { name: "monthly", min: 25, max: 35 },
  { name: "quarterly", min: 85, max: 100 },
  { name: "annual", min: 350, max: 380 },
];
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function getRecurring(
  supabase: any,
  ownerId: string,
  params: { scope?: Scope } = {},
) {
  const since = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  let rows: any[];
  try {
    rows = await loadCountedTxns(supabase, ownerId, { start: since, scope: params.scope });
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const exp = rows.filter(isTrueExpense);
  const buckets = new Map<string, any[]>();
  for (const r of exp) {
    const key = merchantOf(r).toUpperCase();
    if (!key || key === "UNKNOWN") continue;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r);
  }
  const recurring: any[] = [];
  for (const [merchant, list] of buckets) {
    if (list.length < 3) continue;
    const sorted = [...list].filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
    const amounts = sorted.map((r) => Math.abs(Number(r.amount) || 0)).filter((n) => n > 0);
    if (amounts.length < 3) continue;
    const med = median(amounts);
    if (!med) continue;
    const mean = amounts.reduce((s, n) => s + n, 0) / amounts.length;
    const variance = amounts.reduce((s, n) => s + (n - mean) ** 2, 0) / amounts.length;
    const cv = Math.sqrt(variance) / mean;
    const stable = amounts.every((a) => Math.abs(a - med) <= 1) || cv < 0.12;
    if (!stable) continue;
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++)
      gaps.push(Math.abs(new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86_400_000);
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const band = CADENCE_BANDS.find((b) => avgGap >= b.min && avgGap <= b.max);
    if (!band) continue;
    const lastDate = sorted[sorted.length - 1].date;
    const nextDate = new Date(new Date(lastDate).getTime() + avgGap * 86_400_000).toISOString().slice(0, 10);
    recurring.push({
      merchant,
      cadence: band.name,
      typical_amount: r2(med),
      charges_seen: amounts.length,
      category: catOf(sorted[sorted.length - 1]),
      mode: sorted[sorted.length - 1].mode,
      expected_next_date: nextDate,
    });
  }
  recurring.sort((a, b) => b.typical_amount - a.typical_amount);
  const monthlyOverhead = recurring.reduce((s, r) => {
    const perMonth: Record<string, number> = { weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 1 / 3, annual: 1 / 12 };
    return s + r.typical_amount * (perMonth[r.cadence] || 1);
  }, 0);
  return {
    scope: params.scope ?? "all",
    recurring_count: recurring.length,
    estimated_monthly_fixed_overhead: r2(monthlyOverhead),
    subscriptions: recurring.slice(0, 50),
    _debug: { function: "getRecurring", window_start: since, merchants_scanned: buckets.size },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Category / merchant drilldown
// ─────────────────────────────────────────────────────────────────────────────

export async function getCategoryDrilldown(
  supabase: any,
  ownerId: string,
  params: { category: string; start_date?: string; end_date?: string; scope?: Scope },
) {
  const { category, start_date: start, end_date: end, scope } = params;
  let rows: any[];
  try {
    rows = await loadCountedTxns(supabase, ownerId, { start, end, scope });
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const match = rows
    .filter(isTrueExpense)
    .filter((r) => catOf(r).toLowerCase() === category.toLowerCase());
  const total = sumAbs(match);
  const byMerchant: Record<string, { amount: number; count: number }> = {};
  for (const r of match) {
    const k = merchantOf(r);
    if (!byMerchant[k]) byMerchant[k] = { amount: 0, count: 0 };
    byMerchant[k].amount += Math.abs(Number(r.amount) || 0);
    byMerchant[k].count += 1;
  }
  const prev = prevRange(start, end);
  let mom: number | null = null;
  if (prev.start) {
    const pRows = (await loadCountedTxns(supabase, ownerId, { start: prev.start, end: prev.end, scope }))
      .filter(isTrueExpense)
      .filter((r) => catOf(r).toLowerCase() === category.toLowerCase());
    mom = pctChange(total, sumAbs(pRows));
  }
  return {
    category,
    range: { start, end, scope: scope ?? "all" },
    total_spend: r2(total),
    transaction_count: match.length,
    average_transaction_size: match.length ? r2(total / match.length) : 0,
    top_merchants: Object.entries(byMerchant)
      .map(([merchant, v]) => ({ merchant, amount: r2(v.amount), count: v.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15),
    month_over_month_change_pct: mom,
    _debug: { function: "getCategoryDrilldown", filters: { category, start, end, scope: scope ?? "all" } },
  };
}

export async function getMerchantDrilldown(
  supabase: any,
  ownerId: string,
  params: { merchant: string; start_date?: string; end_date?: string; scope?: Scope },
) {
  const { merchant, start_date: start, end_date: end, scope } = params;
  let rows: any[];
  try {
    rows = await loadCountedTxns(supabase, ownerId, { start, end, scope });
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const needle = merchant.toLowerCase();
  const match = rows.filter((r) => merchantOf(r).toLowerCase().includes(needle));
  const spend = match.filter(isTrueExpense);
  const total = sumAbs(spend);
  const cats: Record<string, number> = {};
  for (const r of spend) cats[catOf(r)] = (cats[catOf(r)] || 0) + Math.abs(Number(r.amount) || 0);
  return {
    merchant,
    range: { start, end, scope: scope ?? "all" },
    total_spend: r2(total),
    transaction_count: match.length,
    expense_transaction_count: spend.length,
    categories_used: Object.entries(cats)
      .map(([category, amount]) => ({ category, amount: r2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    related_transactions: match
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 25)
      .map((r) => ({
        date: r.date,
        amount: r2(Math.abs(Number(r.amount) || 0)),
        category: catOf(r),
        treatment: r.treatment_type,
        mode: r.mode,
        description: merchantOf(r),
      })),
    _debug: { function: "getMerchantDrilldown", filters: { merchant, start, end, scope: scope ?? "all" } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anomalies (this month vs last month)
// ─────────────────────────────────────────────────────────────────────────────

export async function getAnomalies(
  supabase: any,
  ownerId: string,
  params: { this_month_start: string; today: string; last_month_start: string; last_month_end: string; scope?: Scope },
) {
  const { this_month_start, today, last_month_start, last_month_end, scope } = params;
  let curr: any[], prev: any[];
  try {
    curr = (await loadCountedTxns(supabase, ownerId, { start: this_month_start, end: today, scope })).filter(isTrueExpense);
    prev = (await loadCountedTxns(supabase, ownerId, { start: last_month_start, end: last_month_end, scope })).filter(isTrueExpense);
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const sumBy = (rows: any[], keyFn: (r: any) => string) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[keyFn(r)] = (m[keyFn(r)] || 0) + Math.abs(Number(r.amount) || 0);
    return m;
  };
  const cCat = sumBy(curr, catOf), pCat = sumBy(prev, catOf);
  const categorySpikes = Object.keys(cCat)
    .map((c) => ({ category: c, current: r2(cCat[c]), previous: r2(pCat[c] || 0), change_pct: pctChange(cCat[c], pCat[c] || 0) }))
    .filter((x) => x.change_pct != null && x.change_pct >= 30 && x.current >= 100)
    .sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0));

  const all = curr.map((r) => Math.abs(Number(r.amount) || 0));
  const mean = all.length ? all.reduce((s, n) => s + n, 0) / all.length : 0;
  const sd = all.length ? Math.sqrt(all.reduce((s, n) => s + (n - mean) ** 2, 0) / all.length) : 0;
  const largeTxns = curr
    .filter((r) => Math.abs(Number(r.amount) || 0) > mean + 2.5 * sd && Math.abs(Number(r.amount) || 0) > 250)
    .map((r) => ({ date: r.date, amount: r2(Math.abs(Number(r.amount) || 0)), category: catOf(r), description: merchantOf(r) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  return {
    range: { this_month_start, today, scope: scope ?? "all" },
    category_spikes: categorySpikes.slice(0, 10),
    unusually_large_transactions: largeTxns,
    _debug: { function: "getAnomalies", current_rows: curr.length, previous_rows: prev.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Affordability
// ─────────────────────────────────────────────────────────────────────────────

export async function getAffordability(
  supabase: any,
  ownerId: string,
  params: {
    amount: number;
    scope?: Scope;
    today: string;
    trailing_start: string;
    prefs?: any;
  },
) {
  const { amount, scope, today, trailing_start, prefs } = params;
  let cash = 0;
  try {
    cash = await cashAsOf(supabase, ownerId, today);
  } catch { /* ignore */ }

  // Trailing ~90 day burn → monthly average true expenses.
  let burnRows: any[];
  try {
    burnRows = (await loadCountedTxns(supabase, ownerId, { start: trailing_start, end: today, scope })).filter(isTrueExpense);
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const days = Math.max(1, (new Date(today).getTime() - new Date(trailing_start).getTime()) / 86_400_000);
  const monthlyBurn = sumAbs(burnRows) / (days / 30);

  const recurring = await getRecurring(supabase, ownerId, { scope });
  const upcomingFixed = (recurring as any).estimated_monthly_fixed_overhead || 0;

  const buffer =
    scope === "business"
      ? Number(prefs?.min_business_cash_buffer) || 0
      : Number(prefs?.min_personal_cash_buffer) || 0;
  const reservePct = Number(prefs?.tax_reserve_percent) || 0;

  const cashAfter = cash - amount;
  const safeFloor = buffer + upcomingFixed;
  let verdict: "yes" | "yes_but" | "no";
  let reason: string;
  if (cashAfter >= safeFloor + monthlyBurn) {
    verdict = "yes";
    reason = `After spending $${r2(amount)} you'd have $${r2(cashAfter)}, comfortably above your $${r2(safeFloor)} buffer + upcoming bills and one month of burn ($${r2(monthlyBurn)}).`;
  } else if (cashAfter >= safeFloor) {
    verdict = "yes_but";
    reason = `You technically can — you'd have $${r2(cashAfter)} left — but that dips below one month of burn ($${r2(monthlyBurn)}) on top of your buffer, so it's tight.`;
  } else if (cashAfter >= 0) {
    verdict = "yes_but";
    reason = `You'd have $${r2(cashAfter)} left, which is below your $${r2(buffer)} cash buffer plus upcoming fixed costs ($${r2(upcomingFixed)}). Not recommended.`;
  } else {
    verdict = "no";
    reason = `You don't have enough liquid cash — spending $${r2(amount)} would leave you at $${r2(cashAfter)}.`;
  }

  return {
    amount: r2(amount),
    scope: scope ?? "all",
    verdict,
    reason,
    available_cash: r2(cash),
    cash_after_purchase: r2(cashAfter),
    average_monthly_burn: r2(monthlyBurn),
    upcoming_fixed_monthly: r2(upcomingFixed),
    min_cash_buffer: r2(buffer),
    tax_reserve_percent: reservePct,
    warnings: [
      "Affordability uses cash snapshots, trailing burn and recurring bills — not unpaid invoices or pending income.",
      ...((recurring as any)._debug ? [] : []),
    ],
    _debug: {
      function: "getAffordability",
      inputs: { amount, scope: scope ?? "all", buffer, monthlyBurn: r2(monthlyBurn), upcomingFixed: r2(upcomingFixed) },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Runway
// ─────────────────────────────────────────────────────────────────────────────

export async function getRunway(
  supabase: any,
  ownerId: string,
  params: { scope?: Scope; today: string; start_3mo: string; start_6mo: string },
) {
  const { scope, today, start_3mo, start_6mo } = params;
  let cash = 0;
  try {
    cash = await cashAsOf(supabase, ownerId, today);
  } catch { /* ignore */ }
  let r3: any[], r6: any[];
  try {
    r3 = (await loadCountedTxns(supabase, ownerId, { start: start_3mo, end: today, scope })).filter(isTrueExpense);
    r6 = (await loadCountedTxns(supabase, ownerId, { start: start_6mo, end: today, scope })).filter(isTrueExpense);
  } catch (e) {
    return { error: String((e as Error).message) };
  }
  const burn3 = sumAbs(r3) / 3;
  const burn6 = sumAbs(r6) / 6;
  const burn = burn3 || burn6;
  const recurring = await getRecurring(supabase, ownerId, { scope });
  const warnings: string[] = [];
  const runway = burn > 0 ? r2(cash / burn) : null;
  if (runway != null && runway < 3) warnings.push("Runway is under 3 months — watch cash closely.");
  return {
    scope: scope ?? "all",
    available_cash: r2(cash),
    average_monthly_burn_3mo: r2(burn3),
    average_monthly_burn_6mo: r2(burn6),
    runway_months: runway,
    estimated_monthly_fixed_overhead: (recurring as any).estimated_monthly_fixed_overhead ?? null,
    warning_flags: warnings,
    _debug: { function: "getRunway", cash: r2(cash), burn3: r2(burn3), burn6: r2(burn6) },
  };
}
