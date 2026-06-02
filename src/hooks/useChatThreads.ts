import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ChatThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export function useChatThreads(ownerId: string | null, canWrite: boolean) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!ownerId) return;
    const { data } = await supabase
      .from('chat_threads')
      .select('id, title, created_at, updated_at')
      .eq('owner_id', ownerId)
      .order('updated_at', { ascending: false });
    setThreads(data ?? []);
    setLoading(false);
  }, [ownerId]);

  useEffect(() => {
    if (ownerId) {
      setLoading(true);
      refresh();
    }
  }, [ownerId, refresh]);

  const createThread = useCallback(
    async (title = 'New chat'): Promise<ChatThread | null> => {
      if (!ownerId || !canWrite) return null;
      const { data, error } = await supabase
        .from('chat_threads')
        .insert({ owner_id: ownerId, title })
        .select('id, title, created_at, updated_at')
        .single();
      if (error || !data) return null;
      setThreads((prev) => [data, ...prev]);
      return data;
    },
    [ownerId, canWrite],
  );

  const renameThread = useCallback(
    async (id: string, title: string) => {
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
      await supabase.from('chat_threads').update({ title }).eq('id', id);
    },
    [],
  );

  const deleteThread = useCallback(async (id: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    await supabase.from('chat_threads').delete().eq('id', id);
  }, []);

  return { threads, loading, refresh, createThread, renameThread, deleteThread };
}
