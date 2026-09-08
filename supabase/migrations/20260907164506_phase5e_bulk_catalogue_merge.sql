-- Phase 5E — bulk catalogue merge helpers + real UNIQUE for upserts

-- Prefer real UNIQUE (NULLs allowed multiple times) for PostgREST onConflict
drop index if exists public.products_shopify_product_gid_uidx;
alter table public.products drop constraint if exists products_shopify_product_gid_key;
alter table public.products add constraint products_shopify_product_gid_key unique (shopify_product_gid);

drop index if exists public.product_variants_shopify_variant_gid_uidx;
alter table public.product_variants drop constraint if exists product_variants_shopify_variant_gid_key;
alter table public.product_variants add constraint product_variants_shopify_variant_gid_key unique (shopify_variant_gid);

drop index if exists public.collections_shopify_collection_gid_uidx;
alter table public.collections drop constraint if exists collections_shopify_collection_gid_key;
alter table public.collections add constraint collections_shopify_collection_gid_key unique (shopify_collection_gid);

drop index if exists public.product_media_shopify_media_gid_uidx;
alter table public.product_media drop constraint if exists product_media_shopify_media_gid_key;
-- media gid may be null for some rows — unique constraint allows multiple nulls
alter table public.product_media add constraint product_media_shopify_media_gid_key unique (shopify_media_gid);

-- Staging for bulk JSON payloads
create table if not exists public.catalogue_import_staging (
  id bigserial primary key,
  batch_id uuid not null,
  entity_type text not null,
  payload jsonb not null,
  processed boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists catalogue_import_staging_batch_idx
  on public.catalogue_import_staging (batch_id, entity_type, processed);

alter table public.catalogue_import_staging enable row level security;
drop policy if exists "admin_all_catalogue_import_staging" on public.catalogue_import_staging;
create policy "admin_all_catalogue_import_staging" on public.catalogue_import_staging
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant all on public.catalogue_import_staging to service_role;
grant select, insert, update, delete on public.catalogue_import_staging to authenticated;
grant usage, select on sequence public.catalogue_import_staging_id_seq to service_role, authenticated;

-- Bulk merge products from jsonb array
create or replace function public.rpc_phase5e_bulk_upsert_products(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_created int := 0;
  v_updated int := 0;
  v_id uuid;
  v_existing uuid;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    select id into v_existing from products where shopify_product_gid = v_row->>'shopify_product_gid' limit 1;
    if v_existing is not null then
      update products set
        name = coalesce(v_row->>'name', name),
        slug = coalesce(v_row->>'slug', slug),
        description = v_row->>'description',
        description_html = v_row->>'description_html',
        price = coalesce((v_row->>'price')::numeric, price),
        compare_at_price = nullif(v_row->>'compare_at_price','')::numeric,
        image_url = v_row->>'image_url',
        gallery_urls = coalesce(v_row->'gallery_urls', gallery_urls),
        inventory_count = coalesce((v_row->>'inventory_count')::int, inventory_count),
        published = coalesce((v_row->>'published')::boolean, published),
        vendor = v_row->>'vendor',
        product_type = v_row->>'product_type',
        shopify_status = v_row->>'shopify_status',
        source_system = 'shopify',
        shopify_legacy_id = v_row->>'shopify_legacy_id',
        shopify_handle = v_row->>'shopify_handle',
        source_created_at = nullif(v_row->>'source_created_at','')::timestamptz,
        source_updated_at = nullif(v_row->>'source_updated_at','')::timestamptz,
        seo_title = v_row->>'seo_title',
        seo_description = v_row->>'seo_description',
        options_json = coalesce(v_row->'options_json', options_json),
        tags_raw = coalesce(
          array(select jsonb_array_elements_text(coalesce(v_row->'tags_raw','[]'::jsonb))),
          tags_raw
        ),
        tracks_inventory = nullif(v_row->>'tracks_inventory','')::boolean,
        total_inventory = nullif(v_row->>'total_inventory','')::int,
        published_at = nullif(v_row->>'published_at','')::timestamptz,
        catalogue_origin = 'SHOPIFY_IMPORTED',
        import_batch_id = p_batch_id,
        sku = v_row->>'sku',
        updated_at = now()
      where id = v_existing;
      v_updated := v_updated + 1;
    else
      begin
        insert into products (
          name, slug, description, description_html, price, compare_at_price, image_url, gallery_urls,
          inventory_count, published, vendor, product_type, shopify_status, source_system,
          shopify_product_gid, shopify_legacy_id, shopify_handle, source_created_at, source_updated_at,
          seo_title, seo_description, options_json, tags_raw, tracks_inventory, total_inventory,
          published_at, catalogue_origin, import_batch_id, sku
        ) values (
          v_row->>'name',
          v_row->>'slug',
          v_row->>'description',
          v_row->>'description_html',
          coalesce((v_row->>'price')::numeric, 0),
          nullif(v_row->>'compare_at_price','')::numeric,
          v_row->>'image_url',
          coalesce(v_row->'gallery_urls', '[]'::jsonb),
          coalesce((v_row->>'inventory_count')::int, 0),
          coalesce((v_row->>'published')::boolean, false),
          v_row->>'vendor',
          v_row->>'product_type',
          v_row->>'shopify_status',
          'shopify',
          v_row->>'shopify_product_gid',
          v_row->>'shopify_legacy_id',
          v_row->>'shopify_handle',
          nullif(v_row->>'source_created_at','')::timestamptz,
          nullif(v_row->>'source_updated_at','')::timestamptz,
          v_row->>'seo_title',
          v_row->>'seo_description',
          coalesce(v_row->'options_json', '[]'::jsonb),
          coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'tags_raw','[]'::jsonb))), '{}'),
          nullif(v_row->>'tracks_inventory','')::boolean,
          nullif(v_row->>'total_inventory','')::int,
          nullif(v_row->>'published_at','')::timestamptz,
          'SHOPIFY_IMPORTED',
          p_batch_id,
          v_row->>'sku'
        );
        v_created := v_created + 1;
      exception when unique_violation then
        -- slug conflict with Unique-native: remap
        insert into catalogue_import_conflicts (batch_id, conflict_type, shopify_gid, details)
        values (p_batch_id, 'PRODUCT_HANDLE', v_row->>'shopify_product_gid',
          jsonb_build_object('slug', v_row->>'slug'));
        insert into products (
          name, slug, description, description_html, price, compare_at_price, image_url, gallery_urls,
          inventory_count, published, vendor, product_type, shopify_status, source_system,
          shopify_product_gid, shopify_legacy_id, shopify_handle, source_created_at, source_updated_at,
          seo_title, seo_description, options_json, tags_raw, tracks_inventory, total_inventory,
          published_at, catalogue_origin, import_batch_id, sku
        ) values (
          v_row->>'name',
          (v_row->>'slug') || '-shopify',
          v_row->>'description',
          v_row->>'description_html',
          coalesce((v_row->>'price')::numeric, 0),
          nullif(v_row->>'compare_at_price','')::numeric,
          v_row->>'image_url',
          coalesce(v_row->'gallery_urls', '[]'::jsonb),
          coalesce((v_row->>'inventory_count')::int, 0),
          coalesce((v_row->>'published')::boolean, false),
          v_row->>'vendor',
          v_row->>'product_type',
          v_row->>'shopify_status',
          'shopify',
          v_row->>'shopify_product_gid',
          v_row->>'shopify_legacy_id',
          v_row->>'shopify_handle',
          nullif(v_row->>'source_created_at','')::timestamptz,
          nullif(v_row->>'source_updated_at','')::timestamptz,
          v_row->>'seo_title',
          v_row->>'seo_description',
          coalesce(v_row->'options_json', '[]'::jsonb),
          coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'tags_raw','[]'::jsonb))), '{}'),
          nullif(v_row->>'tracks_inventory','')::boolean,
          nullif(v_row->>'total_inventory','')::int,
          nullif(v_row->>'published_at','')::timestamptz,
          'SHOPIFY_IMPORTED',
          p_batch_id,
          v_row->>'sku'
        );
        v_created := v_created + 1;
      end;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created, 'updated', v_updated);
end;
$$;

revoke all on function public.rpc_phase5e_bulk_upsert_products(uuid, jsonb) from public, anon;
grant execute on function public.rpc_phase5e_bulk_upsert_products(uuid, jsonb) to service_role, authenticated;

create or replace function public.rpc_phase5e_bulk_upsert_variants(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n int := 0;
  v_product_id uuid;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    select id into v_product_id from products where shopify_product_gid = v_row->>'shopify_product_gid' limit 1;
    if v_product_id is null then continue; end if;

    insert into product_variants (
      product_id, name, sku, barcode, price, compare_at_price, inventory_count, option_values, image_url,
      shopify_variant_gid, shopify_legacy_id, shopify_inventory_item_gid, position, taxable,
      weight_value, weight_unit, source_system, source_created_at, source_updated_at, available_for_sale,
      sku_quality, barcode_quality, import_batch_id
    ) values (
      v_product_id,
      coalesce(v_row->>'name', 'Default'),
      nullif(v_row->>'sku',''),
      nullif(v_row->>'barcode',''),
      nullif(v_row->>'price','')::numeric,
      nullif(v_row->>'compare_at_price','')::numeric,
      coalesce((v_row->>'inventory_count')::int, 0),
      coalesce(v_row->'option_values', '{}'::jsonb),
      v_row->>'image_url',
      v_row->>'shopify_variant_gid',
      v_row->>'shopify_legacy_id',
      v_row->>'shopify_inventory_item_gid',
      nullif(v_row->>'position','')::int,
      nullif(v_row->>'taxable','')::boolean,
      nullif(v_row->>'weight_value','')::numeric,
      v_row->>'weight_unit',
      'shopify',
      nullif(v_row->>'source_created_at','')::timestamptz,
      nullif(v_row->>'source_updated_at','')::timestamptz,
      nullif(v_row->>'available_for_sale','')::boolean,
      coalesce(v_row->>'sku_quality', case when nullif(v_row->>'sku','') is null then 'MISSING' else 'VALID' end),
      coalesce(v_row->>'barcode_quality', case when nullif(v_row->>'barcode','') is null then 'MISSING' else 'VALID' end),
      p_batch_id
    )
    on conflict (shopify_variant_gid) do update set
      product_id = excluded.product_id,
      name = excluded.name,
      sku = excluded.sku,
      barcode = excluded.barcode,
      price = excluded.price,
      compare_at_price = excluded.compare_at_price,
      inventory_count = excluded.inventory_count,
      option_values = excluded.option_values,
      image_url = excluded.image_url,
      shopify_inventory_item_gid = excluded.shopify_inventory_item_gid,
      position = excluded.position,
      taxable = excluded.taxable,
      weight_value = excluded.weight_value,
      weight_unit = excluded.weight_unit,
      source_updated_at = excluded.source_updated_at,
      available_for_sale = excluded.available_for_sale,
      sku_quality = excluded.sku_quality,
      barcode_quality = excluded.barcode_quality,
      import_batch_id = excluded.import_batch_id,
      updated_at = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'upserted', v_n);
end;
$$;

revoke all on function public.rpc_phase5e_bulk_upsert_variants(uuid, jsonb) from public, anon;
grant execute on function public.rpc_phase5e_bulk_upsert_variants(uuid, jsonb) to service_role, authenticated;

create or replace function public.rpc_phase5e_bulk_upsert_collections(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n int := 0;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    insert into collections (
      title, slug, description, description_html, cover_image_url,
      shopify_collection_gid, shopify_legacy_id, shopify_handle, seo_title, seo_description,
      collection_type, source_system, source_updated_at, rule_definition_json, rule_definition_status,
      is_active, import_batch_id, type
    ) values (
      coalesce(v_row->>'title', v_row->>'slug'),
      v_row->>'slug',
      v_row->>'description',
      v_row->>'description_html',
      v_row->>'cover_image_url',
      v_row->>'shopify_collection_gid',
      v_row->>'shopify_legacy_id',
      v_row->>'shopify_handle',
      v_row->>'seo_title',
      v_row->>'seo_description',
      v_row->>'collection_type',
      'shopify',
      nullif(v_row->>'source_updated_at','')::timestamptz,
      v_row->'rule_definition_json',
      coalesce(v_row->>'rule_definition_status', 'UNKNOWN'),
      true,
      p_batch_id,
      coalesce(v_row->>'type', 'seasonal')
    )
    on conflict (shopify_collection_gid) do update set
      title = excluded.title,
      description = excluded.description,
      description_html = excluded.description_html,
      cover_image_url = excluded.cover_image_url,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description,
      source_updated_at = excluded.source_updated_at,
      rule_definition_json = excluded.rule_definition_json,
      rule_definition_status = excluded.rule_definition_status,
      import_batch_id = excluded.import_batch_id;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'upserted', v_n);
end;
$$;

revoke all on function public.rpc_phase5e_bulk_upsert_collections(uuid, jsonb) from public, anon;
grant execute on function public.rpc_phase5e_bulk_upsert_collections(uuid, jsonb) to service_role, authenticated;

create or replace function public.rpc_phase5e_bulk_link_memberships(p_batch_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n int := 0;
  v_pid uuid;
  v_cid uuid;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    select id into v_pid from products where shopify_product_gid = v_row->>'shopify_product_gid' limit 1;
    select id into v_cid from collections where shopify_collection_gid = v_row->>'shopify_collection_gid' limit 1;
    if v_pid is null or v_cid is null then continue; end if;
    insert into product_collections (product_id, collection_id, position, source_system, import_batch_id)
    values (v_pid, v_cid, nullif(v_row->>'position','')::int, 'shopify', p_batch_id)
    on conflict (product_id, collection_id) do update set position = excluded.position, import_batch_id = excluded.import_batch_id;
    -- set primary collection_id if empty
    update products set collection_id = coalesce(collection_id, v_cid) where id = v_pid;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'upserted', v_n);
end;
$$;

revoke all on function public.rpc_phase5e_bulk_link_memberships(uuid, jsonb) from public, anon;
grant execute on function public.rpc_phase5e_bulk_link_memberships(uuid, jsonb) to service_role, authenticated;

create or replace function public.rpc_phase5e_bulk_upsert_metafields(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n int := 0;
  v_owner uuid;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    if v_row->>'owner_type' = 'product' then
      select id into v_owner from products where shopify_product_gid = v_row->>'owner_gid' limit 1;
    elsif v_row->>'owner_type' = 'product_variant' then
      select id into v_owner from product_variants where shopify_variant_gid = v_row->>'owner_gid' limit 1;
    else
      continue;
    end if;
    if v_owner is null then continue; end if;

    insert into metafields (
      owner_type, owner_id, namespace, key, value_type, value_text, value_json,
      source_system, external_gid, source_updated_at, imported_at
    ) values (
      v_row->>'owner_type', v_owner, v_row->>'namespace', v_row->>'key',
      v_row->>'value_type', v_row->>'value_text', v_row->'value_json',
      'shopify', v_row->>'external_gid',
      nullif(v_row->>'source_updated_at','')::timestamptz, now()
    )
    on conflict (owner_type, owner_id, namespace, key, source_system) do update set
      value_type = excluded.value_type,
      value_text = excluded.value_text,
      value_json = excluded.value_json,
      external_gid = excluded.external_gid,
      source_updated_at = excluded.source_updated_at,
      imported_at = now(),
      updated_at = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'upserted', v_n);
end;
$$;

revoke all on function public.rpc_phase5e_bulk_upsert_metafields(jsonb) from public, anon;
grant execute on function public.rpc_phase5e_bulk_upsert_metafields(jsonb) to service_role, authenticated;

create or replace function public.rpc_phase5e_flag_sku_barcode_quality()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dup_sku int;
  v_dup_bar int;
begin
  update product_variants set sku_quality = 'MISSING'
  where source_system = 'shopify' and nullif(btrim(coalesce(sku,'')), '') is null;

  update product_variants set barcode_quality = 'MISSING'
  where source_system = 'shopify' and nullif(btrim(coalesce(barcode,'')), '') is null;

  update product_variants pv set sku_quality = 'DUPLICATE'
  where pv.source_system = 'shopify'
    and nullif(btrim(coalesce(pv.sku,'')), '') is not null
    and exists (
      select 1 from product_variants x
      where x.source_system = 'shopify' and x.sku = pv.sku and x.id <> pv.id
    );

  update product_variants pv set barcode_quality = 'DUPLICATE'
  where pv.source_system = 'shopify'
    and nullif(btrim(coalesce(pv.barcode,'')), '') is not null
    and exists (
      select 1 from product_variants x
      where x.source_system = 'shopify' and x.barcode = pv.barcode and x.id <> pv.id
    );

  select count(*) into v_dup_sku from (
    select sku from product_variants where source_system='shopify' and sku_quality='DUPLICATE' group by sku
  ) s;
  select count(*) into v_dup_bar from (
    select barcode from product_variants where source_system='shopify' and barcode_quality='DUPLICATE' group by barcode
  ) s;

  return jsonb_build_object('ok', true, 'duplicate_sku_groups', v_dup_sku, 'duplicate_barcode_groups', v_dup_bar);
end;
$$;

revoke all on function public.rpc_phase5e_flag_sku_barcode_quality() from public, anon;
grant execute on function public.rpc_phase5e_flag_sku_barcode_quality() to service_role, authenticated;
