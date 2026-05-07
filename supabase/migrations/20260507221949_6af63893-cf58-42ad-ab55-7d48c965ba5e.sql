
CREATE POLICY "Accountant read transactions"
ON public.transactions_uploaded FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read income"
ON public.income_transactions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read merchant_memory"
ON public.merchant_memory FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read category_options"
ON public.category_options FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read categorization_rules"
ON public.categorization_rules FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read app_settings"
ON public.app_settings FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read investment_accounts"
ON public.investment_accounts FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read account_balance_snapshots"
ON public.account_balance_snapshots FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read allocation_plans"
ON public.allocation_plans FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read allocation_line_items"
ON public.allocation_line_items FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read tax_profiles"
ON public.tax_profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read reimbursement_groups"
ON public.reimbursement_groups FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read upload_batches"
ON public.upload_batches FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));

CREATE POLICY "Accountant read profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'accountant'));
