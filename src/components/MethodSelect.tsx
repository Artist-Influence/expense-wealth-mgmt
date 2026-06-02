import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { List } from 'lucide-react';
import type { PaymentMethod } from '@/hooks/usePaymentMethods';

const NONE = '__none__';
const CUSTOM = '__custom__';

interface MethodSelectProps {
  value: string;
  /** Called when the user picks a saved method, clears it, or commits a custom value. */
  onChange: (value: string) => void;
  methods: PaymentMethod[];
  /** When set, only methods matching this mode are shown (falls back to all if none match). */
  mode?: string;
  className?: string;
  placeholder?: string;
  /** Allow selecting "no method". Defaults to true. */
  allowNone?: boolean;
}

/**
 * Dropdown of the owner's saved payment methods with a "Custom…" escape hatch
 * that lets the user type a free-text value (committed on blur / Enter).
 */
export function MethodSelect({
  value,
  onChange,
  methods,
  mode,
  className,
  placeholder = 'Select method',
  allowNone = true,
}: MethodSelectProps) {
  const modeFiltered = mode ? methods.filter(m => m.mode === mode) : methods;
  const filtered = modeFiltered.length > 0 ? modeFiltered : methods;
  const names = filtered.map(m => m.name);
  const valueIsKnown = !value || names.includes(value);

  const [customMode, setCustomMode] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  if (customMode) {
    const commit = () => {
      setCustomMode(false);
      onChange(draft.trim());
    };
    return (
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            else if (e.key === 'Escape') { setDraft(value); setCustomMode(false); }
          }}
          placeholder="Custom method"
          className={className}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onMouseDown={e => { e.preventDefault(); setDraft(value); setCustomMode(false); }}
          title="Back to list"
        >
          <List className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value || (allowNone ? NONE : undefined)}
      onValueChange={v => {
        if (v === CUSTOM) { setDraft(value); setCustomMode(true); return; }
        if (v === NONE) { onChange(''); return; }
        onChange(v);
      }}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>—</SelectItem>}
        {filtered.map(m => (
          <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
        ))}
        {!valueIsKnown && value && (
          <SelectItem value={value}>{value}</SelectItem>
        )}
        <SelectItem value={CUSTOM} className="text-primary font-medium border-t border-border mt-1 pt-1.5">
          + Custom…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
