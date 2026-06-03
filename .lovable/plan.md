## Goal

Let your friends create their own accounts using a shared invite code (`JARED123`), give a display name, and start using the platform immediately — without opening the door to the public.

## Security approach (why this design)

Platform-level signups stay **disabled**. If we simply turned Supabase signups on, anyone could register by calling the API directly and skip the invite code. Instead, a server-side function holds the only key to account creation: it checks the invite code first, then creates the account. The code is validated on the server, never trusted from the browser.

## What gets built

### 1. Invite codes table
A new `invite_codes` table holding the code, an active flag, and an optional label. Seeded with one row: `JARED123` (active, reusable by everyone, no usage cap — per your choice). The table is locked down (no public/browser access); only the signup function can read it.

You can later deactivate a code or add new ones without a code change.

### 2. Display name on profiles
Add a `display_name` column to the existing `profiles` table, and update the existing new-user routine so it saves the display name entered at signup. Existing accounts are unaffected.

### 3. Signup function (server-side)
A new backend function `signup-with-invite` that:
- Validates email, password (min length), display name, and invite code (input validation).
- Confirms the invite code exists and is active — case-insensitive, so `jared123` also works.
- Creates the account with the display name attached and email auto-confirmed (instant access, per your choice).
- Returns a clear error if the code is wrong/inactive or the email is already registered.
- Never reveals whether an email already exists in a way that leaks data beyond a generic "already registered" message.

### 4. Login page: add a Sign Up view
Update `src/pages/Login.tsx` to add a "Create account" toggle alongside the existing sign-in form. The signup form collects: display name, email, password, invite code. On success it signs the new user in and drops them into the app (the existing onboarding wizard then runs on first login).

The existing sign-in flow, MFA challenge, and "Private access only" framing stay intact.

## What stays the same
- Public Supabase signups remain disabled (the function is the only path in).
- All existing RLS, multi-tenant isolation, MFA, and per-user data ownership are untouched — each new friend automatically owns only their own data.
- No changes to financial logic or other pages.

## Technical notes
- `signup-with-invite` runs unauthenticated (`verify_jwt = false`) and uses the service-role key to create the user via the admin API; this is what lets account creation bypass the disabled-signup setting while the invite gate is enforced in code.
- Tradeoff: the admin create path does not run the leaked-password (HIBP) check that normal signups would; the function enforces a minimum password length to compensate. Normal password changes/sign-ins still benefit from existing protections.
- Invite code is stored uppercase and compared case-insensitively.
- After build: deploy the function, then test a signup with `JARED123` (success) and a bad code (rejected).

## Manual step for you
To invite friends, just share the code `JARED123` and the app link. To stop new signups later, deactivate the code (I can wire a quick toggle in Settings if you want, or it can be flipped directly in the backend).
