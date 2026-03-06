import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Plus, Trash2, Upload } from 'lucide-react';
import { parseCsvFile } from '@/lib/csv-parser';
import { categorizeTransactions, updateMerchantMemory } from '@/lib/categorization-engine';
import { generateMerchantKey } from '@/lib/normalizer';

interface CategoryOption {
  id: string;
  mode: string;
  category_name: string;
  sort_order: number;
  is_active: boolean;
}

interface AppSettingsData {
  personal_auto_threshold: number;
  business_auto_threshold: number;
  personal_suggest_threshold: number;
  business_suggest_threshold: number;
  ai_enabled: boolean;
  passcode_enabled: boolean;
}

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
  });
  const [seedingPersonal, setSeedingPersonal] = useState(false);
  const [seedingBusiness, setSeedingBusiness] = useState(false);

  useEffect(() => {
    if (user) {
      loadCategories();
      loadSettings();
    }
  }, [user]);

  const loadCategories = async () => {
    const { data } = await supabase
      .from('category_options')
      .select('*')
      .eq('owner_id', user!.id)
      .order('sort_order');
    const cats = (data || []) as CategoryOption[];
    setPersonalCats(cats.filter(c => c.mode === 'personal'));
    setBusinessCats(cats.filter(c => c.mode === 'business'));
  };

  const loadSettings = async () => {
    const { data } = await supabase
      .from('app_settings')
      .select('*')
      .eq('owner_id', user!.id)
      .maybeSingle();
    if (data) {
      setSettings({
        personal_auto_threshold: data.personal_auto_threshold,
        business_auto_threshold: data.business_auto_threshold,
        personal_suggest_threshold: data.personal_suggest_threshold,
        business_suggest_threshold: data.business_suggest_threshold,
        ai_enabled: data.ai_enabled,
        passcode_enabled: data.passcode_enabled,
      });
    }
  };

  const addCategory = async (mode: 'personal' | 'business', name: string) => {
    if (!name.trim()) return;
    const cats = mode === 'personal' ? personalCats : businessCats;
    await supabase.from('category_options').insert({
      mode, category_name: name.trim(), sort_order: cats.length, owner_id: user!.id,
    });
    if (mode === 'personal') setNewCatPersonal('');
    else setNewCatBusiness('');
    await loadCategories();
    toast.success(`Category "${name}" added`);
  };

  const deleteCategory = async (id: string) => {
    await supabase.from('category_options').delete().eq('id', id);
    await loadCategories();
  };

  const saveSettings = async () => {
    const { data: existing } = await supabase
      .from('app_settings')
      .select('id')
      .eq('owner_id', user!.id)
      .maybeSingle();

    if (existing) {
      await supabase.from('app_settings').update(settings).eq('id', existing.id);
    } else {
      await supabase.from('app_settings').insert({ ...settings, owner_id: user!.id });
    }
    toast.success('Settings saved');
  };

  const handleSeedImport = async (file: File, mode: 'personal' | 'business') => {
    if (mode === 'personal') setSeedingPersonal(true);
    else setSeedingBusiness(true);

    try {
      const parsed = await parseCsvFile(file);
      
      // Build merchant memory from historical data
      const merchantMap = new Map<string, { category: string; method: string | null; notes: string | null; raw: string; count: number }>();
      const categorySet = new Set<string>();

      for (const tx of parsed) {
        if (tx.category) {
          categorySet.add(tx.category);
          const key = tx.merchant_key;
          const existing = merchantMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            merchantMap.set(key, {
              category: tx.category,
              method: tx.method,
              notes: tx.notes,
              raw: tx.description_raw,
              count: 1,
            });
          }
        }
      }

      // Insert category options
      const existingCats = mode === 'personal' ? personalCats : businessCats;
      const existingNames = new Set(existingCats.map(c => c.category_name));
      const newCategories = [...categorySet].filter(c => !existingNames.has(c));
      
      if (newCategories.length > 0) {
        await supabase.from('category_options').insert(
          newCategories.map((name, i) => ({
            mode, category_name: name, sort_order: existingCats.length + i, owner_id: user!.id,
          }))
        );
      }

      // Insert merchant memory
      for (const [key, data] of merchantMap) {
        await updateMerchantMemory(key, mode, data.category, data.method, data.notes, data.raw, user!.id);
      }

      await loadCategories();
      toast.success(`Seeded ${merchantMap.size} merchants and ${newCategories.length} new categories from ${parsed.length} rows`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      if (mode === 'personal') setSeedingPersonal(false);
      else setSeedingBusiness(false);
    }
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
        <Input
          placeholder="New category..."
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          className="glass-input h-8 text-xs"
          onKeyDown={e => e.key === 'Enter' && addCategory(mode, newVal)}
        />
        <Button size="sm" className="h-8" onClick={() => addCategory(mode, newVal)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-8 animate-fade-in max-w-4xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage categories, thresholds, and import historical data</p>
        </div>

        <div className="space-y-6">
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
                <label className="text-xs text-muted-foreground">Personal Auto Threshold: {settings.personal_auto_threshold}%</label>
                <Slider value={[settings.personal_auto_threshold]} onValueChange={v => setSettings(s => ({ ...s, personal_auto_threshold: v[0] }))} max={100} min={50} step={5} />
                <label className="text-xs text-muted-foreground">Personal Suggest Threshold: {settings.personal_suggest_threshold}%</label>
                <Slider value={[settings.personal_suggest_threshold]} onValueChange={v => setSettings(s => ({ ...s, personal_suggest_threshold: v[0] }))} max={100} min={30} step={5} />
              </div>
              <div className="space-y-3">
                <label className="text-xs text-muted-foreground">Business Auto Threshold: {settings.business_auto_threshold}%</label>
                <Slider value={[settings.business_auto_threshold]} onValueChange={v => setSettings(s => ({ ...s, business_auto_threshold: v[0] }))} max={100} min={50} step={5} />
                <label className="text-xs text-muted-foreground">Business Suggest Threshold: {settings.business_suggest_threshold}%</label>
                <Slider value={[settings.business_suggest_threshold]} onValueChange={v => setSettings(s => ({ ...s, business_suggest_threshold: v[0] }))} max={100} min={30} step={5} />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <div className="flex items-center gap-2">
                <Switch checked={settings.ai_enabled} onCheckedChange={v => setSettings(s => ({ ...s, ai_enabled: v }))} />
                <label className="text-xs text-muted-foreground">AI Fallback Enabled</label>
              </div>
            </div>

            <Button size="sm" onClick={saveSettings}>Save Settings</Button>
          </div>

          {/* Historical Seed Import */}
          <div className="glass-panel p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">Import Historical CSV (Seed Data)</h3>
            <p className="text-xs text-muted-foreground mb-4">Import historical CSVs to build merchant memory and extract categories.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Personal Expenses CSV</label>
                <input
                  type="file"
                  accept=".csv"
                  disabled={seedingPersonal}
                  onChange={e => e.target.files?.[0] && handleSeedImport(e.target.files[0], 'personal')}
                  className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                />
                {seedingPersonal && <p className="text-xs text-primary mt-2 animate-pulse">Processing...</p>}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Business Expenses CSV</label>
                <input
                  type="file"
                  accept=".csv"
                  disabled={seedingBusiness}
                  onChange={e => e.target.files?.[0] && handleSeedImport(e.target.files[0], 'business')}
                  className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                />
                {seedingBusiness && <p className="text-xs text-primary mt-2 animate-pulse">Processing...</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
