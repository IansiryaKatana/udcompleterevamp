-- Phase 4H part 2 — bundles, wishlist, drop public_read, merchant feed, attack suite

-- Wishlist hydrate by IDs (replaces products.select('*'))
create or replace function public.rpc_list_wishlist_products(p_force_mode text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_items jsonb;
  v_can_view boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb, 'price_visible', false);
  end if;

  select coalesce(array_agg(w.product_id), '{}'::uuid[])
  into v_ids
  from public.wishlists w
  where w.user_id = v_uid;

  v_can_view := public.storefront_can_view_protected_price(p_force_mode);

  select coalesce(jsonb_agg(to_jsonb(p) order by array_position(v_ids, p.id)), '[]'::jsonb)
  into v_items
  from public.products p
  where p.id = any(v_ids) and p.published = true;

  if not v_can_view then
    v_items := public.redact_protected_price_fields(v_items, false);
  end if;

  return jsonb_build_object('ok', true, 'items', v_items, 'price_visible', v_can_view);
end;
$$;

grant execute on function public.rpc_list_wishlist_products(text) to authenticated, service_role;

-- Products by IDs (related / batch hydrate)
create or replace function public.rpc_get_storefront_products_by_ids(
  p_ids uuid[],
  p_force_mode text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_can_view boolean := public.storefront_can_view_protected_price(p_force_mode);
begin
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_items
  from public.products p
  where p.published = true and p.id = any(coalesce(p_ids, '{}'::uuid[]));

  if not v_can_view then
    v_items := public.redact_protected_price_fields(v_items, false);
  end if;
  return jsonb_build_object('ok', true, 'items', v_items, 'price_visible', v_can_view);
end;
$$;

grant execute on function public.rpc_get_storefront_products_by_ids(uuid[], text)
  to anon, authenticated, service_role;

-- Bundles with redaction
create or replace function public.rpc_list_storefront_bundles(
  p_limit int default 24,
  p_offset int default 0,
  p_force_mode text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_total int;
  v_can_view boolean := public.storefront_can_view_protected_price(p_force_mode);
begin
  select count(*) into v_total from public.product_bundles where published = true;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.sort_order, b.name), '[]'::jsonb)
  into v_items
  from (
    select id, name, slug, overview, description, price, compare_at_price, sku,
           image_url, gallery_urls, badge, published, sort_order
    from public.product_bundles
    where published = true
    order by sort_order, name
    limit greatest(1, least(coalesce(p_limit, 24), 100))
    offset greatest(0, coalesce(p_offset, 0))
  ) b;

  if not v_can_view then
    v_items := public.redact_protected_price_fields(v_items, false);
  end if;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total, 'price_visible', v_can_view);
end;
$$;

drop function if exists public.rpc_list_storefront_bundles(int, int);
grant execute on function public.rpc_list_storefront_bundles(int, int, text)
  to anon, authenticated, service_role;

create or replace function public.rpc_get_storefront_bundle(
  p_slug text,
  p_force_mode text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bundle record;
  v_items jsonb;
  v_can_view boolean := public.storefront_can_view_protected_price(p_force_mode);
  v_out jsonb;
begin
  select * into v_bundle from public.product_bundles b
  where b.slug = p_slug and b.published = true;

  if v_bundle.id is null then
    return jsonb_build_object('ok', false, 'error', 'Bundle not found');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', bi.id,
      'bundle_id', bi.bundle_id,
      'product_id', bi.product_id,
      'variant_id', bi.variant_id,
      'quantity', bi.quantity,
      'sort_order', bi.sort_order,
      'label', bi.label,
      'product', jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'slug', p.slug,
        'image_url', p.image_url,
        'price', case when v_can_view then to_jsonb(p.price) else 'null'::jsonb end,
        'inventory_count', p.inventory_count,
        'price_restricted', not v_can_view
      ),
      'variants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pv.id,
          'product_id', pv.product_id,
          'name', pv.name,
          'sku', pv.sku,
          'price', case when v_can_view then to_jsonb(pv.price) else 'null'::jsonb end,
          'compare_at_price', case when v_can_view then to_jsonb(pv.compare_at_price) else 'null'::jsonb end,
          'inventory_count', pv.inventory_count,
          'image_url', pv.image_url,
          'sort_order', pv.sort_order,
          'is_active', pv.is_active,
          'price_restricted', not v_can_view
        ) order by pv.sort_order, pv.name)
        from public.product_variants pv
        where pv.product_id = p.id and pv.is_active = true
      ), '[]'::jsonb)
    ) order by bi.sort_order, bi.created_at
  ), '[]'::jsonb)
  into v_items
  from public.product_bundle_items bi
  join public.products p on p.id = bi.product_id and p.published = true
  where bi.bundle_id = v_bundle.id;

  if jsonb_array_length(coalesce(v_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Bundle has no available items');
  end if;

  v_out := jsonb_build_object(
    'ok', true,
    'bundle', to_jsonb(v_bundle),
    'items', v_items,
    'available_quantity', public.bundle_available_quantity(v_bundle.id, '[]'::jsonb),
    'price_visible', v_can_view
  );

  if not v_can_view then
    v_out := public.redact_protected_price_fields(v_out, false);
    v_out := v_out || jsonb_build_object('ok', true, 'price_visible', false);
  end if;
  return v_out;
end;
$$;

drop function if exists public.rpc_get_storefront_bundle(text);
grant execute on function public.rpc_get_storefront_bundle(text, text)
  to anon, authenticated, service_role;

-- Merchant feed: server-only; prices only when catalogue_open (or explicit allow)
create or replace function public.rpc_merchant_feed_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_feed_mode text;
  v_include_price boolean;
  v_items jsonb;
begin
  select coalesce(value, 'catalogue_open') into v_mode
  from site_settings where key = 'commercial_access_mode' limit 1;
  select coalesce(value, 'catalogue_open_only') into v_feed_mode
  from site_settings where key = 'merchant_feed_price_mode' limit 1;

  v_include_price := (v_mode = 'catalogue_open' and v_feed_mode in ('catalogue_open_only', 'always'))
    or v_feed_mode = 'always';

  if v_feed_mode = 'disabled' then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb, 'price_included', false, 'disabled', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'description', p.description,
    'slug', p.slug,
    'image_url', p.image_url,
    'price', case when v_include_price then to_jsonb(p.price) else 'null'::jsonb end,
    'inventory_count', p.inventory_count,
    'published', p.published,
    'price_included', v_include_price
  ) order by p.sort_order, p.name), '[]'::jsonb)
  into v_items
  from public.products p
  where p.published = true;

  return jsonb_build_object(
    'ok', true,
    'items', v_items,
    'price_included', v_include_price,
    'commercial_access_mode', v_mode,
    'merchant_feed_price_mode', v_feed_mode,
    'decision', 'Under trade_required: omit price unless merchant_feed_price_mode=always (not recommended for wholesale)'
  );
end;
$$;

revoke all on function public.rpc_merchant_feed_products() from public, anon, authenticated;
grant execute on function public.rpc_merchant_feed_products() to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- DROP public_read — BLOCKER #1 fix (admin_all remains for CMS)
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists "public_read_products" on public.products;
drop policy if exists "public_read_active_variants" on public.product_variants;
drop policy if exists "public_read_product_bundles" on public.product_bundles;
drop policy if exists "public_read_bundle_items" on public.product_bundle_items;

-- Ensure admin policies exist
drop policy if exists "admin_all_products" on public.products;
create policy "admin_all_products" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_product_variants" on public.product_variants;
create policy "admin_all_product_variants" on public.product_variants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_product_bundles" on public.product_bundles;
create policy "admin_all_product_bundles" on public.product_bundles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_product_bundle_items" on public.product_bundle_items;
create policy "admin_all_product_bundle_items" on public.product_bundle_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Legacy homepage setof still used as fallback — make DEFINER so catalogue still works
create or replace function public.rpc_get_homepage_products(p_section text default 'new')
returns setof public.products
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Only return prices when viewer may see them; else raise to force gated RPC
  if not public.storefront_can_view_protected_price(null) then
    raise exception 'USE_GATED_HOMEPAGE_RPC'
      using errcode = 'P0001',
            hint = 'Call rpc_get_homepage_products_gated under trade_required';
  end if;
  return query
  select * from public.products p
  where p.published = true
    and (
      (p_section = 'new' and p.is_new = true)
      or (p_section = 'summer' and p.is_summer = true)
      or (p_section = 'all')
    )
  order by p.sort_order asc, p.created_at desc
  limit 8;
end;
$$;

grant execute on function public.rpc_get_homepage_products(text) to anon, authenticated, service_role;
