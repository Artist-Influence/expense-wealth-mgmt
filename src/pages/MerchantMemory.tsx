import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Edit3, Trash2, Save, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

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

type SortKey = 'merchant_key' | 'mode' | 'most_common_category' | 'most_common_method' | 'default_note_template' | 'times_seen';

export default function MerchantMemory() {
  const { user, ownerId, isAccountant } = useAuth();
  const [merchants, setMerchants] = useState<MerchantRecord[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ category: '', method: '', notes: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('times_seen');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (user && ownerId) loadMerchants();
  }, [user, ownerId]);

  const loadMerchants = async () => {
    const { data } = await supabase
      .from('merchant_memory')
      .select('*')
      .eq('owner_id', ownerId!)
      .order('times_seen', { ascending: false })
      .limit(200);
    setMerchants((data || []) as MerchantRecord[]);
  };

  // Server-side search: only the top-200 records are loaded, so filtering
  // locally misses merchants outside that window. Terms of 2+ chars query the
  // server directly (debounced); clearing the search restores the top-200 view.
  const searchMerchants = async (term: string) => {
    // Strip chars that break PostgREST .or() syntax inside quoted patterns.
    const pattern = `%${term.replace(/[\\"]/g, '')}%`;
    const { data, error } = await supabase
      .from('merchant_memory')
      .select('*')
      .eq('owner_id', ownerId!)
      .or(`merchant_key.ilike."${pattern}",raw_example.ilike."${pattern}"`)
      .order('times_seen', { ascending: false })
      .limit(500);
    if (error) { toast.error(`Search failed: ${error.message}`); return; }
    setMerchants((data || []) as MerchantRecord[]);
  };

  const isServerSearch = search.trim().length >= 2;
  const serverSearchActive = useRef(false);
  useEffect(() => {
    if (!user || !ownerId) return;
    const term = search.trim();
    if (term.length < 2) {
      // Back below the server-search threshold — restore the top-200 view once.
      if (serverSearchActive.current) {
        serverSearchActive.current = false;
        loadMerchants();
      }
      return;
    }
    const t = setTimeout(() => {
      serverSearchActive.current = true;
      searchMerchants(term);
    }, 300);
    return () => clearTimeout(t);
  }, [search, user, ownerId]);

  /** Reload respecting the active search so edits don't yank the user back to the top-200. */
  const refresh = () => (isServerSearch ? searchMerchants(search.trim()) : loadMerchants());

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Numeric defaults desc, text defaults asc.
      setSortDir(key === 'times_seen' ? 'desc' : 'asc');
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const base = !q
      ? merchants
      : merchants.filter(m =>
          m.merchant_key.toLowerCase().includes(q) ||
          (m.raw_example || '').toLowerCase().includes(q) ||
          (m.most_common_category || '').toLowerCase().includes(q),
        );

    const sorted = [...base].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === 'times_seen') {
        return ((av as number) ?? 0) - ((bv as number) ?? 0);
      }
      return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' });
    });
    if (sortDir === 'desc') sorted.reverse();
    return sorted;
  }, [merchants, search, sortKey, sortDir]);

  const startEdit = (m: MerchantRecord) => {
    setEditingId(m.id);
    setEditValues({
      category: m.most_common_category || '',
      method: m.most_common_method || '',
      notes: m.default_note_template || '',
    });
  };

  const saveEdit = async (id: string) => {
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase.from('merchant_memory').update({
        most_common_category: editValues.category || null,
        most_common_method: editValues.method || null,
        default_note_template: editValues.notes || null,
      }).eq('id', id);
      if (error) { toast.error(`Failed to update merchant memory: ${error.message}`); return; }
      setEditingId(null);
      await refresh();
      toast.success('Merchant memory updated');
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteMemory = async (id: string) => {
    if (!confirm('Delete this merchant memory record? This cannot be undone.')) return;
    const { error } = await supabase.from('merchant_memory').delete().eq('id', id);
    if (error) { toast.error(`Failed to delete memory record: ${error.message}`); return; }
    await refresh();
    toast.success('Memory record deleted');
  };

  const SortHeader = ({ label, k, align = 'left' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th className={`px-3 py-3 text-${align} text-xs font-medium text-muted-foreground`}>
        <button
          onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? 'text-foreground' : ''}`}
        >
          {label}
          <Icon className="h-3 w-3" />
        </button>
      </th>
    );
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

        {!isServerSearch && merchants.length >= 200 && (
          <p className="text-xs text-muted-foreground mb-2">Showing first 200 records. Search to find merchants that aren't listed.</p>
        )}
        {isServerSearch && merchants.length >= 500 && (
          <p className="text-xs text-muted-foreground mb-2">Showing first 500 matches. Refine your search to narrow the results.</p>
        )}
        <p className="text-xs text-muted-foreground mb-2">{filtered.length} merchant{filtered.length !== 1 ? 's' : ''} {search ? 'matching' : 'total'}</p>
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <SortHeader label="Merchant Key" k="merchant_key" />
                  <SortHeader label="Mode" k="mode" />
                  <SortHeader label="Category" k="most_common_category" />
                  <SortHeader label="Method" k="most_common_method" />
                  <SortHeader label="Notes" k="default_note_template" />
                  <SortHeader label="Seen" k="times_seen" align="right" />
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
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => saveEdit(m.id)} disabled={savingEdit}>
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
