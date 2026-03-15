import { AppNav } from '@/components/AppNav';
import { Construction } from 'lucide-react';

export default function Income() {
  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-12 flex flex-col items-center justify-center gap-4 text-center">
        <Construction className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-semibold text-foreground">Income</h1>
        <p className="text-muted-foreground text-sm max-w-md">
          Track inflows, classify payroll vs business revenue vs reimbursements, and understand what's actually available to save or invest.
        </p>
        <span className="text-xs text-muted-foreground/60 font-mono">Coming in Phase 3</span>
      </div>
    </div>
  );
}
