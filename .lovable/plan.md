

## Review: Streamlining & Idiot-Proofing Suggestions

After inspecting all pages and core flows, here are concrete suggestions organized by impact.

---

### A. Reduce Manual Work / Automate More

**1. Auto-approve high-confidence transactions on import**
Currently every imported transaction lands in "needs_review" or "suggested" status. Transactions that hit exact merchant memory matches (confidence 95+) should auto-approve and skip the review queue entirely. This already half-exists (the `auto_categorized` status) but still requires manual approval. Add a "trust history" toggle in Settings that auto-approves exact merchant memory matches.

**2. One-click "Approve All Suggested" button**
The Expenses page has bulk approve, but users must manually select suggested rows first. Add a dedicated "Approve All Suggested" button that selects and approves all `suggested` / `ai_suggested` rows above the auto-threshold in one click.

**3. Auto-link reimbursement income to groups**
Income page has manual "Link to Group" flow. When an income transaction is classified as `reimbursement` and its amount matches a pending group's `total_expected`, auto-suggest the match with a one-click confirm instead of requiring the user to open a dialog and pick.

**4. Auto-fill allocation plans from prior months**
Allocations page starts blank each month. Pre-populate from last month's plan as a starting template so you only adjust, not rebuild from scratch.

---

### B. Reduce Clicks / Simplify Flows

**5. Inline category editing on the table**
Currently you must open the drawer to change a category. Add a clickable category cell that opens a dropdown directly in the table row — saves opening/closing the drawer for the most common edit.

**6. Combine Personal/Business mode toggle with a single unified view option**
11 nav items + a mode toggle per page is a lot of context switching. Consider adding an "All Modes" view on Expenses that shows a `mode` column, so you can see everything at once and bulk-reassign without switching tabs.

**7. Keyboard shortcuts**
- `a` to approve selected rows
- `t` to mark as transfer
- `d` to open detail drawer on focused row
- `Escape` to close drawer
- Arrow keys to navigate between transactions in the drawer

**8. Merge Close Month into the nav flow more naturally**
Close Month is a 6-step wizard but each step just links you to another page. Instead, make it a checklist dashboard that pulls live counts and lets you act inline (e.g., approve exceptions right there) rather than bouncing between pages.

---

### C. Prevent Bad Data / Idiot-Proof

**9. Income CSV import should use the same preview/mapping flow as Expenses**
Income currently auto-maps columns with regex and imports immediately. Use the same `ImportPreviewDialog` with column mapping confirmation that Expenses uses, so the user can verify before import.

**10. Warn on duplicate income imports**
Income has no duplicate detection at all. If you import the same CSV twice, you get double entries. Add fingerprint-based duplicate detection (same date + amount + description = skip).

**11. Prevent saving a transaction with no category**
The drawer allows saving with an empty category (sets `review_status: 'edited'`). This creates "edited but uncategorized" rows that slip through. Either require a category on save, or keep the status as `needs_review` if category is empty.

**12. Settings: prevent adding duplicate category names**
Nothing stops you from adding "Food" twice. Check for existing name (case-insensitive) before insert.

**13. Wealth: add delete account with confirmation**
Currently you can add and edit accounts but never delete them. Add a delete button with confirmation in the edit dialog.

---

### D. Make Numbers Clearer / Less Confusing

**14. Show "this month" vs "all time" context on summary cards**
Expenses stats show all-time totals, Income shows current month only. This is inconsistent and confusing. Add a period selector (This Month / This Quarter / All Time) to both pages, or at minimum label the time period clearly.

**15. Insights: add a note that income totals are cross-mode**
Income doesn't have a mode column, so the Income & Savings tab mixes all income with mode-filtered expenses. Add a subtle note: "Income totals include all sources regardless of mode."

**16. Surface "needs attention" count in the nav**
Show a small badge on the Expenses nav item with the count of `needs_review` transactions. Makes the review queue visible without navigating there.

---

### E. UX Polish

**17. Empty state for Insights with no data**
If there are zero transactions, the charts render as blank boxes. Show a friendly "Import some transactions to see insights" message instead.

**18. Wealth page: show "last updated" timestamp**
Balances are manually entered, so showing when each was last updated helps you know if numbers are stale.

**19. Mobile: make the transaction table horizontally scrollable**
On mobile, the expense table columns get crushed. Wrap in `overflow-x-auto` so users can scroll horizontally.

**20. Consistent toast library**
Some pages use `toast` from `sonner`, others use `toast` from `@/hooks/use-toast`. Pick one. Sonner is simpler and already used on most pages — standardize on it.

---

### Priority Ranking

| Priority | Items | Impact |
|----------|-------|--------|
| High | #1 (auto-approve), #9 (income preview), #10 (income dedup), #11 (require category) | Prevents bad data |
| High | #2 (approve all suggested), #5 (inline category edit) | Biggest time savers |
| Medium | #4 (pre-fill allocations), #6 (all-modes view), #14 (period labels) | Reduces confusion |
| Medium | #12 (dupe categories), #13 (delete accounts), #16 (nav badge) | Polish |
| Lower | #7 (keyboard shortcuts), #8 (inline close-month), #18 (timestamps) | Nice to have |

