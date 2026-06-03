# Subscription Tracking

## Goal
Turn the current throwaway "Recurring Charges" list into something you control: a dedicated **Subscriptions** page where each auto-detected recurring charge can be marked as a real subscription or removed (hidden) if it isn't one. Your decisions are remembered, and anything you remove disappears from the Recurring Charges section on Insights. Detection still drives the candidates — there's no manual entry of made-up subscriptions.

## How it works today
The Recurring Charges table on Insights is computed live from approved expenses (grouped by merchant, needs ≥3 charges with a regular cadence). Nothing is saved, so there's no way to confirm a real subscription or remove a false positive — it recomputes every visit.

## What changes

### 1. Remember your decisions (backend)
A new private table stores one row per merchant you've acted on, scoped to you and the current mode (personal/business):
- The merchant key (the same merchant grouping the detector already uses)
- A status: `confirmed` (a real subscription) or `dismissed` (not recurring — hide it)

Only you can read/write your own rows (with read access for a delegated accountant, matching every other table). No manual "add a subscription from scratch" — rows only ever reference a real detected merchant.

### 2. Shared recurring-charge detection
The detection logic currently living inside Insights moves into a small reusable helper so both Insights and the new page produce the exact same candidate list (merchant, avg amount, frequency, category, last charged, monthly estimate).

### 3. New Subscriptions page (`/subscriptions`)
A nav link is added. The page uses the same Personal/Business/All scope toggle as the rest of the app and shows:
- **Confirmed subscriptions** — candidates you marked as real, with a total monthly load, plus a "stale" hint if one hasn't charged recently. Each has a **Remove** action.
- **Detected candidates** — recurring charges you haven't decided on yet, each with **Confirm** (it's a real subscription) and **Dismiss** (not recurring — hide it).
- **Removed** — a small collapsed list of dismissed merchants with an **Undo** so a mistaken removal can be brought back.

### 4. Insights respects your decisions
The Recurring Charges section on Insights filters out anything you've **dismissed**, and visually flags rows you've **confirmed**. The subscription-related "Where to Save" suggestions use the same filtered list, so dismissed items no longer inflate your subscription load.

## Technical notes

**Migration** (new `recurring_overrides` table):
```text
recurring_overrides
  id           uuid pk
  owner_id     uuid   (= auth.uid())
  mode         text   ('personal' | 'business')
  merchant_key text   (truncated normalized description, matching the detector)
  status       text   ('confirmed' | 'dismissed')
  created_at / updated_at timestamps
  unique (owner_id, mode, merchant_key)
```
- GRANTs: `authenticated` (select/insert/update/delete), `service_role` (all); no `anon`.
- RLS: `owner_all` (`auth.uid() = owner_id`) + `delegated_accountant_read` via `has_delegated_access(...)`, mirroring existing tables.
- `updated_at` trigger using existing `update_updated_at_column()`.

**Frontend:**
- Extract the `recurringCharges` `useMemo` body from `src/pages/Insights.tsx` into `src/lib/recurring-charges.ts` (`computeRecurringCharges(approvedExpenses)` returning the same shape plus the `merchant_key`). The detector key stays the current `desc.substring(0, 40)` so existing behavior is unchanged.
- New `src/hooks/useRecurringOverrides.ts` — loads/saves rows for `ownerId` + `mode`, exposes `confirm`, `dismiss`, `undo`, and lookups.
- New `src/pages/Subscriptions.tsx` reusing `ModeScopeToggle`, the same data-load pattern as Insights (transactions for `ownerId`/`mode`, `.is('deleted_at', null)`, counted statuses only), glass-panel styling.
- Register `/subscriptions` in `src/App.tsx` behind `AuthGuard`; add the nav entry in `src/components/AppNav.tsx`.
- Update the Insights Recurring Charges render + subscription suggestions to drop dismissed merchants and tag confirmed ones.

**Out of scope:** no changes to categorization, the `Subscriptions` category tag, or transaction records — removing a false positive only hides it; underlying data is untouched (as chosen).
