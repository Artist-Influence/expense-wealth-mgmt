import { useState, useMemo } from 'react';
import { AppNav } from '@/components/AppNav';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  FileSpreadsheet, Download, Receipt, DollarSign,
  Landmark, PiggyBank, BarChart3
} from 'lucide-react';
import { toast } from 'sonner';

type ExportType = 'expense_ledger' | 'income_ledger' | 'tax_deductions' | 'tax_payments' | 'year_end_summary';

const exportTypes = [
  { id: 'expense_ledger' as ExportType, label: 'Expense Ledger', icon: Receipt, desc: 'Approved expenses with categories, modes, and flags' },
  { id: 'income_ledger' as ExportType, label: 'Income Ledger', icon: DollarSign, desc: 'All income transactions with type and taxable status' },
  { id: 'tax_deductions' as ExportType, label: 'Tax Deductions', icon: Landmark, desc: 'Tax-deductible expenses grouped by category' },
  { id: 'tax_payments' as ExportType, label: 'Tax Payments', icon: PiggyBank, desc: 'Tax payment transactions made' },
  { id: 'year_end_summary' as ExportType, label: 'Year-End Summary', icon: BarChart3, desc: 'Combined income, expenses, deductions, and net position' },
];

function getMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    options.push({ value: val, label: d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) });
  }
  return options;
}

function getQuarterOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const q = Math.floor(now.getMonth() / 3) - i;
    const year = now.getFullYear() + Math.floor(q / 4);
    const quarter = ((q % 4) + 4) % 4;
    const startMonth = quarter * 3;
    const start = `${year}-${String(startMonth + 1).padStart(2, '0')}`;
    const end = `${year}-${String(startMonth + 3).padStart(2, '0')}`;
    options.push({ value: `${start}:${end}`, label: `Q${quarter + 1} ${year}` });
  }
  return options;
}

function getYearOptions() {
  const now = new Date();
  return Array.from({ length: 5 }, (_, i) => {
    const y = now.getFullYear() - i;
    return { value: `${y}-01:${y}-12`, label: String(y) };
  });
}

function getDateRange(period: string, selection: string): { start: string; end: string } {
  if (period === 'month') {
    const [y, m] = selection.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
    return { start, end };
  }
  const [startPart, endPart] = selection.split(':');
  const [sy, sm] = startPart.split('-').map(Number);
  const [ey, em] = endPart.split('-').map(Number);
  const start = `${sy}-${String(sm).padStart(2, '0')}-01`;
  const lastDay = new Date(ey, em, 0).getDate();
  const end = `${ey}-${String(em).padStart(2, '0')}-${lastDay}`;
  return { start, end };
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Accountant() {
  const { user } = useAuth();
  const [selectedExport, setSelectedExport] = useState<ExportType>('expense_ledger');
  const [period, setPeriod] = useState('month');
  const [selection, setSelection] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [modeFilter, setModeFilter] = useState('all');

  const monthOptions = useMemo(getMonthOptions, []);
  const quarterOptions = useMemo(getQuarterOptions, []);
  const yearOptions = useMemo(getYearOptions, []);

  const dateRange = useMemo(() => getDateRange(period, selection), [period, selection]);

  const periodOptions = period === 'month' ? monthOptions : period === 'quarter' ? quarterOptions : yearOptions;

  // Reset selection when period changes
  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    if (p === 'month') setSelection(monthOptions[0].value);
    else if (p === 'quarter') setSelection(quarterOptions[0].value);
    else setSelection(yearOptions[0].value);
  };

  const { data: expenses } = useQuery({
    queryKey: ['accountant-expenses', user?.id, dateRange],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from('transactions_uploaded')
        .select('*')
        .eq('owner_id', user.id)
        .gte('date', dateRange.start)
        .lte('date', dateRange.end)
        .order('date');
      return data || [];
    },
    enabled: !!user,
  });

  const { data: income } = useQuery({
    queryKey: ['accountant-income', user?.id, dateRange],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from('income_transactions')
        .select('*')
        .eq('owner_id', user.id)
        .gte('date', dateRange.start)
        .lte('date', dateRange.end)
        .order('date');
      return data || [];
    },
    enabled: !!user,
  });


  // Only include approved/edited/auto_categorized expenses in exports
  const approvedStatuses = ['approved', 'auto_categorized', 'edited'];

  const filteredExpenses = useMemo(() => {
    if (!expenses) return [];
    // Exclude split parents — child rows carry the real amounts
    let result = expenses.filter(e => approvedStatuses.includes(e.review_status) && !e.is_split_parent);
    if (modeFilter === 'all') return result;
    return result.filter(e => e.transaction_mode === modeFilter);
  }, [expenses, modeFilter]);

  const taxDeductions = useMemo(() => filteredExpenses.filter(e => e.counts_as_tax_deduction), [filteredExpenses]);
  const taxPayments = useMemo(() => filteredExpenses.filter(e => e.treatment_type === 'tax_payment'), [filteredExpenses]);

  const previewData = useMemo(() => {
    switch (selectedExport) {
      case 'expense_ledger':
        return {
          headers: ['Date', 'Description', 'Amount', 'Category', 'Method', 'Mode', 'Transaction Mode', 'Transfer', 'Review Status', 'Notes'],
          rows: filteredExpenses.map(e => [e.date, e.description_normalized || e.description_raw, String(Math.abs(e.amount ?? 0)), e.final_category, e.final_method, e.mode, e.transaction_mode, e.is_transfer ? 'Yes' : 'No', e.review_status, e.final_notes]),
        };
      case 'income_ledger':
        return {
          headers: ['Date', 'Description', 'Amount', 'Income Type', 'Taxable', 'Source', 'Is Earning', 'Notes'],
          rows: (income || []).map(i => {
            const isEarning = !['transfer', 'refund', 'loan_proceeds', 'owner_contribution'].includes(i.income_type);
            return [i.date, i.description_normalized || i.description_raw, String(i.amount ?? 0), i.income_type, i.taxable_status, i.source_account_name, isEarning ? 'Yes' : 'No', i.notes];
          }),
        };
      case 'tax_deductions':
        return {
          headers: ['Date', 'Description', 'Amount', 'Category', 'Mode'],
          rows: taxDeductions.map(e => [e.date, e.description_normalized || e.description_raw, String(e.amount ?? 0), e.final_category, e.mode]),
        };
      case 'tax_payments':
        return {
          headers: ['Date', 'Description', 'Amount', 'Category', 'Notes'],
          rows: taxPayments.map(e => [e.date, e.description_normalized || e.description_raw, String(e.amount ?? 0), e.final_category, e.final_notes]),
        };
      case 'year_end_summary': {
        // Use only approved expenses, exclude transfers from net
        const approved = (expenses || []).filter(e => approvedStatuses.includes(e.review_status));
        const nonEarningTypes = ['transfer', 'refund', 'loan_proceeds', 'owner_contribution'];
        const totalInflows = (income || []).reduce((s, i) => s + (i.amount || 0), 0);
        const totalEarnedIncome = (income || []).filter(i => !nonEarningTypes.includes(i.income_type)).reduce((s, i) => s + (i.amount || 0), 0);
        const totalExpPersonal = approved.filter(e => e.transaction_mode === 'personal' && !e.is_transfer).reduce((s, e) => s + Math.abs(e.amount || 0), 0);
        const totalExpBusiness = approved.filter(e => e.transaction_mode === 'business' && !e.is_transfer).reduce((s, e) => s + Math.abs(e.amount || 0), 0);
        const totalTransfers = approved.filter(e => e.is_transfer).reduce((s, e) => s + Math.abs(e.amount || 0), 0);
        const totalDeductions = taxDeductions.reduce((s, e) => s + Math.abs(e.amount || 0), 0);
        const totalTaxPaid = taxPayments.reduce((s, e) => s + Math.abs(e.amount || 0), 0);
        return {
          headers: ['Metric', 'Amount'],
          rows: [
            ['Total Inflows (all sources)', totalInflows.toFixed(2)],
            ['Total Earned Income (excl. transfers/refunds)', totalEarnedIncome.toFixed(2)],
            ['Personal Expenses (excl. transfers)', totalExpPersonal.toFixed(2)],
            ['Business Expenses (excl. transfers)', totalExpBusiness.toFixed(2)],
            ['Transfers Excluded', totalTransfers.toFixed(2)],
            ['Tax Deductions', totalDeductions.toFixed(2)],
            ['Tax Payments Made', totalTaxPaid.toFixed(2)],
            ['Net Position (Earned Income - Personal - Business)', (totalEarnedIncome - totalExpPersonal - totalExpBusiness).toFixed(2)],
          ],
        };
      }
      default:
        return { headers: [], rows: [] };
    }
  }, [selectedExport, filteredExpenses, income, taxDeductions, taxPayments, expenses]);

  const handleDownload = () => {
    const exportLabel = exportTypes.find(e => e.id === selectedExport)?.label || selectedExport;
    const filename = `${exportLabel.replace(/\s+/g, '_')}_${selection}.csv`;
    downloadCsv(filename, previewData.headers, previewData.rows);
    toast.success(`Downloaded ${filename} (${previewData.rows.length} rows)`);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="container py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Accountant Exports</h1>
          <p className="text-sm text-muted-foreground">Generate clean, downloadable CSV reports for your accountant.</p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Period</label>
            <Select value={period} onValueChange={handlePeriodChange}>
              <SelectTrigger className="w-[120px] h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="quarter">Quarter</SelectItem>
                <SelectItem value="year">Year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Range</label>
            <Select value={selection} onValueChange={setSelection}>
              <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {periodOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(selectedExport === 'expense_ledger' || selectedExport === 'tax_deductions') && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Mode</label>
              <Select value={modeFilter} onValueChange={setModeFilter}>
                <SelectTrigger className="w-[120px] h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Export type cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {exportTypes.map(et => {
            const Icon = et.icon;
            const isActive = selectedExport === et.id;
            return (
              <Card
                key={et.id}
                className={`cursor-pointer transition-all hover:border-primary/40 ${isActive ? 'border-primary bg-primary/5' : ''}`}
                onClick={() => setSelectedExport(et.id)}
              >
                <CardContent className="p-3 text-center space-y-1.5">
                  <Icon className={`h-5 w-5 mx-auto ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                  <p className="text-xs font-medium text-foreground">{et.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{et.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Preview + Download */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">{exportTypes.find(e => e.id === selectedExport)?.label} Preview</CardTitle>
              <CardDescription className="text-xs">{previewData.rows.length} rows</CardDescription>
            </div>
            <Button size="sm" onClick={handleDownload} disabled={previewData.rows.length === 0} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </Button>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    {previewData.headers.map(h => <TableHead key={h} className="text-xs whitespace-nowrap">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.rows.length === 0 ? (
                    <TableRow><TableCell colSpan={previewData.headers.length} className="text-center text-xs text-muted-foreground py-8">No data for this period</TableCell></TableRow>
                  ) : previewData.rows.slice(0, 50).map((row, i) => (
                    <TableRow key={i}>
                      {row.map((cell, j) => <TableCell key={j} className="text-xs py-2">{cell ?? '—'}</TableCell>)}
                    </TableRow>
                  ))}
                  {previewData.rows.length > 50 && (
                    <TableRow><TableCell colSpan={previewData.headers.length} className="text-center text-xs text-muted-foreground py-2">Showing 50 of {previewData.rows.length} rows — full data in download</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
