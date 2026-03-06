import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AppNav } from '@/components/AppNav';
import { User, Briefcase, FileText, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react';

interface DashboardStats {
  personalBatches: number;
  businessBatches: number;
  totalTransactions: number;
  needsReview: number;
  autoCategorized: number;
  approved: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    personalBatches: 0, businessBatches: 0, totalTransactions: 0,
    needsReview: 0, autoCategorized: 0, approved: 0,
  });

  useEffect(() => {
    if (!user) return;
    loadStats();
  }, [user]);

  const loadStats = async () => {
    const [batchesRes, txRes] = await Promise.all([
      supabase.from('upload_batches').select('mode').eq('owner_id', user!.id),
      supabase.from('transactions_uploaded').select('review_status, mode').eq('owner_id', user!.id),
    ]);

    const batches = batchesRes.data || [];
    const txs = txRes.data || [];

    setStats({
      personalBatches: batches.filter(b => b.mode === 'personal').length,
      businessBatches: batches.filter(b => b.mode === 'business').length,
      totalTransactions: txs.length,
      needsReview: txs.filter(t => t.review_status === 'needs_review' || t.review_status === 'suggested').length,
      autoCategorized: txs.filter(t => t.review_status === 'auto_categorized').length,
      approved: txs.filter(t => t.review_status === 'approved' || t.review_status === 'edited').length,
    });
  };

  const autoRate = stats.totalTransactions > 0
    ? Math.round(((stats.autoCategorized + stats.approved) / stats.totalTransactions) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-8 animate-fade-in">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Upload and categorize expenses</p>
        </div>

        {/* Mode Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Link to="/workspace/personal" className="glass-panel p-6 glow-hover group">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <h2 className="text-lg font-medium text-foreground">Personal Expenses</h2>
                </div>
                <p className="text-sm text-muted-foreground">Upload and manage personal expense CSVs</p>
              </div>
              <span className="text-xs font-mono text-muted-foreground">{stats.personalBatches} uploads</span>
            </div>
          </Link>

          <Link to="/workspace/business" className="glass-panel p-6 glow-hover group">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
                    <Briefcase className="h-5 w-5 text-accent" />
                  </div>
                  <h2 className="text-lg font-medium text-foreground">Business Expenses</h2>
                </div>
                <p className="text-sm text-muted-foreground">Upload and manage Artist Influence expenses</p>
              </div>
              <span className="text-xs font-mono text-muted-foreground">{stats.businessBatches} uploads</span>
            </div>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass-panel-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Rows</span>
            </div>
            <p className="text-2xl font-semibold font-mono text-foreground">{stats.totalTransactions.toLocaleString()}</p>
          </div>

          <div className="glass-panel-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground">Needs Review</span>
            </div>
            <p className="text-2xl font-semibold font-mono text-warning">{stats.needsReview.toLocaleString()}</p>
          </div>

          <div className="glass-panel-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-4 w-4 text-success" />
              <span className="text-xs text-muted-foreground">Approved</span>
            </div>
            <p className="text-2xl font-semibold font-mono text-success">{stats.approved.toLocaleString()}</p>
          </div>

          <div className="glass-panel-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Auto Rate</span>
            </div>
            <p className="text-2xl font-semibold font-mono text-primary">{autoRate}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}
