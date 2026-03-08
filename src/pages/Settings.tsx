import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Trash2, ChevronDown, Zap, Save } from 'lucide-react';
import { previewCsvFile, parseCsvFileWithMapping, type ColumnMapping, type ParsePreview } from '@/lib/csv-parser';
import { updateMerchantMemory } from '@/lib/categorization-engine';
import { SeedMappingDialog } from '@/components/SeedMappingDialog';

interface CategoryOption {
  id: string; mode: string; category_name: string; sort_order: number; is_active: boolean;
}

interface AppSettingsData {
  personal_auto_threshold: number; business_auto_threshold: number;
  personal_suggest_threshold: number; business_suggest_threshold: number;
  ai_enabled: boolean; passcode_enabled: boolean;
  prevent_exact_duplicates: boolean; flag_possible_duplicates: boolean;
  exclude_transfers_from_totals: boolean;
}

interface Rule {
  id: string; mode: string; rule_name: string; match_type: string; pattern: string;
  category_output: string | null; method_output: string | null; notes_output: string | null;
  priority: number; is_active: boolean;
}

const emptyRule = {
  rule_name: '', mode: 'both', match_type: 'contains', pattern: '',
  category_output: '', method_output: '', notes_output: '', priority: 100, is_active: true,
};

export default function SettingsPage() {
  const { user } = useAuth();
  const [personalCats, setPersonalCats] = useState<CategoryOption[]>([]);
  const [businessCats, setBusinessCats] = useState<CategoryOption[]>([]);
  const [newCatPersonal, setNewCatPersonal] = useState('');
  const [newCatBusiness, setNewCatBusiness] = useState('');
  const [settings, setSettings] = useState<AppSettingsData>({
    personal_auto_threshold: 90, business_auto_threshold: 90,
    personal_suggest_threshold: 70, business_suggest_threshold: 70,
    ai_enabled: false, passcode_enabled: false,
    prevent_exact_duplicates: true, flag_possible_duplicates: true,
    exclude_transfers_from_totals: true,
  });
  const [seedingPersonal, setSeedingPersonal] = useState(false);
  const [seedingBusiness, setSeedingBusiness] = useState(false);
  const [seedingPersonalIncome, setSeedingPersonalIncome] = useState(false);
  const [seedingBusinessIncome, setSeedingBusinessIncome] = useState(false);

  // Seed mapping dialog state
  const [seedDialogOpen, setSeedDialogOpen] = useState(false);
  const [seedPreview, setSeedPreview] = useState<ParsePreview | null>(null);
  const [seedFile, setSeedFile] = useState<File | null>(null);
  const [seedMode, setSeedMode] = useState<'personal' | 'business'>('personal');
  const [seedLabel, setSeedLabel] = useState('');

  // Rules state
  const [rules, setRules] = useState<Rule[]>([]);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState(emptyRule);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (user) { loadCategories(); loadSettings(); loadRules(); }
  }, [user]);

  const loadCategories = async () => {
    const { data } = await supabase.from('category_options').select('*').eq('owner_id', user!.id).order('sort_order');
    const cats = (data || []) as CategoryOption[];
    setPersonalCats(cats.filter(c => c.mode === 'personal'));
    setBusinessCats(cats.filter(c => c.mode === 'business'));
  };

  const loadSettings = async () => {
    const { data } = await supabase.from('app_settings').select('*').eq('owner_id', user!.id).maybeSingle();
    if (data) {
      setSettings({
        personal_auto_threshold: data.personal_auto_threshold,
        business_auto_threshold: data.business_auto_threshold,
        personal_suggest_threshold: data.personal_suggest_threshold,
        business_suggest_threshold: data.business_suggest_threshold,
        ai_enabled: data.ai_enabled, passcode_enabled: data.passcode_enabled,
        prevent_exact_duplicates: data.prevent_exact_duplicates ?? true,
        flag_possible_duplicates: data.flag_possible_duplicates ?? true,
        exclude_transfers_from_totals: data.exclude_transfers_from_totals ?? true,
      });
    }
  };

  const loadRules = async () => {
    const { data } = await supabase.from('categorization_rules').select('*').eq('owner_id', user!.id).order('priority', { ascending: true });
    setRules((data || []) as Rule[]);
  };

  const addCategory = async (mode: 'personal' | 'business', name: string) => {
    if (!name.trim()) return;
    const cats = mode === 'personal' ? personalCats : businessCats;
    await supabase.from('category_options').insert({ mode, category_name: name.trim(), sort_order: cats.length, owner_id: user!.id });
    if (mode === 'personal') setNewCatPersonal(''); else setNewCatBusiness('');
    await loadCategories();
    toast.success(`Category "${name}" added`);
  };

  const deleteCategory = async (id: string) => {
    await supabase.from('category_options').delete().eq('id', id);
    await loadCategories();
  };

  const saveSettings = async () => {
    const { data: existing } = await supabase.from('app_settings').select('id').eq('owner_id', user!.id).maybeSingle();
    const payload = { ...settings };
    if (existing) await supabase.from('app_settings').update(payload).eq('id', existing.id);
    else await supabase.from('app_settings').insert({ ...payload, owner_id: user!.id });
    toast.success('Settings saved');
  };

  const handleSeedFileSelected = async (file: File, mode: 'personal' | 'business', label: string) => {
    try {
      const preview = await previewCsvFile(file);
      setSeedPreview(preview);
      setSeedFile(file);
      setSeedMode(mode);
      setSeedLabel(label);
      setSeedDialogOpen(true);
    } catch (err: any) {
      toast.error(`Failed to read CSV: ${err.message}`);
    }
  };

  const handleSeedConfirm = async (mapping: ColumnMapping) => {
    setSeedDialogOpen(false);
    if (!seedFile) return;
    const mode = seedMode;
    const setLoading = mode === 'personal' ? setSeedingPersonal : setSeedingBusiness;
    setLoading(true);
    try {
      const parsed = await parseCsvFileWithMapping(seedFile, mapping);
      const merchantMap = new Map<string, { category: string; method: string | null; notes: string | null; raw: string; count: number }>();
      const categorySet = new Set<string>();
      for (const tx of parsed) {
        if (tx.category) {
          categorySet.add(tx.category);
          const existing = merchantMap.get(tx.merchant_key);
          if (existing) existing.count++; else merchantMap.set(tx.merchant_key, { category: tx.category, method: tx.method, notes: tx.notes, raw: tx.description_raw, count: 1 });
        }
      }
      const existingCats = mode === 'personal' ? personalCats : businessCats;
      const existingNames = new Set(existingCats.map(c => c.category_name));
      const newCategories = [...categorySet].filter(c => !existingNames.has(c));
      if (newCategories.length > 0) {
        await supabase.from('category_options').insert(newCategories.map((name, i) => ({ mode, category_name: name, sort_order: existingCats.length + i, owner_id: user!.id })));
      }
      for (const [key, data] of merchantMap) {
        await updateMerchantMemory(key, mode, data.category, data.method, data.notes, data.raw, user!.id);
      }
      await loadCategories();
      toast.success(`Seeded ${merchantMap.size} merchants and ${newCategories.length} new categories from ${parsed.length} transactions`);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const handleSeedCancel = () => {
    setSeedDialogOpen(false);
    setSeedFile(null);
    setSeedPreview(null);
  };

  // Rules functions
  const addRule = async () => {
    const { error } = await supabase.from('categorization_rules').insert({
      ...newRule, category_output: newRule.category_output || null,
      method_output: newRule.method_output || null, notes_output: newRule.notes_output || null,
      owner_id: user!.id,
    });
    if (!error) { setIsAddingRule(false); setNewRule(emptyRule); await loadRules(); toast.success('Rule added'); }
  };

  const deleteRule = async (id: string) => {
    await supabase.from('categorization_rules').delete().eq('id', id);
    await loadRules(); toast.success('Rule deleted');
  };

  const toggleRuleActive = async (id: string, active: boolean) => {
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
      else if (rule.match_type === 'regex') { try { match = new RegExp(rule.pattern, 'i').test(testInput); } catch {} }
      if (match) { setTestResult(`✓ "${rule.rule_name}" → ${rule.category_output || '—'}`); return; }
    }
    setTestResult('✗ No rules matched');
  };

  const CategoryList = ({ cats, mode, newVal, setNewVal }: { cats: CategoryOption[]; mode: 'personal' | 'business'; newVal: string; setNewVal: (v: string) => void }) => (
    <div className="glass-panel p-4">
      <h3 className="text-sm font-medium text-foreground mb-3 capitalize">{mode} Categories</h3>
      <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin mb-3">
        {cats.map(c => (
          <div key={c.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-secondary/30">
            <span className="text-xs text-foreground">{c.category_name}</span>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => deleteCategory(c.id)}>
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input placeholder="New category..." value={newVal} onChange={e => setNewVal(e.target.value)} className="glass-input h-8 text-xs" onKeyDown={e => e.key === 'Enter' && addCategory(mode, newVal)} />
        <Button size="sm" className="h-8" onClick={() => addCategory(mode, newVal)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-6 animate-fade-in max-w-4xl">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage categories, thresholds, rules, and import logic</p>
        </div>

        <div className="space-y-4">
          {/* Categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CategoryList cats={personalCats} mode="personal" newVal={newCatPersonal} setNewVal={setNewCatPersonal} />
            <CategoryList cats={businessCats} mode="business" newVal={newCatBusiness} setNewVal={setNewCatBusiness} />
          </div>

          {/* Thresholds */}
          <div className="glass-panel p-4 space-y-4">
            <h3 className="text-sm font-medium text-foreground">Confidence Thresholds</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-xs text-muted-foreground">Personal Auto: {settings.personal_auto_threshold}%</label>
                <Slider value={[settings.personal_auto_threshold]} onValueChange={v => setSettings(s => ({ ...s, personal_auto_threshold: v[0] }))} max={100} min={50} step={5} />
                <label className="text-xs text-muted-foreground">Personal Suggest: {settings.personal_suggest_threshold}%</label>
                <Slider value={[settings.personal_suggest_threshold]} onValueChange={v => setSettings(s => ({ ...s, personal_suggest_threshold: v[0] }))} max={100} min={30} step={5} />
              </div>
              <div className="space-y-3">
                <label className="text-xs text-muted-foreground">Business Auto: {settings.business_auto_threshold}%</label>
                <Slider value={[settings.business_auto_threshold]} onValueChange={v => setSettings(s => ({ ...s, business_auto_threshold: v[0] }))} max={100} min={50} step={5} />
                <label className="text-xs text-muted-foreground">Business Suggest: {settings.business_suggest_threshold}%</label>
                <Slider value={[settings.business_suggest_threshold]} onValueChange={v => setSettings(s => ({ ...s, business_suggest_threshold: v[0] }))} max={100} min={30} step={5} />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Switch checked={settings.ai_enabled} onCheckedChange={v => setSettings(s => ({ ...s, ai_enabled: v }))} />
              <label className="text-xs text-muted-foreground">AI Fallback Enabled</label>
            </div>
          </div>

          {/* Import Logic */}
          <div className="glass-panel p-4 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Import Logic</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-foreground">Prevent exact duplicate imports</p>
                <p className="text-[11px] text-muted-foreground">Skip rows that already exist</p>
              </div>
              <Switch checked={settings.prevent_exact_duplicates} onCheckedChange={v => setSettings(s => ({ ...s, prevent_exact_duplicates: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-foreground">Flag possible duplicates</p>
                <p className="text-[11px] text-muted-foreground">Mark similar transactions within 3 days</p>
              </div>
              <Switch checked={settings.flag_possible_duplicates} onCheckedChange={v => setSettings(s => ({ ...s, flag_possible_duplicates: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-foreground">Exclude transfers from totals</p>
                <p className="text-[11px] text-muted-foreground">Card payments won't count as expenses</p>
              </div>
              <Switch checked={settings.exclude_transfers_from_totals} onCheckedChange={v => setSettings(s => ({ ...s, exclude_transfers_from_totals: v }))} />
            </div>
          </div>

          <Button size="sm" onClick={saveSettings}>Save Settings</Button>

          {/* Historical Seed Import */}
          <div className="glass-panel p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">Import Historical CSV (Seed)</h3>
            <p className="text-[11px] text-muted-foreground mb-3">Build merchant memory from historical data. Upload expenses and income separately for each mode.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-foreground">Personal</h4>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Expenses CSV</label>
                  <input type="file" accept=".csv" disabled={seedingPersonal} onChange={e => e.target.files?.[0] && handleSeedImport(e.target.files[0], 'personal')} className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                  {seedingPersonal && <p className="text-xs text-primary mt-1 animate-pulse">Processing...</p>}
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Income CSV</label>
                  <input type="file" accept=".csv" disabled={seedingPersonalIncome} onChange={e => { if (e.target.files?.[0]) { setSeedingPersonalIncome(true); handleSeedImport(e.target.files[0], 'personal').finally(() => setSeedingPersonalIncome(false)); }}} className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                  {seedingPersonalIncome && <p className="text-xs text-primary mt-1 animate-pulse">Processing...</p>}
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-foreground">Business</h4>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Expenses CSV</label>
                  <input type="file" accept=".csv" disabled={seedingBusiness} onChange={e => e.target.files?.[0] && handleSeedImport(e.target.files[0], 'business')} className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                  {seedingBusiness && <p className="text-xs text-primary mt-1 animate-pulse">Processing...</p>}
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Income CSV</label>
                  <input type="file" accept=".csv" disabled={seedingBusinessIncome} onChange={e => { if (e.target.files?.[0]) { setSeedingBusinessIncome(true); handleSeedImport(e.target.files[0], 'business').finally(() => setSeedingBusinessIncome(false)); }}} className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                  {seedingBusinessIncome && <p className="text-xs text-primary mt-1 animate-pulse">Processing...</p>}
                </div>
              </div>
            </div>
          </div>

          {/* Advanced Rules */}
          <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
            <CollapsibleTrigger className="glass-panel p-4 w-full flex items-center justify-between cursor-pointer hover:bg-secondary/20 transition-colors">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium text-foreground">Advanced Rules</h3>
                <span className="text-[11px] text-muted-foreground font-mono">{rules.length} rules</span>
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${rulesOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-3 animate-fade-in">
              {/* Rule Tester */}
              <div className="glass-panel-sm p-3">
                <div className="flex items-center gap-2">
                  <Input placeholder="Test a description..." value={testInput} onChange={e => setTestInput(e.target.value)} className="glass-input h-8 text-xs flex-1" />
                  <Button size="sm" onClick={testRules} className="h-8 text-xs">Test</Button>
                </div>
                {testResult && (
                  <p className={`mt-2 text-xs font-mono ${testResult.startsWith('✓') ? 'text-success' : 'text-muted-foreground'}`}>{testResult}</p>
                )}
              </div>

              {/* Add Rule */}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setIsAddingRule(true)} className="h-8 gap-1 text-xs">
                  <Plus className="h-3 w-3" /> Add Rule
                </Button>
              </div>

              {isAddingRule && (
                <div className="glass-panel-sm p-3 animate-fade-in space-y-2">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Input placeholder="Rule name" value={newRule.rule_name} onChange={e => setNewRule(v => ({ ...v, rule_name: e.target.value }))} className="glass-input h-8 text-xs" />
                    <Select value={newRule.mode} onValueChange={v => setNewRule(r => ({ ...r, mode: v }))}>
                      <SelectTrigger className="h-8 glass-input text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">Both</SelectItem>
                        <SelectItem value="personal">Personal</SelectItem>
                        <SelectItem value="business">Business</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={newRule.match_type} onValueChange={v => setNewRule(r => ({ ...r, match_type: v }))}>
                      <SelectTrigger className="h-8 glass-input text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contains">Contains</SelectItem>
                        <SelectItem value="equals">Equals</SelectItem>
                        <SelectItem value="regex">Regex</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input placeholder="Pattern" value={newRule.pattern} onChange={e => setNewRule(v => ({ ...v, pattern: e.target.value }))} className="glass-input h-8 text-xs" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Input placeholder="Category" value={newRule.category_output} onChange={e => setNewRule(v => ({ ...v, category_output: e.target.value }))} className="glass-input h-8 text-xs" />
                    <Input placeholder="Method" value={newRule.method_output} onChange={e => setNewRule(v => ({ ...v, method_output: e.target.value }))} className="glass-input h-8 text-xs" />
                    <Input placeholder="Notes" value={newRule.notes_output} onChange={e => setNewRule(v => ({ ...v, notes_output: e.target.value }))} className="glass-input h-8 text-xs" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={addRule} className="h-8 text-xs">Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setIsAddingRule(false); setNewRule(emptyRule); }} className="h-8 text-xs">Cancel</Button>
                  </div>
                </div>
              )}

              {/* Rules Table */}
              <div className="glass-panel-sm overflow-hidden">
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40">
                        <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">On</th>
                        <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Name</th>
                        <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Mode</th>
                        <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Match</th>
                        <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">Pattern</th>
                        <th className="px-2 py-2 text-left text-[11px] font-medium text-muted-foreground">→ Cat</th>
                        <th className="px-2 py-2 text-right text-[11px] font-medium text-muted-foreground">Del</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map(r => (
                        <tr key={r.id} className="border-b border-border/10 hover:bg-secondary/20">
                          <td className="px-2 py-1.5"><Switch checked={r.is_active} onCheckedChange={v => toggleRuleActive(r.id, v)} /></td>
                          <td className="px-2 py-1.5 text-foreground">{r.rule_name}</td>
                          <td className="px-2 py-1.5"><span className="match-tag bg-primary/10 text-primary/80">{r.mode}</span></td>
                          <td className="px-2 py-1.5 font-mono text-muted-foreground">{r.match_type}</td>
                          <td className="px-2 py-1.5 font-mono text-foreground">{r.pattern}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.category_output || '—'}</td>
                          <td className="px-2 py-1.5 text-right">
                            <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => deleteRule(r.id)}>
                              <Trash2 className="h-3 w-3 text-destructive/60" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
