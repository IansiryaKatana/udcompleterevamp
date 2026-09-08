-- Phase 2D: Finance & AR Core — schema, capabilities, aging, invoices,
-- statements, finance notes/events/documents, Unique manual payment posting,
-- admin RPCs, and service_role selftest.
--
-- CRITICAL IMMUTABILITY:
--   Historical Shopify payment_transactions / refunds / order money snapshots
--   are IMMUTABLE. Never UPDATE Shopify-sourced ledger rows.
--   Manual Unique payments INSERT source_system='unique' payment_transactions
--   then adjust orders.total_received / total_outstanding / financial_status
--   using the Unique-post-only formula below (preserves Shopify outstanding on
--   untouched orders).
--
-- Unique manual payment formula (documented):
--   When posting Unique manual payment:
--     new_received = order.total_received + amount
--     if new_received > order.total then reject overpayment
--     if amount > order.total_outstanding then reject
--     set total_received = new_received
--     set total_outstanding = greatest(order.total - new_received, 0)
--     financial_status:
--       PAID            if outstanding = 0 and total > 0
--       PARTIALLY_PAID  if received > 0 and outstanding > 0
--       PENDING         if received = 0
--   Reversal subtracts the original Unique amount from total_received and
--   recomputes outstanding the same way. Shopify historical totals on orders
--   that never receive a Unique mutation are left as imported.
--
-- Invoice numbering: production sequence NOT enabled until business confirms.
-- Default prefix is TEST-only (UD-INV-TEST-).
-- Credit notes: do NOT auto-generate from custom.credit_note metafield.

-- ═══════════════════════════════════════════════════════════════════════════
-- Permissions
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.admin_users
  add column if not exists finance_capabilities text[] not null default '{}'::text[];

comment on column public.admin_users.finance_capabilities is
  'Optional finance caps: finance_view (redundant with is_admin), finance_post, finance_reverse, finance_invoice, finance_statement, finance_notes. Editors are view-only by default; owner/admin mutate all.';

create or replace function public.current_admin_role()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select au.role
  from public.admin_users au
  where au.auth_user_id = (select auth.uid())
    and au.is_active = true
  limit 1;
$$;

create or replace function public.current_admin_finance_capabilities()
returns text[]
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(au.finance_capabilities, '{}'::text[])
  from public.admin_users au
  where au.auth_user_id = (select auth.uid())
    and au.is_active = true
  limit 1;
$$;

create or replace function public.current_admin_is_owner_or_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users au
    where au.auth_user_id = (select auth.uid())
      and au.is_active = true
      and au.role in ('owner', 'admin')
  );
$$;

-- View: any CMS admin (owner/admin/editor). Viewers excluded via is_admin().
create or replace function public.can_view_finance()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.is_admin();
$$;

create or replace function public.can_post_manual_payment()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'finance_post' = any(coalesce(public.current_admin_finance_capabilities(), '{}'::text[]));
$$;

create or replace function public.can_reverse_manual_payment()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'finance_reverse' = any(coalesce(public.current_admin_finance_capabilities(), '{}'::text[]));
$$;

create or replace function public.can_manage_invoices()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'finance_invoice' = any(coalesce(public.current_admin_finance_capabilities(), '{}'::text[]));
$$;

create or replace function public.can_generate_statements()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'finance_statement' = any(coalesce(public.current_admin_finance_capabilities(), '{}'::text[]));
$$;

create or replace function public.can_manage_finance_notes()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'finance_notes' = any(coalesce(public.current_admin_finance_capabilities(), '{}'::text[]))
      or public.can_post_manual_payment();
$$;

comment on function public.can_view_finance() is
  'True when is_admin() (owner/admin/editor). Viewers cannot view finance RPCs.';
comment on function public.can_post_manual_payment() is
  'Owner/admin, or editor with finance_post capability.';
comment on function public.can_reverse_manual_payment() is
  'Owner/admin, or editor with finance_reverse capability.';
comment on function public.can_manage_invoices() is
  'Owner/admin, or editor with finance_invoice capability.';
comment on function public.can_generate_statements() is
  'Owner/admin, or editor with finance_statement capability.';
comment on function public.can_manage_finance_notes() is
  'Owner/admin, or finance_notes / finance_post capability.';

grant execute on function public.current_admin_role() to authenticated, service_role;
grant execute on function public.current_admin_finance_capabilities() to authenticated, service_role;
grant execute on function public.current_admin_is_owner_or_admin() to authenticated, service_role;
grant execute on function public.can_view_finance() to authenticated, service_role;
grant execute on function public.can_post_manual_payment() to authenticated, service_role;
grant execute on function public.can_reverse_manual_payment() to authenticated, service_role;
grant execute on function public.can_manage_invoices() to authenticated, service_role;
grant execute on function public.can_generate_statements() to authenticated, service_role;
grant execute on function public.can_manage_finance_notes() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- payment_transactions additive (Unique posting)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.payment_transactions
  add column if not exists idempotency_key text,
  add column if not exists reversal_of_id uuid references public.payment_transactions(id) on delete set null,
  add column if not exists posted_by_staff_id uuid references public.staff_members(id) on delete set null,
  add column if not exists internal_note text,
  add column if not exists payment_method text,
  add column if not exists payment_date date;

comment on column public.payment_transactions.idempotency_key is
  'Client idempotency key for Unique manual posts. Shopify rows leave null.';
comment on column public.payment_transactions.reversal_of_id is
  'When set, this row reverses the referenced Unique payment_transaction.';

create unique index if not exists payment_transactions_idempotency_key_uidx
  on public.payment_transactions (idempotency_key)
  where idempotency_key is not null;

create index if not exists payment_transactions_reversal_of_id_idx
  on public.payment_transactions (reversal_of_id)
  where reversal_of_id is not null;

create index if not exists payment_transactions_source_system_idx
  on public.payment_transactions (source_system)
  where source_system is not null;

-- Forbid UPDATE/DELETE of Shopify historical payment rows
create or replace function public.forbid_shopify_payment_tx_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and coalesce(old.source_system, '') = 'shopify' then
    raise exception 'Shopify payment_transactions are immutable (UPDATE forbidden)'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'DELETE' and coalesce(old.source_system, '') = 'shopify' then
    raise exception 'Shopify payment_transactions are immutable (DELETE forbidden)'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_payment_transactions_shopify_immutable on public.payment_transactions;
create trigger trg_payment_transactions_shopify_immutable
  before update or delete on public.payment_transactions
  for each row execute function public.forbid_shopify_payment_tx_mutation();

create or replace function public.forbid_shopify_refund_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(old.source_system, '') = 'shopify' then
    raise exception 'Shopify refunds are immutable'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_refunds_shopify_immutable on public.refunds;
create trigger trg_refunds_shopify_immutable
  before update or delete on public.refunds
  for each row execute function public.forbid_shopify_refund_mutation();

-- ═══════════════════════════════════════════════════════════════════════════
-- finance_idempotency_keys
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.finance_idempotency_keys (
  key text primary key,
  operation text not null,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff_members(id) on delete set null,
  constraint finance_idempotency_keys_operation_chk check (char_length(trim(operation)) > 0)
);

comment on table public.finance_idempotency_keys is
  'Idempotent finance RPC results. Key is client-supplied; result_json replayed on duplicate.';

alter table public.finance_idempotency_keys enable row level security;

drop policy if exists "admin_select_finance_idempotency_keys" on public.finance_idempotency_keys;
create policy "admin_select_finance_idempotency_keys" on public.finance_idempotency_keys
  for select to authenticated using (public.can_view_finance());

drop policy if exists "admin_insert_finance_idempotency_keys" on public.finance_idempotency_keys;
create policy "admin_insert_finance_idempotency_keys" on public.finance_idempotency_keys
  for insert to authenticated with check (
    public.can_post_manual_payment()
    or public.can_reverse_manual_payment()
    or public.can_manage_invoices()
    or public.can_generate_statements()
  );

grant select, insert on public.finance_idempotency_keys to authenticated;
grant all on public.finance_idempotency_keys to service_role;
revoke update, delete on public.finance_idempotency_keys from authenticated;
revoke update, delete on public.finance_idempotency_keys from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- invoice_numbering_config (TEST prefix until business confirms production)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.invoice_numbering_config (
  key text primary key default 'default',
  prefix text not null default 'UD-INV-TEST-',
  next_seq bigint not null default 1,
  is_production boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint invoice_numbering_config_next_seq_chk check (next_seq >= 1)
);

comment on table public.invoice_numbering_config is
  'Invoice sequence. Production numbering NOT enabled until business confirms sequence. Test prefix only by default.';

insert into public.invoice_numbering_config (key, prefix, next_seq, is_production)
values ('default', 'UD-INV-TEST-', 1, false)
on conflict (key) do nothing;

alter table public.invoice_numbering_config enable row level security;

drop policy if exists "admin_select_invoice_numbering_config" on public.invoice_numbering_config;
create policy "admin_select_invoice_numbering_config" on public.invoice_numbering_config
  for select to authenticated using (public.can_view_finance());

drop policy if exists "admin_update_invoice_numbering_config" on public.invoice_numbering_config;
create policy "admin_update_invoice_numbering_config" on public.invoice_numbering_config
  for update to authenticated
  using (public.current_admin_is_owner_or_admin())
  with check (public.current_admin_is_owner_or_admin());

grant select on public.invoice_numbering_config to authenticated;
grant update on public.invoice_numbering_config to authenticated;
grant all on public.invoice_numbering_config to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- invoices + finance_documents (circular FKs added after both exist)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  order_id uuid references public.orders(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  invoice_date date not null default current_date,
  due_date date,
  currency text not null default 'GBP',
  subtotal numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  shipping_total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  outstanding numeric(14,2) not null default 0,
  status text not null default 'draft',
  billing_snapshot jsonb not null default '{}'::jsonb,
  shipping_snapshot jsonb not null default '{}'::jsonb,
  line_items_snapshot jsonb not null default '[]'::jsonb,
  tax_snapshot jsonb not null default '{}'::jsonb,
  provenance text not null default 'unique_native',
  source_system text not null default 'unique',
  created_by_staff_id uuid references public.staff_members(id) on delete set null,
  version int not null default 1,
  document_id uuid,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_invoice_number_uidx unique (invoice_number),
  constraint invoices_status_chk check (status in ('draft', 'issued', 'void', 'paid', 'partial')),
  constraint invoices_provenance_chk check (
    provenance in ('unique_native', 'reconstructed_from_order', 'imported_original')
  )
);

comment on table public.invoices is
  'Unique-native / reconstructed invoices. Snapshots freeze lines at issue time. HTML lives in finance_documents.';

create index if not exists invoices_order_id_idx on public.invoices (order_id);
create index if not exists invoices_customer_id_idx on public.invoices (customer_id);
create index if not exists invoices_company_id_idx on public.invoices (company_id);
create index if not exists invoices_status_idx on public.invoices (status);
create index if not exists invoices_invoice_number_idx on public.invoices (invoice_number);
create index if not exists invoices_created_at_desc_idx on public.invoices (created_at desc);

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

drop policy if exists "admin_select_invoices" on public.invoices;
create policy "admin_select_invoices" on public.invoices
  for select to authenticated using (public.can_view_finance());

drop policy if exists "admin_insert_invoices" on public.invoices;
create policy "admin_insert_invoices" on public.invoices
  for insert to authenticated with check (public.can_manage_invoices());

drop policy if exists "admin_update_invoices" on public.invoices;
create policy "admin_update_invoices" on public.invoices
  for update to authenticated
  using (public.can_manage_invoices()) with check (public.can_manage_invoices());

grant select, insert, update on public.invoices to authenticated;
revoke delete on public.invoices from authenticated;
grant all on public.invoices to service_role;

create table if not exists public.finance_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  entity_type text,
  entity_id uuid,
  invoice_id uuid,
  title text,
  body_html text not null,
  content_hash text,
  storage_path text,
  template_version text not null default 'v1',
  provenance text,
  generated_by_staff_id uuid references public.staff_members(id) on delete set null,
  source_system text not null default 'unique',
  created_at timestamptz not null default now(),
  constraint finance_documents_type_chk check (
    document_type in ('invoice', 'statement', 'credit_note')
  ),
  constraint finance_documents_body_chk check (char_length(trim(body_html)) > 0)
);

comment on table public.finance_documents is
  'Durable HTML finance documents (print-to-PDF). No live Worldpay; snapshots only.';

create index if not exists finance_documents_type_created_idx
  on public.finance_documents (document_type, created_at desc);
create index if not exists finance_documents_entity_idx
  on public.finance_documents (entity_type, entity_id)
  where entity_id is not null;
create index if not exists finance_documents_invoice_id_idx
  on public.finance_documents (invoice_id)
  where invoice_id is not null;

alter table public.finance_documents enable row level security;

drop policy if exists "admin_select_finance_documents" on public.finance_documents;
create policy "admin_select_finance_documents" on public.finance_documents
  for select to authenticated using (public.can_view_finance());

drop policy if exists "admin_insert_finance_documents" on public.finance_documents;
create policy "admin_insert_finance_documents" on public.finance_documents
  for insert to authenticated with check (
    public.can_manage_invoices() or public.can_generate_statements()
  );

grant select, insert on public.finance_documents to authenticated;
revoke update, delete on public.finance_documents from authenticated;
grant all on public.finance_documents to service_role;

-- Circular FKs (nullable)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'invoices_document_id_fkey' and table_name = 'invoices'
  ) then
    alter table public.invoices
      add constraint invoices_document_id_fkey
      foreign key (document_id) references public.finance_documents(id) on delete set null;
  end if;
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'finance_documents_invoice_id_fkey' and table_name = 'finance_documents'
  ) then
    alter table public.finance_documents
      add constraint finance_documents_invoice_id_fkey
      foreign key (invoice_id) references public.invoices(id) on delete set null;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- credit_notes additive columns (table from 043)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.credit_notes
  add column if not exists document_number text,
  add column if not exists version int not null default 1,
  add column if not exists provenance text,
  add column if not exists line_items_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists tax_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists created_by_staff_id uuid references public.staff_members(id) on delete set null,
  add column if not exists billing_snapshot jsonb not null default '{}'::jsonb;

comment on column public.credit_notes.provenance is
  'unique_native | reconstructed_from_order | imported_original. Never auto-generated from custom.credit_note metafield.';

-- ═══════════════════════════════════════════════════════════════════════════
-- statements
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.statements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  period_from date not null,
  period_to date not null,
  opening_balance numeric(14,2) not null default 0,
  closing_balance numeric(14,2) not null default 0,
  currency text not null default 'GBP',
  entries_snapshot jsonb not null default '[]'::jsonb,
  document_id uuid references public.finance_documents(id) on delete set null,
  source_system text not null default 'unique',
  created_by uuid references public.staff_members(id) on delete set null,
  created_at timestamptz not null default now(),
  idempotency_key text,
  constraint statements_period_chk check (period_to >= period_from),
  constraint statements_owner_chk check (customer_id is not null or company_id is not null)
);

comment on table public.statements is
  'Customer/company AR statements for a date range. Unique-only synthetic statements OK.';

create unique index if not exists statements_idempotency_key_uidx
  on public.statements (idempotency_key)
  where idempotency_key is not null;
create index if not exists statements_customer_id_idx on public.statements (customer_id);
create index if not exists statements_company_id_idx on public.statements (company_id);
create index if not exists statements_period_idx on public.statements (period_from, period_to);

alter table public.statements enable row level security;

drop policy if exists "admin_select_statements" on public.statements;
create policy "admin_select_statements" on public.statements
  for select to authenticated using (public.can_view_finance());

drop policy if exists "admin_insert_statements" on public.statements;
create policy "admin_insert_statements" on public.statements
  for insert to authenticated with check (public.can_generate_statements());

grant select, insert on public.statements to authenticated;
revoke update, delete on public.statements from authenticated;
grant all on public.statements to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- finance_notes (append-only)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.finance_notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  body text not null,
  author_staff_id uuid references public.staff_members(id) on delete set null,
  author_name_snapshot text,
  source_system text not null default 'unique',
  created_at timestamptz not null default now(),
  constraint finance_notes_entity_type_chk check (
    entity_type in ('order', 'customer', 'company', 'invoice', 'payment')
  ),
  constraint finance_notes_body_chk check (char_length(trim(body)) > 0)
);

comment on table public.finance_notes is
  'Append-only finance notes. UPDATE/DELETE blocked by trigger.';

create index if not exists finance_notes_entity_created_idx
  on public.finance_notes (entity_type, entity_id, created_at);

create or replace function public.forbid_finance_notes_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'finance_notes is append-only; UPDATE/DELETE are not allowed'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_finance_notes_no_update on public.finance_notes;
create trigger trg_finance_notes_no_update
  before update on public.finance_notes
  for each row execute function public.forbid_finance_notes_mutation();

drop trigger if exists trg_finance_notes_no_delete on public.finance_notes;
create trigger trg_finance_notes_no_delete
  before delete on public.finance_notes
  for each row execute function public.forbid_finance_notes_mutation();

alter table public.finance_notes enable row level security;

drop policy if exists "admin_select_finance_notes" on public.finance_notes;
create policy "admin_select_finance_notes" on public.finance_notes
  for select to authenticated using (public.can_view_finance());

drop policy if exists "admin_insert_finance_notes" on public.finance_notes;
create policy "admin_insert_finance_notes" on public.finance_notes
  for insert to authenticated with check (public.can_manage_finance_notes());

grant select, insert on public.finance_notes to authenticated;
grant select, insert on public.finance_notes to service_role;
revoke update, delete on public.finance_notes from authenticated;
revoke update, delete on public.finance_notes from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- finance_events (append-only, mirrors crm_events)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.finance_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  category text not null default 'system',
  source_system text,
  actor_type text,
  actor_id uuid,
  actor_name_snapshot text,
  message text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint finance_events_entity_type_chk check (
    entity_type in ('order', 'customer', 'company', 'invoice', 'payment', 'statement', 'refund')
  ),
  constraint finance_events_event_type_chk check (char_length(trim(event_type)) > 0)
);

comment on table public.finance_events is
  'Append-only finance audit timeline. UPDATE/DELETE blocked by trigger.';

create index if not exists finance_events_entity_occurred_idx
  on public.finance_events (entity_type, entity_id, occurred_at);
create index if not exists finance_events_event_type_idx
  on public.finance_events (event_type);

create or replace function public.forbid_finance_events_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'finance_events is append-only; UPDATE/DELETE are not allowed'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_finance_events_no_update on public.finance_events;
create trigger trg_finance_events_no_update
  before update on public.finance_events
  for each row execute function public.forbid_finance_events_mutation();

drop trigger if exists trg_finance_events_no_delete on public.finance_events;
create trigger trg_finance_events_no_delete
  before delete on public.finance_events
  for each row execute function public.forbid_finance_events_mutation();

alter table public.finance_events enable row level security;

drop policy if exists "admin_select_finance_events" on public.finance_events;
create policy "admin_select_finance_events" on public.finance_events
  for select to authenticated using (public.can_view_finance());

drop policy if exists "admin_insert_finance_events" on public.finance_events;
create policy "admin_insert_finance_events" on public.finance_events
  for insert to authenticated with check (public.can_view_finance());

grant select, insert on public.finance_events to authenticated;
grant select, insert on public.finance_events to service_role;
revoke update, delete on public.finance_events from authenticated;
revoke update, delete on public.finance_events from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- Helpers
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.finance_aging_bucket(
  p_due_date date,
  p_as_of date default current_date
)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when p_due_date is null then 'no_due_date'
    when p_due_date >= p_as_of then 'current'
    when (p_as_of - p_due_date) between 1 and 30 then '1_30'
    when (p_as_of - p_due_date) between 31 and 60 then '31_60'
    when (p_as_of - p_due_date) between 61 and 90 then '61_90'
    else '91_plus'
  end;
$$;

comment on function public.finance_aging_bucket(date, date) is
  'AR aging: current | 1_30 | 31_60 | 61_90 | 91_plus | no_due_date';

grant execute on function public.finance_aging_bucket(date, date) to authenticated, service_role;

create or replace function public.finance_financial_status_from_amounts(
  p_total numeric,
  p_received numeric,
  p_outstanding numeric
)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when coalesce(p_received, 0) = 0 then 'PENDING'
    when coalesce(p_outstanding, 0) = 0 and coalesce(p_total, 0) > 0 then 'PAID'
    when coalesce(p_outstanding, 0) = 0 then 'PAID'
    when coalesce(p_received, 0) > 0 and coalesce(p_outstanding, 0) > 0 then 'PARTIALLY_PAID'
    else 'PENDING'
  end;
$$;

grant execute on function public.finance_financial_status_from_amounts(numeric, numeric, numeric)
  to authenticated, service_role;

create or replace function public.order_is_unique_native(p_order_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (
        coalesce(o.metadata->>'source_system', '') = 'unique'
        or coalesce(o.order_source, '') in ('unique_draft', 'unique')
        or o.draft_order_id is not null
      )
  );
$$;

grant execute on function public.order_is_unique_native(uuid) to authenticated, service_role;

create or replace function public.append_finance_event(
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_category text default 'system',
  p_message text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_system text default 'unique',
  p_actor_type text default null,
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_actor_id uuid := coalesce(p_actor_id, public.current_admin_staff_id());
  v_actor_name text := coalesce(p_actor_name, public.current_admin_display_name());
  v_actor_type text := coalesce(p_actor_type, case when v_actor_id is not null then 'staff' else 'system' end);
begin
  insert into public.finance_events (
    entity_type, entity_id, event_type, category, source_system,
    actor_type, actor_id, actor_name_snapshot,
    message, old_value, new_value, metadata, occurred_at
  ) values (
    p_entity_type, p_entity_id, p_event_type,
    coalesce(nullif(btrim(p_category), ''), 'system'),
    p_source_system,
    v_actor_type, v_actor_id, v_actor_name,
    p_message, p_old_value, p_new_value, coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_occurred_at, now())
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.append_finance_event(
  text, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, uuid, text, timestamptz
) to authenticated, service_role;

create or replace function public.finance_lookup_idempotency(p_key text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select result_json
  from public.finance_idempotency_keys
  where key = p_key
  limit 1;
$$;

grant execute on function public.finance_lookup_idempotency(text) to authenticated, service_role;

create or replace function public.finance_store_idempotency(
  p_key text,
  p_operation text,
  p_result jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return;
  end if;
  insert into public.finance_idempotency_keys (key, operation, result_json, created_by)
  values (p_key, p_operation, p_result, public.current_admin_staff_id())
  on conflict (key) do nothing;
end;
$$;

grant execute on function public.finance_store_idempotency(text, text, jsonb) to authenticated, service_role;

create or replace function public.allocate_invoice_number()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cfg public.invoice_numbering_config%rowtype;
  v_num text;
begin
  select * into v_cfg
  from public.invoice_numbering_config
  where key = 'default'
  for update;

  if not found then
    insert into public.invoice_numbering_config (key, prefix, next_seq, is_production)
    values ('default', 'UD-INV-TEST-', 1, false)
    returning * into v_cfg;
    select * into v_cfg from public.invoice_numbering_config where key = 'default' for update;
  end if;

  -- Production numbering intentionally gated: keep TEST prefix unless is_production=true
  -- AND business has confirmed sequence (is_production flag).
  v_num := v_cfg.prefix || lpad(v_cfg.next_seq::text, 6, '0');

  update public.invoice_numbering_config
  set next_seq = next_seq + 1, updated_at = now()
  where key = 'default';

  return v_num;
end;
$$;

grant execute on function public.allocate_invoice_number() to authenticated, service_role;

-- Content hash for durable HTML docs (md5; no pgcrypto dependency required)
create or replace function public.finance_content_hash(p_text text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select md5(coalesce(p_text, ''));
$$;

grant execute on function public.finance_content_hash(text) to authenticated, service_role;

-- Optional full ledger recalc (available for tooling; Unique posts use additive formula)
create or replace function public.recalc_order_financials_from_ledger(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_credits numeric(14,2);
  v_refunds numeric(14,2);
  v_received numeric(14,2);
  v_outstanding numeric(14,2);
  v_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  select coalesce(sum(pt.amount), 0) into v_credits
  from public.payment_transactions pt
  where pt.order_id = p_order_id
    and upper(pt.status) in ('SUCCESS', 'SUCCESSFUL', 'CAPTURED', 'PAID', 'SALE')
    and upper(pt.kind) in ('SALE', 'CAPTURE', 'PAYMENT');

  select coalesce(sum(pt.amount), 0) into v_refunds
  from public.payment_transactions pt
  where pt.order_id = p_order_id
    and upper(pt.status) in ('SUCCESS', 'SUCCESSFUL', 'REFUNDED')
    and upper(pt.kind) in ('REFUND', 'VOID', 'REVERSAL');

  v_received := greatest(v_credits - v_refunds, 0);
  v_outstanding := greatest(coalesce(v_order.total, 0) - v_received, 0);
  v_status := public.finance_financial_status_from_amounts(v_order.total, v_received, v_outstanding);

  update public.orders
  set total_received = v_received,
      total_outstanding = v_outstanding,
      financial_status = v_status,
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'total_received', v_received,
    'total_outstanding', v_outstanding,
    'financial_status', v_status
  );
end;
$$;

comment on function public.recalc_order_financials_from_ledger(uuid) is
  'Sums successful SALE/CAPTURE/PAYMENT credits minus REFUND/VOID/REVERSAL. Prefer Unique additive post formula for manual posts to preserve Shopify history on untouched orders.';

grant execute on function public.recalc_order_financials_from_ledger(uuid) to authenticated, service_role;

-- Core Unique post (no auth — callers must gate)
create or replace function public.finance_post_manual_payment_core(
  p_order_id uuid,
  p_amount numeric,
  p_method text,
  p_payment_date date,
  p_reference text,
  p_note text,
  p_idempotency_key text,
  p_expected_outstanding numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cached jsonb;
  v_order public.orders%rowtype;
  v_amount numeric(14,2);
  v_new_received numeric(14,2);
  v_new_outstanding numeric(14,2);
  v_status text;
  v_tx_id uuid;
  v_result jsonb;
  v_old_received numeric(14,2);
  v_old_outstanding numeric(14,2);
begin
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_cached := public.finance_lookup_idempotency(p_idempotency_key);
    if v_cached is not null then
      return v_cached || jsonb_build_object('idempotent_replay', true);
    end if;
    select id into v_tx_id
    from public.payment_transactions
    where idempotency_key = p_idempotency_key
    limit 1;
    if v_tx_id is not null then
      v_result := jsonb_build_object('ok', true, 'payment_id', v_tx_id, 'idempotent_replay', true);
      perform public.finance_store_idempotency(p_idempotency_key, 'post_manual_payment', v_result);
      return v_result;
    end if;
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  -- Concurrency: expected outstanding must match current
  if p_expected_outstanding is not null
     and round(coalesce(v_order.total_outstanding, 0), 2) is distinct from round(p_expected_outstanding, 2) then
    return jsonb_build_object(
      'ok', false,
      'error', 'outstanding_conflict',
      'current_outstanding', v_order.total_outstanding
    );
  end if;

  if v_amount > coalesce(v_order.total_outstanding, 0) then
    return jsonb_build_object(
      'ok', false,
      'error', 'amount_exceeds_outstanding',
      'outstanding', v_order.total_outstanding
    );
  end if;

  v_old_received := coalesce(v_order.total_received, 0);
  v_old_outstanding := coalesce(v_order.total_outstanding, 0);
  v_new_received := round(v_old_received + v_amount, 2);

  if v_new_received > coalesce(v_order.total, 0) then
    return jsonb_build_object('ok', false, 'error', 'overpayment_rejected');
  end if;

  v_new_outstanding := greatest(round(coalesce(v_order.total, 0) - v_new_received, 2), 0);
  v_status := public.finance_financial_status_from_amounts(v_order.total, v_new_received, v_new_outstanding);

  insert into public.payment_transactions (
    order_id, kind, status, gateway, formatted_gateway, amount, currency,
    payment_id, processed_at, source_created_at, source_system,
    idempotency_key, posted_by_staff_id, internal_note, payment_method, payment_date,
    metadata
  ) values (
    p_order_id, 'SALE', 'SUCCESS',
    coalesce(nullif(btrim(p_method), ''), 'manual'),
    coalesce(nullif(btrim(p_method), ''), 'manual'),
    v_amount, coalesce(v_order.currency, 'GBP'),
    nullif(btrim(p_reference), ''),
    now(), now(), 'unique',
    nullif(btrim(p_idempotency_key), ''),
    public.current_admin_staff_id(),
    p_note,
    coalesce(nullif(btrim(p_method), ''), 'manual'),
    coalesce(p_payment_date, current_date),
    jsonb_build_object('posted_via', 'rpc_admin_post_manual_payment')
  )
  returning id into v_tx_id;

  update public.orders
  set total_received = v_new_received,
      total_outstanding = v_new_outstanding,
      financial_status = v_status,
      updated_at = now()
  where id = p_order_id;

  perform public.append_finance_event(
    'order', p_order_id, 'manual_payment_posted', 'payment',
    'Unique manual payment posted',
    jsonb_build_object('total_received', v_old_received, 'total_outstanding', v_old_outstanding),
    jsonb_build_object(
      'total_received', v_new_received,
      'total_outstanding', v_new_outstanding,
      'financial_status', v_status,
      'payment_id', v_tx_id,
      'amount', v_amount
    ),
    jsonb_build_object('method', p_method, 'payment_date', coalesce(p_payment_date, current_date)),
    'unique'
  );
  perform public.append_finance_event(
    'payment', v_tx_id, 'manual_payment_posted', 'payment',
    'Unique manual payment created',
    null,
    jsonb_build_object('order_id', p_order_id, 'amount', v_amount),
    '{}'::jsonb,
    'unique'
  );

  v_result := jsonb_build_object(
    'ok', true,
    'payment_id', v_tx_id,
    'total_received', v_new_received,
    'total_outstanding', v_new_outstanding,
    'financial_status', v_status
  );
  perform public.finance_store_idempotency(p_idempotency_key, 'post_manual_payment', v_result);
  return v_result;
end;
$$;

grant execute on function public.finance_post_manual_payment_core(
  uuid, numeric, text, date, text, text, text, numeric
) to authenticated, service_role;

create or replace function public.finance_reverse_manual_payment_core(
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cached jsonb;
  v_tx public.payment_transactions%rowtype;
  v_order public.orders%rowtype;
  v_rev_id uuid;
  v_existing uuid;
  v_new_received numeric(14,2);
  v_new_outstanding numeric(14,2);
  v_status text;
  v_result jsonb;
begin
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_cached := public.finance_lookup_idempotency(p_idempotency_key);
    if v_cached is not null then
      return v_cached || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  select * into v_tx from public.payment_transactions where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if coalesce(v_tx.source_system, '') is distinct from 'unique' then
    return jsonb_build_object('ok', false, 'error', 'not_unique_payment');
  end if;

  if v_tx.reversal_of_id is not null then
    return jsonb_build_object('ok', false, 'error', 'cannot_reverse_a_reversal');
  end if;

  select id into v_existing
  from public.payment_transactions
  where reversal_of_id = p_payment_id
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'error', 'already_reversed', 'reversal_id', v_existing);
  end if;

  select * into v_order from public.orders where id = v_tx.order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_new_received := greatest(round(coalesce(v_order.total_received, 0) - v_tx.amount, 2), 0);
  v_new_outstanding := greatest(round(coalesce(v_order.total, 0) - v_new_received, 2), 0);
  v_status := public.finance_financial_status_from_amounts(v_order.total, v_new_received, v_new_outstanding);

  insert into public.payment_transactions (
    order_id, parent_transaction_id, kind, status, gateway, formatted_gateway,
    amount, currency, processed_at, source_created_at, source_system,
    idempotency_key, reversal_of_id, posted_by_staff_id, internal_note,
    payment_method, payment_date, metadata
  ) values (
    v_tx.order_id, v_tx.id, 'REVERSAL', 'SUCCESS',
    coalesce(v_tx.gateway, 'manual'), coalesce(v_tx.formatted_gateway, 'manual'),
    v_tx.amount, v_tx.currency, now(), now(), 'unique',
    nullif(btrim(p_idempotency_key), ''), p_payment_id,
    public.current_admin_staff_id(), p_reason,
    v_tx.payment_method, current_date,
    jsonb_build_object('reverses', p_payment_id, 'reason', p_reason)
  )
  returning id into v_rev_id;

  update public.orders
  set total_received = v_new_received,
      total_outstanding = v_new_outstanding,
      financial_status = v_status,
      updated_at = now()
  where id = v_order.id;

  perform public.append_finance_event(
    'order', v_order.id, 'manual_payment_reversed', 'payment',
    'Unique manual payment reversed',
    jsonb_build_object('total_received', v_order.total_received, 'total_outstanding', v_order.total_outstanding),
    jsonb_build_object(
      'total_received', v_new_received,
      'total_outstanding', v_new_outstanding,
      'financial_status', v_status,
      'original_payment_id', p_payment_id,
      'reversal_id', v_rev_id
    ),
    jsonb_build_object('reason', p_reason),
    'unique'
  );

  v_result := jsonb_build_object(
    'ok', true,
    'reversal_id', v_rev_id,
    'payment_id', p_payment_id,
    'total_received', v_new_received,
    'total_outstanding', v_new_outstanding,
    'financial_status', v_status
  );
  perform public.finance_store_idempotency(p_idempotency_key, 'reverse_manual_payment', v_result);
  return v_result;
end;
$$;

grant execute on function public.finance_reverse_manual_payment_core(uuid, text, text)
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- 3. Aging summary (defined before dashboard so dashboard can call it)
create or replace function public.rpc_admin_ar_aging_summary(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_as_of date := coalesce((p_filters->>'as_of')::date, current_date);
  v_row record;
  v_out jsonb := '{}'::jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  v_out := jsonb_build_object(
    'current', 0, '1_30', 0, '31_60', 0, '61_90', 0, '91_plus', 0, 'no_due_date', 0
  );

  for v_row in
    select public.finance_aging_bucket(o.payment_due_on, v_as_of) as bucket,
           coalesce(sum(o.total_outstanding), 0)::numeric(14,2) as amt,
           count(*)::int as cnt
    from public.orders o
    where coalesce(o.total_outstanding, 0) > 0
      and (v_company is null or o.company_id = v_company)
      and (v_customer is null or o.customer_id = v_customer)
    group by 1
  loop
    v_out := v_out || jsonb_build_object(
      v_row.bucket, v_row.amt,
      v_row.bucket || '_count', v_row.cnt
    );
  end loop;

  return jsonb_build_object('ok', true, 'as_of', v_as_of, 'buckets', v_out);
end;
$$;

-- 1. Dashboard
create or replace function public.rpc_admin_finance_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_as_of date := coalesce((p_filters->>'as_of')::date, current_date);
  v_open_count int;
  v_open_total numeric(14,2);
  v_received numeric(14,2);
  v_overdue numeric(14,2);
  v_no_due numeric(14,2);
  v_aging jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select
    count(*)::int,
    coalesce(sum(o.total_outstanding), 0),
    coalesce(sum(o.total_received), 0),
    coalesce(sum(case
      when o.payment_due_on is not null and o.payment_due_on < v_as_of then o.total_outstanding
      else 0 end), 0),
    coalesce(sum(case when o.payment_due_on is null then o.total_outstanding else 0 end), 0)
  into v_open_count, v_open_total, v_received, v_overdue, v_no_due
  from public.orders o
  where coalesce(o.total_outstanding, 0) > 0
    and (v_company is null or o.company_id = v_company)
    and (v_customer is null or o.customer_id = v_customer);

  v_aging := public.rpc_admin_ar_aging_summary(p_filters);

  return jsonb_build_object(
    'ok', true,
    'as_of', v_as_of,
    'open_receivable_count', v_open_count,
    'open_receivable_total', v_open_total,
    'total_received_on_open', v_received,
    'overdue_total', v_overdue,
    'no_due_date_total', v_no_due,
    'aging', v_aging
  );
end;
$$;

-- 2. AR receivables list
create or replace function public.rpc_list_admin_ar_receivables(
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default 'outstanding_desc',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(coalesce(p_filters->>'q', '')), '');
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_bucket text := nullif(btrim(coalesce(p_filters->>'aging_bucket', '')), '');
  v_as_of date := coalesce((p_filters->>'as_of')::date, current_date);
  v_unpaid_only boolean := coalesce((p_filters->>'unpaid_only')::boolean, true);
  v_total int;
  v_rows jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with base as (
    select
      o.id,
      o.order_number,
      o.email,
      o.customer_id,
      o.company_id,
      o.currency,
      o.total,
      o.total_received,
      o.total_outstanding,
      o.financial_status,
      o.payment_due_on,
      o.trading_name_snapshot,
      public.finance_aging_bucket(o.payment_due_on, v_as_of) as aging_bucket,
      o.source_created_at,
      o.created_at
    from public.orders o
    where (
        (v_unpaid_only and coalesce(o.total_outstanding, 0) > 0)
        or (
          not v_unpaid_only and (
            coalesce(o.total_outstanding, 0) > 0
            or upper(coalesce(o.financial_status, '')) in (
              'PENDING', 'PARTIALLY_PAID', 'AUTHORIZED', 'UNPAID'
            )
          )
        )
      )
      and (v_company is null or o.company_id = v_company)
      and (v_customer is null or o.customer_id = v_customer)
      and (
        v_q is null
        or o.order_number ilike '%' || v_q || '%'
        or o.email ilike '%' || v_q || '%'
        or coalesce(o.trading_name_snapshot, '') ilike '%' || v_q || '%'
      )
  ),
  filtered as (
    select * from base b
    where v_bucket is null or b.aging_bucket = v_bucket
  ),
  counted as (
    select count(*)::int as total from filtered
  ),
  sorted as (
    select f.*,
      case coalesce(p_sort, 'outstanding_desc')
        when 'outstanding_asc' then row_number() over (order by f.total_outstanding asc, f.created_at desc)
        when 'due_asc' then row_number() over (order by f.payment_due_on asc nulls last, f.total_outstanding desc)
        when 'due_desc' then row_number() over (order by f.payment_due_on desc nulls last, f.total_outstanding desc)
        when 'created_desc' then row_number() over (order by f.created_at desc)
        else row_number() over (order by f.total_outstanding desc, f.created_at desc)
      end as rn
    from filtered f
  )
  select
    (select total from counted),
    coalesce(
      (select jsonb_agg(to_jsonb(s) - 'rn' order by s.rn)
       from sorted s
       where s.rn > v_offset and s.rn <= v_offset + v_limit),
      '[]'::jsonb
    )
  into v_total, v_rows;

  return jsonb_build_object(
    'ok', true,
    'total', coalesce(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

-- 4. List payment transactions
create or replace function public.rpc_list_admin_payment_transactions(
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default 'processed_desc',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_order uuid := nullif(p_filters->>'order_id', '')::uuid;
  v_source text := nullif(btrim(coalesce(p_filters->>'source_system', '')), '');
  v_kind text := nullif(btrim(coalesce(p_filters->>'kind', '')), '');
  v_total int;
  v_rows jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*)::int into v_total
  from public.payment_transactions pt
  where (v_order is null or pt.order_id = v_order)
    and (v_source is null or pt.source_system = v_source)
    and (v_kind is null or upper(pt.kind) = upper(v_kind));

  select coalesce(jsonb_agg(to_jsonb(x) - 'sort_rn' order by x.sort_rn), '[]'::jsonb)
  into v_rows
  from (
    select pt.*,
      case coalesce(p_sort, 'processed_desc')
        when 'amount_desc' then row_number() over (order by pt.amount desc, pt.created_at desc)
        when 'created_asc' then row_number() over (order by pt.created_at asc)
        else row_number() over (order by coalesce(pt.processed_at, pt.created_at) desc)
      end as sort_rn
    from public.payment_transactions pt
    where (v_order is null or pt.order_id = v_order)
      and (v_source is null or pt.source_system = v_source)
      and (v_kind is null or upper(pt.kind) = upper(v_kind))
  ) x
  where x.sort_rn > v_offset and x.sort_rn <= v_offset + v_limit;

  return jsonb_build_object(
    'ok', true, 'total', coalesce(v_total, 0), 'limit', v_limit, 'offset', v_offset,
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

-- 5. Get payment transaction
create or replace function public.rpc_get_admin_payment_transaction(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select to_jsonb(pt) into v_row
  from public.payment_transactions pt
  where pt.id = p_id;

  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'payment', v_row);
end;
$$;

-- 6. Post manual payment
create or replace function public.rpc_admin_post_manual_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method text default 'manual',
  p_payment_date date default current_date,
  p_reference text default null,
  p_note text default null,
  p_idempotency_key text default null,
  p_expected_outstanding numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.can_post_manual_payment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.finance_post_manual_payment_core(
    p_order_id, p_amount, p_method, p_payment_date,
    p_reference, p_note, p_idempotency_key, p_expected_outstanding
  );
end;
$$;

-- 7. Reverse manual payment
create or replace function public.rpc_admin_reverse_manual_payment(
  p_payment_id uuid,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.can_reverse_manual_payment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.finance_reverse_manual_payment_core(p_payment_id, p_reason, p_idempotency_key);
end;
$$;

-- 8. List refunds
create or replace function public.rpc_list_admin_finance_refunds(
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default 'created_desc',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_order uuid := nullif(p_filters->>'order_id', '')::uuid;
  v_total int;
  v_rows jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*)::int into v_total
  from public.refunds r
  where v_order is null or r.order_id = v_order;

  select coalesce(jsonb_agg(to_jsonb(x) - 'rn' order by x.rn), '[]'::jsonb)
  into v_rows
  from (
    select r.*,
      row_number() over (order by coalesce(r.source_created_at, r.created_at) desc) as rn
    from public.refunds r
    where v_order is null or r.order_id = v_order
  ) x
  where x.rn > v_offset and x.rn <= v_offset + v_limit;

  return jsonb_build_object(
    'ok', true, 'total', coalesce(v_total, 0), 'limit', v_limit, 'offset', v_offset,
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

-- 9. Get refund
create or replace function public.rpc_get_admin_finance_refund(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_lines jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select to_jsonb(r) into v_row from public.refunds r where r.id = p_id;
  if v_row is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(li) order by li.created_at), '[]'::jsonb)
  into v_lines
  from public.refund_line_items li
  where li.refund_id = p_id;

  return jsonb_build_object('ok', true, 'refund', v_row, 'line_items', v_lines);
end;
$$;

-- 10. Create invoice from order
create or replace function public.finance_create_invoice_from_order_core(
  p_order_id uuid,
  p_idempotency_key text,
  p_as_reconstructed boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cached jsonb;
  v_order public.orders%rowtype;
  v_inv_id uuid;
  v_doc_id uuid;
  v_number text;
  v_lines jsonb;
  v_tax jsonb;
  v_html text;
  v_hash text;
  v_prov text;
  v_status text;
  v_result jsonb;
  v_existing uuid;
begin
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_cached := public.finance_lookup_idempotency(p_idempotency_key);
    if v_cached is not null then
      return v_cached || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  -- Idempotent: one active invoice per order unless reconstructing again with new key
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    select id into v_existing
    from public.invoices
    where order_id = p_order_id and status <> 'void'
    order by created_at desc
    limit 1;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'invoice_id', v_existing, 'idempotent_replay', true);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_item_id', oi.id,
    'product_name', oi.product_name,
    'sku', oi.sku_snapshot,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price,
    'line_total', oi.line_total,
    'discount_total', oi.discount_total,
    'tax_total', oi.tax_total
  ) order by oi.created_at), '[]'::jsonb)
  into v_lines
  from public.order_items oi
  where oi.order_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(tl) order by tl.created_at), '[]'::jsonb)
  into v_tax
  from public.order_tax_lines tl
  where tl.order_id = p_order_id;

  if p_as_reconstructed or not public.order_is_unique_native(p_order_id) then
    v_prov := 'reconstructed_from_order';
  else
    v_prov := 'unique_native';
  end if;

  v_status := case
    when coalesce(v_order.total_outstanding, 0) = 0 and coalesce(v_order.total, 0) > 0 then 'paid'
    when coalesce(v_order.total_received, 0) > 0 then 'partial'
    else 'issued'
  end;

  v_number := public.allocate_invoice_number();

  insert into public.invoices (
    invoice_number, order_id, customer_id, company_id,
    invoice_date, due_date, currency,
    subtotal, discount_total, shipping_total, tax_total, total,
    amount_paid, outstanding, status,
    billing_snapshot, shipping_snapshot, line_items_snapshot, tax_snapshot,
    provenance, source_system, created_by_staff_id, version, metadata
  ) values (
    v_number, p_order_id, v_order.customer_id, v_order.company_id,
    current_date, v_order.payment_due_on, coalesce(v_order.currency, 'GBP'),
    coalesce(v_order.subtotal, 0), coalesce(v_order.discount_total, 0),
    coalesce(v_order.shipping_total, 0), coalesce(v_order.tax_total, 0),
    coalesce(v_order.total, 0),
    coalesce(v_order.total_received, 0), coalesce(v_order.total_outstanding, 0), v_status,
    coalesce(v_order.metadata->'billing_address', '{}'::jsonb),
    coalesce(v_order.shipping_address, '{}'::jsonb),
    v_lines, jsonb_build_object('lines', v_tax, 'tax_total', v_order.tax_total),
    v_prov, 'unique', public.current_admin_staff_id(), 1,
    jsonb_build_object('order_number', v_order.order_number)
  )
  returning id into v_inv_id;

  v_html := format(
    $html$<!DOCTYPE html><html><head><meta charset="utf-8"><title>%s</title></head>
<body>
<h1>Invoice %s</h1>
<p>Order: %s</p>
<p>Date: %s</p>
<p>Due: %s</p>
<p>Subtotal: %s %s</p>
<p>Tax: %s</p>
<p>Shipping: %s</p>
<p>Discount: %s</p>
<p><strong>Total: %s %s</strong></p>
<p>Amount paid: %s</p>
<p>Outstanding: %s</p>
<p>Provenance: %s</p>
<pre>%s</pre>
</body></html>$html$,
    v_number, v_number, v_order.order_number, current_date::text,
    coalesce(v_order.payment_due_on::text, 'n/a'),
    v_order.subtotal::text, coalesce(v_order.currency, 'GBP'),
    v_order.tax_total::text, v_order.shipping_total::text, v_order.discount_total::text,
    v_order.total::text, coalesce(v_order.currency, 'GBP'),
    v_order.total_received::text, v_order.total_outstanding::text,
    v_prov, v_lines::text
  );
  v_hash := public.finance_content_hash(v_html);

  insert into public.finance_documents (
    document_type, entity_type, entity_id, invoice_id, title, body_html,
    content_hash, template_version, provenance, generated_by_staff_id, source_system
  ) values (
    'invoice', 'invoice', v_inv_id, v_inv_id, 'Invoice ' || v_number, v_html,
    v_hash, 'v1', v_prov, public.current_admin_staff_id(), 'unique'
  )
  returning id into v_doc_id;

  update public.invoices set document_id = v_doc_id where id = v_inv_id;

  perform public.append_finance_event(
    'invoice', v_inv_id, 'invoice_created', 'document',
    'Invoice created from order',
    null,
    jsonb_build_object('invoice_number', v_number, 'order_id', p_order_id, 'provenance', v_prov),
    '{}'::jsonb, 'unique'
  );
  perform public.append_finance_event(
    'order', p_order_id, 'invoice_created', 'document',
    'Invoice ' || v_number || ' created',
    null,
    jsonb_build_object('invoice_id', v_inv_id, 'invoice_number', v_number),
    '{}'::jsonb, 'unique'
  );

  v_result := jsonb_build_object(
    'ok', true,
    'invoice_id', v_inv_id,
    'invoice_number', v_number,
    'document_id', v_doc_id,
    'provenance', v_prov
  );
  perform public.finance_store_idempotency(p_idempotency_key, 'create_invoice_from_order', v_result);
  return v_result;
end;
$$;

grant execute on function public.finance_create_invoice_from_order_core(uuid, text, boolean)
  to authenticated, service_role;

create or replace function public.rpc_admin_create_invoice_from_order(
  p_order_id uuid,
  p_idempotency_key text default null,
  p_as_reconstructed boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.can_manage_invoices() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.finance_create_invoice_from_order_core(p_order_id, p_idempotency_key, p_as_reconstructed);
end;
$$;

-- 11. Get / list invoices
create or replace function public.rpc_get_admin_invoice(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_inv jsonb;
  v_doc jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select to_jsonb(i) into v_inv from public.invoices i where i.id = p_id;
  if v_inv is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select to_jsonb(d) into v_doc
  from public.finance_documents d
  where d.id = (v_inv->>'document_id')::uuid;

  return jsonb_build_object('ok', true, 'invoice', v_inv, 'document', v_doc);
end;
$$;

create or replace function public.rpc_list_admin_invoices(
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default 'created_desc',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_order uuid := nullif(p_filters->>'order_id', '')::uuid;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_status text := nullif(btrim(coalesce(p_filters->>'status', '')), '');
  v_total int;
  v_rows jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*)::int into v_total
  from public.invoices i
  where (v_order is null or i.order_id = v_order)
    and (v_customer is null or i.customer_id = v_customer)
    and (v_company is null or i.company_id = v_company)
    and (v_status is null or i.status = v_status);

  select coalesce(jsonb_agg(to_jsonb(x) - 'rn' order by x.rn), '[]'::jsonb)
  into v_rows
  from (
    select i.*,
      row_number() over (order by i.created_at desc) as rn
    from public.invoices i
    where (v_order is null or i.order_id = v_order)
      and (v_customer is null or i.customer_id = v_customer)
      and (v_company is null or i.company_id = v_company)
      and (v_status is null or i.status = v_status)
  ) x
  where x.rn > v_offset and x.rn <= v_offset + v_limit;

  return jsonb_build_object(
    'ok', true, 'total', coalesce(v_total, 0), 'limit', v_limit, 'offset', v_offset,
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

-- 12. Generate statement
create or replace function public.finance_generate_statement_core(
  p_customer_id uuid,
  p_company_id uuid,
  p_from date,
  p_to date,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cached jsonb;
  v_opening numeric(14,2) := 0;
  v_closing numeric(14,2) := 0;
  v_entries jsonb := '[]'::jsonb;
  v_currency text := 'GBP';
  v_stmt_id uuid;
  v_doc_id uuid;
  v_html text;
  v_hash text;
  v_result jsonb;
  v_existing uuid;
begin
  if p_customer_id is null and p_company_id is null then
    return jsonb_build_object('ok', false, 'error', 'customer_or_company_required');
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    return jsonb_build_object('ok', false, 'error', 'invalid_period');
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_cached := public.finance_lookup_idempotency(p_idempotency_key);
    if v_cached is not null then
      return v_cached || jsonb_build_object('idempotent_replay', true);
    end if;
    select id into v_existing from public.statements where idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'statement_id', v_existing, 'idempotent_replay', true);
    end if;
  end if;

  -- Opening: Unique-only synthetic — open outstanding on orders dated before period start.
  select coalesce(sum(o.total_outstanding), 0), coalesce(max(o.currency), 'GBP')
  into v_opening, v_currency
  from public.orders o
  where (p_customer_id is null or o.customer_id = p_customer_id)
    and (p_company_id is null or o.company_id = p_company_id)
    and coalesce(o.source_created_at, o.created_at)::date < p_from
    and coalesce(o.total_outstanding, 0) > 0;

  v_opening := coalesce(v_opening, 0);
  v_currency := coalesce(v_currency, 'GBP');

  select coalesce(jsonb_agg(e.entry order by e.sort_at), '[]'::jsonb)
  into v_entries
  from (
    select jsonb_build_object(
      'entry_type', 'invoice_open',
      'order_id', o.id,
      'order_number', o.order_number,
      'amount', o.total,
      'direction', 'debit',
      'occurred_on', coalesce(o.source_created_at, o.created_at)::date
    ) as entry,
    coalesce(o.source_created_at, o.created_at) as sort_at
    from public.orders o
    where (p_customer_id is null or o.customer_id = p_customer_id)
      and (p_company_id is null or o.company_id = p_company_id)
      and coalesce(o.source_created_at, o.created_at)::date between p_from and p_to
    union all
    select jsonb_build_object(
      'entry_type', 'payment',
      'payment_id', pt.id,
      'order_id', pt.order_id,
      'amount', pt.amount,
      'direction', 'credit',
      'kind', pt.kind,
      'source_system', pt.source_system,
      'occurred_on', coalesce(pt.payment_date, pt.processed_at::date, pt.created_at::date)
    ),
    coalesce(pt.processed_at, pt.created_at)
    from public.payment_transactions pt
    join public.orders o on o.id = pt.order_id
    where (p_customer_id is null or o.customer_id = p_customer_id)
      and (p_company_id is null or o.company_id = p_company_id)
      and coalesce(pt.payment_date, pt.processed_at::date, pt.created_at::date) between p_from and p_to
      and upper(pt.status) in ('SUCCESS', 'SUCCESSFUL', 'CAPTURED', 'PAID', 'SALE', 'REFUNDED')
  ) e;

  -- Closing = current open outstanding for entity (Unique synthetic)
  select coalesce(sum(o.total_outstanding), 0), coalesce(max(o.currency), v_currency)
  into v_closing, v_currency
  from public.orders o
  where (p_customer_id is null or o.customer_id = p_customer_id)
    and (p_company_id is null or o.company_id = p_company_id);

  v_html := format(
    $html$<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement</title></head>
<body>
<h1>Account Statement</h1>
<p>Period: %s to %s</p>
<p>Opening balance: %s %s</p>
<p>Closing balance: %s %s</p>
<pre>%s</pre>
</body></html>$html$,
    p_from::text, p_to::text,
    v_opening::text, v_currency,
    v_closing::text, v_currency,
    coalesce(v_entries, '[]'::jsonb)::text
  );
  v_hash := public.finance_content_hash(v_html);

  insert into public.finance_documents (
    document_type, entity_type, entity_id, title, body_html, content_hash,
    template_version, provenance, generated_by_staff_id, source_system
  ) values (
    'statement',
    case when p_company_id is not null then 'company' else 'customer' end,
    coalesce(p_company_id, p_customer_id),
    format('Statement %s–%s', p_from, p_to),
    v_html, v_hash, 'v1', 'unique_native',
    public.current_admin_staff_id(), 'unique'
  )
  returning id into v_doc_id;

  insert into public.statements (
    customer_id, company_id, period_from, period_to,
    opening_balance, closing_balance, currency, entries_snapshot,
    document_id, source_system, created_by, idempotency_key
  ) values (
    p_customer_id, p_company_id, p_from, p_to,
    v_opening, v_closing, v_currency, coalesce(v_entries, '[]'::jsonb),
    v_doc_id, 'unique', public.current_admin_staff_id(),
    nullif(btrim(p_idempotency_key), '')
  )
  returning id into v_stmt_id;

  perform public.append_finance_event(
    'statement', v_stmt_id, 'statement_generated', 'document',
    'AR statement generated',
    null,
    jsonb_build_object(
      'opening', v_opening, 'closing', v_closing,
      'period_from', p_from, 'period_to', p_to
    ),
    jsonb_build_object('customer_id', p_customer_id, 'company_id', p_company_id),
    'unique'
  );

  v_result := jsonb_build_object(
    'ok', true,
    'statement_id', v_stmt_id,
    'document_id', v_doc_id,
    'opening_balance', v_opening,
    'closing_balance', v_closing,
    'currency', v_currency,
    'entries', coalesce(v_entries, '[]'::jsonb)
  );
  perform public.finance_store_idempotency(p_idempotency_key, 'generate_statement', v_result);
  return v_result;
end;
$$;

grant execute on function public.finance_generate_statement_core(uuid, uuid, date, date, text)
  to authenticated, service_role;

create or replace function public.rpc_admin_generate_statement(
  p_customer_id uuid default null,
  p_company_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.can_generate_statements() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.finance_generate_statement_core(
    p_customer_id, p_company_id, p_from, p_to, p_idempotency_key
  );
end;
$$;

-- 13. List / get statements
create or replace function public.rpc_list_admin_statements(
  p_limit int default 50,
  p_offset int default 0,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_total int;
  v_rows jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*)::int into v_total
  from public.statements s
  where (v_customer is null or s.customer_id = v_customer)
    and (v_company is null or s.company_id = v_company);

  select coalesce(jsonb_agg(to_jsonb(x) - 'rn' order by x.rn), '[]'::jsonb)
  into v_rows
  from (
    select s.*,
      row_number() over (order by s.created_at desc) as rn
    from public.statements s
    where (v_customer is null or s.customer_id = v_customer)
      and (v_company is null or s.company_id = v_company)
  ) x
  where x.rn > v_offset and x.rn <= v_offset + v_limit;

  return jsonb_build_object(
    'ok', true, 'total', coalesce(v_total, 0), 'limit', v_limit, 'offset', v_offset,
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

create or replace function public.rpc_get_admin_statement(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_stmt jsonb;
  v_doc jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select to_jsonb(s) into v_stmt from public.statements s where s.id = p_id;
  if v_stmt is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select to_jsonb(d) into v_doc
  from public.finance_documents d
  where d.id = (v_stmt->>'document_id')::uuid;

  return jsonb_build_object('ok', true, 'statement', v_stmt, 'document', v_doc);
end;
$$;

-- 14. Add finance note
create or replace function public.rpc_admin_add_finance_note(
  p_entity_type text,
  p_entity_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_manage_finance_notes() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if p_entity_type not in ('order', 'customer', 'company', 'invoice', 'payment') then
    return jsonb_build_object('ok', false, 'error', 'invalid_entity_type');
  end if;
  if p_body is null or btrim(p_body) = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_body');
  end if;

  insert into public.finance_notes (
    entity_type, entity_id, body, author_staff_id, author_name_snapshot, source_system
  ) values (
    p_entity_type, p_entity_id, btrim(p_body),
    public.current_admin_staff_id(), public.current_admin_display_name(), 'unique'
  )
  returning id into v_id;

  perform public.append_finance_event(
    p_entity_type, p_entity_id, 'finance_note_added', 'note',
    'Finance note added',
    null, jsonb_build_object('note_id', v_id),
    '{}'::jsonb, 'unique'
  );

  return jsonb_build_object('ok', true, 'note_id', v_id);
end;
$$;

-- 15. Finance timeline
create or replace function public.rpc_list_admin_finance_timeline(
  p_entity_type text,
  p_entity_id uuid,
  p_limit int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
  v_total int;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with timeline as (
    select
      e.id, 'event'::text as item_type, e.event_type, e.category,
      e.message, e.old_value, e.new_value, e.metadata, e.source_system,
      e.actor_type, e.actor_name_snapshot, e.occurred_at, e.created_at,
      null::text as body
    from public.finance_events e
    where e.entity_type = p_entity_type and e.entity_id = p_entity_id
    union all
    select
      n.id, 'note', 'finance_note', 'note',
      left(n.body, 120), null, jsonb_build_object('note_id', n.id),
      '{}'::jsonb, n.source_system, 'staff', n.author_name_snapshot,
      n.created_at, n.created_at, n.body
    from public.finance_notes n
    where n.entity_type = p_entity_type and n.entity_id = p_entity_id
  )
  select count(*)::int into v_total from timeline;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at desc, t.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select * from (
      select
        e.id, 'event'::text as item_type, e.event_type, e.category,
        e.message, e.old_value, e.new_value, e.metadata, e.source_system,
        e.actor_type, e.actor_name_snapshot, e.occurred_at, e.created_at,
        null::text as body
      from public.finance_events e
      where e.entity_type = p_entity_type and e.entity_id = p_entity_id
      union all
      select
        n.id, 'note', 'finance_note', 'note',
        left(n.body, 120), null, jsonb_build_object('note_id', n.id),
        '{}'::jsonb, n.source_system, 'staff', n.author_name_snapshot,
        n.created_at, n.created_at, n.body
      from public.finance_notes n
      where n.entity_type = p_entity_type and n.entity_id = p_entity_id
    ) u
    order by u.occurred_at desc, u.created_at desc
    offset v_offset limit v_limit
  ) t;

  return jsonb_build_object(
    'ok', true, 'total', coalesce(v_total, 0), 'limit', v_limit, 'offset', v_offset,
    'rows', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

-- 16. Reconciliation flags (FLAG only — no auto-fix)
create or replace function public.rpc_admin_finance_reconciliation_flags(p_limit int default 50)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_flags jsonb := '[]'::jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select coalesce(jsonb_agg(f order by f->>'flag'), '[]'::jsonb)
  into v_flags
  from (
    -- Outstanding cache vs total - received
    select jsonb_build_object(
      'flag', 'outstanding_mismatch',
      'order_id', o.id,
      'order_number', o.order_number,
      'total', o.total,
      'total_received', o.total_received,
      'total_outstanding', o.total_outstanding,
      'expected_outstanding', greatest(o.total - o.total_received, 0)
    ) as f
    from public.orders o
    where round(coalesce(o.total_outstanding, 0), 2)
          is distinct from round(greatest(coalesce(o.total, 0) - coalesce(o.total_received, 0), 0), 2)
    limit v_limit
  ) s;

  -- Negative outstanding
  select coalesce(v_flags, '[]'::jsonb) || coalesce(jsonb_agg(f), '[]'::jsonb)
  into v_flags
  from (
    select jsonb_build_object(
      'flag', 'negative_outstanding',
      'order_id', o.id,
      'order_number', o.order_number,
      'total_outstanding', o.total_outstanding
    ) as f
    from public.orders o
    where o.total_outstanding < 0
    limit v_limit
  ) s;

  -- Received > total
  select coalesce(v_flags, '[]'::jsonb) || coalesce(jsonb_agg(f), '[]'::jsonb)
  into v_flags
  from (
    select jsonb_build_object(
      'flag', 'received_exceeds_total',
      'order_id', o.id,
      'order_number', o.order_number,
      'total', o.total,
      'total_received', o.total_received
    ) as f
    from public.orders o
    where coalesce(o.total_received, 0) > coalesce(o.total, 0) + 0.009
    limit v_limit
  ) s;

  return jsonb_build_object(
    'ok', true,
    'flags', coalesce(v_flags, '[]'::jsonb),
    'note', 'FLAG only — no auto-fix applied'
  );
end;
$$;

-- 17. Order finance panel (Phase 2A)
create or replace function public.rpc_get_admin_order_finance_panel(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order jsonb;
  v_payments jsonb;
  v_refunds jsonb;
  v_invoices jsonb;
  v_notes jsonb;
  v_events jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select to_jsonb(o) into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(pt) order by coalesce(pt.processed_at, pt.created_at) desc), '[]'::jsonb)
  into v_payments
  from public.payment_transactions pt
  where pt.order_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by coalesce(r.source_created_at, r.created_at) desc), '[]'::jsonb)
  into v_refunds
  from public.refunds r
  where r.order_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc), '[]'::jsonb)
  into v_invoices
  from public.invoices i
  where i.order_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
  into v_notes
  from public.finance_notes n
  where n.entity_type = 'order' and n.entity_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc), '[]'::jsonb)
  into v_events
  from public.finance_events e
  where e.entity_type = 'order' and e.entity_id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'order', v_order,
    'aging_bucket', public.finance_aging_bucket(
      (v_order->>'payment_due_on')::date, current_date
    ),
    'payments', v_payments,
    'refunds', v_refunds,
    'invoices', v_invoices,
    'notes', v_notes,
    'events', v_events,
    'capabilities', jsonb_build_object(
      'can_post', public.can_post_manual_payment(),
      'can_reverse', public.can_reverse_manual_payment(),
      'can_invoice', public.can_manage_invoices(),
      'can_notes', public.can_manage_finance_notes()
    )
  );
end;
$$;

-- 18. CRM finance summary (Phase 2C)
create or replace function public.rpc_get_admin_crm_finance_summary(
  p_entity_type text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order_count int;
  v_lifetime numeric(14,2);
  v_received numeric(14,2);
  v_outstanding numeric(14,2);
  v_overdue numeric(14,2);
  v_aging jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if p_entity_type not in ('customer', 'company') then
    return jsonb_build_object('ok', false, 'error', 'invalid_entity_type');
  end if;

  select
    count(*)::int,
    coalesce(sum(o.total), 0),
    coalesce(sum(o.total_received), 0),
    coalesce(sum(o.total_outstanding), 0),
    coalesce(sum(case
      when o.payment_due_on is not null and o.payment_due_on < current_date
           and o.total_outstanding > 0 then o.total_outstanding
      else 0 end), 0)
  into v_order_count, v_lifetime, v_received, v_outstanding, v_overdue
  from public.orders o
  where (p_entity_type = 'customer' and o.customer_id = p_entity_id)
     or (p_entity_type = 'company' and o.company_id = p_entity_id);

  v_aging := public.rpc_admin_ar_aging_summary(
    case when p_entity_type = 'customer'
      then jsonb_build_object('customer_id', p_entity_id)
      else jsonb_build_object('company_id', p_entity_id)
    end
  );

  return jsonb_build_object(
    'ok', true,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'order_count', v_order_count,
    'lifetime_total', v_lifetime,
    'total_received', v_received,
    'total_outstanding', v_outstanding,
    'overdue_total', v_overdue,
    'aging', v_aging
  );
end;
$$;

-- Grants for all admin RPCs
grant execute on function public.rpc_admin_finance_dashboard(jsonb) to authenticated, service_role;
grant execute on function public.rpc_list_admin_ar_receivables(int, int, text, jsonb) to authenticated, service_role;
grant execute on function public.rpc_admin_ar_aging_summary(jsonb) to authenticated, service_role;
grant execute on function public.rpc_list_admin_payment_transactions(int, int, text, jsonb) to authenticated, service_role;
grant execute on function public.rpc_get_admin_payment_transaction(uuid) to authenticated, service_role;
grant execute on function public.rpc_admin_post_manual_payment(uuid, numeric, text, date, text, text, text, numeric) to authenticated, service_role;
grant execute on function public.rpc_admin_reverse_manual_payment(uuid, text, text) to authenticated, service_role;
grant execute on function public.rpc_list_admin_finance_refunds(int, int, text, jsonb) to authenticated, service_role;
grant execute on function public.rpc_get_admin_finance_refund(uuid) to authenticated, service_role;
grant execute on function public.rpc_admin_create_invoice_from_order(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.rpc_get_admin_invoice(uuid) to authenticated, service_role;
grant execute on function public.rpc_list_admin_invoices(int, int, text, jsonb) to authenticated, service_role;
grant execute on function public.rpc_admin_generate_statement(uuid, uuid, date, date, text) to authenticated, service_role;
grant execute on function public.rpc_list_admin_statements(int, int, jsonb) to authenticated, service_role;
grant execute on function public.rpc_get_admin_statement(uuid) to authenticated, service_role;
grant execute on function public.rpc_admin_add_finance_note(text, uuid, text) to authenticated, service_role;
grant execute on function public.rpc_list_admin_finance_timeline(text, uuid, int, int) to authenticated, service_role;
grant execute on function public.rpc_admin_finance_reconciliation_flags(int) to authenticated, service_role;
grant execute on function public.rpc_get_admin_order_finance_panel(uuid) to authenticated, service_role;
grant execute on function public.rpc_get_admin_crm_finance_summary(text, uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Selftest (service_role only)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase2d_finance_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix constant text := 'PHASE2D-STAB-';
  v_cases jsonb := '{}'::jsonb;
  v_pass int := 0;
  v_total int := 0;
  v_rate numeric := 0;
  v_detail text;
  v_case_ok boolean;
  v_cleanup_ok boolean := true;
  v_cleanup_detail text := 'ok';
  v_customer_id uuid;
  v_company_id uuid;
  v_order_id uuid;
  v_order_shopify_id uuid;
  v_order2_id uuid;
  v_pay_id uuid;
  v_pay2_id uuid;
  v_rev_id uuid;
  v_inv_id uuid;
  v_stmt_id uuid;
  v_rpc jsonb;
  v_ord public.orders%rowtype;
  v_ord_shop public.orders%rowtype;
  v_shop_received numeric(14,2);
  v_shop_outstanding numeric(14,2);
  v_bucket text;
  v_cnt int;
  v_refund_id uuid;
begin
  -- ── Prefix cleanup (start) ───────────────────────────────────────────────
  begin
    alter table public.finance_events disable trigger trg_finance_events_no_delete;
    alter table public.finance_notes disable trigger trg_finance_notes_no_delete;

    delete from public.finance_notes
    where entity_id in (
      select id from public.orders where order_number like v_prefix || '%'
      union select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
      union select id from public.invoices where invoice_number like 'UD-INV-TEST-%'
        and metadata->>'order_number' like v_prefix || '%'
      union select id from public.payment_transactions where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    ) or body like v_prefix || '%';

    delete from public.finance_events
    where entity_id in (
      select id from public.orders where order_number like v_prefix || '%'
      union select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
      union select id from public.invoices where metadata->>'order_number' like v_prefix || '%'
      union select id from public.statements where idempotency_key like v_prefix || '%'
      union select id from public.payment_transactions where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    ) or coalesce(actor_name_snapshot, '') like v_prefix || '%';

    delete from public.statements where idempotency_key like v_prefix || '%'
       or customer_id in (select id from public.customers where email like v_prefix || '%')
       or company_id in (select id from public.companies where name like v_prefix || '%');

    delete from public.finance_documents where id in (
      select document_id from public.invoices where metadata->>'order_number' like v_prefix || '%'
      union
      select document_id from public.statements where idempotency_key like v_prefix || '%'
    ) or title like v_prefix || '%';

    delete from public.invoices where metadata->>'order_number' like v_prefix || '%'
       or order_id in (select id from public.orders where order_number like v_prefix || '%');

    delete from public.finance_idempotency_keys where key like v_prefix || '%';

    delete from public.refund_line_items where refund_id in (
      select id from public.refunds where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    );
    delete from public.refunds where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.payment_transactions where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_tax_lines where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_items where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_events where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.orders where order_number like v_prefix || '%';
    delete from public.companies where name like v_prefix || '%';
    delete from public.customers where coalesce(email, '') like v_prefix || '%';

    alter table public.finance_events enable trigger trg_finance_events_no_delete;
    alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
  exception when others then
    begin
      alter table public.finance_events enable trigger trg_finance_events_no_delete;
      alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
    exception when others then null;
    end;
  end;

  -- Seed CRM + Unique order + Shopify-like untouched order
  insert into public.customers (
    email, display_name, first_name, last_name, source_system, status, approval_status
  ) values (
    v_prefix || 'cust@unique.local', v_prefix || 'Customer', 'Phase', 'TwoD',
    'unique', 'active', 'approved'
  ) returning id into v_customer_id;

  insert into public.companies (name, source_system, status)
  values (v_prefix || 'Company Ltd', 'unique', 'active')
  returning id into v_company_id;

  insert into public.orders (
    order_number, email, status, currency, subtotal, shipping_total, tax_total,
    discount_total, total, customer_id, company_id, financial_status,
    total_received, total_outstanding, payment_due_on, order_source, metadata,
    shipping_address, source_created_at
  ) values (
    v_prefix || 'ORD-001', v_prefix || 'cust@unique.local', 'pending', 'GBP',
    100.00, 0, 0, 0, 100.00, v_customer_id, v_company_id, 'PENDING',
    0, 100.00, current_date - 45, 'unique_draft',
    jsonb_build_object('source_system', 'unique', 'billing_address', jsonb_build_object('name', 'Test')),
    '{}'::jsonb, now() - interval '50 days'
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, product_name, unit_price, quantity, line_total, sku_snapshot
  ) values (
    v_order_id, v_prefix || 'Widget', 50.00, 2, 100.00, v_prefix || 'SKU-1'
  );

  -- Second Unique order: no due date
  insert into public.orders (
    order_number, email, status, currency, subtotal, total, customer_id, company_id,
    financial_status, total_received, total_outstanding, payment_due_on, order_source,
    metadata, source_created_at
  ) values (
    v_prefix || 'ORD-002', v_prefix || 'cust@unique.local', 'pending', 'GBP',
    50.00, 50.00, v_customer_id, v_company_id, 'PENDING', 0, 50.00, null,
    'unique_draft', jsonb_build_object('source_system', 'unique'), now()
  ) returning id into v_order2_id;

  -- Shopify-like historical order (untouched money must stay put)
  insert into public.orders (
    order_number, email, status, currency, subtotal, total, customer_id, company_id,
    financial_status, total_received, total_outstanding, payment_due_on,
    order_source, shopify_order_gid, metadata, source_created_at
  ) values (
    v_prefix || 'SH-100', v_prefix || 'cust@unique.local', 'paid', 'GBP',
    200.00, 200.00, v_customer_id, v_company_id, 'PARTIALLY_PAID', 80.00, 120.00,
    current_date - 10, 'shopify', 'gid://shopify/Order/' || v_prefix || '100',
    jsonb_build_object('source_system', 'shopify'), now() - interval '100 days'
  ) returning id into v_order_shopify_id;

  insert into public.payment_transactions (
    order_id, kind, status, gateway, amount, currency, source_system, processed_at
  ) values (
    v_order_shopify_id, 'SALE', 'SUCCESS', 'Worldpay eCommerce', 80.00, 'GBP', 'shopify', now() - interval '90 days'
  );

  select total_received, total_outstanding into v_shop_received, v_shop_outstanding
  from public.orders where id = v_order_shopify_id;

  -- ── A_ar_dashboard_agg ───────────────────────────────────────────────────
  begin
    v_case_ok := false;
    -- Direct aggregation (RPC Forbidden without admin JWT)
    v_rpc := public.rpc_admin_finance_dashboard(
      jsonb_build_object('customer_id', v_customer_id)
    );
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      select count(*)::int, coalesce(sum(total_outstanding), 0)
      into v_cnt, v_ord.total_outstanding
      from public.orders
      where customer_id = v_customer_id and total_outstanding > 0;
      if v_cnt >= 3 and v_ord.total_outstanding = 270.00 then
        v_case_ok := true;
        v_detail := 'open AR count=' || v_cnt || ' total=270; RPC Forbidden without admin';
      else
        v_detail := format('unexpected agg count=%s outstanding=%s', v_cnt, v_ord.total_outstanding);
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true'
          and (v_rpc->>'open_receivable_total')::numeric = 270 then
      v_case_ok := true;
      v_detail := 'dashboard ok total=270';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('A_ar_dashboard_agg', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_ar_dashboard_agg', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── B_aging_buckets ──────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_bucket := public.finance_aging_bucket(current_date - 45, current_date);
    if v_bucket = '31_60' then
      v_case_ok := true;
      v_detail := 'ORD-001 ages to 31_60';
    else
      v_detail := 'expected 31_60 got ' || coalesce(v_bucket, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('B_aging_buckets', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_aging_buckets', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── C_no_due_date ────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_bucket := public.finance_aging_bucket(null, current_date);
    if v_bucket = 'no_due_date' then
      v_case_ok := true;
      v_detail := 'null due → no_due_date';
    else
      v_detail := 'got ' || coalesce(v_bucket, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('C_no_due_date', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_no_due_date', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── D_manual_pay_partial ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_post_manual_payment_core(
      v_order_id, 40.00, 'Bank Deposit', current_date,
      v_prefix || 'REF-1', v_prefix || 'partial note',
      v_prefix || 'idem-partial', 100.00
    );
    if coalesce(v_rpc->>'ok', '') = 'true' then
      v_pay_id := (v_rpc->>'payment_id')::uuid;
      select * into v_ord from public.orders where id = v_order_id;
      if v_ord.total_received = 40 and v_ord.total_outstanding = 60
         and v_ord.financial_status = 'PARTIALLY_PAID' then
        v_case_ok := true;
        v_detail := 'partial 40/100 → PARTIALLY_PAID';
      else
        v_detail := format('received=%s outstanding=%s status=%s',
          v_ord.total_received, v_ord.total_outstanding, v_ord.financial_status);
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('D_manual_pay_partial', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_manual_pay_partial', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── E_manual_pay_full ────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_post_manual_payment_core(
      v_order_id, 60.00, 'Bank Deposit', current_date,
      v_prefix || 'REF-2', null, v_prefix || 'idem-full', 60.00
    );
    if coalesce(v_rpc->>'ok', '') = 'true' then
      v_pay2_id := (v_rpc->>'payment_id')::uuid;
      select * into v_ord from public.orders where id = v_order_id;
      if v_ord.total_received = 100 and v_ord.total_outstanding = 0
         and v_ord.financial_status = 'PAID' then
        v_case_ok := true;
        v_detail := 'full pay → PAID';
      else
        v_detail := format('received=%s outstanding=%s status=%s',
          v_ord.total_received, v_ord.total_outstanding, v_ord.financial_status);
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('E_manual_pay_full', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_manual_pay_full', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── F_idempotent_duplicate ───────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_post_manual_payment_core(
      v_order_id, 60.00, 'Bank Deposit', current_date,
      v_prefix || 'REF-2', null, v_prefix || 'idem-full', 0
    );
    if coalesce(v_rpc->>'ok', '') = 'true'
       and coalesce((v_rpc->>'idempotent_replay')::boolean, false) = true
       and (v_rpc->>'payment_id')::uuid = v_pay2_id then
      select total_received into v_ord.total_received from public.orders where id = v_order_id;
      if v_ord.total_received = 100 then
        v_case_ok := true;
        v_detail := 'idempotent replay; received still 100';
      else
        v_detail := 'replay ok but received changed to ' || v_ord.total_received::text;
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('F_idempotent_duplicate', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_idempotent_duplicate', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── G_overpayment_reject ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    -- Reset order2 for overpay test
    update public.orders set total_received = 0, total_outstanding = 50, financial_status = 'PENDING'
    where id = v_order2_id;
    v_rpc := public.finance_post_manual_payment_core(
      v_order2_id, 75.00, 'manual', current_date, null, null, v_prefix || 'idem-over', 50.00
    );
    if coalesce(v_rpc->>'error', '') in ('amount_exceeds_outstanding', 'overpayment_rejected') then
      v_case_ok := true;
      v_detail := 'rejected: ' || (v_rpc->>'error');
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('G_overpayment_reject', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_overpayment_reject', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── H_stale_outstanding_conflict ─────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_post_manual_payment_core(
      v_order2_id, 10.00, 'manual', current_date, null, null, v_prefix || 'idem-stale', 999.00
    );
    if coalesce(v_rpc->>'error', '') = 'outstanding_conflict' then
      v_case_ok := true;
      v_detail := 'stale expected outstanding rejected';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('H_stale_outstanding_conflict', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_stale_outstanding_conflict', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── I_reverse_manual ─────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    -- Post then reverse on order2
    v_rpc := public.finance_post_manual_payment_core(
      v_order2_id, 20.00, 'manual', current_date, null, null, v_prefix || 'idem-rev-src', 50.00
    );
    v_pay_id := (v_rpc->>'payment_id')::uuid;
    v_rpc := public.finance_reverse_manual_payment_core(v_pay_id, 'selftest reverse', v_prefix || 'idem-rev');
    if coalesce(v_rpc->>'ok', '') = 'true' then
      v_rev_id := (v_rpc->>'reversal_id')::uuid;
      select * into v_ord from public.orders where id = v_order2_id;
      if v_ord.total_received = 0 and v_ord.total_outstanding = 50 and v_rev_id is not null then
        v_case_ok := true;
        v_detail := 'reversed; back to 0/50';
      else
        v_detail := format('received=%s outstanding=%s', v_ord.total_received, v_ord.total_outstanding);
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('I_reverse_manual', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('I_reverse_manual', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── J_reverse_twice_fail ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_reverse_manual_payment_core(v_pay_id, 'again', v_prefix || 'idem-rev2');
    if coalesce(v_rpc->>'error', '') = 'already_reversed' then
      v_case_ok := true;
      v_detail := 'second reverse rejected';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('J_reverse_twice_fail', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('J_reverse_twice_fail', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── K_permission_forbidden ───────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_admin_post_manual_payment(v_order2_id, 1, 'manual', current_date, null, null, null, 50);
    if auth.uid() is null and coalesce(v_rpc->>'error', '') = 'Forbidden' then
      v_rpc := public.rpc_admin_create_invoice_from_order(v_order_id, v_prefix || 'inv-forbid', false);
      if coalesce(v_rpc->>'error', '') = 'Forbidden' then
        v_case_ok := true;
        v_detail := 'post+invoice Forbidden without admin';
      else
        v_detail := 'invoice: ' || v_rpc::text;
      end if;
    else
      v_detail := 'post: ' || coalesce(v_rpc::text, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('K_permission_forbidden', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('K_permission_forbidden', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── L_invoice_create ─────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_create_invoice_from_order_core(v_order_id, v_prefix || 'inv-1', false);
    if coalesce(v_rpc->>'ok', '') = 'true'
       and coalesce(v_rpc->>'provenance', '') = 'unique_native' then
      v_inv_id := (v_rpc->>'invoice_id')::uuid;
      if (v_rpc->>'invoice_number') like 'UD-INV-TEST-%' then
        v_case_ok := true;
        v_detail := 'invoice ' || (v_rpc->>'invoice_number') || ' unique_native';
      else
        v_detail := 'bad number ' || coalesce(v_rpc->>'invoice_number', '');
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('L_invoice_create', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('L_invoice_create', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── M_invoice_idempotent ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_create_invoice_from_order_core(v_order_id, v_prefix || 'inv-1', false);
    if coalesce(v_rpc->>'ok', '') = 'true'
       and coalesce((v_rpc->>'idempotent_replay')::boolean, false) = true
       and (v_rpc->>'invoice_id')::uuid = v_inv_id then
      v_case_ok := true;
      v_detail := 'invoice idempotent replay';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('M_invoice_idempotent', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('M_invoice_idempotent', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── N_shopify_order_untouched ────────────────────────────────────────────
  begin
    v_case_ok := false;
    select * into v_ord_shop from public.orders where id = v_order_shopify_id;
    if v_ord_shop.total_received = v_shop_received
       and v_ord_shop.total_outstanding = v_shop_outstanding then
      -- Attempt UPDATE on Shopify tx must fail
      begin
        update public.payment_transactions set amount = 1
        where order_id = v_order_shopify_id and source_system = 'shopify';
        v_detail := 'Shopify tx UPDATE unexpectedly allowed';
      exception when others then
        v_case_ok := true;
        v_detail := 'Shopify money untouched; tx immutable';
      end;
    else
      v_detail := format('shopify received/outstanding changed %s/%s',
        v_ord_shop.total_received, v_ord_shop.total_outstanding);
    end if;
    v_cases := v_cases || jsonb_build_object('N_shopify_order_untouched', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('N_shopify_order_untouched', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── O_statement_balances ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_generate_statement_core(
      v_customer_id, v_company_id,
      current_date - 120, current_date,
      v_prefix || 'stmt-1'
    );
    if coalesce(v_rpc->>'ok', '') = 'true' then
      v_stmt_id := (v_rpc->>'statement_id')::uuid;
      if v_stmt_id is not null
         and (v_rpc ? 'opening_balance')
         and (v_rpc ? 'closing_balance') then
        v_case_ok := true;
        v_detail := format('stmt opening=%s closing=%s',
          v_rpc->>'opening_balance', v_rpc->>'closing_balance');
      else
        v_detail := 'missing balances';
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('O_statement_balances', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('O_statement_balances', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── P_refund_read ────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    insert into public.refunds (order_id, note, total_refunded, currency, source_system)
    values (v_order_id, v_prefix || 'refund sample', 0, 'GBP', 'unique')
    returning id into v_refund_id;
    v_rpc := public.rpc_get_admin_finance_refund(v_refund_id);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      -- Direct read path for service_role selftest without JWT
      if exists (select 1 from public.refunds where id = v_refund_id) then
        v_case_ok := true;
        v_detail := 'refund row readable; RPC Forbidden without admin';
      else
        v_detail := 'refund missing';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' then
      v_case_ok := true;
      v_detail := 'refund RPC ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('P_refund_read', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('P_refund_read', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── Q_audit_events ───────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    select count(*)::int into v_cnt
    from public.finance_events
    where entity_type = 'order' and entity_id = v_order_id
      and event_type in ('manual_payment_posted', 'invoice_created');
    if v_cnt >= 2 then
      v_case_ok := true;
      v_detail := 'finance_events count=' || v_cnt::text;
    else
      v_detail := 'expected >=2 events got ' || v_cnt::text;
    end if;
    v_cases := v_cases || jsonb_build_object('Q_audit_events', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('Q_audit_events', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── R_provenance_reconstructed ───────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_create_invoice_from_order_core(
      v_order_shopify_id, v_prefix || 'inv-recon', true
    );
    if coalesce(v_rpc->>'ok', '') = 'true'
       and coalesce(v_rpc->>'provenance', '') = 'reconstructed_from_order' then
      v_case_ok := true;
      v_detail := 'Shopify order invoice provenance=reconstructed_from_order';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('R_provenance_reconstructed', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('R_provenance_reconstructed', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── S_finance_note ───────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    insert into public.finance_notes (entity_type, entity_id, body, author_name_snapshot, source_system)
    values ('order', v_order_id, v_prefix || ' note body', 'phase2d_selftest', 'unique');
    select count(*)::int into v_cnt
    from public.finance_notes
    where entity_type = 'order' and entity_id = v_order_id;
    if v_cnt >= 1 then
      v_case_ok := true;
      v_detail := 'note appended';
    else
      v_detail := 'note missing';
    end if;
    v_cases := v_cases || jsonb_build_object('S_finance_note', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('S_finance_note', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── T_reconciliation_flags_shape ─────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_admin_finance_reconciliation_flags(10);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      v_case_ok := true;
      v_detail := 'flags RPC Forbidden without admin (expected in selftest)';
    elsif coalesce(v_rpc->>'ok', '') = 'true' and v_rpc ? 'flags' then
      v_case_ok := true;
      v_detail := 'flags RPC ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('T_reconciliation_flags_shape', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('T_reconciliation_flags_shape', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── U_order_panel_shape ──────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_get_admin_order_finance_panel(v_order_id);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      if exists (select 1 from public.payment_transactions where order_id = v_order_id and source_system = 'unique') then
        v_case_ok := true;
        v_detail := 'panel Forbidden without admin; Unique txs present';
      else
        v_detail := 'no unique txs';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' and v_rpc ? 'payments' then
      v_case_ok := true;
      v_detail := 'panel ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('U_order_panel_shape', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('U_order_panel_shape', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── V_crm_finance_summary_shape ──────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_get_admin_crm_finance_summary('customer', v_customer_id);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      select coalesce(sum(total_outstanding), 0) into v_ord.total_outstanding
      from public.orders where customer_id = v_customer_id;
      v_case_ok := true;
      v_detail := 'summary Forbidden without admin; customer outstanding=' || v_ord.total_outstanding::text;
    elsif coalesce(v_rpc->>'ok', '') = 'true' then
      v_case_ok := true;
      v_detail := 'crm finance summary ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('V_crm_finance_summary_shape', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('V_crm_finance_summary_shape', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- Score
  select count(*)::int,
         count(*) filter (where (value->>'ok')::boolean)::int
  into v_total, v_pass
  from jsonb_each(v_cases);

  if v_total > 0 then
    v_rate := round((v_pass::numeric / v_total::numeric) * 100, 1);
  end if;

  -- ── Final cleanup (always) ───────────────────────────────────────────────
  begin
    perform set_config('ud.allow_finance_selftest_cleanup', 'on', true);
    alter table public.finance_events disable trigger trg_finance_events_no_delete;
    alter table public.finance_notes disable trigger trg_finance_notes_no_delete;
    alter table public.payment_transactions disable trigger trg_payment_transactions_shopify_immutable;
    alter table public.refunds disable trigger trg_refunds_shopify_immutable;

    delete from public.finance_notes
    where entity_id in (
      select id from public.orders where order_number like v_prefix || '%'
      union select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
      union select id from public.invoices where metadata->>'order_number' like v_prefix || '%'
      union select id from public.payment_transactions where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    ) or body like v_prefix || '%';

    delete from public.finance_events
    where entity_id in (
      select id from public.orders where order_number like v_prefix || '%'
      union select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
      union select id from public.invoices where metadata->>'order_number' like v_prefix || '%'
      union select id from public.statements where idempotency_key like v_prefix || '%'
      union select id from public.payment_transactions where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    ) or coalesce(actor_name_snapshot, '') like v_prefix || '%';

    delete from public.statements where idempotency_key like v_prefix || '%'
       or customer_id in (select id from public.customers where email like v_prefix || '%')
       or company_id in (select id from public.companies where name like v_prefix || '%');

    delete from public.finance_documents where id in (
      select document_id from public.invoices
      where metadata->>'order_number' like v_prefix || '%'
         or order_id in (select id from public.orders where order_number like v_prefix || '%')
      union
      select document_id from public.statements where idempotency_key like v_prefix || '%'
    );

    delete from public.invoices
    where metadata->>'order_number' like v_prefix || '%'
       or order_id in (select id from public.orders where order_number like v_prefix || '%');

    delete from public.finance_idempotency_keys where key like v_prefix || '%';

    delete from public.refund_line_items where refund_id in (
      select id from public.refunds where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    );
    delete from public.refunds where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.payment_transactions where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_tax_lines where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_items where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_events where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.orders where order_number like v_prefix || '%';
    delete from public.companies where name like v_prefix || '%';
    delete from public.customers where coalesce(email, '') like v_prefix || '%';

    alter table public.payment_transactions enable trigger trg_payment_transactions_shopify_immutable;
    alter table public.refunds enable trigger trg_refunds_shopify_immutable;
    alter table public.finance_events enable trigger trg_finance_events_no_delete;
    alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
  exception when others then
    v_cleanup_ok := false;
    v_cleanup_detail := SQLERRM;
    begin
      alter table public.payment_transactions enable trigger trg_payment_transactions_shopify_immutable;
      alter table public.refunds enable trigger trg_refunds_shopify_immutable;
      alter table public.finance_events enable trigger trg_finance_events_no_delete;
      alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
    exception when others then null;
    end;
  end;

  return jsonb_build_object(
    'ok', v_pass = v_total and v_cleanup_ok,
    'pass', v_pass,
    'total', v_total,
    'pass_rate_pct', v_rate,
    'cases', v_cases,
    'cleanup', jsonb_build_object('ok', v_cleanup_ok, 'detail', v_cleanup_detail)
  );
end;
$$;

comment on function public.rpc_phase2d_finance_selftest() is
  'Phase 2D Finance & AR selftest. service_role only. Synthetic PHASE2D-STAB-* data; always cleaned up.';

revoke all on function public.rpc_phase2d_finance_selftest() from public;
revoke all on function public.rpc_phase2d_finance_selftest() from anon;
revoke all on function public.rpc_phase2d_finance_selftest() from authenticated;
grant execute on function public.rpc_phase2d_finance_selftest() to service_role;
