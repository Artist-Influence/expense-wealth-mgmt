## Fix

1. **Delete the duplicate "Wealthfront" account** (empty, auto-seeded).
2. **Add `wealthfront` as the auto_track_pattern on "S&P 500"** so it picks up Wealthfront contributions automatically.
3. **Update the default seed entry** — change Wealthfront's default name from "Wealthfront" to "S&P 500" so it won't try to re-seed in the future (the pattern overlap check will also prevent it now that S&P 500 has the pattern).
