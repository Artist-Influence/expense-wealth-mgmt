## AI Assistant — "Ask anything about your finances & the platform"

A dedicated **Assistant** page with threaded, account-saved conversations. The assistant can both explain how the platform works and answer questions about live financial data (expenses, income, allocations, tax, reimbursements), respecting the same financial-integrity rules used elsewhere (only reviewed `final_category` counts; split parents and transfers excluded).

### 1. Database (migration)
Two new owner-scoped tables, RLS mirroring existing tables:

- **`chat_threads`** — `id`, `owner_id`, `title`, `created_at`, `updated_at`.
- **`chat_messages`** — `id` (db-generated uuid), `thread_id`, `owner_id`, `role` (`user`/`assistant`), `content` (text), `parts` (jsonb, for tool calls/results), `created_at`.

Policies: owner full access (`auth.uid() = owner_id`), accountant read (`has_role`). GRANTs for `authenticated` + `service_role`. `updated_at` trigger on threads.

### 2. Edge function `assistant-chat` (streaming)
- Validates the caller's JWT, derives `owner_id`, creates a Supabase client bound to the user so RLS applies.
- Uses Lovable AI (`LOVABLE_API_KEY`, default `google/gemini-3-flash-preview`) and streams the response.
- **System prompt** embeds a concise "how the platform works" guide (pages, categorization engine, modes/treatments, allocations, tax reserves, reimbursements, monthly close) plus the financial-integrity rules so explanations are accurate.
- **Read-only tools** the model can call to answer data questions:
  - `query_expenses` — date range, mode, category filters → totals & breakdowns (only reviewed rows, excludes split parents / transfers / non-expense movements).
  - `query_income` — date range, mode, type → totals (reviewed only).
  - `query_allocations` — latest/by-month allocation plans & line items.
  - `query_tax` — tax profile + reserve estimates.
  - `query_reimbursements` — outstanding / received groups.
  - `query_top_merchants` — top spend by merchant/category for a period.
  All tools run parameterized SELECTs scoped to `owner_id`; no write tools.
- Persists the user message and the completed assistant message (with `parts`) to `chat_messages` in the active thread.

### 3. Frontend — `/assistant` page
- Add **Assistant** nav item in `AppNav.tsx` (hidden for investor role; available to owner + accountant).
- Install AI Elements primitives (`conversation`, `message`, `prompt-input`, `tool`, `shimmer`) and build the chat from them.
- Layout: left **thread sidebar** (list, "New chat", rename/delete) + main conversation pane, in the existing glass-panel dark style.
- Routing: real route `/assistant/:threadId` (and `/assistant` → create/select a thread, then navigate). Active thread id comes from the URL; chat window is keyed by `threadId`.
- `useChat` (AI SDK) with `DefaultChatTransport` pointed at the edge function, `id = threadId`, optimistic user message + "Thinking…" shimmer while loading, messages rendered via `message.parts`.
- Tool calls render in collapsed (`defaultOpen={false}`) accordions with a domain icon; assistant text has no colored bubble, user messages use `primary`/`primary-foreground`.
- Threads & messages load from the DB on mount; reloading a thread URL restores its history.

### 4. Verification
- Create two threads, send a data question and a how-to question in each, reload — both restore correctly.
- Confirm data answers match the app's own totals (integrity rules respected) and that tool accordions stay collapsed by default.

### Technical notes
- Single-user/owner model: assistant answers about the owner's data; accountant role gets read access via existing policies.
- No financial-logic changes — tools reuse the same exclusion rules already enforced in the app.
- Message ids are db-generated; AI SDK `msg_...` ids are not written into uuid columns.