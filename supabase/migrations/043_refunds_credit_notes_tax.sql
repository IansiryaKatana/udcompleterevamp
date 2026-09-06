-- Phase 2C — Refunds, credit notes, order tax lines
-- Additive. Native Shopify Returns remain rare; credit_note metafield is separate.

-- ── Order tax lines (invoice reconstruction) ────────────────────────────────
create table if not exists public.order_tax_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  title text not null,
  rate numeric(8,6),
  rate_percentage numeric(8,4),
  price numeric(14,2) not null default 0,
  currency text not null default 'GBP',
  channel_liable boolean,
  source_system text,
  created_at timestamptz not null default now(),
  constraint order_tax_lines_title_chk check (char_length(trim(title)) > 0)
);

comment on table public.order_tax_lines is
  'VAT/tax lines for orders and optional per-line allocation. UD prices are typically VAT-exclusive (GB VAT 20%).';

create index if not exists order_tax_lines_order_id_idx
  on public.order_tax_lines (order_id);

create index if not exists order_tax_lines_order_item_id_idx
  on public.order_tax_lines (order_item_id)
  where order_item_id is not null;

alter table public.order_tax_lines enable row level security;

drop policy if exists "admin_all_order_tax_lines" on public.order_tax_lines;
create policy "admin_all_order_tax_lines" on public.order_tax_lines
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customer_read_own_order_tax_lines" on public.order_tax_lines;
create policy "customer_read_own_order_tax_lines" on public.order_tax_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_tax_lines.order_id
        and (
          o.user_id = (select auth.uid())
          or exists (
            select 1 from public.customers c
            where c.id = o.customer_id and c.auth_user_id = (select auth.uid())
          )
        )
    )
  );

grant select, insert, update, delete on public.order_tax_lines to authenticated;
grant all on public.order_tax_lines to service_role;

-- ── Refunds ─────────────────────────────────────────────────────────────────
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  note text,
  total_refunded numeric(14,2) not null default 0,
  currency text not null default 'GBP',
  source_created_at timestamptz,
  source_system text,
  external_gid text,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.refunds is
  'Refund headers. Link related REFUND rows in payment_transactions via metadata or parent_transaction_id.';

create index if not exists refunds_order_id_idx
  on public.refunds (order_id);

create unique index if not exists refunds_external_gid_uidx
  on public.refunds (source_system, external_gid)
  where external_gid is not null and source_system is not null;

drop trigger if exists trg_refunds_updated_at on public.refunds;
create trigger trg_refunds_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();

alter table public.refunds enable row level security;

drop policy if exists "admin_select_refunds" on public.refunds;
create policy "admin_select_refunds" on public.refunds
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_refunds" on public.refunds;
create policy "admin_insert_refunds" on public.refunds
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_refunds" on public.refunds;
create policy "admin_update_refunds" on public.refunds
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.refunds to authenticated;
revoke delete on public.refunds from authenticated;
grant all on public.refunds to service_role;

drop policy if exists "customer_read_own_refunds" on public.refunds;
create policy "customer_read_own_refunds" on public.refunds
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = refunds.order_id
        and (
          o.user_id = (select auth.uid())
          or exists (
            select 1 from public.customers c
            where c.id = o.customer_id and c.auth_user_id = (select auth.uid())
          )
        )
    )
  );

-- ── Refund line items ───────────────────────────────────────────────────────
create table if not exists public.refund_line_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refunds(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  quantity int not null default 0,
  restock_type text,
  subtotal numeric(14,2) not null default 0,
  total_tax numeric(14,2) not null default 0,
  sku_snapshot text,
  name_snapshot text,
  source_system text,
  external_gid text,
  created_at timestamptz not null default now()
);

create index if not exists refund_line_items_refund_id_idx
  on public.refund_line_items (refund_id);

create index if not exists refund_line_items_order_item_id_idx
  on public.refund_line_items (order_item_id)
  where order_item_id is not null;

alter table public.refund_line_items enable row level security;

drop policy if exists "admin_all_refund_line_items" on public.refund_line_items;
create policy "admin_all_refund_line_items" on public.refund_line_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.refund_line_items to authenticated;
grant all on public.refund_line_items to service_role;

-- ── Credit notes (finance / PT2 — distinct from Shopify Returns) ────────────
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  ar_account_id uuid references public.ar_accounts(id) on delete set null,
  refund_id uuid references public.refunds(id) on delete set null,
  status text not null default 'draft',
  flag_value text,
  amount numeric(14,2),
  currency text not null default 'GBP',
  reason text,
  document_number text,
  issued_at timestamptz,
  source_system text,
  external_gid text,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.credit_notes is
  'Finance credit notes (Shopify custom.credit_note / PT2). Not the same as native Shopify Return objects.';
comment on column public.credit_notes.flag_value is
  'Raw metafield value when imported (Yes/No). Normalized amount may be filled later.';

create index if not exists credit_notes_order_id_idx
  on public.credit_notes (order_id)
  where order_id is not null;

create index if not exists credit_notes_company_id_idx
  on public.credit_notes (company_id)
  where company_id is not null;

create index if not exists credit_notes_status_idx
  on public.credit_notes (status);

create unique index if not exists credit_notes_external_gid_uidx
  on public.credit_notes (source_system, external_gid)
  where external_gid is not null and source_system is not null;

drop trigger if exists trg_credit_notes_updated_at on public.credit_notes;
create trigger trg_credit_notes_updated_at
  before update on public.credit_notes
  for each row execute function public.set_updated_at();

alter table public.credit_notes enable row level security;

drop policy if exists "admin_all_credit_notes" on public.credit_notes;
create policy "admin_all_credit_notes" on public.credit_notes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.credit_notes to authenticated;
grant all on public.credit_notes to service_role;

-- Optional link from refund → payment transaction
alter table public.refunds
  add column if not exists payment_transaction_id uuid references public.payment_transactions(id) on delete set null;

create index if not exists refunds_payment_transaction_id_idx
  on public.refunds (payment_transaction_id)
  where payment_transaction_id is not null;
