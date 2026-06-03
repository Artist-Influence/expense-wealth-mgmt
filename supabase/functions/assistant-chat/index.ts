import { createClient } from "npm:@supabase/supabase-js@2";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "npm:ai";
import { z } from "npm:zod";
import {
  getIncomeSummary,
  getExpenseSummary,
  getProfitAndLoss,
  getCashFlow,
  getNetWorth,
  getRunway,
  getCategoryDrilldown,
  getMerchantDrilldown,
  getRecurring,
  getAnomalies,
  getAffordability,
  getDataQuality,
  COUNTED_STATUSES,
  type Scope,
} from "./finance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  const minus = (days: number) => ymdInTz(new Date(now.getTime() - days * 86_400_000));

  const prevMonthY = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;

  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: OWNER_TIMEZONE, weekday: "long" }).format(now);
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
    trailing_30_start: minus(30),
    trailing_90_start: minus(90),
    trailing_180_start: minus(180),
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
- "trailing 30 days" = ${ctx.trailing_30_start} through ${ctx.today}.
- "trailing 90 days" = ${ctx.trailing_90_start} through ${ctx.today}.
- NEVER assume any other year. If the user does not name a year, use the current year (${ctx.current_year}).
- You may call get_today to re-confirm these computed ranges before any data query.
`;
}

const PLATFORM_GUIDE = `
You are the in-app FINANCE ANALYST for a single owner who runs a business (Artist Influence) alongside personal finances.
Act like an analyst, not a generic assistant: CALCULATE FIRST, EXPLAIN SECOND. You never do arithmetic yourself and you never invent numbers — you ONLY narrate figures returned by the deterministic finance tools.

ANSWERING PROTOCOL (follow every time a question touches money):
1. Parse INTENT: income / expense / profit / cash-flow / personal-spend / business-spend / transfer / debt / net-worth / category drilldown / merchant drilldown / affordability / anomaly / recurring / runway / tax.
2. Parse the PERIOD and pass it via the tool's "period" parameter — one of this_year/ytd, this_month, last_month, last_year, trailing_30, trailing_90, all. The SERVER converts the period to exact dates, so you must NOT compute or pass start_date/end_date for relative periods. Only pass start_date/end_date for an explicit custom range the user gives (e.g. "March 2026"). If no period is named, use "this_year" for totals questions and "this_month" for "right now" questions.
3. Parse SCOPE: business / personal / all (or a specific category/merchant). "The business" = business scope. "Personally" = personal scope.
4. CALL the matching tool with period + scope. You may call several (e.g. data_quality alongside the main one). Never answer a numeric question without a tool call.
5. Generate the answer ONLY from returned fields, and report the date range from the tool's returned "range" object — never a year you typed yourself. If a tool returns an error or empty data, say so plainly.

DEFAULT DEFINITIONS (use unless the user overrides):
- "How much did I make?" → income_summary: lead with gross_income, then also give true_operating_income (and net_operating_profit via profit_and_loss for business).
- "How much did I spend?" → expense_summary.total_expenses (TRUE expenses, excludes transfers & credit-card payments). Mention total cash outflow (cash_flow.total_cash_out) only if it differs and is relevant.
- "What's my profit?" → profit_and_loss (business income − business operating expenses). Excludes owner draws, transfers, CC payments, loan proceeds, owner contributions.
- "What's my cash flow / why did cash go down?" → cash_flow: break out operating out, credit-card payments, taxes, debt payments and owner draws separately.
- "What did I take home / take out of the business?" → cash_flow.owner_draws_estimate (flag it's an estimate).
- "How much went to credit cards?" → expense_summary.credit_card_payments (NOT counted as spend).
- "How much did I spend on <card/merchant>?" → merchant_drilldown for the actual card transactions, not the payments to the card.
- "What's my net worth?" → net_worth (ASSETS-ONLY; always disclose liabilities are not tracked).
- "Can I afford $X?" → affordability (uses cash, burn, buffer, upcoming bills) — never just the raw cash balance.
- "What subscriptions / recurring bills do I have?" → recurring. "How long will my cash last?" → runway.

GUARDRAILS — always append relevant warnings returned by the tools, e.g.:
- uncategorized > 5% of value/volume, transactions needing review, unmatched transfers, assumes CC transactions are imported, cash-basis only, taxes excluded unless reserve enabled.
If data_quality.reliable is false, lead the warning with the uncategorized figure.

RESPONSE FORMAT (markdown, concise, money as US dollars):
1. One-sentence ANSWER first, stating the exact date range and scope (e.g. "Jan 1–May 31, 2026, business").
2. A short BREAKDOWN bullet list of the key figures.
3. One INSIGHT line (biggest driver, MoM change, anomaly) when useful.
4. A WARNING line only if the data needs caveats.

PLATFORM CONTEXT: pages are Expenses (/), Income, Insights, Wealth, Allocate, Tax, Memory, Accountant, Close, Settings. Only reviewed transactions (${COUNTED_STATUSES.join(", ")}) count; split-parents, transfers and non-expense movements are excluded from spend. Reporting category = final category, falling back to predicted.
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

    // Validate request body. Never trust client-supplied shapes.
    const BodySchema = z.object({
      messages: z.array(z.any()).min(1).max(200),
      threadId: z.string().uuid().optional(),
      ownerId: z.string().uuid().optional(),
    });
    const parsedBody = BodySchema.safeParse(await req.json());
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const messages: UIMessage[] = parsedBody.data.messages as UIMessage[];
    const threadId: string | undefined = parsedBody.data.threadId;

    // Derive the effective owner SERVER-SIDE. A client may only act on its own
    // data, or on an owner that has explicitly delegated access to this user.
    let ownerId: string = userId;
    if (parsedBody.data.ownerId && parsedBody.data.ownerId !== userId) {
      const { data: deleg } = await supabase
        .from("delegated_access")
        .select("owner_id")
        .eq("grantee_user_id", userId)
        .eq("owner_id", parsedBody.data.ownerId)
        .in("role", ["accountant", "investor"])
        .maybeSingle();
      if (!deleg?.owner_id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      ownerId = deleg.owner_id as string;
    }


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
      headers: { "Lovable-API-Key": LOVABLE_API_KEY, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    const model = provider("google/gemini-3-flash-preview");

    const dateCtx = getDateContext();

    // Finance preferences (cash buffers, tax reserve, etc.)
    const { data: settings } = await supabase
      .from("app_settings")
      .select(
        "min_personal_cash_buffer, min_business_cash_buffer, tax_reserve_percent, monthly_savings_goal, monthly_personal_spend_limit, monthly_business_expense_target, report_basis, report_excluded_categories",
      )
      .eq("owner_id", ownerId)
      .maybeSingle();
    const prefs = settings ?? {};
    const reservePct = Number((prefs as any)?.tax_reserve_percent) || 30;

    const scopeSchema = z.enum(["business", "personal", "all"]).optional()
      .describe("business = Artist Influence, personal = personal money, all = both");

    const periodSchema = z
      .enum(["this_year", "ytd", "this_month", "last_month", "last_year", "trailing_30", "trailing_90", "all"])
      .optional()
      .describe("Relative period — STRONGLY PREFERRED over start_date/end_date. The server resolves it to exact dates from the authoritative current date, so you can never pick the wrong year.");

    const dateParams = {
      period: periodSchema,
      start_date: z.string().optional().describe("Inclusive start YYYY-MM-DD. Only use if no period fits."),
      end_date: z.string().optional().describe("Inclusive end YYYY-MM-DD. Only use if no period fits."),
    };

    // Resolve a relative period to concrete dates, overriding any model-supplied dates.
    const resolvePeriod = (p: any) => {
      const out: any = { ...p };
      switch (p?.period) {
        case "this_year":
        case "ytd":
          out.start_date = dateCtx.this_year_start; out.end_date = dateCtx.today; break;
        case "this_month":
          out.start_date = dateCtx.this_month_start; out.end_date = dateCtx.today; break;
        case "last_month":
          out.start_date = dateCtx.last_month_start; out.end_date = dateCtx.last_month_end; break;
        case "last_year":
          out.start_date = dateCtx.last_year_start; out.end_date = dateCtx.last_year_end; break;
        case "trailing_30":
          out.start_date = dateCtx.trailing_30_start; out.end_date = dateCtx.today; break;
        case "trailing_90":
          out.start_date = dateCtx.trailing_90_start; out.end_date = dateCtx.today; break;
        case "all":
          out.start_date = undefined; out.end_date = undefined; break;
      }
      delete out.period;
      return out;
    };

    const tools = {
      get_today: tool({
        description:
          "Authoritative current date (owner timezone) plus pre-computed ranges (YTD, this/last month, trailing 30/90/180). Call before any relative-period query.",
        inputSchema: z.object({}),
        execute: async () => dateCtx,
      }),

      income_summary: tool({
        description:
          "Income for a period/scope: gross_income, true_operating_income (excludes refunds/reimbursements/loans/contributions), plus breakdowns by source and month.",
        inputSchema: z.object({ ...dateParams, scope: scopeSchema }),
        execute: async (p) => getIncomeSummary(supabase, ownerId, resolvePeriod(p)),
      }),

      expense_summary: tool({
        description:
          "Expenses for a period/scope: total_expenses (TRUE spend, excludes transfers & CC payments), personal vs business, tax/debt/credit-card payments separated, plus breakdowns by category, vendor and month.",
        inputSchema: z.object({ ...dateParams, scope: scopeSchema }),
        execute: async (p) => getExpenseSummary(supabase, ownerId, resolvePeriod(p)),
      }),

      profit_and_loss: tool({
        description:
          "Business P&L for a period: gross_revenue, operating_expenses, net_operating_profit, margin, owner_draws_estimate, taxes, estimated_tax_reserve, net cash after draws, biggest categories and MoM change.",
        inputSchema: z.object({ ...dateParams }),
        execute: async (p) =>
          getProfitAndLoss(supabase, ownerId, { ...resolvePeriod(p), tax_reserve_percent: reservePct }),
      }),

      cash_flow: tool({
        description:
          "Cash flow for a period/scope: cash in/out, operating vs transfers/debt/owner-draws, and starting/ending cash from balance snapshots. Use for 'why did my cash change'.",
        inputSchema: z.object({ ...dateParams, scope: scopeSchema }),
        execute: async (p) => getCashFlow(supabase, ownerId, resolvePeriod(p)),
      }),

      net_worth: tool({
        description:
          "ASSETS-ONLY net worth (cash snapshots + investments). Liabilities are NOT tracked — always disclose that. Optional as_of date.",
        inputSchema: z.object({ as_of: z.string().optional() }),
        execute: async (p) => getNetWorth(supabase, ownerId, p as any),
      }),

      cash_runway: tool({
        description: "Available cash, average 3mo/6mo monthly burn, and runway in months for a scope.",
        inputSchema: z.object({ scope: scopeSchema }),
        execute: async (p) =>
          getRunway(supabase, ownerId, {
            scope: (p as any).scope as Scope,
            today: dateCtx.today,
            start_3mo: dateCtx.trailing_90_start,
            start_6mo: dateCtx.trailing_180_start,
          }),
      }),

      category_drilldown: tool({
        description: "Deep dive on one category: total, count, average size, top merchants, MoM change.",
        inputSchema: z.object({ category: z.string(), ...dateParams, scope: scopeSchema }),
        execute: async (p) => getCategoryDrilldown(supabase, ownerId, resolvePeriod(p)),
      }),

      merchant_drilldown: tool({
        description:
          "Deep dive on one merchant/card name: total spend, count, categories used and recent transactions. Use for 'how much did I spend on <merchant or card>'.",
        inputSchema: z.object({ merchant: z.string(), ...dateParams, scope: scopeSchema }),
        execute: async (p) => getMerchantDrilldown(supabase, ownerId, resolvePeriod(p)),
      }),

      recurring: tool({
        description: "Detected recurring charges / subscriptions and estimated monthly fixed overhead.",
        inputSchema: z.object({ scope: scopeSchema }),
        execute: async (p) => getRecurring(supabase, ownerId, p as any),
      }),

      anomalies: tool({
        description: "Spending anomalies this month vs last month: category spikes and unusually large transactions.",
        inputSchema: z.object({ scope: scopeSchema }),
        execute: async (p) =>
          getAnomalies(supabase, ownerId, {
            this_month_start: dateCtx.this_month_start,
            today: dateCtx.today,
            last_month_start: dateCtx.last_month_start,
            last_month_end: dateCtx.last_month_end,
            scope: (p as any).scope as Scope,
          }),
      }),

      affordability: tool({
        description:
          "Whether the owner can afford to spend a given amount, using available cash, trailing burn, cash buffer and upcoming recurring bills. Returns a yes / yes_but / no verdict.",
        inputSchema: z.object({ amount: z.number().positive(), scope: scopeSchema }),
        execute: async (p) =>
          getAffordability(supabase, ownerId, {
            amount: (p as any).amount,
            scope: (p as any).scope as Scope,
            today: dateCtx.today,
            trailing_start: dateCtx.trailing_90_start,
            prefs,
          }),
      }),

      data_quality: tool({
        description:
          "Data-reliability check for a period/scope: uncategorized count & %, needs-review count, unmatched transfers and warnings. Call alongside financial answers when totals matter.",
        inputSchema: z.object({ ...dateParams, scope: scopeSchema }),
        execute: async (p) => getDataQuality(supabase, ownerId, resolvePeriod(p)),
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
          return { tax_profile: data, configured_reserve_percent: reservePct };
        },
      }),

      query_reimbursements: tool({
        description: "Reimbursement groups (money fronted and awaiting / received). Optionally filter by status.",
        inputSchema: z.object({ status: z.enum(["pending", "partial", "received"]).optional() }),
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
            (sum: number, g: any) => sum + Math.max(0, (Number(g.total_expected) || 0) - (Number(g.total_received) || 0)),
            0,
          );
          return { groups: data ?? [], total_outstanding: Math.round(outstanding * 100) / 100 };
        },
      }),
    };

    const result = streamText({
      model,
      system: buildDateBlock(dateCtx) + PLATFORM_GUIDE,
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
