# Setup Wizard for New Owners

Add a multi-step welcome modal that introduces the owner to the tool's workflow the first time they sign in, with the ability to replay it later from Settings.

## Behavior

- Shows automatically the first time the **owner** logs in (investors and accountants never see it).
- Dismissable; completion is remembered so it won't reappear.
- Can be reopened anytime from a "Replay walkthrough" button in Settings.

## Wizard content (steps)

A clean glass-panel dialog matching the dark glassmorphism theme, with a progress dots indicator and Back / Next / Finish buttons. Steps:

1. **Welcome** — What this tool is: a single-account cash control system that turns bank/card CSVs into categorized expenses, tracked income, and wealth allocation.
2. **Upload statements** — Drag CSVs into the Expenses page; the app auto-detects the payment method, prevents duplicates, and runs categorization.
3. **Review & categorize** — Only reviewed transactions count toward totals. Explains the red badge in the nav, approving/editing categories, splitting mixed-use charges, and marking transfers.
4. **Income & reimbursements** — Upload income CSVs; separate true earnings from reimbursements/fronted money.
5. **Wealth, allocations & tax** — Set wealth targets, allocate investable surplus, and view tax reserve estimates.
6. **Assistant & monthly close** — Ask the AI assistant financial questions, and use the guided Close Month workflow to finalize each period.
7. **Finish** — Encourages setting preferences in Settings (cash buffers, tax %, goals) and starts the user on the Expenses page.

Each step has a short title, 2-4 sentences of plain-English guidance, and a relevant lucide icon (reusing the icons already used in the nav).

## Persistence

Add an `onboarding_completed` boolean column (default `false`) to `app_settings`. The wizard reads it on load; clicking Finish or Skip sets it to `true`. The "Replay walkthrough" button in Settings simply reopens the modal without changing the flag (or optionally resets it).

## Technical details

- **Migration**: `ALTER TABLE public.app_settings ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;` (existing RLS/grants already cover this table). The Supabase types file regenerates automatically after the migration.
- **New component** `src/components/OnboardingWizard.tsx` — a controlled `Dialog` (shadcn) holding step state, the step content array, progress dots, and navigation buttons. Props: `open`, `onClose`. On finish/skip it updates `app_settings.onboarding_completed = true` for the current `ownerId`.
- **Trigger logic**: In `Expenses.tsx` (the `/` landing page), for `isOwner` only, query `app_settings.onboarding_completed` for `ownerId` after auth resolves; if `false`/missing, open the wizard. Gate on role so investors/accountants are excluded.
- **Replay entry point**: Add a "Walkthrough" / "Replay setup guide" button in `Settings.tsx` that opens the same `OnboardingWizard` with local open state.
- Styling uses existing semantic tokens (`glass-panel`, `primary`, `muted-foreground`) — no new colors. No backend/business-logic changes beyond the single boolean flag.

## Out of scope

- No interactive element-pointing tour (modal only).
- No changes to categorization, income, tax, or allocation logic.
