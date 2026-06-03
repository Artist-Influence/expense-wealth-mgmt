import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSetupStatus } from '@/hooks/useSetupStatus';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Trash2, ChevronDown, Zap, Save, Wand2, HelpCircle, CheckCircle2, Circle, CreditCard, Database, ArrowRight } from 'lucide-react';
import { previewCsvFile, parseCsvFileWithMapping, type ColumnMapping, type ParsePreview } from '@/lib/csv-parser';
import { updateMerchantMemory } from '@/lib/categorization-engine';
import { SeedMappingDialog } from '@/components/SeedMappingDialog';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import type { PaymentMethod } from '@/hooks/usePaymentMethods';

const STOP_WORDS = new Set(['THE', 'AND', 'INC', 'LLC', 'LTD', 'FOR', 'FROM', 'WITH', 'COM', 'WWW', 'HTTP', 'HTTPS', 'NET', 'ORG', 'CO', 'USA', 'TST', 'SQ', 'POS', 'DES', 'ACH', 'REF', 'TXN', 'PMT', 'CKS', 'INT', 'FEE', 'TAX', 'PRE', 'ATM', 'WEB', 'TEL', 'PPD', 'CCD']);

async function generateRulesFromMerchants(
  merchants: { key: string; category: string | null; method: string | null }[],
  mode: string,
  ownerId: string
): Promise<number> {
  // Group by category
  const catGroups = new Map<string, string[]>();
  for (const m of merchants) {
    if (!m.category) continue;
    const list = catGroups.get(m.category) || [];
    list.push(m.key);
    catGroups.set(m.category, list);
  }

  // Load existing rules to avoid duplicates
  const { data: existingRules } = await supabase
    .from('categorization_rules')
    .select('pattern, category_output, mode')
    .eq('owner_id', ownerId);
  const existingSet = new Set(
    (existingRules || []).map(r => `${r.pattern?.toUpperCase()}|${r.category_output}|${r.mode}`)
  );

  const newRules: Array<{
    rule_name: string; mode: string; match_type: string; pattern: string;
    category_output: string; priority: number; is_active: boolean; owner_id: string;
  }> = [];

  for (const [category, keys] of catGroups) {
    if (keys.length < 2) continue;
    // Tokenize all keys
    const wordCounts = new Map<string, number>();
    for (const key of keys) {
      const words = key.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
      const unique = new Set(words);
      for (const w of unique) {
        wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
      }
    }
    // Keep words appearing in 2+ merchants
    for (const [word, count] of wordCounts) {
      if (count < 2) continue;
      const dupeKey = `${word}|${category}|${mode}`;
      const dupeKeyBoth = `${word}|${category}|both`;
      if (existingSet.has(dupeKey) || existingSet.has(dupeKeyBoth)) continue;
      existingSet.add(dupeKey);
      newRules.push({
        rule_name: `Auto: ${word} → ${category}`,
        mode,
        match_type: 'contains',
        pattern: word,
        category_output: category,
        priority: 200,
        is_active: true,
        owner_id: ownerId,
      });
    }
  }

  if (newRules.length > 0) {
    // Insert in batches of 50
    for (let i = 0; i < newRules.length; i += 50) {
      await supabase.from('categorization_rules').insert(newRules.slice(i, i + 50));
    }
  }

  return newRules.length;
}

interface CategoryOption {
  id: string; mode: string; category_name: string; sort_order: number; is_active: boolean;
}

interface AppSettingsData {
  personal_auto_threshold: number; business_auto_threshold: number;
  personal_suggest_threshold: number; business_suggest_threshold: number;
  ai_enabled: boolean; passcode_enabled: boolean;
  prevent_exact_duplicates: boolean; flag_possible_duplicates: boolean;
  exclude_transfers_from_totals: boolean;
  min_personal_cash_buffer: number; min_business_cash_buffer: number;
  tax_reserve_percent: number; monthly_savings_goal: number;
  monthly_personal_spend_limit: number; monthly_business_expense_target: number;
  report_basis: string;
  usage_profile: 'personal' | 'business' | 'both';
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

function SetupRow({
  done, icon: Icon, title, desc, actionLabel, onAction,
}: {
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${done ? 'border-primary/20 bg-primary/5' : 'border-warning/30 bg-warning/5'}`}>
      {done
        ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        : <Circle className="h-4 w-4 text-warning shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground">{title}</span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
      </div>
      {!done && (
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs shrink-0" onClick={onAction}>
          {actionLabel}
          <ArrowRight className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { user, ownerId, isAccountant, isOwner } = useAuth();
  const setup = useSetupStatus();
  const methodsSectionRef = useRef<HTMLDivElement>(null);
  const seedSectionRef = useRef<HTMLDivElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
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
    min_personal_cash_buffer: 5000, min_business_cash_buffer: 10000,
    tax_reserve_percent: 30, monthly_savings_goal: 0,
    monthly_personal_spend_limit: 0, monthly_business_expense_target: 0,
    report_basis: 'cash',
    usage_profile: 'both',
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

  // Payment methods state
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [newMethod, setNewMethod] = useState<{ name: string; mode: string; account_type: string; match_pattern: string }>({
    name: '', mode: 'personal', account_type: 'credit_card', match_pattern: '',
  });

  useEffect(() => {
    if (user && ownerId) { loadCategories(); loadSettings(); loadRules(); loadMethods(); }
  }, [user, ownerId]);

  const loadCategories = async () => {
    const { data } = await supabase.from('category_options').select('*').eq('owner_id', ownerId!).order('sort_order');
    const cats = (data || []) as CategoryOption[];
    setPersonalCats(cats.filter(c => c.mode === 'personal'));
    setBusinessCats(cats.filter(c => c.mode === 'business'));
  };

  const loadSettings = async () => {
    const { data } = await supabase.from('app_settings').select('*').eq('owner_id', ownerId!).maybeSingle();
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
        min_personal_cash_buffer: Number(data.min_personal_cash_buffer ?? 5000),
        min_business_cash_buffer: Number(data.min_business_cash_buffer ?? 10000),
        tax_reserve_percent: Number(data.tax_reserve_percent ?? 30),
        monthly_savings_goal: Number(data.monthly_savings_goal ?? 0),
        monthly_personal_spend_limit: Number(data.monthly_personal_spend_limit ?? 0),
        monthly_business_expense_target: Number(data.monthly_business_expense_target ?? 0),
        report_basis: data.report_basis ?? 'cash',
        usage_profile: (['personal', 'business', 'both'].includes((data as any).usage_profile) ? (data as any).usage_profile : 'both'),
      });
    }
  };

  const loadRules = async () => {
    const { data } = await supabase.from('categorization_rules').select('*').eq('owner_id', ownerId!).order('priority', { ascending: true });
    setRules((data || []) as Rule[]);
  };

  const loadMethods = async () => {
    const { data } = await supabase.from('payment_methods').select('*').eq('owner_id', ownerId!).order('sort_order');
    setMethods((data || []) as PaymentMethod[]);
  };

  const addMethod = async () => {
    const name = newMethod.name.trim();
    if (!name) { toast.error('Method name is required'); return; }
    const duplicate = methods.find(m => m.name.toLowerCase() === name.toLowerCase());
    if (duplicate) { toast.error(`Method "${name}" already exists`); return; }
    await supabase.from('payment_methods').insert({
      name,
      mode: newMethod.mode,
      account_type: newMethod.account_type,
      match_pattern: newMethod.match_pattern.trim() || null,
      sort_order: methods.length,
      owner_id: user!.id,
    });
    setNewMethod({ name: '', mode: 'personal', account_type: 'credit_card', match_pattern: '' });
    await loadMethods();
    setup.reload();
    toast.success(`Method "${name}" added`);
  };

  const updateMethod = async (id: string, patch: Partial<PaymentMethod>) => {
    await supabase.from('payment_methods').update(patch).eq('id', id);
    await loadMethods();
  };

  const deleteMethod = async (id: string) => {
    await supabase.from('payment_methods').delete().eq('id', id);
    await loadMethods();
    toast.success('Method deleted');
  };

  const addCategory = async (mode: 'personal' | 'business', name: string) => {
    if (!name.trim()) return;
    const cats = mode === 'personal' ? personalCats : businessCats;
    const duplicate = cats.find(c => c.category_name.toLowerCase() === name.trim().toLowerCase());
    if (duplicate) {
      toast.error(`Category "${duplicate.category_name}" already exists`);
      return;
    }
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
    const { data: existing } = await supabase.from('app_settings').select('id').eq('owner_id', ownerId!).maybeSingle();
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
    const isIncome = seedLabel.toLowerCase().includes('income');
    const setLoading = isIncome
      ? (mode === 'personal' ? setSeedingPersonalIncome : setSeedingBusinessIncome)
      : (mode === 'personal' ? setSeedingPersonal : setSeedingBusiness);
    setLoading(true);
    try {
      const parsed = await parseCsvFileWithMapping(seedFile, mapping);
      const merchantMap = new Map<string, { category: string | null; method: string | null; notes: string | null; raw: string; count: number }>();
      const categorySet = new Set<string>();
      for (const tx of parsed) {
        if (tx.category) categorySet.add(tx.category);
        const existing = merchantMap.get(tx.merchant_key);
        if (existing) existing.count++;
        else merchantMap.set(tx.merchant_key, { category: tx.category || null, method: tx.method, notes: tx.notes, raw: tx.description_raw, count: 1 });
      }
      // Only insert categories for expense CSVs (not income)
      let newCatCount = 0;
      if (!isIncome && categorySet.size > 0) {
        const existingCats = mode === 'personal' ? personalCats : businessCats;
        const existingNames = new Set(existingCats.map(c => c.category_name));
        const newCategories = [...categorySet].filter(c => !existingNames.has(c));
        newCatCount = newCategories.length;
        if (newCategories.length > 0) {
          await supabase.from('category_options').insert(newCategories.map((name, i) => ({ mode, category_name: name, sort_order: existingCats.length + i, owner_id: user!.id })));
        }
      }
      for (const [key, data] of merchantMap) {
        await updateMerchantMemory(key, mode, data.category, data.method, data.notes, data.raw, user!.id);
      }
      // Auto-generate rules from seeded merchants (expenses only)
      let ruleCount = 0;
      if (!isIncome) {
        const merchantsForRules = [...merchantMap.entries()].map(([key, data]) => ({
          key, category: data.category, method: data.method,
        }));
        ruleCount = await generateRulesFromMerchants(merchantsForRules, mode, user!.id);
        await loadRules();
      }
      await loadCategories();
      setup.reload();
      toast.success(`Seeded ${merchantMap.size} merchants${!isIncome ? `, ${newCatCount} new categories, ${ruleCount} auto-rules` : ''} from ${parsed.length} transactions`);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  const handleSeedCancel = () => {
    setSeedDialogOpen(false);
    setSeedFile(null);
    setSeedPreview(null);
  };

  const clearSeededData = async (mode: 'personal' | 'business') => {
    try {
      await supabase.from('merchant_memory').delete().eq('owner_id', ownerId!).eq('mode', mode);
      await supabase.from('category_options').delete().eq('owner_id', ownerId!).eq('mode', mode);
      await supabase.from('categorization_rules').delete().eq('owner_id', ownerId!).eq('mode', mode).eq('priority', 200);
      await loadCategories();
      await loadRules();
      toast.success(`Cleared all ${mode} merchant memory, categories, and auto-generated rules`);
    } catch (err: any) {
      toast.error(`Failed to clear: ${err.message}`);
    }
  };

  const [generatingRules, setGeneratingRules] = useState(false);

  const handleGenerateRulesFromMemory = async (mode: 'personal' | 'business') => {
    setGeneratingRules(true);
    try {
      const { data: merchants } = await supabase
        .from('merchant_memory')
        .select('merchant_key, most_common_category, most_common_method')
        .eq('owner_id', ownerId!)
        .eq('mode', mode);
      if (!merchants || merchants.length === 0) {
        toast.error(`No ${mode} merchant memory found. Seed historical data first.`);
        return;
      }
      const mapped = merchants.map(m => ({
        key: m.merchant_key,
        category: m.most_common_category,
        method: m.most_common_method,
      }));
      const count = await generateRulesFromMerchants(mapped, mode, user!.id);
      await loadRules();
      toast.success(`Generated ${count} new auto-rules from ${merchants.length} ${mode} merchants`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGeneratingRules(false);
    }
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete category?</AlertDialogTitle>
                  <AlertDialogDescription>"{c.category_name}" will be permanently removed. Existing transactions using it won't be affected.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteCategory(c.id)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
      <OnboardingWizard open={wizardOpen} onClose={() => setWizardOpen(false)} persistOnComplete={false} />
      <div className="container py-6 animate-fade-in max-w-4xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground">Manage categories, thresholds, rules, and import logic</p>
          </div>
          {!isAccountant && (
            <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)} className="gap-1.5 shrink-0">
              <HelpCircle className="h-3.5 w-3.5" />
              Replay walkthrough
            </Button>
          )}
        </div>

        <div className="space-y-4">
          {/* Account security — 2FA (all accounts) */}
          <MfaCard />

          {/* Setup checklist — owner only */}
          {isOwner && !setup.loading && (
            <div className="glass-panel p-4">
              {setup.isReady ? (
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <span>You're all set — uploads are ready to import accurately.</span>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-medium text-foreground mb-1">Finish setup to get accurate results</h3>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    Complete these steps before uploading your statements so transactions get categorized correctly.
                  </p>
                  <div className="space-y-2">
                    <SetupRow
                      done={setup.hasMethods}
                      icon={CreditCard}
                      title="Add your payment methods"
                      desc="Register your cards and bank accounts so uploads tag to the right account."
                      actionLabel="Add methods"
                      onAction={() => methodsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    />
                    <SetupRow
                      done={setup.hasReferenceData}
                      icon={Database}
                      title="Seed a reference statement"
                      desc="Import a historical CSV to teach the categorizer your merchants and categories."
                      actionLabel="Seed history"
                      onAction={() => seedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CategoryList cats={personalCats} mode="personal" newVal={newCatPersonal} setNewVal={setNewCatPersonal} />
            <CategoryList cats={businessCats} mode="business" newVal={newCatBusiness} setNewVal={setNewCatBusiness} />
          </div>

          {/* Payment Methods */}
          <div ref={methodsSectionRef} className="glass-panel p-4 scroll-mt-20">
            <h3 className="text-sm font-medium text-foreground mb-1">Payment Methods</h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              Register your credit cards and bank accounts. The filename keyword auto-tags uploaded CSVs to the right account.
            </p>

            <div className="space-y-1.5 mb-3">
              {methods.length === 0 && (
                <p className="text-xs text-muted-foreground italic py-2">No payment methods yet. Add your first card or account below.</p>
              )}
              {methods.map(m => (
                <div key={m.id} className={`grid grid-cols-12 gap-2 items-center py-1.5 px-2 rounded hover:bg-secondary/20 ${m.is_active ? '' : 'opacity-50'}`}>
                  <Input
                    value={m.name}
                    onChange={e => setMethods(prev => prev.map(x => x.id === m.id ? { ...x, name: e.target.value } : x))}
                    onBlur={e => updateMethod(m.id, { name: e.target.value.trim() })}
                    className="glass-input h-8 text-xs col-span-3"
                  />
                  <Select value={m.mode} onValueChange={v => updateMethod(m.id, { mode: v })}>
                    <SelectTrigger className="glass-input h-8 text-xs col-span-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">Personal</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={m.account_type} onValueChange={v => updateMethod(m.id, { account_type: v })}>
                    <SelectTrigger className="glass-input h-8 text-xs col-span-3"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="bank_account">Bank Account</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={m.match_pattern || ''}
                    placeholder="filename keyword"
                    onChange={e => setMethods(prev => prev.map(x => x.id === m.id ? { ...x, match_pattern: e.target.value } : x))}
                    onBlur={e => updateMethod(m.id, { match_pattern: e.target.value.trim() || null })}
                    className="glass-input h-8 text-xs col-span-3"
                  />
                  <div className="col-span-1 flex items-center justify-end gap-1">
                    <Switch checked={m.is_active} onCheckedChange={v => updateMethod(m.id, { is_active: v })} />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                          <Trash2 className="h-3 w-3 text-destructive/60" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete payment method?</AlertDialogTitle>
                          <AlertDialogDescription>"{m.name}" will be removed. Existing transactions using it won't be affected.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMethod(m.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-12 gap-2 items-center border-t border-border/40 pt-3">
              <Input
                placeholder="Name (e.g. Chase Sapphire)"
                value={newMethod.name}
                onChange={e => setNewMethod(v => ({ ...v, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addMethod()}
                className="glass-input h-8 text-xs col-span-3"
              />
              <Select value={newMethod.mode} onValueChange={v => setNewMethod(s => ({ ...s, mode: v }))}>
                <SelectTrigger className="glass-input h-8 text-xs col-span-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                </SelectContent>
              </Select>
              <Select value={newMethod.account_type} onValueChange={v => setNewMethod(s => ({ ...s, account_type: v }))}>
                <SelectTrigger className="glass-input h-8 text-xs col-span-3"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                  <SelectItem value="bank_account">Bank Account</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="filename keyword (optional)"
                value={newMethod.match_pattern}
                onChange={e => setNewMethod(v => ({ ...v, match_pattern: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addMethod()}
                className="glass-input h-8 text-xs col-span-3"
              />
              <Button size="sm" className="h-8 col-span-1" onClick={addMethod}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
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

          {/* Usage profile — controls how much of the app is shown */}
          <div className="glass-panel p-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">Usage profile</h3>
              <p className="text-[11px] text-muted-foreground">
                Choose how you use the app. Personal or Business hides the parts you don't need; Both shows everything.
              </p>
            </div>
            <div className="max-w-xs space-y-1.5">
              <label className="text-xs text-muted-foreground">I use this for</label>
              <Select
                value={settings.usage_profile}
                onValueChange={v => setSettings(s => ({ ...s, usage_profile: v as AppSettingsData['usage_profile'] }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal only</SelectItem>
                  <SelectItem value="business">Business only</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="glass-panel p-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">Finance Preferences</h3>
              <p className="text-[11px] text-muted-foreground">
                Used by the AI assistant for affordability, runway, profit and tax-reserve answers.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {([
                ['min_personal_cash_buffer', 'Minimum personal cash buffer ($)'],
                ['min_business_cash_buffer', 'Minimum business cash buffer ($)'],
                ['tax_reserve_percent', 'Tax reserve (% of net profit)'],
                ['monthly_savings_goal', 'Monthly savings goal ($)'],
                ['monthly_personal_spend_limit', 'Monthly personal spend limit ($)'],
                ['monthly_business_expense_target', 'Monthly business expense target ($)'],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <Input
                    type="number"
                    value={settings[key]}
                    onChange={e =>
                      setSettings(s => ({ ...s, [key]: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Reporting basis</label>
                <Select
                  value={settings.report_basis}
                  onValueChange={v => setSettings(s => ({ ...s, report_basis: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash basis</SelectItem>
                    <SelectItem value="accrual">Accrual basis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Button size="sm" onClick={saveSettings}>Save Settings</Button>


          {/* Historical Seed Import */}
          <div ref={seedSectionRef} className="glass-panel p-4 scroll-mt-20">
            <h3 className="text-sm font-medium text-foreground mb-3">Import Historical CSV (Seed)</h3>
            <p className="text-[11px] text-muted-foreground mb-3">Build merchant memory from historical data. Upload expenses and income separately for each mode.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-foreground">Personal</h4>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive/70 hover:text-destructive">
                        <Trash2 className="h-3 w-3 mr-1" /> Clear
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear Personal Seeded Data?</AlertDialogTitle>
                        <AlertDialogDescription>This will delete all personal merchant memory and categories. You can re-upload CSVs after.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => clearSeededData('personal')}>Clear All</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Expenses CSV</label>
                  <input type="file" accept=".csv" disabled={seedingPersonal} onChange={e => e.target.files?.[0] && handleSeedFileSelected(e.target.files[0], 'personal', 'Personal Expenses')} className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                  {seedingPersonal && <p className="text-xs text-primary mt-1 animate-pulse">Processing...</p>}
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Income CSV</label>
                  <input type="file" accept=".csv" disabled={seedingPersonalIncome} onChange={e => e.target.files?.[0] && handleSeedFileSelected(e.target.files[0], 'personal', 'Personal Income')} className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                  {seedingPersonalIncome && <p className="text-xs text-primary mt-1 animate-pulse">Processing...</p>}
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-foreground">Business</h4>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-6 text-[11px] text-destructive/70 hover:text-destructive">
                        <Trash2 className="h-3 w-3 mr-1" /> Clear
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear Business Seeded Data?</AlertDialogTitle>
                        <AlertDialogDescription>This will delete all business merchant memory and categories. You can re-upload CSVs after.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => clearSeededData('business')}>Clear All</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Expenses CSV</label>
                  <input type="file" accept=".csv" disabled={seedingBusiness} onChange={e => e.target.files?.[0] && handleSeedFileSelected(e.target.files[0], 'business', 'Business Expenses')} className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                  {seedingBusiness && <p className="text-xs text-primary mt-1 animate-pulse">Processing...</p>}
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Income CSV</label>
                  <input type="file" accept=".csv" disabled={seedingBusinessIncome} onChange={e => e.target.files?.[0] && handleSeedFileSelected(e.target.files[0], 'business', 'Business Income')} className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer" />
                  {seedingBusinessIncome && <p className="text-xs text-primary mt-1 animate-pulse">Processing...</p>}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={generatingRules} onClick={() => handleGenerateRulesFromMemory('personal')}>
                <Wand2 className="h-3 w-3" /> Generate Personal Rules
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={generatingRules} onClick={() => handleGenerateRulesFromMemory('business')}>
                <Wand2 className="h-3 w-3" /> Generate Business Rules
              </Button>
              {generatingRules && <span className="text-xs text-primary animate-pulse self-center">Generating...</span>}
            </div>
          </div>

          <SeedMappingDialog
            open={seedDialogOpen}
            preview={seedPreview}
            mode={seedMode}
            label={seedLabel}
            isIncome={seedLabel.toLowerCase().includes('income')}
            onConfirm={handleSeedConfirm}
            onCancel={handleSeedCancel}
          />

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
