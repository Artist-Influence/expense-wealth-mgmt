-- Money taken OUT of an investment account (e.g. a Dub withdrawal to checking).
-- Wealth growth math needs these as dated negative flows; without them a
-- withdrawal reads as a loss. Logged by hand on the Wealth card, or captured
-- at import when an investment platform's ACH credit lands in checking.
create table public.investment_withdrawals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  account_id uuid not null references public.investment_accounts(id) on delete cascade,
  date date not null,
  amount numeric not null check (amount > 0),
  note text,
  source text not null default 'manual' check (source in ('manual', 'import')),
  source_file_name text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.investment_withdrawals enable row level security;

-- Same access as account_balance_snapshots: owner full, accountant delegate read.
create policy owner_all on public.investment_withdrawals
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy delegated_accountant_read on public.investment_withdrawals
  for select to authenticated
  using (public.has_delegated_access(auth.uid(), owner_id, 'accountant'::app_role));

create index idx_iw_account_date on public.investment_withdrawals(account_id, date);
create index idx_iw_owner on public.investment_withdrawals(owner_id);
