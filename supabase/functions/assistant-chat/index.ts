import { createClient } from "npm:@supabase/supabase-js@2";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "npm:ai";
import { z } from "npm:zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Statuses that count toward financial totals (mirrors the app's "suggested" review mode).
const COUNTED_STATUSES = ["approved", "auto_categorized", "edited", "suggested", "ai_suggested"];

// The owner is based in NYC (matches NYS/NYC tax context), so resolve "today" in that timezone.
const OWNER_TIMEZONE = "America/New_York";

// Returns YYYY-MM-DD for a given Date in the owner's timezone.
function ymdInTz(d: Date, timeZone = OWNER_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Builds an authoritative current-date context with pre-computed common ranges.
function getDateContext() {
  const now = new Date();
  const today = ymdInTz(now);
  const [y, m] = today.split("-").map(Number);

  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDayOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();

  const prevMonthY = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: OWNER_TIMEZONE,
    weekday: "long",
  }).format(now);
  const longDate = new Intl.DateTimeFormat("en-US", {
    timeZone: OWNER_TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  return {
    today,
    current_year: y,
    current_month: `${y}-${pad(m)}`,
    weekday,
    long_date: longDate,
    this_year_start: `${y}-01-01`,
    this_month_start: `${y}-${pad(m)}-01`,
    last_month_start: `${prevMonthY}-${pad(prevMonth)}-01`,
    last_month_end: `${prevMonthY}-${pad(prevMonth)}-${pad(lastDayOfMonth(prevMonthY, prevMonth))}`,
    last_year_start: `${y - 1}-01-01`,
    last_year_end: `${y - 1}-12-31`,
  };
}

function buildDateBlock(ctx: ReturnType<typeof getDateContext>): string {
  return `
CURRENT DATE CONTEXT (authoritative — never override from training data or memory):
- Today is ${ctx.today} (${ctx.weekday}, ${ctx.long_date}).
- Current year = ${ctx.current_year}. Current month = ${ctx.current_month}.
- "this year" / "YTD" = ${ctx.this_year_start} through ${ctx.today}.
- "this month" = ${ctx.this_month_start} through ${ctx.today}.
- "last month" = ${ctx.last_month_start} through ${ctx.last_month_end}.
- "last year" = ${ctx.last_year_start} through ${ctx.last_year_end}.
- NEVER assume any other year. If the user does not name a year, use the current year (${ctx.current_year}).
- You may call get_today to re-confirm these computed ranges before any data query.
`;
}

const PLATFORM_GUIDE = `
You are the in-app AI assistant for a personal + business cash-control and wealth platform used by a single owner.
You can (1) explain how the platform works and (2) answer questions about the owner's live financial data using the provided tools.

HOW THE PLATFORM WORKS (pages):
- Expenses (/): Airtable-style dense spreadsheet of uploaded bank/credit-card transactions. CSVs are imported, auto-categorized through a 5-layer engine (exact merchant memory, fuzzy match, rules, CSV hints, AI), and reviewed. Each transaction has a mode (personal / business / reimbursable_work), a treatment, a tax treatment, and a category.
- Income (/income): imported inflows (earnings vs reimbursements).
- Insights (/insights): charts and totals of spend & income by category/month.
- Wealth (/wealth): net worth & investment account tracking toward a target.
- Allocate (/allocations): monthly waterfall splitting free cash into emergency fund, tax reserve, and investments.
- Tax (/tax): flat-rate Federal/NYS/NYC reserve estimates based on a tax profile.
- Memory (/merchants): learned merchant defaults (category, method, mode).
- Accountant (/accountant): read-only full-data exports.
- Close (/close-month): guided monthly reconciliation & finalization.
- Settings (/settings): thresholds, categories, payment methods, passcode.

FINANCIAL-INTEGRITY RULES (always honored by the tools, explain them when relevant):
- Only reviewed transactions count toward totals (statuses: ${COUNTED_STATUSES.join(", ")}). Raw "needs_review" rows are excluded by default.
- Split-parent rows and transfers / non-expense cash movements are excluded from spend totals.
- Category used for reporting is the edited/final category, falling back to the predicted category.

STYLE:
- Be concise and use markdown. Format money as US dollars.
- When you state a number, ALWAYS state the exact date range you used (e.g. "Jan 1, 2026 – Jun 2, 2026 (YTD)") and the mode. Derive the range only from the CURRENT DATE CONTEXT above — never state a year you did not compute from it.
- For any relative period ("this year", "YTD", "last month", "this month", "last year"), use the pre-computed ranges from the CURRENT DATE CONTEXT and pass them as start_date/end_date to the data tools.
- If a question needs data, call the appropriate tool. Never invent figures.
- If data is missing or empty, say so plainly.
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const messages: UIMessage[] = body.messages ?? [];
    const threadId: string | undefined = body.threadId;
    const ownerId: string = body.ownerId ?? userId;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const provider = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
    });
    const model = provider("google/gemini-3-flash-preview");

    // ---- Helpers ----
    const expenseBase = () =>
      supabase
        .from("transactions_uploaded")
        .select(
          "date, amount, mode, transaction_mode, final_category, predicted_category, description_raw, description_normalized, review_status",
        )
        .eq("owner_id", ownerId)
        .eq("is_split_parent", false)
        .eq("exclude_from_expense_totals", false)
        .eq("is_transfer", false)
        .eq("is_non_expense_cash_movement", false)
        .in("review_status", COUNTED_STATUSES);

    const applyRange = (q: any, start?: string, end?: string) => {
      if (start) q = q.gte("date", start);
      if (end) q = q.lte("date", end);
      return q;
    };

    const dateCtx = getDateContext();

    const tools = {
      get_today: tool({
        description:
          "Returns the authoritative current date (owner's timezone) and pre-computed date ranges for this year/YTD, this month, last month, and last year. Call this whenever a question involves a relative period before querying data.",
        inputSchema: z.object({}),
        execute: async () => dateCtx,
      }),

      query_expenses: tool({
        description:
          "Total and category breakdown of the owner's expenses for an optional date range, mode, and category. Returns counted (reviewed) spend only.",
        inputSchema: z.object({
          start_date: z.string().optional().describe("Inclusive start date YYYY-MM-DD"),
          end_date: z.string().optional().describe("Inclusive end date YYYY-MM-DD"),
          mode: z.enum(["personal", "business", "reimbursable_work"]).optional(),
          category: z.string().optional().describe("Filter to a single category name"),
        }),
        execute: async ({ start_date, end_date, mode, category }) => {
          let q = applyRange(expenseBase(), start_date, end_date);
          if (mode) q = q.eq("mode", mode);
          const { data, error } = await q.limit(5000);
          if (error) return { error: error.message };
          let rows = data ?? [];
          const catOf = (r: any) => r.final_category ?? r.predicted_category ?? "Uncategorized";
          if (category) rows = rows.filter((r: any) => catOf(r)?.toLowerCase() === category.toLowerCase());
          const byCategory: Record<string, number> = {};
          let total = 0;
          for (const r of rows) {
            const amt = Math.abs(Number(r.amount) || 0);
            total += amt;
            const c = catOf(r);
            byCategory[c] = (byCategory[c] || 0) + amt;
          }
          const breakdown = Object.entries(byCategory)
            .map(([c, amount]) => ({ category: c, amount: Math.round(amount * 100) / 100 }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 25);
          return {
            total: Math.round(total * 100) / 100,
            transaction_count: rows.length,
            filters: { start_date, end_date, mode, category },
            breakdown,
          };
        },
      }),

      query_top_merchants: tool({
        description: "Top merchants/descriptions by total spend for an optional date range and mode.",
        inputSchema: z.object({
          start_date: z.string().optional(),
          end_date: z.string().optional(),
          mode: z.enum(["personal", "business", "reimbursable_work"]).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }),
        execute: async ({ start_date, end_date, mode, limit }) => {
          let q = applyRange(expenseBase(), start_date, end_date);
          if (mode) q = q.eq("mode", mode);
          const { data, error } = await q.limit(5000);
          if (error) return { error: error.message };
          const byMerchant: Record<string, { amount: number; count: number }> = {};
          for (const r of data ?? []) {
            const key = (r.description_normalized || r.description_raw || "Unknown").trim();
            const amt = Math.abs(Number(r.amount) || 0);
            if (!byMerchant[key]) byMerchant[key] = { amount: 0, count: 0 };
            byMerchant[key].amount += amt;
            byMerchant[key].count += 1;
          }
          const top = Object.entries(byMerchant)
            .map(([merchant, v]) => ({ merchant, amount: Math.round(v.amount * 100) / 100, count: v.count }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, limit ?? 10);
          return { filters: { start_date, end_date, mode }, top };
        },
      }),

      query_income: tool({
        description: "Total income for an optional date range, mode and income type. Counts reviewed income only.",
        inputSchema: z.object({
          start_date: z.string().optional(),
          end_date: z.string().optional(),
          mode: z.enum(["personal", "business"]).optional(),
          income_type: z.string().optional(),
        }),
        execute: async ({ start_date, end_date, mode, income_type }) => {
          let q = supabase
            .from("income_transactions")
            .select("date, amount, mode, income_type, taxable_status, status, description_raw")
            .eq("owner_id", ownerId)
            .neq("status", "needs_review");
          q = applyRange(q, start_date, end_date);
          if (mode) q = q.eq("mode", mode);
          if (income_type) q = q.eq("income_type", income_type);
          const { data, error } = await q.limit(5000);
          if (error) return { error: error.message };
          let total = 0;
          const byType: Record<string, number> = {};
          for (const r of data ?? []) {
            const amt = Math.abs(Number(r.amount) || 0);
            total += amt;
            byType[r.income_type || "other"] = (byType[r.income_type || "other"] || 0) + amt;
          }
          return {
            total: Math.round(total * 100) / 100,
            count: (data ?? []).length,
            by_type: byType,
            filters: { start_date, end_date, mode, income_type },
          };
        },
      }),

      query_allocations: tool({
        description: "Allocation plans (free cash, emergency fund, tax reserve, investments). Optionally filter by month (YYYY-MM).",
        inputSchema: z.object({ month: z.string().optional() }),
        execute: async ({ month }) => {
          let q = supabase
            .from("allocation_plans")
            .select("month, status, free_cash, emergency_fund_amount, tax_reserve_amount, total_income, total_expenses, notes")
            .eq("owner_id", ownerId)
            .order("month", { ascending: false });
          if (month) q = q.eq("month", month);
          const { data, error } = await q.limit(24);
          if (error) return { error: error.message };
          return { plans: data ?? [] };
        },
      }),

      query_tax: tool({
        description: "The owner's tax profile and configured reserve percentages.",
        inputSchema: z.object({}),
        execute: async () => {
          const { data, error } = await supabase
            .from("tax_profiles")
            .select(
              "filing_status, state, city, default_federal_reserve_percent, default_nys_reserve_percent, default_nyc_reserve_percent, custom_effective_tax_rate_optional, estimated_w2_withholding_ytd, estimated_tax_payments_ytd",
            )
            .eq("owner_id", ownerId)
            .maybeSingle();
          if (error) return { error: error.message };
          return { tax_profile: data };
        },
      }),

      query_reimbursements: tool({
        description: "Reimbursement groups (money fronted and awaiting / received). Optionally filter by status.",
        inputSchema: z.object({
          status: z.enum(["pending", "partial", "received"]).optional(),
        }),
        execute: async ({ status }) => {
          let q = supabase
            .from("reimbursement_groups")
            .select("title, status, total_expected, total_received, reimbursable_to, submitted_date, received_date")
            .eq("owner_id", ownerId)
            .order("created_at", { ascending: false });
          if (status) q = q.eq("status", status);
          const { data, error } = await q.limit(100);
          if (error) return { error: error.message };
          const outstanding = (data ?? []).reduce(
            (sum, g: any) => sum + Math.max(0, (Number(g.total_expected) || 0) - (Number(g.total_received) || 0)),
            0,
          );
          return { groups: data ?? [], total_outstanding: Math.round(outstanding * 100) / 100 };
        },
      }),

      query_investments: tool({
        description: "Investment / brokerage accounts with current balances and contribution targets.",
        inputSchema: z.object({}),
        execute: async () => {
          const { data, error } = await supabase
            .from("investment_accounts")
            .select("account_name, account_type, platform, mode, current_balance, contributions_ytd, contribution_target_yearly")
            .eq("owner_id", ownerId)
            .eq("is_active", true);
          if (error) return { error: error.message };
          const total = (data ?? []).reduce((s, a: any) => s + (Number(a.current_balance) || 0), 0);
          return { accounts: data ?? [], total_balance: Math.round(total * 100) / 100 };
        },
      }),
    };

    const result = streamText({
      model,
      system: PLATFORM_GUIDE,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(50),
    });

    return result.toUIMessageStreamResponse({
      headers: corsHeaders,
      originalMessages: messages,
      onFinish: async ({ responseMessage }) => {
        try {
          if (!threadId) return;
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          const textOf = (m: UIMessage) =>
            (m.parts ?? [])
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("");

          const rows: any[] = [];
          if (lastUser) {
            rows.push({
              thread_id: threadId,
              owner_id: ownerId,
              role: "user",
              content: textOf(lastUser),
              parts: lastUser.parts ?? null,
            });
          }
          if (responseMessage) {
            rows.push({
              thread_id: threadId,
              owner_id: ownerId,
              role: "assistant",
              content: textOf(responseMessage as UIMessage),
              parts: (responseMessage as UIMessage).parts ?? null,
            });
          }
          if (rows.length) {
            const { error: insErr } = await supabase.from("chat_messages").insert(rows);
            if (insErr) console.error("persist chat_messages error", insErr.message);
            await supabase
              .from("chat_threads")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", threadId);
          }
        } catch (e) {
          console.error("onFinish persist error", e);
        }
      },
    });
  } catch (e) {
    console.error("assistant-chat error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
