## Problem

In **Resolve Duplicates**, the action buttons (e.g. "Not duplicates", "Keep oldest, delete N", "Keep oldest, archive N") *do* exist in the code, but they're invisible because each cluster card grows wider than the dialog. The transaction descriptions (long `ORIG CO NAME:INTUIT ...` strings) don't truncate inside the scroll area, so the card expands to fit the text and the `justify-between` header row pushes the buttons off the right edge of the screen. Result: nothing visible to click, on every tab (Income, Possible, Exact).

## Root cause

In `src/components/DuplicateResolverDialog.tsx`:
- The `ScrollArea` content and cluster panels have no horizontal width constraint, so `truncate` on the description never kicks in (truncation needs a bounded-width parent).
- The action buttons live in the same flex row as the cluster summary using `justify-between`; when the card overflows, the buttons travel off-screen with it.

## Fix (UI only, single file)

In `src/components/DuplicateResolverDialog.tsx`:

1. **Constrain widths so cards can't overflow**
   - Add `w-full min-w-0` to the `ScrollArea` and the inner `space-y-3` container.
   - Add `w-full min-w-0 overflow-hidden` to each cluster `glass-panel`.

2. **Make the action buttons always visible**
   - Restructure each cluster header so the action buttons sit in their own row (or allow `flex-wrap`) instead of being pinned to the right of a `justify-between` row. This guarantees they render regardless of description length / viewport width.

3. **Force descriptions to truncate**
   - Ensure the description `<span className="truncate">` has a properly bounded `min-w-0` flex parent and add `max-w-full`/`flex-1 min-w-0` so long INTUIT strings ellipsis instead of expanding the card.

4. **Quick verify**
   - Open the dialog on the Income tab (5 clusters) and confirm the "Not duplicates" and "Keep oldest, delete N" buttons are visible and clickable, and that resolving refreshes the list. Repeat spot-check on Possible/Exact tabs.

## Out of scope
No changes to duplicate-detection logic, database, or how resolution is processed — the handlers (`archiveLosers`, `markNotDuplicates`, `deleteIncomeLosers`, `hardDelete`) already work; they just weren't reachable.