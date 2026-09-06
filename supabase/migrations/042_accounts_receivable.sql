-- Phase 2B — Accounts receivable / credit-account foundation
-- Models open AR (~£1.11M in Shopify) without a full payment-schedule engine.
-- Additive. Does not replace orders.total_outstanding (denormalized cache on order).

-- ── AR account (company-preferred; customer fallback) ───────────────────────
create table if not exists public.ar_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'open',
  currency text not null default 'GBP',
  credit_limit numeric(14,2),
  current_balance numeric(14,2) not null default 0,
  overdue_balance numeric(14,2) not null default 0,
  payment_terms_label text,
  payment_terms_due_in_days int,
  cg_assigned_id uuid references public.staff_members(id) on delete set null,
  notes text,
  source_system text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ar_accounts_owner_chk check (
    company_id is not null or customer_id is not null
  )
);

comment on table public.ar_accounts is
  'Trade credit / AR account. Prefer company_id for B2B; customer_id for person-only accounts. Balances are operational caches — rebuild from ar_entries + orders when needed.';

create unique index if not exists ar_accounts_company_uidx
  on public.ar_accounts (company_id)
  where company_id is not null;

create unique index if not exists ar_accounts_customer_only_uidx
  on public.ar_accounts (customer_id)
  where company_id is null and customer_id is not null;

create index if not exists ar_accounts_status_idx
  on public.ar_accounts (status);

create index if not exists ar_accounts_cg_assigned_id_idx
  on public.ar_accounts (cg_assigned_id)
  where cg_assigned_id is not null;

drop trigger if exists trg_ar_accounts_updated_at on public.ar_accounts;
create trigger trg_ar_accounts_updated_at
  before update on public.ar_accounts
  for each row execute function public.set_updated_at();

alter table public.ar_accounts enable row level security;

drop policy if exists "admin_all_ar_accounts" on public.ar_accounts;
create policy "admin_all_ar_accounts" on public.ar_accounts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.ar_accounts to authenticated;
grant all on public.ar_accounts to service_role;

-- ── AR ledger entries (open invoice, payment applied, adjustment, write-off) ─
create table if not exists public.ar_entries (
  id uuid primary key default gen_random_uuid(),
  ar_account_id uuid not null references public.ar_accounts(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  payment_transaction_id uuid references public.payment_transactions(id) on delete set null,
  entry_type text not null,
  amount numeric(14,2) not null,
  currency text not null default 'GBP',
  -- Positive amount increases receivable (invoice); negative decreases (payment/credit).
  direction text not null default 'debit',
  due_on date,
  occurred_at timestamptz not null default now(),
  memo text,
  source_system text,
  external_gid text,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ar_entries_entry_type_chk check (char_length(trim(entry_type)) > 0),
  constraint ar_entries_direction_chk check (direction in ('debit', 'credit'))
);

comment on table public.ar_entries is
  'AR movement log. entry_type examples: invoice_open, payment_applied, refund_credit, adjustment, write_off. Not a full payment-schedule engine.';
comment on column public.ar_entries.direction is
  'debit = increases AR balance; credit = decreases AR balance.';

create index if not exists ar_entries_account_occurred_idx
  on public.ar_entries (ar_account_id, occurred_at);

create index if not exists ar_entries_order_id_idx
  on public.ar_entries (order_id)
  where order_id is not null;

create index if not exists ar_entries_due_on_idx
  on public.ar_entries (due_on)
  where due_on is not null;

create unique index if not exists ar_entries_external_gid_uidx
  on public.ar_entries (source_system, external_gid)
  where external_gid is not null and source_system is not null;

alter table public.ar_entries enable row level security;

drop policy if exists "admin_select_ar_entries" on public.ar_entries;
create policy "admin_select_ar_entries" on public.ar_entries
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_ar_entries" on public.ar_entries;
create policy "admin_insert_ar_entries" on public.ar_entries
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_ar_entries" on public.ar_entries;
create policy "admin_update_ar_entries" on public.ar_entries
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Prefer correcting via new adjusting entries; delete only for import repair.
drop policy if exists "admin_delete_ar_entries" on public.ar_entries;
create policy "admin_delete_ar_entries" on public.ar_entries
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.ar_entries to authenticated;
grant all on public.ar_entries to service_role;

-- ── Order-level money helpers for credit workflows ──────────────────────────
alter table public.orders
  add column if not exists payment_due_on date,
  add column if not exists payment_gateway_names text[] not null default '{}'::text[],
  add column if not exists ar_account_id uuid references public.ar_accounts(id) on delete set null;

comment on column public.orders.payment_due_on is
  'Optional due date (from metafield order.payment_due_date or future terms). Sparse in Shopify history.';
comment on column public.orders.payment_gateway_names is
  'Snapshot of gateways listed on the order (Worldpay, Bank Deposit, …).';
comment on column public.orders.ar_account_id is
  'Optional link to the AR account carrying this order''s receivable.';

create index if not exists orders_payment_due_on_idx
  on public.orders (payment_due_on)
  where payment_due_on is not null;

create index if not exists orders_ar_account_id_idx
  on public.orders (ar_account_id)
  where ar_account_id is not null;

create index if not exists orders_total_outstanding_idx
  on public.orders (total_outstanding)
  where total_outstanding > 0;
