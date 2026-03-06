import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Edit3, Trash2, Save, X, Zap } from 'lucide-react';

interface Rule {
  id: string;
  mode: string;
  rule_name: string;
  match_type: string;
  pattern: string;
  category_output: string | null;
  method_output: string | null;
  notes_output: string | null;
  priority: number;
  is_active: boolean;
}

const emptyRule = {
  rule_name: '', mode: 'both', match_type: 'contains', pattern: '',
  category_output: '', method_output: '', notes_output: '', priority: 100, is_active: true,
};

export default function RulesEngine() {
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newRule, setNewRule] = useState(emptyRule);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState(emptyRule);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => { if (user) loadRules(); }, [user]);

  const loadRules = async () => {
    const { data } = await supabase
      .from('categorization_rules')
      .select('*')
      .eq('owner_id', user!.id)
      .order('priority', { ascending: true });
    setRules((data || []) as Rule[]);
  };

  const addRule = async () => {
    const { error } = await supabase.from('categorization_rules').insert({
      ...newRule,
      category_output: newRule.category_output || null,
      method_output: newRule.method_output || null,
      notes_output: newRule.notes_output || null,
      owner_id: user!.id,
    });
    if (!error) {
      setIsAdding(false);
      setNewRule(emptyRule);
      await loadRules();
      toast.success('Rule added');
    }
  };

  const saveEdit = async (id: string) => {
    await supabase.from('categorization_rules').update({
      ...editValues,
      category_output: editValues.category_output || null,
      method_output: editValues.method_output || null,
      notes_output: editValues.notes_output || null,
    }).eq('id', id);
    setEditingId(null);
    await loadRules();
    toast.success('Rule updated');
  };

  const deleteRule = async (id: string) => {
    await supabase.from('categorization_rules').delete().eq('id', id);
    await loadRules();
    toast.success('Rule deleted');
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from('categorization_rules').update({ is_active: active }).eq('id', id);
    await loadRules();
  };

  const testRules = () => {
    if (!testInput) return;
    const upper = testInput.toUpperCase();
    for (const rule of rules.filter(r => r.is_active)) {
      let match = false;
      if (rule.match_type === 'contains') match = upper.includes(rule.pattern.toUpperCase());
      else if (rule.match_type === 'equals') match = upper === rule.pattern.toUpperCase();
      else if (rule.match_type === 'regex') {
        try { match = new RegExp(rule.pattern, 'i').test(testInput); } catch {}
      }
      if (match) {
        setTestResult(`✓ Rule "${rule.rule_name}" → Category: ${rule.category_output || '—'}, Method: ${rule.method_output || '—'}`);
        return;
      }
    }
    setTestResult('✗ No rules matched');
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-8 animate-fade-in">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Rules Engine</h1>
            <p className="text-sm text-muted-foreground">Pattern-based categorization rules</p>
          </div>
          <Button size="sm" onClick={() => setIsAdding(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Rule
          </Button>
        </div>

        {/* Rule Tester */}
        <div className="glass-panel p-4 mb-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <Input
              placeholder="Test a description..."
              value={testInput}
              onChange={e => setTestInput(e.target.value)}
              className="glass-input h-9 text-sm flex-1"
            />
            <Button size="sm" onClick={testRules} className="h-9">Test</Button>
          </div>
          {testResult && (
            <p className={`mt-2 text-xs font-mono ${testResult.startsWith('✓') ? 'text-success' : 'text-muted-foreground'}`}>
              {testResult}
            </p>
          )}
        </div>

        {/* Add Rule Form */}
        {isAdding && (
          <div className="glass-panel p-4 mb-4 animate-fade-in">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <Input placeholder="Rule name" value={newRule.rule_name} onChange={e => setNewRule(v => ({ ...v, rule_name: e.target.value }))} className="glass-input h-9 text-sm" />
              <Select value={newRule.mode} onValueChange={v => setNewRule(r => ({ ...r, mode: v }))}>
                <SelectTrigger className="h-9 glass-input text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
              <Select value={newRule.match_type} onValueChange={v => setNewRule(r => ({ ...r, match_type: v }))}>
                <SelectTrigger className="h-9 glass-input text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">Contains</SelectItem>
                  <SelectItem value="equals">Equals</SelectItem>
                  <SelectItem value="regex">Regex</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Pattern" value={newRule.pattern} onChange={e => setNewRule(v => ({ ...v, pattern: e.target.value }))} className="glass-input h-9 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Input placeholder="Category output" value={newRule.category_output} onChange={e => setNewRule(v => ({ ...v, category_output: e.target.value }))} className="glass-input h-9 text-sm" />
              <Input placeholder="Method output" value={newRule.method_output} onChange={e => setNewRule(v => ({ ...v, method_output: e.target.value }))} className="glass-input h-9 text-sm" />
              <Input placeholder="Notes output" value={newRule.notes_output} onChange={e => setNewRule(v => ({ ...v, notes_output: e.target.value }))} className="glass-input h-9 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addRule}>Save Rule</Button>
              <Button size="sm" variant="ghost" onClick={() => { setIsAdding(false); setNewRule(emptyRule); }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Rules Table */}
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Active</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Name</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Mode</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Match</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">Pattern</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">→ Category</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">→ Method</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">Priority</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                    <td className="px-3 py-2">
                      <Switch checked={r.is_active} onCheckedChange={v => toggleActive(r.id, v)} />
                    </td>
                    <td className="px-3 py-2 text-xs font-medium text-foreground">{r.rule_name}</td>
                    <td className="px-3 py-2"><span className="match-tag bg-primary/10 text-primary/80">{r.mode}</span></td>
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{r.match_type}</td>
                    <td className="px-3 py-2 text-xs font-mono text-foreground">{r.pattern}</td>
                    <td className="px-3 py-2 text-xs">{r.category_output || '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.method_output || '—'}</td>
                    <td className="px-3 py-2 text-right text-xs font-mono text-muted-foreground">{r.priority}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => deleteRule(r.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive/60" />
                      </Button>
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
