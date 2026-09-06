-- Phase 2A — Payment transaction ledger
-- Additive. Does not alter Stripe webhook columns or checkout RPCs.
-- Supports Worldpay, Bank Deposit, manual, PAY LATER, store credit, Stripe, etc.

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  parent_transaction_id uuid references public.payment_transactions(id) on delete set null,
  kind text not null,
  status text not null,
  gateway text,
  formatted_gateway text,
  amount numeric(14,2) not null,
  currency text not null default 'GBP',
  payment_id text,
  authorization_code text,
  error_code text,
  account_number_masked text,
  test boolean not null default false,
  manually_capturable boolean not null default false,
  processed_at timestamptz,
  source_created_at timestamptz,
  source_system text,
  external_gid text,
  external_legacy_id text,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_transactions_kind_chk check (char_length(trim(kind)) > 0),
  constraint payment_transactions_status_chk check (char_length(trim(status)) > 0)
);

comment on table public.payment_transactions is
  'Canonical money-movement ledger. kind examples: SALE, AUTHORIZATION, CAPTURE, VOID, REFUND. Gateway is free text (Worldpay eCommerce, Bank Deposit, manual, PAY LATER, stripe, …).';
comment on column public.payment_transactions.account_number_masked is
  'Masked account/card hint only. Never store PANs or Worldpay tokens.';

create index if not exists payment_transactions_order_id_idx
  on public.payment_transactions (order_id, processed_at);

create index if not exists payment_transactions_kind_status_idx
  on public.payment_transactions (kind, status);

create index if not exists payment_transactions_gateway_idx
  on public.payment_transactions (gateway)
  where gateway is not null;

create unique index if not exists payment_transactions_external_gid_uidx
  on public.payment_transactions (source_system, external_gid)
  where external_gid is not null and source_system is not null;

create index if not exists payment_transactions_payment_id_idx
  on public.payment_transactions (payment_id)
  where payment_id is not null;

drop trigger if exists trg_payment_transactions_updated_at on public.payment_transactions;
create trigger trg_payment_transactions_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

alter table public.payment_transactions enable row level security;

drop policy if exists "admin_select_payment_transactions" on public.payment_transactions;
create policy "admin_select_payment_transactions" on public.payment_transactions
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_payment_transactions" on public.payment_transactions;
create policy "admin_insert_payment_transactions" on public.payment_transactions
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_payment_transactions" on public.payment_transactions;
create policy "admin_update_payment_transactions" on public.payment_transactions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- No delete policy for authenticated — historical money rows should not be casually removed.
-- service_role may correct imports if required.

grant select, insert, update on public.payment_transactions to authenticated;
revoke delete on public.payment_transactions from authenticated;
revoke delete on public.payment_transactions from anon;
grant all on public.payment_transactions to service_role;

-- Customer can see transactions for their own orders (account history).
drop policy if exists "customer_read_own_payment_transactions" on public.payment_transactions;
create policy "customer_read_own_payment_transactions" on public.payment_transactions
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = payment_transactions.order_id
        and (
          o.user_id = (select auth.uid())
          or exists (
            select 1 from public.customers c
            where c.id = o.customer_id and c.auth_user_id = (select auth.uid())
          )
        )
    )
  );
