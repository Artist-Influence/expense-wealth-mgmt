import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Edit3, Trash2, Save } from 'lucide-react';

interface MerchantRecord {
  id: string;
  merchant_key: string;
  raw_example: string | null;
  mode: string;
  most_common_category: string | null;
  most_common_method: string | null;
  default_note_template: string | null;
  times_seen: number;
  last_seen: string;
}

export default function MerchantMemory() {
  const { user } = useAuth();
  const [merchants, setMerchants] = useState<MerchantRecord[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ category: '', method: '', notes: '' });

  useEffect(() => {
    if (user) loadMerchants();
  }, [user]);

  const loadMerchants = async () => {
    const { data } = await supabase
      .from('merchant_memory')
      .select('*')
      .eq('owner_id', user!.id)
      .order('times_seen', { ascending: false })
      .limit(200);
    setMerchants((data || []) as MerchantRecord[]);
  };

  const filtered = merchants.filter(m => {
    if (!search) return true;
    const s = search.toLowerCase();
    return m.merchant_key.toLowerCase().includes(s) ||
      (m.raw_example || '').toLowerCase().includes(s) ||
      (m.most_common_category || '').toLowerCase().includes(s);
  });

  const startEdit = (m: MerchantRecord) => {
    setEditingId(m.id);
    setEditValues({
      category: m.most_common_category || '',
      method: m.most_common_method || '',
      notes: m.default_note_template || '',
    });
  };

  const saveEdit = async (id: string) => {
    await supabase.from('merchant_memory').update({
      most_common_category: editValues.category || null,
      most_common_method: editValues.method || null,
      default_note_template: editValues.notes || null,
    }).eq('id', id);
    setEditingId(null);
    await loadMerchants();
    toast.success('Merchant memory updated');
  };

  const deleteMemory = async (id: string) => {
    if (!confirm('Delete this merchant memory record? This cannot be undone.')) return;
    await supabase.from('merchant_memory').delete().eq('id', id);
    await loadMerchants();
    toast.success('Memory record deleted');
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-8 animate-fade-in">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">Merchant Memory</h1>
          <p className="text-sm text-muted-foreground">Learned merchant patterns from approved transactions</p>
        </div>

        <div className="glass-panel p-4 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search merchants..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="glass-input pl-9 h-9 text-sm"
            />
          </div>
        </div>

        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Merchant Key</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Mode</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Category</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Method</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Notes</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">Seen</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                    <td className="px-3 py-2">
                      <p className="text-xs font-mono text-foreground">{m.merchant_key}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]" title={m.raw_example || ''}>
                        {m.raw_example || ''}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <span className="match-tag bg-primary/10 text-primary/80">{m.mode}</span>
                    </td>
                    <td className="px-3 py-2">
                      {editingId === m.id ? (
                        <Input value={editValues.category} onChange={e => setEditValues(v => ({ ...v, category: e.target.value }))} className="glass-input h-7 text-xs w-28" />
                      ) : (
                        <span className="text-xs">{m.most_common_category || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingId === m.id ? (
                        <Input value={editValues.method} onChange={e => setEditValues(v => ({ ...v, method: e.target.value }))} className="glass-input h-7 text-xs w-28" />
                      ) : (
                        <span className="text-xs text-muted-foreground">{m.most_common_method || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingId === m.id ? (
                        <Input value={editValues.notes} onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))} className="glass-input h-7 text-xs w-32" />
                      ) : (
                        <span className="text-xs text-muted-foreground">{m.default_note_template || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-xs font-mono text-muted-foreground">{m.times_seen}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editingId === m.id ? (
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => saveEdit(m.id)}>
                          <Save className="h-3.5 w-3.5 text-success" />
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => startEdit(m)}>
                            <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => deleteMemory(m.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive/60" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
