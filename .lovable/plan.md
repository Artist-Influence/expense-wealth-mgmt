# Fix: Assistant uses wrong year ("2024 YTD" instead of 2026)

## Root cause
The `assistant-chat` edge function's system prompt (`PLATFORM_GUIDE`) never tells the model **what today's date is**. Large language models have no clock — when a user says "this year" or "YTD", the model guesses a year from its training data (it picked **2024**), even though the underlying data is from **2026**.

I verified the data: business transactions are almost entirely dated **2026** (1,152 rows) with a handful in 2025. So the figures shown are likely real, but the model mislabeled the period as "2024 (YTD)" purely because it didn't know the current date.

## The fix
Make date handling deterministic and impossible to get wrong by giving the model the real date and forcing it to use computed ranges instead of guessing.

### 1. Inject the live current date into the system prompt
In `supabase/functions/assistant-chat/index.ts`, compute the server date at request time (in the owner's timezone, America/New_York to match the NYS/NYC tax context) and prepend a hard, explicit block to the system prompt, e.g.:

```text
CURRENT DATE CONTEXT (authoritative — never override from memory):
- Today is {YYYY-MM-DD} ({weekday}, {Month D, YYYY}).
- Current year = {YYYY}. Current month = {YYYY-MM}.
- "this year" / "YTD" = {YYYY}-01-01 through today.
- "last year" = {YYYY-1}. "last month" = previous calendar month.
- "this month" = {YYYY-MM-01} through today.
NEVER assume any other year. If a user does not name a year, use the current year above.
```

### 2. Add an explicit `get_today` tool
Add a tiny tool that returns the current date and pre-computed common ranges (this_year_start, today, this_month_start, last_month_start/end, last_year_start/end). This gives the model a reliable source to call and removes any ambiguity about how to compute ranges before calling `query_expenses` / `query_top_merchants` / `query_income`.

### 3. Harden the period-labeling rule
Add a STYLE rule: when reporting a number, the model must state the exact date range it used (from the computed values), e.g. "Jan 1, 2026 – Jun 2, 2026 (YTD)", and must never state a year it did not compute from the current-date context.

### 4. Deploy & verify
- Redeploy `assistant-chat`.
- Test via a direct call asking "What are my top business expenses this year?" and confirm the response references **2026** with the correct YTD range, and that the totals match the 2026 data.

## Technical notes
- Date computation uses `Intl.DateTimeFormat` with `timeZone: "America/New_York"` so "today" and YTD boundaries are correct regardless of the server's UTC clock.
- No database schema changes, no client changes required — this is contained to the edge function. (Optional: the same current-date block could later be surfaced to other AI functions, but that's out of scope here.)
