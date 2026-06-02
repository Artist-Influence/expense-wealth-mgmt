## Problem

The Income page fails to load with the error `invalid input syntax for type uuid: "null"`. The same error shows up for several other backend calls (app_settings, category_options, transactions_uploaded, income_transactions).

### Root cause

`useAuth()` exposes `ownerId`, which is resolved **asynchronously** and is `null` for a brief moment after login. In `src/pages/Income.tsx`, the data fetch:

- only guards `if (!user) return;` — so it runs while `ownerId` is still `null`, sending `owner_id=eq.null` to the database (invalid UUID), and
- has a dependency array of `[user]` only — so it never re-runs once `ownerId` finishes resolving.

Result: the query fires too early with `null` and never recovers, so income never loads.

## Fix

1. **`src/pages/Income.tsx`**
   - Change the guard in `fetchTransactions` to also wait for `ownerId`: `if (!user || !ownerId) return;`
   - Add `ownerId` to the `useCallback` dependency array so the fetch re-runs as soon as `ownerId` resolves.

2. **Audit the same pattern app-wide** to ensure this doesn't happen again. Search for queries that use `ownerId` / `effectiveOwnerId` but omit it from their guard or dependency array (the network log shows the same `owner_id=eq.null` error coming from app_settings, category_options, and transactions_uploaded as well). For each affected fetch/`useQuery`:
   - Guard so the query is disabled until `ownerId` is truthy (`enabled: !!ownerId` for react-query, or an early `return` for manual fetches).
   - Include `ownerId` in the dependency array / query key so it refetches once resolved.

## Validation

- Reload the app while logged in as owner → Income page loads transactions with no `uuid: "null"` errors in the console/network.
- Confirm the other previously-failing calls (categories, expenses, app_settings) no longer return 400s.
