import { useEffect } from 'react';

export type ModeScope = 'personal' | 'business' | 'all';

interface Props {
  value: ModeScope;
  onChange: (v: ModeScope) => void;
  allowAll?: boolean;
  storageKey?: string;
  className?: string;
}

/**
 * Shared Personal / Business / All segmented toggle.
 * Pass a `storageKey` to auto-persist the choice across sessions.
 */
export function ModeScopeToggle({
  value,
  onChange,
  allowAll = true,
  storageKey,
  className = '',
}: Props) {
  // Persist on change
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, value);
    }
  }, [value, storageKey]);

  const opts: { key: ModeScope; label: string }[] = [
    { key: 'personal', label: 'Personal' },
    { key: 'business', label: 'Business' },
    ...(allowAll ? [{ key: 'all' as ModeScope, label: 'All' }] : []),
  ];

  return (
    <div
      className={`inline-flex items-center rounded-md border border-border/50 bg-secondary/50 p-0.5 ${className}`}
    >
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            value === o.key
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Read a persisted scope from localStorage, defaulting to `personal`. */
export function readPersistedScope(
  storageKey: string,
  fallback: ModeScope = 'personal',
): ModeScope {
  if (typeof window === 'undefined') return fallback;
  const v = localStorage.getItem(storageKey);
  if (v === 'personal' || v === 'business' || v === 'all') return v;
  return fallback;
}
