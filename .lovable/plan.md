## Update the per-investment "Add update" popover

Target: `SnapshotEditor` in `src/pages/Wealth.tsx` (lines ~116–202), the popover opened by the calendar icon on each investment card.

### Changes

1. **Date picker** — Replace the `<Input type="month">` with a shadcn `Popover` + `Calendar` (`mode="single"`) so the user can pick any specific date, not just a month. Display the chosen date as `MMM d, yyyy` on the trigger button. Store the picked date as `YYYY-MM-DD` and pass it through to `onSave` (instead of forcing `-01`). The existing `account_balance_snapshots` table already keys on `(account_id, as_of_date)` as a date, so arbitrary days work without a migration. History rows will switch their label to `MMM d, yyyy` to match.

2. **Wider amount field** — Restructure the "Add / overwrite" row so the dollar input gets enough width to show full amounts (e.g., `$1,250,000`). Stack the row: date picker on top, then a full-width amount input with a `$` prefix and `tabular-nums`, and a Save button beside it. Widen the popover from `w-72` to `w-80` (or `w-96`) so values aren't clipped.

3. **No business logic changes** — Mutation, validation, and dedupe stay the same; only the input UI and the date string format change.

### Files
- `src/pages/Wealth.tsx` — update `SnapshotEditor` only.

### Validation
- Open an investment card → calendar icon → pick a non-first-of-month date → save → confirm row appears with that date and chart point lands on the correct day.
- Type a 7-figure balance and confirm the full number is visible while typing.
