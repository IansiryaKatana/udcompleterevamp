-- Phase 5G — WMS opening stock & warehouse cutover readiness
-- Does NOT enable wms_enabled. Does NOT post production OPENING to UD_WH_1.
-- Shadow import to UD_SHADOW is authorized. No Shopify mutations. No customer contact.

begin;

-- Keep locks explicit
update site_settings set value = 'false' where key = 'wms_enabled';
insert into site_settings (key, value) values
  ('wms_opening_post_authorized', 'false'),
  ('wms_opening_basis_approved', 'false'),
  ('wms_freeze_window_active', 'false')
on conflict (key) do update set value = excluded.value;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Location classification (evidence-bearing)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.wms_location_classifications (
  id uuid primary key default gen_random_uuid(),
  shopify_location_name text not null unique,
  shopify_location_gid text,
  classification text not null
    check (classification in (
      'PHYSICAL_ACTIVE','PHYSICAL_HISTORICAL','SALESPERSON_LOGICAL','UNKNOWN','EXCLUDE_FROM_WMS'
    )),
  unique_warehouse_code text,
  evidence text not null,
  include_in_opening boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.wms_location_classifications
  (shopify_location_name, classification, unique_warehouse_code, evidence, include_in_opening)
values
  ('UD WH 1', 'PHYSICAL_ACTIVE', 'UD_WH_1',
   'Phase 5C/5E: active physical warehouse; shopify_location_map unique_warehouse_code=UD_WH_1; all 13247 snapshot rows currently under this name',
   true),
  ('Warehouse 2', 'PHYSICAL_HISTORICAL', null,
   'Phase 5E location_map PHYSICAL_WAREHOUSE historical — do not invent Unique warehouse without confirmation',
   false),
  ('UD002', 'SALESPERSON_LOGICAL', null, 'Salesperson virtual location — EXCLUDE from WMS warehouses', false),
  ('UD003', 'SALESPERSON_LOGICAL', null, 'Salesperson virtual location — EXCLUDE from WMS warehouses', false),
  ('UD004', 'SALESPERSON_LOGICAL', null, 'Salesperson virtual location — EXCLUDE from WMS warehouses', false),
  ('UD005', 'SALESPERSON_LOGICAL', null, 'Salesperson virtual location — EXCLUDE from WMS warehouses', false),
  ('UD006', 'SALESPERSON_LOGICAL', null, 'Salesperson virtual location — EXCLUDE from WMS warehouses', false),
  ('UD007', 'SALESPERSON_LOGICAL', null, 'Salesperson virtual location — EXCLUDE from WMS warehouses', false),
  ('UD008', 'SALESPERSON_LOGICAL', null, 'Salesperson virtual location — EXCLUDE from WMS warehouses', false)
on conflict (shopify_location_name) do update set
  classification = excluded.classification,
  unique_warehouse_code = excluded.unique_warehouse_code,
  evidence = excluded.evidence,
  include_in_opening = excluded.include_in_opening,
  updated_at = now();

alter table public.wms_location_classifications enable row level security;
drop policy if exists wms_loc_class_admin on public.wms_location_classifications;
create policy wms_loc_class_admin on public.wms_location_classifications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.wms_location_classifications to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Identity / SKU / barcode quality review (no auto-merge)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.wms_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  review_type text not null
    check (review_type in (
      'MISSING_SKU','DUPLICATE_SKU','MISSING_BARCODE','DUPLICATE_BARCODE',
      'MISSING_VARIANT','AMBIGUOUS','UNTRACKED'
    )),
  identity_key text not null,
  variant_ids uuid[] not null default '{}',
  operational_impact text not null
    check (operational_impact in (
      'BLOCKS_OPENING_BALANCE','BLOCKS_SCANNING','MANUAL_PICK_ALLOWED',
      'REVIEW_ONLY','SCANNING_READY','SCANNING_REQUIRES_REVIEW',
      'MANUAL_SKU_PICK_ONLY','IDENTITY_AMBIGUOUS'
    )),
  evidence jsonb not null default '{}'::jsonb,
  review_status text not null default 'UNREVIEWED'
    check (review_status in ('UNREVIEWED','ACCEPTED','RESOLVED','DEFERRED')),
  created_at timestamptz not null default now(),
  unique (review_type, identity_key)
);

alter table public.wms_identity_reviews enable row level security;
drop policy if exists wms_identity_reviews_admin on public.wms_identity_reviews;
create policy wms_identity_reviews_admin on public.wms_identity_reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.wms_identity_reviews to authenticated, service_role;

create or replace function public.rpc_phase5g_rebuild_identity_reviews()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing_sku int := 0;
  v_dup_sku int := 0;
  v_missing_bc int := 0;
  v_dup_bc int := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  delete from wms_identity_reviews where review_status = 'UNREVIEWED';

  insert into wms_identity_reviews (review_type, identity_key, variant_ids, operational_impact, evidence)
  select 'MISSING_SKU', 'variant:' || v.id::text, array[v.id], 'MANUAL_PICK_ALLOWED',
         jsonb_build_object('variant_id', v.id, 'product_id', v.product_id, 'shopify_variant_gid', v.shopify_variant_gid)
  from product_variants v
  where coalesce(nullif(btrim(v.sku), ''), '') = ''
  on conflict (review_type, identity_key) do nothing;
  get diagnostics v_missing_sku = row_count;

  insert into wms_identity_reviews (review_type, identity_key, variant_ids, operational_impact, evidence)
  select 'DUPLICATE_SKU', lower(btrim(v.sku)), array_agg(v.id), 'BLOCKS_SCANNING',
         jsonb_build_object('sku', btrim(v.sku), 'count', count(*))
  from product_variants v
  where coalesce(nullif(btrim(v.sku), ''), '') <> ''
  group by lower(btrim(v.sku)), btrim(v.sku)
  having count(*) > 1
  on conflict (review_type, identity_key) do nothing;
  get diagnostics v_dup_sku = row_count;

  insert into wms_identity_reviews (review_type, identity_key, variant_ids, operational_impact, evidence)
  select 'MISSING_BARCODE', 'variant:' || v.id::text, array[v.id], 'MANUAL_SKU_PICK_ONLY',
         jsonb_build_object('variant_id', v.id, 'sku', v.sku)
  from product_variants v
  where coalesce(nullif(btrim(v.barcode), ''), '') = ''
  on conflict (review_type, identity_key) do nothing;
  get diagnostics v_missing_bc = row_count;

  insert into wms_identity_reviews (review_type, identity_key, variant_ids, operational_impact, evidence)
  select 'DUPLICATE_BARCODE', lower(btrim(v.barcode)), array_agg(v.id), 'IDENTITY_AMBIGUOUS',
         jsonb_build_object('barcode', btrim(v.barcode), 'count', count(*))
  from product_variants v
  where coalesce(nullif(btrim(v.barcode), ''), '') <> ''
  group by lower(btrim(v.barcode)), btrim(v.barcode)
  having count(*) > 1
  on conflict (review_type, identity_key) do nothing;
  get diagnostics v_dup_bc = row_count;

  return jsonb_build_object(
    'ok', true,
    'missing_sku', v_missing_sku,
    'duplicate_sku_groups', v_dup_sku,
    'missing_barcode', v_missing_bc,
    'duplicate_barcode_groups', v_dup_bc,
    'note', 'No automatic identity merge'
  );
end;
$$;

revoke all on function public.rpc_phase5g_rebuild_identity_reviews() from public, anon;
grant execute on function public.rpc_phase5g_rebuild_identity_reviews() to authenticated, service_role;

-- Ambiguous barcode scan must STOP
create or replace function public.rpc_phase5g_resolve_barcode_scan(p_barcode text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
  v_n int;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if coalesce(nullif(btrim(p_barcode), ''), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_barcode', 'action', 'MANUAL_SKU_PICK_ONLY');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'variant_id', v.id, 'product_id', v.product_id, 'sku', v.sku, 'barcode', v.barcode,
    'shopify_variant_gid', v.shopify_variant_gid
  )), '[]'::jsonb), count(*)
  into v_rows, v_n
  from product_variants v
  where lower(btrim(v.barcode)) = lower(btrim(p_barcode));

  if v_n = 0 then
    return jsonb_build_object('ok', true, 'match', 'NONE', 'action', 'MANUAL_SKU_PICK_ONLY', 'variants', v_rows);
  elsif v_n = 1 then
    return jsonb_build_object('ok', true, 'match', 'EXACT', 'action', 'SCANNING_READY', 'variants', v_rows);
  else
    return jsonb_build_object(
      'ok', true, 'match', 'AMBIGUOUS', 'action', 'STOP_REQUIRE_SELECTION',
      'variants', v_rows,
      'note', 'Duplicate barcode must not silently resolve to one product'
    );
  end if;
end;
$$;

revoke all on function public.rpc_phase5g_resolve_barcode_scan(text) from public, anon;
grant execute on function public.rpc_phase5g_resolve_barcode_scan(text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Opening balance batch + staging (no WMS ledger post)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.wms_opening_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  source_system text not null default 'shopify_inventory_snapshots',
  source_timestamp timestamptz,
  target_warehouse_code text not null,
  source_basis text not null
    check (source_basis in (
      'SHOPIFY_ON_HAND','SHOPIFY_AVAILABLE','PHYSICAL_COUNT',
      'VERIFIED_WAREHOUSE_EXPORT','RECONCILED_PHYSICAL_SYSTEM'
    )),
  status text not null default 'DRAFT'
    check (status in (
      'DRAFT','STAGED','REVIEW_REQUIRED','APPROVED','REJECTED',
      'SHADOW_POSTED','READY_TO_POST','POSTED','REVERSED','CANCELLED'
    )),
  row_count int not null default 0,
  unit_total numeric(18,3) not null default 0,
  mapping_errors int not null default 0,
  review_errors int not null default 0,
  approved_rows int not null default 0,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wms_opening_staging (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.wms_opening_batches(id) on delete cascade,
  warehouse_code text not null,
  location_code text not null default 'DEFAULT',
  shopify_inventory_item_gid text,
  shopify_variant_gid text,
  shopify_location_gid text,
  product_id uuid,
  variant_id uuid,
  sku text,
  barcode text,
  identity_class text not null default 'VALID'
    check (identity_class in (
      'EXACT_SOURCE_ID_MATCH','VALID','MISSING_SKU','DUPLICATE_SKU','MISSING_BARCODE',
      'DUPLICATE_BARCODE','MISSING_VARIANT','AMBIGUOUS','UNTRACKED'
    )),
  source_on_hand numeric(14,3),
  source_available numeric(14,3),
  source_committed numeric(14,3),
  source_incoming numeric(14,3),
  source_quantity numeric(14,3) not null default 0,
  source_basis text not null,
  approved_quantity numeric(14,3),
  status text not null default 'SOURCE'
    check (status in ('SOURCE','MAPPED','REVIEW_REQUIRED','APPROVED','REJECTED','READY_TO_POST')),
  reconciliation_note text,
  source_timestamp timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists wms_opening_staging_batch_item_uidx
  on public.wms_opening_staging (batch_id, shopify_inventory_item_gid);

create index if not exists wms_opening_staging_batch_idx on public.wms_opening_staging (batch_id, status);
create index if not exists wms_opening_staging_variant_idx on public.wms_opening_staging (variant_id);

-- Physical count sheets (recommended control — optional)
create table if not exists public.wms_physical_count_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.wms_opening_batches(id) on delete set null,
  variant_id uuid,
  sku text,
  expected_system_qty numeric(14,3),
  counted_qty numeric(14,3),
  variance numeric(14,3) generated always as (coalesce(counted_qty,0) - coalesce(expected_system_qty,0)) stored,
  review_status text not null default 'PENDING'
    check (review_status in ('PENDING','REVIEWED','ACCEPTED','REJECTED')),
  approved_qty numeric(14,3),
  notes text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['wms_opening_batches','wms_opening_staging','wms_physical_count_lines']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all_%1$s on public.%1$I', t);
    execute format(
      'create policy admin_all_%1$s on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

comment on table public.wms_opening_batches is
  'Phase 5G opening-stock batches. Production post requires APPROVED + wms_opening_post_authorized. Shadow posts allowed to UD_SHADOW only.';
comment on table public.wms_opening_staging is
  'Staging rows — preview/validate/review. Never auto-posts to UD_WH_1.';

commit;
