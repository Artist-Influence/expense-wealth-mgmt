## Problem

The Login page shows a spinner while `useAuth` resolves, but auth state changes (from `onAuthStateChange` firing before/after `getSession`) cause `loading` to oscillate, resulting in an infinite flicker between spinner and form — making the page unusable.

## Root Cause

The Login page gates its **entire render** on `authLoading`. Every time `useAuth`'s loading state briefly toggles (due to the auth state change listener and role-fetching lifecycle), the Login component swaps between spinner and form. The Login page **should not** need a loading gate at all — it should always show the form and only conditionally redirect when auth is confirmed.

## Fix (2 changes)

### 1. Login page: Remove loading gate, only gate the redirect (`src/pages/Login.tsx`)

- Remove the `if (authLoading) return <spinner>` block entirely
- Change the redirect check to: `if (!authLoading && user && isAuthorized)` — only redirect when we're **sure** the user is authenticated
- The form always renders, so no flicker

### 2. Harden `useAuth` against re-init (`src/hooks/useAuth.ts`)

- Remove the `initialised` ref guard (it can silently break on HMR or edge-case remounts)
- Instead, use standard cleanup: unsubscribe in the effect cleanup, and let `getSession` run on every mount
- This ensures auth always resolves even after hot reloads
