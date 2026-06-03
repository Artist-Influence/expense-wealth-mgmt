# Personal / Business / Both usage profile

## Goal
Let the owner declare how they use the app — **Personal only**, **Business only**, or **Both** — during first-run onboarding. The choice then declutters the whole app: mode toggles, the Accountant nav item, and in-page dashboards only show what's relevant. "Both" keeps everything exactly as it is today.

There is no public signup in this app (single-owner login), so the choice is captured in the existing onboarding wizard on first login and can be changed later in Settings.

## Where the choice is stored
Add one field, `usage_profile` (text, default `'both'`, values `personal` | `business` | `both`), to the existing `app_settings` row. A small validation trigger rejects any other value.

## What changes

### 1. Capture the choice
- **Onboarding wizard** (`OnboardingWizard.tsx`): add a new early step with three large cards — Personal, Business, Both — with a short description of each. The selection is required to advance. On completion, save `usage_profile` alongside the existing `onboarding_completed` flag.
- **Settings**: add a "Usage profile" selector so the owner can switch later. Switching takes effect immediately across the app.

### 2. Read the choice everywhere
- New hook `useUsageProfile()` returns `{ profile, loading }` for the current owner. Pages use it to decide which scopes to show and what to default to.
- Rule used everywhere: if `profile === 'both'` → current behavior unchanged. If `personal` or `business` → force that mode and hide the scope selector. Existing investor/accountant role logic still wins (investor stays business-locked).

### 3. Adapt the UI by profile
- **Nav** (`AppNav.tsx`): hide the **Accountant** item when `profile === 'personal'` (the only page you marked business-specific). All other pages stay visible in every profile.
- **Expenses**: the Personal / Business / Reimbursable tabs and the "Personal vs Business" comparison strip collapse to the chosen side. Personal-only hides the Business tab and comparison; Business-only hides the Personal tab.
- **Insights**: the Personal/Business switch is locked to the profile and hidden when not "both".
- **Income**: the All/Personal/Business filter locks to the profile and hides the other options when not "both".
- **Wealth & Reimbursements**: the shared `ModeScopeToggle` is hidden and its scope forced to the profile when not "both" (default stays "all" for "both").

### 4. Default behavior
- Existing data and the existing single owner default to `both`, so nothing changes for the current user until they pick a different profile.

## Technical notes
- DB: migration adds `usage_profile` to `app_settings` with a default and a validation trigger (no CHECK constraint per project convention).
- `useUsageProfile()` queries `app_settings.usage_profile` by `ownerId` from `useAuth`.
- `ModeScopeToggle` gains an optional `hidden`/`lockedTo` handling so callers can force-and-hide it cleanly; pages compute the effective scope as `profile === 'both' ? persistedScope : profile`.
- Investor/accountant role filtering is left intact and takes precedence over the usage profile.
- No changes to financial calculations — only which views/toggles are shown.
