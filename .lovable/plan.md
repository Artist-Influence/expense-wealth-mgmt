## Problem

The auto-seed logic matches by account name, but your existing accounts have different names than the defaults (e.g. "Collectr" instead of "Pokémon", "Dub (Custom ETFs)" instead of "Dub"). This created duplicate empty accounts.

## Fix

1. **Delete the two duplicate accounts** ("Dub" and "Pokémon" with $0 balances) from the database.

2. **Fix auto-seed matching** in `DEFAULT_AUTO_ACCOUNTS` — also check by `auto_track_pattern` overlap, not just name. If any existing account already has a matching pattern, skip seeding. This prevents future duplicates regardless of account naming.
