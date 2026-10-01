import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetch-all';
import { accountMatcher, planWithdrawals, type WithdrawalRow } from '@/lib/account-growth';

// Account types whose platform transfers are deposits/withdrawals. Collectibles
// are left out: money in that mentions "Pokemon" is a card SALE (income), not a
// withdrawal from the collection.
const CAPTURE_TYPES = new Set(['brokerage', 'crypto', 'roth_ira', 'traditional_ira', 'savings']);

export type WithdrawalCapture = {
  /** Investment account an inflow came OUT of, or null if it isn't one. */
  match: (tx: { description_raw: string | null; description_normalized: string | null }) => string | null;
  /** Logs the new ones (deduped against everything already logged); returns how many were saved. */
  save: (found: WithdrawalRow[], fileName: string) => Promise<number>;
};

/**
 * Money coming back from Dub / Wealthfront / Gemini lands in checking as a
 * credit. Without this it was saved as income, or worse as a positive
 * "expense" that the Wealth page then counted as a DEPOSIT into that account.
 * Returns null (import carries on as before) if the lookup fails.
 */
export async function createWithdrawalCapture(ownerId: string): Promise<WithdrawalCapture | null> {
  try {
    const [{ data: accounts, error }, existing] = await Promise.all([
      supabase
        .from('investment_accounts')
        .select('id, account_name, auto_track_pattern, account_type')
        .eq('owner_id', ownerId)
        .is('deleted_at', null),
      fetchAllRows<WithdrawalRow>((from, to) =>
        supabase
          .from('investment_withdrawals')
          .select('account_id, date, amount')
          .eq('owner_id', ownerId)
          .order('id')
          .range(from, to),
      ),
    ]);
    if (error) throw new Error(error.message);
    const match = accountMatcher((accounts || []).filter(a => CAPTURE_TYPES.has(a.account_type)));
    return {
      match: tx => match(tx),
      save: async (found, fileName) => {
        const inserts = planWithdrawals(found, existing);
        if (inserts.length === 0) return 0;
        const { error: insErr } = await supabase.from('investment_withdrawals').insert(
          inserts.map(w => ({ ...w, owner_id: ownerId, source: 'import', source_file_name: fileName })),
        );
        if (insErr) throw new Error(insErr.message);
        existing.push(...inserts);
        return inserts.length;
      },
    };
  } catch (e) {
    console.warn('Withdrawal capture unavailable:', e);
    return null;
  }
}
