# Show all Subscriptions-tagged expenses on the Subscriptions page

## Problem

The Subscriptions page only lists merchants the detector sees **3 or more times**. Anything you manually tagged with the `Subscriptions` category but that appears only once or twice never shows up.

Confirmed against your live data: 43 transactions are tagged `Subscriptions` (40 business + 3 personal), but only 4 merchants clear the 3-charge threshold. Real subscriptions like Lovable, OpenAI, Slack, Airtable, Twilio, Squarespace, Verizon, CapCut (business) are silently dropped.

## Fix

Make the page include **any expense explicitly categorized as `Subscriptions`** in addition to the auto-detected recurring charges, for both personal and business.

### 1. `src/lib/recurring-charges.ts` (shared detector)

- Add an options argument: `computeRecurringCharges(expenses, { includeCategories?: string[]; minCount?: number })`. Defaults preserve today's behavior (`minCount = 3`, `includeCategories = []`), so the Insights "Recurring Charges" section is unchanged.
- A merchant qualifies if it has `>= minCount` charges **OR** its category is in `includeCategories` (e.g. `Subscriptions`).
- Guard the cadence math for low-count groups (currently `daySpan / (count - 1)` divides by zero for a single charge and produces `NaN`):
  - `count < 2` → `frequency = 'monthly'` (sensible default for a manually-tagged subscription), `monthlyEstimate = avg`.
  - `count >= 2` → unchanged logic.

### 2. `src/pages/Subscriptions.tsx`

- Call the detector with `{ includeCategories: ['Subscriptions'] }` so every tagged merchant appears, even with one charge.
- Treat a candidate whose `category === 'Subscriptions'` as **confirmed by default** (it already lives in "Your subscriptions" without needing a click), unless the user has explicitly dismissed it via an override. Auto-detected recurring charges that are *not* tagged still appear under "Detected recurring charges" for confirm/dismiss as today. Override rows (confirm/dismiss/undo) continue to win over the default.
- The Personal / Business / All scope toggle already drives this, so it works across both modes automatically.

## Notes / out of scope

- Some merchants split into separate rows because grouping uses the first 40 characters of the description (e.g. `GOOGLE *CLOUD 6PMVXQ` vs `GOOGLE *CLOUD 7DJMVW`). They'll all now be visible but may show as distinct line items. Tighter merchant normalization is a separate, larger change — not included here.
- The console "order of Hooks" warning on the Insights page is a hot-reload artifact from the recent edits and clears on a full refresh; I'll verify it's gone after the change. No structural hook bug was found.

## Verification

- Load `/subscriptions` in Personal, Business, and All scopes and confirm all 24 distinct tagged merchants now appear.
- Confirm the Insights "Recurring Charges" section still lists only the 3+ charge merchants (unchanged).
- Confirm/dismiss/undo still persist correctly.
