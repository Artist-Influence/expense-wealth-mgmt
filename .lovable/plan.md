## Problem

A stale Supabase session triggers repeated `_refreshAccessToken` calls that fail with "Failed to fetch". Each failure fires `onAuthStateChange`, toggling the auth state and causing the Login page to flicker — the form never stays visible long enough to type.

## Fix

### 1. Login.tsx — Stop reacting to passive auth state on the login page

Remove the auto-redirect logic (`if (!authLoading && user && isAuthorized) return <Navigate ...>`) from the render path entirely. Instead, only redirect after an **explicit** sign-in action succeeds (already handled by `navigate('/')` in `handleSubmit`).

This means:
- The login form **always** renders, no matter what `onAuthStateChange` is doing in the background.
- If the user already has a valid session and navigates to `/login`, `AuthGuard` on `/` will handle them — or we can add a one-time check on mount that doesn't cause re-renders.

### 2. useAuth.ts — Clear stale sessions gracefully

Add error handling in the `getSession` call: if the session exists but has an expired/invalid refresh token, sign out to clear the stale session instead of letting Supabase loop on refresh attempts.

These two changes stop the flicker loop and make the login form always usable.