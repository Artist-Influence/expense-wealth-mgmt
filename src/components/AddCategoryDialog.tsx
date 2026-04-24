import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface AddCategoryDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'personal' | 'business';
  existingCategories: string[];
  /** Called with the canonical name after successful insert. */
  onCreated: (newCategoryName: string) => void;
}

const MAX_LEN = 60;

export function AddCategoryDialog({ open, onClose, mode, existingCategories, onCreated }: AddCategoryDialogProps) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Category name cannot be empty');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      toast.error(`Category name must be ${MAX_LEN} characters or fewer`);
      return;
    }
    if (existingCategories.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('That category already exists');
      return;
    }
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('category_options').insert({
        owner_id: user.id,
        mode,
        category_name: trimmed,
        sort_order: existingCategories.length,
        is_active: true,
      });
      if (error) throw error;
      toast.success(`Added "${trimmed}" to ${mode} categories`);
      onCreated(trimmed);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add category');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add new category</DialogTitle>
          <DialogDescription>
            Adding to <span className="font-medium capitalize text-foreground">{mode}</span> categories.
            This will be available across the app.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Label htmlFor="new-category-name" className="text-xs text-muted-foreground uppercase tracking-wider">
            Category name
          </Label>
          <Input
            id="new-category-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="e.g. Coffee Shops"
            maxLength={MAX_LEN}
            className="mt-1"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Adding…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
