import { useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ScanSearch, AlertTriangle } from 'lucide-react';
import type { UIMessage } from 'ai';

/**
 * Per-answer audit panel: reads the `_debug` blocks emitted by the deterministic
 * finance tools for a single assistant message and shows exactly how the number
 * was produced — parsed intent (function), date range, scope, rows used and any
 * data-quality warnings. Lets the owner verify the assistant never guessed.
 */

type AnyPart = UIMessage['parts'][number] & Record<string, any>;

interface AuditEntry {
  function: string;
  range?: { start?: string; end?: string; scope?: string };
  input?: any;
  rows?: number | null;
  warnings: string[];
  note?: string;
  extra?: Record<string, unknown>;
}

function fmtRange(range?: { start?: string; end?: string; scope?: string }, input?: any): string {
  const start = range?.start ?? input?.start_date;
  const end = range?.end ?? input?.end_date;
  const scope = range?.scope ?? input?.scope ?? input?.period;
  const r = start || end ? `${start ?? '…'} → ${end ?? 'today'}` : input?.period ?? 'all time';
  return scope ? `${r} · ${scope}` : r;
}

export function AnswerAudit({ message }: { message: UIMessage }) {
  const [open, setOpen] = useState(false);

  const entries = useMemo<AuditEntry[]>(() => {
    const out: AuditEntry[] = [];
    for (const part of (message.parts ?? []) as AnyPart[]) {
      const type = String(part.type ?? '');
      const isTool = type.startsWith('tool-') || type === 'dynamic-tool';
      if (!isTool) continue;
      const output = part.output;
      if (!output || typeof output !== 'object') continue;
      const dbg = (output as any)._debug ?? {};
      const fnName =
        dbg.function ||
        (type === 'dynamic-tool' ? part.toolName : type.replace(/^tool-/, ''));
      out.push({
        function: fnName,
        range: (output as any).range,
        input: part.input,
        rows:
          (output as any).transaction_count ??
          (output as any).total_transactions ??
          dbg.rows_included ??
          dbg.rows_loaded ??
          null,
        warnings: Array.isArray((output as any).warnings) ? (output as any).warnings : [],
        note: dbg.note,
        extra: dbg,
      });
    }
    return out;
  }, [message]);

  if (entries.length === 0) return null;

  const allWarnings = Array.from(new Set(entries.flatMap((e) => e.warnings)));

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ScanSearch className="h-3.5 w-3.5" />
        <span>Why this answer?</span>
        {allWarnings.length > 0 && (
          <Badge variant="secondary" className="gap-1 rounded-full px-1.5 py-0 text-[10px]">
            <AlertTriangle className="h-3 w-3 text-warning" />
            {allWarnings.length}
          </Badge>
        )}
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 rounded-lg border border-border/60 bg-secondary/20 p-3 text-xs space-y-3">
        <div className="space-y-2">
          {entries.map((e, i) => (
            <div key={i} className="rounded-md bg-background/40 p-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono font-medium text-foreground">{e.function}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{fmtRange(e.range, e.input)}</span>
                {e.rows != null && (
                  <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
                    {e.rows} rows
                  </Badge>
                )}
              </div>
              {e.note && <p className="mt-1 text-muted-foreground">{e.note}</p>}
            </div>
          ))}
        </div>

        {allWarnings.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">
              Data warnings
            </p>
            <ul className="space-y-1">
              {allWarnings.map((w, i) => (
                <li key={i} className="flex gap-1.5 text-warning-foreground/90">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-warning" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/70">
          Figures come from deterministic backend calculations — the assistant only narrates them.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
