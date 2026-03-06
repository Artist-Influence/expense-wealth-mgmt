

## Plan: Seed Historical Data via Edge Function

The CSV files are large (2,521 business rows, 1,644 personal rows). The existing Settings UI requires manual file upload after login. Instead, I'll create an edge function that processes the CSV data server-side and seeds merchant memory + category options directly into the database.

### Approach

**Create a seeding edge function** (`seed-historical`) that:
1. Accepts the CSV content as text + mode (personal/business) in the request body
2. Parses rows, normalizes descriptions, generates merchant keys
3. Applies category remapping (Cannabis → Substances, Pokemon → Investment)
4. Extracts unique categories → inserts into `category_options`
5. Builds merchant memory map → upserts into `merchant_memory`
6. Returns summary stats

**Create a seed script page** (`/seed`) or add a one-click button to Settings that:
1. Has the two CSV files embedded as static imports (or fetches them)
2. Calls the edge function for each mode

**Simpler alternative** — since the seeding logic already exists client-side in `Settings.tsx`, and the CSVs can be served as static assets:
1. Copy the two expense CSVs to `public/seed/` as static files
2. Add a "Seed from built-in historical data" button to Settings
3. On click, fetch the CSV files, parse client-side using existing `parseCsvFile` + `handleSeedImport` logic
4. No new edge function needed

### Implementation Steps

1. **Copy CSV files to `public/seed/`**:
   - `public/seed/business-expenses-2025.csv` (Artist Influence)
   - `public/seed/personal-expenses-2025.csv` (Jared Rapoza Personal)

2. **Add "Seed Built-in Data" buttons to Settings page**:
   - Two buttons: "Seed Personal 2025 Data" and "Seed Business 2025 Data"
   - On click, fetch from `/seed/*.csv`, convert to File object, call existing `handleSeedImport`
   - Show progress and results using existing toast logic

3. **Handle multi-select category cleanup**: The personal CSV has entries like `"Cannabis,Business"` — the existing `remapCategory` function already handles comma-separated values and cannabis remapping, so this is covered.

### What gets seeded
- **Business**: ~2,521 rows → categories like Marketing, Vendor Payment, Subscriptions, Taxes, Label Royalties, etc. + merchant memory for FACEBK, TIKTOK, Zelle recipients, etc.
- **Personal**: ~1,644 rows → categories like Dining, Subscriptions, Fees, Health & Personal Care, Entertainment, Substances, Investment, etc. + merchant memory for Uber Eats, Foodtown, CVS, etc.

