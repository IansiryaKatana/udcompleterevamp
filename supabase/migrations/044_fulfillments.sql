-- Phase 3A — Fulfilments + inventory location foundation
-- Additive. Keeps orders.fulfillment_status / tracking_number / carrier / shipped_at
-- as the simple CMS summary used by Admin ship UI and account pages.

-- ── Inventory locations (start with UD WH 1; no movement ledger yet) ─────────
create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  is_active boolean not null default true,
  is_primary boolean not null default false,
  fulfills_online_orders boolean not null default true,
  address1 text,
  address2 text,
  city text,
  province text,
  province_code text,
  postal_code text,
  country text,
  country_code text,
  phone text,
  source_system text,
  external_gid text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_locations_name_chk check (char_length(trim(name)) > 0)
);

comment on table public.inventory_locations is
  'Warehouse/stock locations. Shopify showed a single active location (UD WH 1). Stock movements deferred.';

create unique index if not exists inventory_locations_external_gid_uidx
  on public.inventory_locations (source_system, external_gid)
  where external_gid is not null and source_system is not null;

create unique index if not exists inventory_locations_code_uidx
  on public.inventory_locations (code)
  where code is not null;

create index if not exists inventory_locations_primary_idx
  on public.inventory_locations (is_primary)
  where is_primary = true;

drop trigger if exists trg_inventory_locations_updated_at on public.inventory_locations;
create trigger trg_inventory_locations_updated_at
  before update on public.inventory_locations
  for each row execute function public.set_updated_at();

alter table public.inventory_locations enable row level security;

drop policy if exists "admin_all_inventory_locations" on public.inventory_locations;
create policy "admin_all_inventory_locations" on public.inventory_locations
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Public read of active locations is not required for storefront today.
grant select, insert, update, delete on public.inventory_locations to authenticated;
grant all on public.inventory_locations to service_role;

-- Seed known Shopify warehouse (idempotent by code).
do $$
begin
  if not exists (select 1 from public.inventory_locations where code = 'UD_WH_1') then
    insert into public.inventory_locations (
      name, code, is_active, is_primary, fulfills_online_orders,
      address1, city, province, province_code, postal_code, country, country_code, phone,
      source_system, external_gid
    ) values (
      'UD WH 1', 'UD_WH_1', true, true, true,
      'Unit 2, Hollins Business Park', 'Darwen', 'England', 'ENG', 'BB3 1HN',
      'United Kingdom', 'GB', '+447944238204',
      'shopify', 'gid://shopify/Location/93733355846'
    );
  end if;
end;
$$;

-- ── Order shipping lines (method titles from Shopify) ───────────────────────
create table if not exists public.order_shipping_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  title text,
  code text,
  source text,
  carrier_identifier text,
  original_price numeric(14,2) not null default 0,
  currency text not null default 'GBP',
  source_system text,
  external_gid text,
  created_at timestamptz not null default now()
);

comment on table public.order_shipping_lines is
  'Shipping method lines (e.g. Standard Delivery, Saturday delivery).';

create index if not exists order_shipping_lines_order_id_idx
  on public.order_shipping_lines (order_id);

alter table public.order_shipping_lines enable row level security;

drop policy if exists "admin_all_order_shipping_lines" on public.order_shipping_lines;
create policy "admin_all_order_shipping_lines" on public.order_shipping_lines
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customer_read_own_order_shipping_lines" on public.order_shipping_lines;
create policy "customer_read_own_order_shipping_lines" on public.order_shipping_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_shipping_lines.order_id
        and (
          o.user_id = (select auth.uid())
          or exists (
            select 1 from public.customers c
            where c.id = o.customer_id and c.auth_user_id = (select auth.uid())
          )
        )
    )
  );

grant select, insert, update, delete on public.order_shipping_lines to authenticated;
grant all on public.order_shipping_lines to service_role;

-- ── Fulfilments (shipments) ─────────────────────────────────────────────────
create table if not exists public.fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  inventory_location_id uuid references public.inventory_locations(id) on delete set null,
  status text,
  display_status text,
  name text,
  service_handle text,
  service_name text,
  tracking_company text,
  tracking_number text,
  tracking_url text,
  -- Multiple tracking numbers/companies as JSON array of {company, number, url}
  tracking_info jsonb not null default '[]'::jsonb,
  -- DPD Integration by WSA custom attribute and similar carrier statuses
  carrier_status text,
  carrier_status_raw jsonb not null default '{}'::jsonb,
  estimated_delivery_at timestamptz,
  in_transit_at timestamptz,
  delivered_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_system text,
  external_gid text,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fulfillments is
  'Shipment headers. Shopify service was Manual; tracking often DPD/DPD UK; carrier_status holds DPD Delivery Status.';
comment on column public.orders.tracking_number is
  'CMS summary tracking for simple ship UI. Detailed shipments live in fulfillments.';

create index if not exists fulfillments_order_id_idx
  on public.fulfillments (order_id);

create index if not exists fulfillments_tracking_number_idx
  on public.fulfillments (tracking_number)
  where tracking_number is not null;

create index if not exists fulfillments_tracking_company_idx
  on public.fulfillments (tracking_company)
  where tracking_company is not null;

create index if not exists fulfillments_carrier_status_idx
  on public.fulfillments (carrier_status)
  where carrier_status is not null;

create unique index if not exists fulfillments_external_gid_uidx
  on public.fulfillments (source_system, external_gid)
  where external_gid is not null and source_system is not null;

drop trigger if exists trg_fulfillments_updated_at on public.fulfillments;
create trigger trg_fulfillments_updated_at
  before update on public.fulfillments
  for each row execute function public.set_updated_at();

alter table public.fulfillments enable row level security;

drop policy if exists "admin_select_fulfillments" on public.fulfillments;
create policy "admin_select_fulfillments" on public.fulfillments
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_fulfillments" on public.fulfillments;
create policy "admin_insert_fulfillments" on public.fulfillments
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_fulfillments" on public.fulfillments;
create policy "admin_update_fulfillments" on public.fulfillments
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.fulfillments to authenticated;
revoke delete on public.fulfillments from authenticated;
grant all on public.fulfillments to service_role;

drop policy if exists "customer_read_own_fulfillments" on public.fulfillments;
create policy "customer_read_own_fulfillments" on public.fulfillments
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = fulfillments.order_id
        and (
          o.user_id = (select auth.uid())
          or exists (
            select 1 from public.customers c
            where c.id = o.customer_id and c.auth_user_id = (select auth.uid())
          )
        )
    )
  );

-- ── Fulfilment line items ───────────────────────────────────────────────────
create table if not exists public.fulfillment_line_items (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.fulfillments(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  quantity int not null default 0,
  sku_snapshot text,
  name_snapshot text,
  source_system text,
  external_gid text,
  created_at timestamptz not null default now()
);

create index if not exists fulfillment_line_items_fulfillment_id_idx
  on public.fulfillment_line_items (fulfillment_id);

create index if not exists fulfillment_line_items_order_item_id_idx
  on public.fulfillment_line_items (order_item_id)
  where order_item_id is not null;

alter table public.fulfillment_line_items enable row level security;

drop policy if exists "admin_all_fulfillment_line_items" on public.fulfillment_line_items;
create policy "admin_all_fulfillment_line_items" on public.fulfillment_line_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.fulfillment_line_items to authenticated;
grant all on public.fulfillment_line_items to service_role;
