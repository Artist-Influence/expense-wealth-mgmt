import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Target } from 'lucide-react';

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function SetWealthTargetDialog({
  open,
  onOpenChange,
  currentAmount,
  currentYear,
  ytdContributed,
  currentBalance,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentAmount: number;
  currentYear: number;
  ytdContributed: number;
  currentBalance: number;
  onSave: (amount: number, year: number) => void;
  saving?: boolean;
}) {
  const [amount, setAmount] = useState<string>('');
  const [year, setYear] = useState<number>(currentYear || new Date().getFullYear());

  useEffect(() => {
    if (open) {
      setAmount(currentAmount > 0 ? String(currentAmount) : '');
      setYear(currentYear || new Date().getFullYear());
    }
  }, [open, currentAmount, currentYear]);

  const target = Number(amount) || 0;
  const remaining = Math.max(0, target - ytdContributed);
  const now = new Date();
  // Months remaining in the target year (inclusive of current month if year is current)
  const monthsLeft = (() => {
    if (year > now.getFullYear()) return (year - now.getFullYear()) * 12 + (12 - now.getMonth());
    if (year === now.getFullYear()) return Math.max(1, 12 - now.getMonth());
    return 0;
  })();
  const monthlyPace = monthsLeft > 0 ? remaining / monthsLeft : 0;

  const yearOptions = [now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2, now.getFullYear() + 3];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-4 gap-3">
        <DialogHeader className="space-y-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            End-of-Year Wealth Target
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Target amount</Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="e.g. 50000"
                className="h-8 text-sm"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Year</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-muted/30 p-2.5 space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Contributed YTD</span>
              <span className="text-foreground font-medium tabular-nums">{fmt(ytdContributed)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Current portfolio balance</span>
              <span className="text-foreground font-medium tabular-nums">{fmt(currentBalance)}</span>
            </div>
            {target > 0 && (
              <>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Remaining to target</span>
                  <span className={`font-medium tabular-nums ${remaining === 0 ? 'text-[hsl(var(--success))]' : 'text-foreground'}`}>
                    {fmt(remaining)}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Months left in {year}</span>
                  <span className="text-foreground font-medium tabular-nums">{monthsLeft}</span>
                </div>
                <div className="pt-1.5 mt-1.5 border-t border-border/50 flex justify-between text-xs">
                  <span className="text-muted-foreground">Monthly pace needed</span>
                  <span className="text-primary font-semibold tabular-nums">
                    {monthsLeft > 0 ? `${fmt(monthlyPace)}/mo` : '—'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => onSave(target, year)}
            disabled={saving || target < 0}
          >
            {saving ? 'Saving…' : 'Save target'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
