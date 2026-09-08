-- Phase 5E — Catalogue schema parity (EXTEND existing products architecture)
-- Does NOT flip locked gates. Does NOT enable WMS/Worldpay/DPD.
-- Does NOT rebuild storefront — extends schema for Shopify catalogue import.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'pilot_send_authorized' and value is distinct from 'false';
update public.site_settings set value = 'observe'
where key = 'compliance_enforcement_mode' and value is distinct from 'observe';
update public.site_settings set value = 'false'
where key = 'wms_enabled' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'automation_engine_enabled' and value is distinct from 'false';

-- ── Products EXTEND ─────────────────────────────────────────────────────────
alter table public.products
  add column if not exists vendor text,
  add column if not exists product_type text,
  add column if not exists shopify_status text,
  add column if not exists source_system text,
  add column if not exists shopify_product_gid text,
  add column if not exists shopify_legacy_id text,
  add column if not exists shopify_handle text,
  add column if not exists source_created_at timestamptz,
  add column if not exists source_updated_at timestamptz,
  add column if not exists description_html text,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists options_json jsonb not null default '[]'::jsonb,
  add column if not exists tags_raw text[] not null default '{}',
  add column if not exists tracks_inventory boolean,
  add column if not exists total_inventory int,
  add column if not exists published_at timestamptz,
  add column if not exists catalogue_origin text
    check (catalogue_origin is null or catalogue_origin in ('SHOPIFY_IMPORTED','UNIQUE_NATIVE','POSSIBLE_CONFLICT')),
  add column if not exists import_batch_id uuid;

create unique index if not exists products_shopify_product_gid_uidx
  on public.products (shopify_product_gid)
  where shopify_product_gid is not null;

create index if not exists products_shopify_handle_idx
  on public.products (shopify_handle)
  where shopify_handle is not null;

create index if not exists products_vendor_idx on public.products (vendor);
create index if not exists products_product_type_idx on public.products (product_type);
create index if not exists products_shopify_status_idx on public.products (shopify_status);
create index if not exists products_catalogue_origin_idx on public.products (catalogue_origin);

-- ── Variants EXTEND ─────────────────────────────────────────────────────────
alter table public.product_variants
  add column if not exists barcode text,
  add column if not exists shopify_variant_gid text,
  add column if not exists shopify_legacy_id text,
  add column if not exists shopify_inventory_item_gid text,
  add column if not exists position int,
  add column if not exists taxable boolean,
  add column if not exists weight_value numeric(14,4),
  add column if not exists weight_unit text,
  add column if not exists source_system text,
  add column if not exists source_created_at timestamptz,
  add column if not exists source_updated_at timestamptz,
  add column if not exists available_for_sale boolean,
  add column if not exists sku_quality text
    check (sku_quality is null or sku_quality in ('VALID','MISSING','DUPLICATE','INVALID_FORMAT')),
  add column if not exists barcode_quality text
    check (barcode_quality is null or barcode_quality in ('VALID','MISSING','DUPLICATE','INVALID_FORMAT')),
  add column if not exists import_batch_id uuid;

create unique index if not exists product_variants_shopify_variant_gid_uidx
  on public.product_variants (shopify_variant_gid)
  where shopify_variant_gid is not null;

create index if not exists product_variants_barcode_idx
  on public.product_variants (barcode)
  where barcode is not null;

create index if not exists product_variants_sku_idx
  on public.product_variants (sku)
  where sku is not null;

-- ── Collections EXTEND ──────────────────────────────────────────────────────
alter table public.collections
  add column if not exists shopify_collection_gid text,
  add column if not exists shopify_legacy_id text,
  add column if not exists shopify_handle text,
  add column if not exists description_html text,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists collection_type text,
  add column if not exists source_system text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists sort_order_rule text,
  add column if not exists rule_definition_json jsonb,
  add column if not exists rule_definition_status text
    check (rule_definition_status is null or rule_definition_status in ('KNOWN','UNKNOWN','NOT_APPLICABLE')),
  add column if not exists import_batch_id uuid,
  add column if not exists is_active boolean default true;

-- is_active may already exist — ignore
do $$ begin
  alter table public.collections alter column is_active set default true;
exception when others then null;
end $$;

create unique index if not exists collections_shopify_collection_gid_uidx
  on public.collections (shopify_collection_gid)
  where shopify_collection_gid is not null;

-- ── M2M product ↔ collection ────────────────────────────────────────────────
create table if not exists public.product_collections (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  position int,
  source_system text default 'shopify',
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  unique (product_id, collection_id)
);

create index if not exists product_collections_collection_idx
  on public.product_collections (collection_id, product_id);

alter table public.product_collections enable row level security;
drop policy if exists "admin_all_product_collections" on public.product_collections;
create policy "admin_all_product_collections" on public.product_collections
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Storefront reads via SECURITY DEFINER RPCs only
grant select, insert, update, delete on public.product_collections to authenticated;
grant all on public.product_collections to service_role;

-- ── Product media provenance ────────────────────────────────────────────────
create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  shopify_media_gid text,
  position int not null default 0,
  alt_text text,
  source_url text,
  destination_url text,
  destination_asset_id text,
  checksum text,
  width int,
  height int,
  status text not null default 'SOURCE_REFERENCED'
    check (status in (
      'SOURCE_REFERENCED','COPIED','SOURCE_NOT_FOUND','DOWNLOAD_FAILED',
      'UPLOAD_FAILED','INVALID_MEDIA','DUPLICATE','OTHER','PENDING_COPY'
    )),
  failure_reason text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_media_shopify_media_gid_uidx
  on public.product_media (shopify_media_gid)
  where shopify_media_gid is not null;

create index if not exists product_media_product_idx on public.product_media (product_id, position);

alter table public.product_media enable row level security;
drop policy if exists "admin_all_product_media" on public.product_media;
create policy "admin_all_product_media" on public.product_media
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.product_media to authenticated;
grant all on public.product_media to service_role;

-- ── Inventory source snapshot (NOT WMS ledger) ──────────────────────────────
create table if not exists public.shopify_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  shopify_inventory_item_gid text,
  shopify_variant_gid text,
  shopify_location_gid text,
  location_name text,
  location_class text
    check (location_class is null or location_class in (
      'PHYSICAL_WAREHOUSE','SALESPERSON_VIRTUAL','UNKNOWN','OTHER'
    )),
  sku text,
  barcode text,
  available numeric(14,3),
  on_hand numeric(14,3),
  committed numeric(14,3),
  incoming numeric(14,3),
  tracked boolean,
  snapshot_at timestamptz not null default now(),
  import_batch_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shopify_inventory_snapshots_variant_idx
  on public.shopify_inventory_snapshots (shopify_variant_gid);
create index if not exists shopify_inventory_snapshots_item_idx
  on public.shopify_inventory_snapshots (shopify_inventory_item_gid);
create index if not exists shopify_inventory_snapshots_batch_idx
  on public.shopify_inventory_snapshots (import_batch_id);

alter table public.shopify_inventory_snapshots enable row level security;
drop policy if exists "admin_all_shopify_inventory_snapshots" on public.shopify_inventory_snapshots;
create policy "admin_all_shopify_inventory_snapshots" on public.shopify_inventory_snapshots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.shopify_inventory_snapshots to authenticated;
grant all on public.shopify_inventory_snapshots to service_role;

comment on table public.shopify_inventory_snapshots is
  'Phase 5E Shopify inventory SOURCE SNAPSHOT only. Never posts to Unique WMS ledger / opening balances.';

-- ── Import batches / conflicts / location map ───────────────────────────────
create table if not exists public.catalogue_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'shopify_forensic',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  watermark jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  created_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  failed_count int not null default 0,
  warning_count int not null default 0,
  status text not null default 'running'
    check (status in ('running','completed','failed','partial')),
  notes text
);

create table if not exists public.catalogue_import_conflicts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.catalogue_import_batches(id) on delete set null,
  conflict_type text not null,
  shopify_gid text,
  unique_entity_type text,
  unique_entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN'
    check (status in ('OPEN','RESOLVED','IGNORED')),
  created_at timestamptz not null default now()
);

create table if not exists public.shopify_location_map (
  id uuid primary key default gen_random_uuid(),
  shopify_location_gid text unique,
  location_name text,
  location_class text not null
    check (location_class in ('PHYSICAL_WAREHOUSE','SALESPERSON_VIRTUAL','UNKNOWN','OTHER')),
  unique_warehouse_code text,
  notes text,
  created_at timestamptz not null default now()
);

insert into public.shopify_location_map (location_name, location_class, unique_warehouse_code, notes)
select v.location_name, v.location_class, v.unique_warehouse_code, v.notes
from (values
  ('UD WH 1', 'PHYSICAL_WAREHOUSE', 'UD_WH_1', 'Known physical warehouse — map GID when available'),
  ('Warehouse 2', 'PHYSICAL_WAREHOUSE', null, 'Historical — do not invent Unique warehouse without confirmation'),
  ('UD002', 'SALESPERSON_VIRTUAL', null, 'Must NOT become physical WMS warehouse'),
  ('UD003', 'SALESPERSON_VIRTUAL', null, 'Must NOT become physical WMS warehouse'),
  ('UD004', 'SALESPERSON_VIRTUAL', null, 'Must NOT become physical WMS warehouse'),
  ('UD005', 'SALESPERSON_VIRTUAL', null, 'Must NOT become physical WMS warehouse'),
  ('UD006', 'SALESPERSON_VIRTUAL', null, 'Must NOT become physical WMS warehouse'),
  ('UD007', 'SALESPERSON_VIRTUAL', null, 'Must NOT become physical WMS warehouse'),
  ('UD008', 'SALESPERSON_VIRTUAL', null, 'Must NOT become physical WMS warehouse')
) as v(location_name, location_class, unique_warehouse_code, notes)
where not exists (
  select 1 from public.shopify_location_map m where m.location_name = v.location_name
);

alter table public.catalogue_import_batches enable row level security;
alter table public.catalogue_import_conflicts enable row level security;
alter table public.shopify_location_map enable row level security;
drop policy if exists "admin_all_catalogue_import_batches" on public.catalogue_import_batches;
create policy "admin_all_catalogue_import_batches" on public.catalogue_import_batches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_catalogue_import_conflicts" on public.catalogue_import_conflicts;
create policy "admin_all_catalogue_import_conflicts" on public.catalogue_import_conflicts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_shopify_location_map" on public.shopify_location_map;
create policy "admin_all_shopify_location_map" on public.shopify_location_map
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.catalogue_import_batches to authenticated;
grant select, insert, update, delete on public.catalogue_import_conflicts to authenticated;
grant select, insert, update, delete on public.shopify_location_map to authenticated;
grant all on public.catalogue_import_batches to service_role;
grant all on public.catalogue_import_conflicts to service_role;
grant all on public.shopify_location_map to service_role;

-- Mark existing Unique-native demo products
update public.products
set catalogue_origin = 'UNIQUE_NATIVE'
where catalogue_origin is null
  and shopify_product_gid is null;

-- ── Storefront collection filter: also use M2M ──────────────────────────────
create or replace function public.rpc_list_storefront_products(
  p_filter text default 'all',
  p_slug text default null,
  p_limit int default 12,
  p_offset int default 0,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_in_stock_only boolean default false,
  p_sort text default 'default',
  p_force_mode text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_items jsonb;
  v_filter text := lower(coalesce(btrim(p_filter), 'all'));
  v_sort text := lower(coalesce(btrim(p_sort), 'default'));
  v_can_view boolean := public.storefront_can_view_protected_price(p_force_mode);
  v_min numeric := case when v_can_view then p_min_price else null end;
  v_max numeric := case when v_can_view then p_max_price else null end;
begin
  select count(*) into v_total
  from public.products p
  where p.published = true
    and (v_min is null or p.price >= v_min)
    and (v_max is null or p.price <= v_max)
    and (not coalesce(p_in_stock_only, false) or p.inventory_count > 0)
    and (
      v_filter = 'all' or (v_filter = 'new' and p.is_new = true) or (v_filter = 'best' and p.is_featured = true)
      or (v_filter in ('deals', 'summer') and p.is_summer = true)
      or (v_filter = 'collection' and p_slug is not null and (
        exists (select 1 from public.collections c where c.id = p.collection_id and coalesce(c.is_active,true) and c.slug = btrim(p_slug))
        or exists (
          select 1 from public.product_collections pc
          join public.collections c on c.id = pc.collection_id
          where pc.product_id = p.id and coalesce(c.is_active,true) and c.slug = btrim(p_slug)
        )
      ))
      or (v_filter = 'category' and p_slug is not null and p.category_id in (
        with recursive cat_tree as (
          select c.id from public.categories c where c.slug = btrim(p_slug) and c.is_active
          union all
          select ch.id from public.categories ch inner join cat_tree t on ch.parent_id = t.id where ch.is_active
        ) select id from cat_tree))
    );

  select coalesce(jsonb_agg(to_jsonb(sub)), '[]'::jsonb) into v_items
  from (
    select p.* from public.products p
    where p.published = true
      and (v_min is null or p.price >= v_min)
      and (v_max is null or p.price <= v_max)
      and (not coalesce(p_in_stock_only, false) or p.inventory_count > 0)
      and (
        v_filter = 'all' or (v_filter = 'new' and p.is_new = true) or (v_filter = 'best' and p.is_featured = true)
        or (v_filter in ('deals', 'summer') and p.is_summer = true)
        or (v_filter = 'collection' and p_slug is not null and (
          exists (select 1 from public.collections c where c.id = p.collection_id and coalesce(c.is_active,true) and c.slug = btrim(p_slug))
          or exists (
            select 1 from public.product_collections pc
            join public.collections c on c.id = pc.collection_id
            where pc.product_id = p.id and coalesce(c.is_active,true) and c.slug = btrim(p_slug)
          )
        ))
        or (v_filter = 'category' and p_slug is not null and p.category_id in (
          with recursive cat_tree as (
            select c.id from public.categories c where c.slug = btrim(p_slug) and c.is_active
            union all
            select ch.id from public.categories ch inner join cat_tree t on ch.parent_id = t.id where ch.is_active
          ) select id from cat_tree))
      )
    order by
      case when v_can_view and v_sort = 'price_asc' then p.price end asc nulls last,
      case when v_can_view and v_sort = 'price_desc' then p.price end desc nulls last,
      case when v_sort = 'name' then p.name end asc nulls last,
      p.sort_order asc, p.created_at desc
    limit greatest(coalesce(p_limit, 12), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) sub;

  if not v_can_view then
    v_items := public.redact_protected_price_fields(v_items, false);
  end if;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total, 'price_visible', v_can_view);
end;
$$;

grant execute on function public.rpc_list_storefront_products(text, text, int, int, numeric, numeric, boolean, text, text)
  to anon, authenticated, service_role;
