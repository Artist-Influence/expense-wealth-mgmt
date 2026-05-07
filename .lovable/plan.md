## Problem

The login page keeps flickering between the loading spinner and login form, making it impossible to type. This is caused by a race condition in `useAuth` where both `onAuthStateChange` and `getSession` independently set loading state, and `useUserRole` resets `roleLoading` to `true` on every user change — causing the combined `loading` flag to oscillate.

## Fix

### 1. Stabilize `useAuth` loading state (`src/hooks/useAuth.ts`)

- Use a single `initialLoading` ref that only transitions from `true` → `false` once, never back
- Remove the duplicate `setLoading(false)` from both `onAuthStateChange` and `getSession` — instead use a pattern where `getSession` resolves first, and `onAuthStateChange` only handles subsequent changes
- Set up `onAuthStateChange` listener BEFORE calling `getSession` (already done), but only mark initial load complete after `getSession` resolves

### 2. Prevent `useUserRole` from resetting loading (`src/hooks/useUserRole.ts`)

- Don't reset `roleLoading` back to `true` on subsequent calls when user hasn't changed — only set it `true` on initial mount or actual user ID change
- Use a ref to track the previous user ID to avoid unnecessary loading resets

### 3. Add loading guard to Login page (`src/pages/Login.tsx`)

- Show a minimal loading state while `useAuth` is still resolving, preventing the form from briefly appearing and disappearing

These three changes together will ensure the login form renders once and stays stable.
