
# Investor Portal: Read-Only Business View

## Overview
Add a separate investor login that gives read-only access to **business expenses, income, and insights only**. Personal data is completely filtered out (not shown at all). No uploads, edits, settings, or other pages visible.

## Database Changes

### 1. Create `user_roles` table
- Columns: `id`, `user_id` (references auth.users), `role` (enum: `owner`, `investor`)
- RLS: users can read their own role; owner can manage all roles
- Seed Jared's account as `owner`

### 2. Security-definer helper function
- `has_role(user_id, role)` — used in RLS and app logic without recursion

## Auth Changes

### 3. Update `useAuth` hook
- Remove the hardcoded `ALLOWED_EMAIL` check — instead, after login, look up the user's role from `user_roles`
- Expose `role: 'owner' | 'investor' | null` alongside `user` and `isAuthorized`
- Investors are authorized but restricted

### 4. Update Login page
- Allow any email with a valid account to log in (not just Jared's)
- After login, role determines what they see
- You'll create investor accounts manually via the backend

### 5. Disable public signup
- Use `configure_auth` to ensure `disable_signup: true` — only you can create investor accounts from the backend

## Frontend: Role-Based Access

### 6. Create `InvestorGuard` component
- Wraps investor-accessible routes
- If user is `investor`, renders children; if `owner`, also renders; if neither, redirects to login

### 7. Update `AuthGuard`
- Owner sees everything as before
- Investor gets redirected to `/expenses` if they try to access restricted pages (Wealth, Tax, Allocations, Merchants, Settings, Accountant, Close Month)

### 8. Update `AppNav`
- If role is `investor`: only show Expenses, Income, Insights nav items
- Hide Health Check button, Sign Out stays
- Hide CSV upload triggers

### 9. Update Expenses page for investors
- **Filter**: Only fetch `mode = 'business'` transactions — personal rows never loaded
- **Read-only**: Hide all edit buttons, upload section, bulk actions, review controls, split button
- **Export**: Keep CSV download button (read-only with export)

### 10. Update Income page for investors
- **Filter**: Only fetch `mode = 'business'` income
- **Read-only**: Hide upload, edit, delete, status change controls
- **Export**: Keep download

### 11. Update Insights page for investors
- **Filter**: Only load business-mode data
- **Read-only**: Remove any edit/action controls
- Charts and summaries render normally but with business data only

## Summary
- ~1 migration (roles table + enum + helper function)
- ~6 files modified (useAuth, Login, AuthGuard, AppNav, Expenses, Income, Insights)
- ~1 new file (InvestorGuard or role context)
- Personal data never reaches the investor's browser — filtered at the query level
