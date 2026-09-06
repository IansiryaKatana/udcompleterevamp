-- Phase 4 — Draft orders (sales-assisted / credit / phone-order path)
-- Additive. Does NOT replace storefront quote_requested orders or Stripe checkout.

create table if not exists public.draft_orders (
  id uuid primary key default gen_random_uuid(),
  name text,
  status text not null default 'open',
  email text,
  phone text,
  note text,
  po_number text,
  tax_exempt boolean not null default false,
  taxes_included boolean not null default false,
  currency text not null default 'GBP',
  ready boolean not null default false,
  reserve_inventory_until timestamptz,
  subtotal numeric(14,2) not null default 0,
  total_tax numeric(14,2) not null default 0,
  total_shipping numeric(14,2) not null default 0,
  total_discounts numeric(14,2) not null default 0,
  total_price numeric(14,2) not null default 0,
  invoice_url text,
  invoice_sent_at timestamptz,
  completed_at timestamptz,
  -- Purchasing entity
  purchasing_entity_type text,
  customer_id uuid references public.customers(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  company_location_id uuid references public.company_locations(id) on delete set null,
  -- Sales ownership (mirrors Shopify metafields)
  salesperson_id uuid references public.staff_members(id) on delete set null,
  referrer_id uuid references public.staff_members(id) on delete set null,
  trading_name_snapshot text,
  customer_type_snapshot text,
  payment_due_on date,
  -- Addresses as jsonb for source fidelity
  billing_address jsonb not null default '{}'::jsonb,
  shipping_address jsonb not null default '{}'::jsonb,
  custom_attributes jsonb not null default '[]'::jsonb,
  shipping_line jsonb,
  -- Converted live order
  converted_order_id uuid references public.orders(id) on delete set null,
  source_system text,
  shopify_draft_gid text,
  shopify_legacy_id text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint draft_orders_status_chk check (char_length(trim(status)) > 0)
);

comment on table public.draft_orders is
  'Wholesale sales drafts (Shopify DraftOrder). Distinct from storefront quote_requested checkout orders.';
comment on column public.draft_orders.status is
  'open | invoice_sent | completed | … (free text for Shopify parity)';
comment on column public.draft_orders.purchasing_entity_type is
  'PurchasingCompany | Customer | null';
comment on column public.draft_orders.converted_order_id is
  'Set when draft completes into a live order (FromDraft path).';

create index if not exists draft_orders_status_idx
  on public.draft_orders (status);

create index if not exists draft_orders_customer_id_idx
  on public.draft_orders (customer_id)
  where customer_id is not null;

create index if not exists draft_orders_company_id_idx
  on public.draft_orders (company_id)
  where company_id is not null;

create index if not exists draft_orders_salesperson_id_idx
  on public.draft_orders (salesperson_id)
  where salesperson_id is not null;

create index if not exists draft_orders_converted_order_id_idx
  on public.draft_orders (converted_order_id)
  where converted_order_id is not null;

create index if not exists draft_orders_source_created_at_idx
  on public.draft_orders (source_created_at)
  where source_created_at is not null;

create unique index if not exists draft_orders_shopify_draft_gid_uidx
  on public.draft_orders (shopify_draft_gid)
  where shopify_draft_gid is not null;

create unique index if not exists draft_orders_shopify_legacy_id_uidx
  on public.draft_orders (shopify_legacy_id)
  where shopify_legacy_id is not null;

drop trigger if exists trg_draft_orders_updated_at on public.draft_orders;
create trigger trg_draft_orders_updated_at
  before update on public.draft_orders
  for each row execute function public.set_updated_at();

alter table public.draft_orders enable row level security;

drop policy if exists "admin_select_draft_orders" on public.draft_orders;
create policy "admin_select_draft_orders" on public.draft_orders
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_draft_orders" on public.draft_orders;
create policy "admin_insert_draft_orders" on public.draft_orders
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_draft_orders" on public.draft_orders;
create policy "admin_update_draft_orders" on public.draft_orders
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_delete_draft_orders" on public.draft_orders;
create policy "admin_delete_draft_orders" on public.draft_orders
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.draft_orders to authenticated;
grant all on public.draft_orders to service_role;

-- ── Draft line items (immutable snapshots; product may be missing later) ────
create table if not exists public.draft_order_line_items (
  id uuid primary key default gen_random_uuid(),
  draft_order_id uuid not null references public.draft_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  title text not null,
  variant_title text,
  sku_snapshot text,
  vendor_snapshot text,
  quantity int not null default 1,
  original_unit_price numeric(14,2) not null default 0,
  discounted_unit_price numeric(14,2),
  original_total numeric(14,2) not null default 0,
  discounted_total numeric(14,2),
  taxable boolean not null default true,
  requires_shipping boolean not null default true,
  custom_attributes jsonb not null default '[]'::jsonb,
  tax_lines jsonb not null default '[]'::jsonb,
  product_shopify_gid text,
  variant_shopify_gid text,
  source_line_item_gid text,
  deleted_product boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint draft_order_line_items_title_chk check (char_length(trim(title)) > 0)
);

comment on table public.draft_order_line_items is
  'Draft line snapshots. Display must work when product/variant rows are gone.';

create index if not exists draft_order_line_items_draft_id_idx
  on public.draft_order_line_items (draft_order_id);

create index if not exists draft_order_line_items_sku_idx
  on public.draft_order_line_items (sku_snapshot)
  where sku_snapshot is not null;

alter table public.draft_order_line_items enable row level security;

drop policy if exists "admin_all_draft_order_line_items" on public.draft_order_line_items;
create policy "admin_all_draft_order_line_items" on public.draft_order_line_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.draft_order_line_items to authenticated;
grant all on public.draft_order_line_items to service_role;

-- Link live orders back to originating draft (FromDraft).
alter table public.orders
  add column if not exists draft_order_id uuid references public.draft_orders(id) on delete set null;

comment on column public.orders.draft_order_id is
  'Originating wholesale draft when order_source / tags indicate FromDraft conversion.';

create index if not exists orders_draft_order_id_idx
  on public.orders (draft_order_id)
  where draft_order_id is not null;
