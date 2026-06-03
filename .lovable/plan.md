# Guide new owners to set up before uploading

New owners should configure their **payment methods** and seed at least one **reference (historical) statement** in Settings before uploading real statements. Per your choices: a **soft warning** (upload stays allowed), the two required steps are **methods + reference statements**, and the guidance lives as a **checklist banner at the top of Settings**.

## What "ready" means

Setup is considered complete for an owner when both are true:
- At least one **payment method** exists (`payment_methods` for the owner).
- At least one **reference statement** has been seeded — detected by the presence of `merchant_memory` rows for the owner (the historical-seed flow in Settings writes these).

No new database columns are needed; readiness is derived live from existing tables.

## 1. Shared readiness hook

New hook `src/hooks/useSetupStatus.ts`:
- Queries counts of `payment_methods` and `merchant_memory` for the current `ownerId` (head/count requests, cheap).
- Returns `{ hasMethods, hasReferenceData, isReady, loading, reload }`.
- Owner-only concern; investors/accountants never see the gate.

## 2. Settings "Get started" checklist banner

At the top of `src/pages/Settings.tsx` (above existing sections, owner only — hidden for accountants):
- A glass-panel banner titled "Finish setup to get accurate results".
- Two checklist rows, each showing a check (done) or empty circle (todo):
  1. **Add your payment methods** — short text; "Add methods" button scrolls to the existing Payment Methods section.
  2. **Seed a reference statement** — short text explaining this teaches the categorizer; "Seed history" button scrolls to the existing historical-seed section.
- When both are complete, the banner collapses into a subtle "You're all set — uploads are ready" confirmation (or hides).
- Uses `useSetupStatus`; refreshes after a method is added or a seed completes (call `reload`).
- Anchors: add `id`/`ref` to the existing Payment Methods and Historical Seed sections so the buttons can scroll to them.

## 3. Soft warning before uploading (Expenses)

In `src/pages/Expenses.tsx`, inside the existing Upload sheet (and only for owners when setup is incomplete):
- Show a warning callout at the top of the upload sheet body: "Set up first for best results — you haven't added payment methods / seeded a reference statement yet. Uploading now may misclassify transactions." with a "Go to Settings" link (routes to `/settings`).
- The Upload CSV button and flow remain fully enabled (soft warning only).
- Only the missing item(s) are mentioned; the warning disappears once `isReady`.

## Out of scope

- No hard blocking/disabling of upload.
- No schema changes, no changes to categorization, seeding, or method-detection logic.
- Investor/accountant experiences unchanged.

## Technical notes

- Reuse existing semantic tokens (`glass-panel`, `warning`, `primary`, `muted-foreground`); no new colors.
- Section scrolling via `ref.scrollIntoView({ behavior: 'smooth' })`.
- Readiness checks use `select('id', { count: 'exact', head: true })` filtered by `owner_id`.
