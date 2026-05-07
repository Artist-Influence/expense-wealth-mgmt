## Accountant Login

Create a new `accountant` role that sees everything the owner sees — all pages, all data (personal + business).

### Steps

1. **Database migration** — Add `'accountant'` to the `app_role` enum. Update all RLS policies on every table to also grant **read access** to users with the `accountant` role (they can view but not modify data).

2. **Create the user account** — Sign up `zoeb@pivotalwealthandtax.com` with password `5075138942`, then insert a row into `user_roles` with role `accountant`.

3. **Update `useUserRole.ts`** — Add `'accountant'` to the `AppRole` type.

4. **Update `useAuth.ts`** — Add `isAccountant` flag (`role === 'accountant'`). Accountants are authorized (`isAuthorized = true`).

5. **Update `AuthGuard.tsx`** — Allow accountants to access all routes (same as owner).

6. **Update `AppNav.tsx`** — Show all nav items for accountants (same as owner). Optionally show an "Accountant View" label.

7. **Update `Expenses.tsx` and other pages** — Accountants see the same data as the owner. They query using `owner_id` of the actual owner (since the data belongs to you, not them). This means RLS policies need to allow accountants to read rows where they have the accountant role. Alternatively, we can use a simpler approach: accountants read data via a database function that returns the owner's `user_id`, and RLS policies grant read access to accountants on all owner data.

### Data Access Approach

Since all data is owned by your user ID, the accountant needs to read *your* data, not theirs. Two options:

**Option A (simpler):** RLS policies grant SELECT to any user with role `accountant` on all tables (no owner_id filter for reads). This means any accountant can see all data.

**Option B (scoped):** Create an `accountant_access` table mapping accountant user_id → owner user_id, and RLS checks that mapping. More secure if you ever have multiple owners.

Given this is a single-user system, **Option A** is recommended.

### Security Note
The accountant will have **read-only** access. They cannot create, update, or delete transactions or settings. Write operations remain restricted to the owner.
