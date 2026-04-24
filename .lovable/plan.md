# Compact the Wealth Add/Edit Account Modal

## Goal
Shrink the Add/Edit Account dialog on `/wealth` so all fields fit in one screen at the user's viewport (1042×686) without scrolling.

## Changes — `src/pages/Wealth.tsx` (Dialog only, lines 268–348)

1. **Tighter dialog shell**: `DialogContent` → add `p-4 gap-3` (default is `p-6 gap-4`).
2. **Smaller header**: `DialogTitle` → `text-base`; remove default header spacing.
3. **Denser fields**:
   - Field group spacing: `space-y-4` → `space-y-2.5`; per-field label/input gap: `space-y-1.5` → `space-y-1`.
   - Grid gaps: `gap-3` → `gap-2`.
   - All `Label`s → `text-xs`.
   - All `Input`s and `SelectTrigger`s → `h-8 text-sm`.
4. **Move Priority + Notes onto one row** (currently two full-width rows). New row: `Priority | Notes` in a 2-col grid. Drop the helper text "(higher = more important)" — Priority is self-explanatory.
5. **Footer**: buttons → `size="sm" h-8`; smaller top padding `pt-1`.

## Out of scope
- Summary cards and account cards on the page itself stay as-is — the request was about the modal.
- No logic, validation, or schema changes.

## QA
- Open Add Account at 1042×686 → entire form + footer visible without scroll.
- Open Edit Account → same, plus Delete button visible in footer.
- All inputs still typeable; selects still open.
