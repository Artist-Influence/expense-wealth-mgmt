import { AppNav } from '@/components/AppNav';
import { Construction } from 'lucide-react';

export default function Reimbursements() {
  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-12 flex flex-col items-center justify-center gap-4 text-center">
        <Construction className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-semibold text-foreground">Reimbursements</h1>
        <p className="text-muted-foreground text-sm max-w-md">
          Track money you fronted for work, submit expense reports, and match incoming reimbursement payments.
        </p>
        <span className="text-xs text-muted-foreground/60 font-mono">Coming in Phase 2</span>
      </div>
    </div>
  );
}
