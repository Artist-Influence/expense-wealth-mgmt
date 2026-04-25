create table public.account_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  account_id uuid not null references public.investment_accounts(id) on delete cascade,
  as_of_date date not null,
  balance numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, as_of_date)
);

alter table public.account_balance_snapshots enable row level security;

create policy "Owner access account_balance_snapshots"
  on public.account_balance_snapshots
  for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index idx_abs_account_date on public.account_balance_snapshots(account_id, as_of_date);
create index idx_abs_owner on public.account_balance_snapshots(owner_id);

create trigger trg_abs_updated_at
  before update on public.account_balance_snapshots
  for each row execute function public.update_updated_at_column();