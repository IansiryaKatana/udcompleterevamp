-- Phase 5E — product-level SKU unique blocks Shopify catalogue (duplicate first-variant SKUs)
-- Variant SKU remains the commercial identity; product.sku is denormalized optional.

drop index if exists public.products_sku_unique_idx;

create index if not exists products_sku_idx on public.products (sku) where sku is not null;

-- Harden bulk product upsert: never fail whole batch on sku; leave sku nullable on conflict
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
  v_failed int := 0;
  v_existing uuid;
  v_slug text;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      select id into v_existing from products where shopify_product_gid = v_row->>'shopify_product_gid' limit 1;
      v_slug := v_row->>'slug';
      if v_existing is not null then
        update products set
          name = coalesce(v_row->>'name', name),
          slug = coalesce(v_slug, slug),
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
          tags_raw = coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'tags_raw','[]'::jsonb))), tags_raw),
          tracks_inventory = nullif(v_row->>'tracks_inventory','')::boolean,
          total_inventory = nullif(v_row->>'total_inventory','')::int,
          published_at = nullif(v_row->>'published_at','')::timestamptz,
          catalogue_origin = 'SHOPIFY_IMPORTED',
          import_batch_id = p_batch_id,
          sku = nullif(v_row->>'sku',''),
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
            v_row->>'name', v_slug, v_row->>'description', v_row->>'description_html',
            coalesce((v_row->>'price')::numeric, 0), nullif(v_row->>'compare_at_price','')::numeric,
            v_row->>'image_url', coalesce(v_row->'gallery_urls', '[]'::jsonb),
            coalesce((v_row->>'inventory_count')::int, 0), coalesce((v_row->>'published')::boolean, false),
            v_row->>'vendor', v_row->>'product_type', v_row->>'shopify_status', 'shopify',
            v_row->>'shopify_product_gid', v_row->>'shopify_legacy_id', v_row->>'shopify_handle',
            nullif(v_row->>'source_created_at','')::timestamptz, nullif(v_row->>'source_updated_at','')::timestamptz,
            v_row->>'seo_title', v_row->>'seo_description', coalesce(v_row->'options_json', '[]'::jsonb),
            coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'tags_raw','[]'::jsonb))), '{}'),
            nullif(v_row->>'tracks_inventory','')::boolean, nullif(v_row->>'total_inventory','')::int,
            nullif(v_row->>'published_at','')::timestamptz, 'SHOPIFY_IMPORTED', p_batch_id, nullif(v_row->>'sku','')
          );
          v_created := v_created + 1;
        exception when unique_violation then
          insert into catalogue_import_conflicts (batch_id, conflict_type, shopify_gid, details)
          values (p_batch_id, 'PRODUCT_HANDLE_OR_SKU', v_row->>'shopify_product_gid',
            jsonb_build_object('slug', v_slug, 'sku', v_row->>'sku'));
          insert into products (
            name, slug, description, description_html, price, compare_at_price, image_url, gallery_urls,
            inventory_count, published, vendor, product_type, shopify_status, source_system,
            shopify_product_gid, shopify_legacy_id, shopify_handle, source_created_at, source_updated_at,
            seo_title, seo_description, options_json, tags_raw, tracks_inventory, total_inventory,
            published_at, catalogue_origin, import_batch_id, sku
          ) values (
            v_row->>'name', v_slug || '-shopify-' || substr(md5(v_row->>'shopify_product_gid'),1,6),
            v_row->>'description', v_row->>'description_html',
            coalesce((v_row->>'price')::numeric, 0), nullif(v_row->>'compare_at_price','')::numeric,
            v_row->>'image_url', coalesce(v_row->'gallery_urls', '[]'::jsonb),
            coalesce((v_row->>'inventory_count')::int, 0), coalesce((v_row->>'published')::boolean, false),
            v_row->>'vendor', v_row->>'product_type', v_row->>'shopify_status', 'shopify',
            v_row->>'shopify_product_gid', v_row->>'shopify_legacy_id', v_row->>'shopify_handle',
            nullif(v_row->>'source_created_at','')::timestamptz, nullif(v_row->>'source_updated_at','')::timestamptz,
            v_row->>'seo_title', v_row->>'seo_description', coalesce(v_row->'options_json', '[]'::jsonb),
            coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'tags_raw','[]'::jsonb))), '{}'),
            nullif(v_row->>'tracks_inventory','')::boolean, nullif(v_row->>'total_inventory','')::int,
            nullif(v_row->>'published_at','')::timestamptz, 'SHOPIFY_IMPORTED', p_batch_id, null
          );
          v_created := v_created + 1;
        end;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      insert into catalogue_import_conflicts (batch_id, conflict_type, shopify_gid, details)
      values (p_batch_id, 'PRODUCT_UPSERT_ERROR', v_row->>'shopify_product_gid',
        jsonb_build_object('error', SQLERRM));
    end;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_created, 'updated', v_updated, 'failed', v_failed);
end;
$$;

grant execute on function public.rpc_phase5e_bulk_upsert_products(uuid, jsonb) to service_role, authenticated;
