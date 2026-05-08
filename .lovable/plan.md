## Goal
Stop the successful sign-in from bouncing back to `/login`, while keeping the login page stable and preserving role-based access.

## Plan
1. **Make sign-in wait for a real stored session**
   - Update `src/pages/Login.tsx` so `handleSubmit` reads the returned `data.session` from `signInWithPassword`.
   - If a session is returned, explicitly set/confirm it before navigating to `/`.
   - Navigate only after `supabase.auth.getSession()` confirms the session exists, so `AuthGuard` does not mount during a transient unauthenticated state.

2. **Harden the auth hook against transient null sessions**
   - Update `src/hooks/useAuth.ts` so a quick `null` auth event cannot immediately mark the user unauthenticated while `getSession()` is still resolving.
   - Keep the route guard in a loading state until the initial session check is definitively complete.
   - Clear `effectiveOwnerId` when there is no user, preventing stale owner state between login attempts.

3. **Make role lookup fail safely and visibly**
   - Update `src/hooks/useUserRole.ts` to treat role lookup errors separately from “no role found.”
   - Avoid immediately redirecting a just-signed-in user because of a brief role-query race.
   - Keep existing security behavior: users without a valid role still cannot access protected pages.

4. **Validate the auth path**
   - Verify the login page still renders immediately.
   - Verify signing in routes to the portal instead of returning to `/login`.
   - Check console/network signals for auth or role lookup failures.

## Technical notes
- No database changes are needed for this fix.
- This stays within the existing Lovable Cloud auth setup and does not alter user roles or permissions.