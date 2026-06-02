import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface PaymentMethod {
  id: string;
  name: string;
  mode: string;
  account_type: string;
  match_pattern: string | null;
  is_active: boolean;
  sort_order: number;
}

/**
 * Loads the owner's active payment methods (credit cards / bank accounts).
 * Used for filename auto-detection and method dropdowns.
 */
export function usePaymentMethods() {
  const { user, ownerId } = useAuth();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    const { data } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('is_active', true)
      .order('sort_order');
    setMethods((data || []) as PaymentMethod[]);
    setLoading(false);
  }, [ownerId]);

  useEffect(() => {
    if (user && ownerId) reload();
  }, [user, ownerId, reload]);

  return { methods, loading, reload };
}
