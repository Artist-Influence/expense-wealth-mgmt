import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import { useAuth } from '@/hooks/useAuth';
import { useChatThreads } from '@/hooks/useChatThreads';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { AssistantChat } from '@/components/AssistantChat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, MessageSquare, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react';

function dbRowsToMessages(rows: any[]): UIMessage[] {
  return rows.map((r) => {
    const parts =
      Array.isArray(r.parts) && r.parts.length > 0
        ? r.parts
        : [{ type: 'text', text: r.content ?? '' }];
    return { id: r.id, role: r.role, parts } as UIMessage;
  });
}

export default function Assistant() {
  const { user, ownerId, loading, isAccountant, isInvestor } = useAuth();
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const canWrite = !isAccountant && !isInvestor;

  const { threads, loading: threadsLoading, createThread, renameThread, deleteThread } =
    useChatThreads(ownerId, canWrite);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const bootstrapped = useRef(false);

  // Bootstrap: pick the most recent thread or create one, then navigate.
  useEffect(() => {
    if (!ownerId || threadsLoading || threadId) return;
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      if (threads.length > 0) {
        navigate(`/assistant/${threads[0].id}`, { replace: true });
      } else if (canWrite) {
        const t = await createThread();
        if (t) navigate(`/assistant/${t.id}`, { replace: true });
      }
    })();
  }, [ownerId, threadsLoading, threadId, threads, canWrite, createThread, navigate]);

  // Load messages for the active thread.
  const { data: initialMessages, isLoading: messagesLoading } = useQuery({
    queryKey: ['chat_messages', threadId],
    queryFn: async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, role, content, parts')
        .eq('thread_id', threadId!)
        .order('created_at', { ascending: true });
      return dbRowsToMessages(data ?? []);
    },
    enabled: !!threadId,
  });

  const handleNewChat = async () => {
    const t = await createThread();
    if (t) navigate(`/assistant/${t.id}`);
  };

  const handleDelete = async (id: string) => {
    await deleteThread(id);
    if (id === threadId) {
      const next = threads.find((t) => t.id !== id);
      navigate(next ? `/assistant/${next.id}` : '/assistant', { replace: true });
    }
  };

  const startEdit = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };
  const saveEdit = async () => {
    if (editingId && editTitle.trim()) await renameThread(editingId, editTitle.trim());
    setEditingId(null);
  };

  // Auto-title a brand-new thread from the first message.
  const handleFirstMessage = (text: string) => {
    if (!threadId) return;
    const current = threads.find((t) => t.id === threadId);
    if (current && (current.title === 'New chat' || !current.title)) {
      const title = text.length > 48 ? text.slice(0, 48) + '…' : text;
      renameThread(threadId, title);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppNav />
      <div className="flex-1 min-h-0 flex">
        {/* Thread sidebar */}
        <aside className="w-60 shrink-0 border-r border-border/60 flex flex-col glass-panel rounded-none border-y-0 border-l-0">
          <div className="p-3">
            <Button
              onClick={handleNewChat}
              disabled={!canWrite}
              className="w-full gap-2"
              size="sm"
            >
              <Plus className="h-4 w-4" /> New chat
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5 scrollbar-thin">
            {threadsLoading ? (
              <p className="text-xs text-muted-foreground px-2 py-2">Loading…</p>
            ) : threads.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-2">No conversations yet</p>
            ) : (
              threads.map((t) => {
                const active = t.id === threadId;
                if (editingId === t.id) {
                  return (
                    <div key={t.id} className="flex items-center gap-1 px-1 py-1">
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        className="h-7 text-xs"
                      />
                      <button onClick={saveEdit} className="p-1 text-success hover:text-success/80">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                }
                return (
                  <div
                    key={t.id}
                    className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                      active
                        ? 'bg-primary/15 text-primary border border-primary/20'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                    }`}
                    onClick={() => navigate(`/assistant/${t.id}`)}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate">{t.title}</span>
                    {canWrite && (
                      <span className="hidden group-hover:flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(t.id, t.title);
                          }}
                          className="p-0.5 hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(t.id);
                          }}
                          className="p-0.5 hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Chat pane */}
        <main className="flex-1 min-w-0 flex flex-col">
          {threadId && ownerId && !messagesLoading ? (
            <AssistantChat
              key={threadId}
              threadId={threadId}
              ownerId={ownerId}
              initialMessages={initialMessages ?? []}
              canSend={canWrite}
              onFirstMessage={handleFirstMessage}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
