
# Create Investor Account

## Steps

1. **Create the auth user** via the backend with email `tribe@artistinfluence.com` and password `arty`, with auto-confirm enabled so no email verification is needed.

2. **Assign the `investor` role** by inserting a row into `user_roles` with the new user's ID and role `investor`.

That's it — the existing investor portal code will handle the rest (restricted nav, business-only data, read-only UI).
