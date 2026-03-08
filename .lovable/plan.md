

## Fix: Import Preview Dialog Content Getting Cut Off

The dialog uses `max-w-lg` which is too narrow for the file names, badges, and row counts to fit without truncation.

### Change

**`src/components/ImportPreviewDialog.tsx` line 46:**
- Change `max-w-lg` to `max-w-2xl` to give the content enough horizontal space
- This prevents the file names, method badges, and row counts from being clipped

| File | Change |
|------|--------|
| `src/components/ImportPreviewDialog.tsx` | Widen dialog from `max-w-lg` to `max-w-2xl` |

