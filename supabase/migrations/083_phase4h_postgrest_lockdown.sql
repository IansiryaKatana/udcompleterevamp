-- Phase 4H — PostgREST price lockdown, commerce parity, pilot gate (no mass send)
-- Does NOT flip commercial_access_mode. Does NOT send pilot emails automatically.
-- catalogue_open production behavior preserved via SECURITY DEFINER storefront RPCs.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';

insert into public.site_settings (key, value)
values
  ('merchant_feed_price_mode', 'catalogue_open_only'),
  ('pilot_send_authorized', 'false')
on conflict (key) do nothing;

comment on function public.redact_protected_price_fields(jsonb, boolean) is
  'Phase 4H: TRADE_PROTECTED monetary fields — never rely on UI hide.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Make catalogue RPCs SECURITY DEFINER (required after dropping public_read)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.storefront_can_view_protected_price(p_force_mode text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_uid uuid := (select auth.uid());
  v_cu public.customers%rowtype;
  v_policy jsonb;
  v_has boolean := false;
begin
  if nullif(btrim(coalesce(p_force_mode, '')), '') is not null then
    v_mode := lower(btrim(p_force_mode));
  else
    select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_mode
    from public.site_settings where key = 'commercial_access_mode' limit 1;
    v_mode := coalesce(v_mode, 'catalogue_open');
  end if;

  if v_uid is not null then
    select * into v_cu from public.customers where auth_user_id = v_uid limit 1;
    v_has := found;
  end if;

  if v_has then
    v_policy := public.commercial_policy_evaluate(
      v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
      v_mode, true, v_cu.customer_type, v_cu.payment_terms
    );
  else
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
  end if;

  return coalesce((v_policy->>'can_view_price')::boolean, false);
end;
$$;

revoke all on function public.storefront_can_view_protected_price(text) from public;
grant execute on function public.storefront_can_view_protected_price(text)
  to anon, authenticated, service_role;

-- Re-apply get/list/search/autocomplete as SECURITY DEFINER (bodies match 081)
create or replace function public.rpc_get_storefront_product(
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
  v_row public.products%rowtype;
  v_variants jsonb;
  v_reviews jsonb;
  v_avg numeric;
  v_count int;
  v_delivery text;
  v_can_view boolean;
  v_out jsonb;
begin
  if p_slug is null or btrim(p_slug) = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing slug');
  end if;

  select * into v_row from public.products p
  where p.slug = btrim(p_slug) and p.published = true limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Not found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(v) order by v.sort_order, v.name), '[]'::jsonb)
  into v_variants
  from public.product_variants v
  where v.product_id = v_row.id and v.is_active = true;

  select round(avg(r.rating)::numeric, 1), count(*)::int into v_avg, v_count
  from public.product_reviews r where r.product_id = v_row.id and r.status = 'approved';

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id, 'rating', r.rating, 'title', r.title, 'body', r.body,
      'created_at', r.created_at,
      'author_label', coalesce(split_part(public.auth_user_email(r.user_id), '@', 1), 'Customer')
    ) order by r.created_at desc
  ), '[]'::jsonb)
  into v_reviews
  from public.product_reviews r where r.product_id = v_row.id and r.status = 'approved';

  begin
    v_delivery := public.resolve_product_delivery_text(v_row.id);
  exception when others then
    v_delivery := null;
  end;

  v_can_view := public.storefront_can_view_protected_price(p_force_mode);
  v_out := jsonb_build_object(
    'ok', true,
    'product', to_jsonb(v_row),
    'variants', v_variants,
    'reviews', jsonb_build_object(
      'average_rating', coalesce(v_avg, 0), 'count', coalesce(v_count, 0), 'items', v_reviews
    ),
    'delivery_text', v_delivery,
    'price_visible', v_can_view
  );

  if not v_can_view then
    perform public.commercial_observe('price_redacted', 'PRICE_REDACTED', 'product_detail', jsonb_build_object('slug', p_slug));
    v_out := public.redact_protected_price_fields(v_out, false);
    v_out := v_out || jsonb_build_object('ok', true, 'price_visible', false);
  end if;
  return v_out;
end;
$$;

grant execute on function public.rpc_get_storefront_product(text, text) to anon, authenticated, service_role;

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
      or (v_filter = 'collection' and p_slug is not null and exists (
        select 1 from public.collections c where c.id = p.collection_id and c.is_active and c.slug = btrim(p_slug)))
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
        or (v_filter = 'collection' and p_slug is not null and exists (
          select 1 from public.collections c where c.id = p.collection_id and c.is_active and c.slug = btrim(p_slug)))
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

create or replace function public.rpc_search_storefront_products(
  p_query text, p_limit int default 12, p_offset int default 0, p_force_mode text default null
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
  v_can_view boolean := public.storefront_can_view_protected_price(p_force_mode);
  v_q text := trim(coalesce(p_query, ''));
begin
  select count(*) into v_total from public.products p
  where p.published = true and (v_q = '' or p.name ilike '%'||v_q||'%' or p.slug ilike '%'||v_q||'%' or coalesce(p.sku,'') ilike '%'||v_q||'%');

  select coalesce(jsonb_agg(to_jsonb(sub)), '[]'::jsonb) into v_items from (
    select p.* from public.products p
    where p.published = true and (v_q = '' or p.name ilike '%'||v_q||'%' or p.slug ilike '%'||v_q||'%' or coalesce(p.sku,'') ilike '%'||v_q||'%')
    order by p.sort_order, p.name
    limit greatest(coalesce(p_limit, 12), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) sub;

  if not v_can_view then
    v_items := public.redact_protected_price_fields(v_items, false);
  end if;
  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total, 'price_visible', v_can_view,
    'sort_by_price_note', case when not v_can_view then 'price_sort_disabled_when_redacted' else null end);
end;
$$;

grant execute on function public.rpc_search_storefront_products(text, int, int, text)
  to anon, authenticated, service_role;

create or replace function public.rpc_product_autocomplete(
  p_query text, p_limit int default 8, p_force_mode text default null
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
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'slug', p.slug, 'image_url', p.image_url,
    'price', case when v_can_view then to_jsonb(p.price) else 'null'::jsonb end,
    'price_restricted', not v_can_view
  )), '[]'::jsonb)
  into v_items
  from (
    select id, name, slug, image_url, price from public.products
    where published = true
      and (name ilike '%' || trim(p_query) || '%' or slug ilike '%' || trim(p_query) || '%')
    order by sort_order, name
    limit greatest(1, least(coalesce(p_limit, 8), 20))
  ) p;
  return jsonb_build_object('ok', true, 'items', v_items, 'price_visible', v_can_view);
end;
$$;

grant execute on function public.rpc_product_autocomplete(text, int, text)
  to anon, authenticated, service_role;

create or replace function public.rpc_get_homepage_products_gated(
  p_section text default 'new',
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
  select coalesce(jsonb_agg(to_jsonb(sub)), '[]'::jsonb) into v_items from (
    select p.* from public.products p
    where p.published = true
      and (
        (p_section = 'new' and p.is_new = true)
        or (p_section = 'summer' and p.is_summer = true)
        or (p_section = 'all')
      )
    order by p.sort_order asc, p.created_at desc
    limit 8
  ) sub;

  if not v_can_view then
    v_items := public.redact_protected_price_fields(v_items, false);
  end if;
  return jsonb_build_object('ok', true, 'items', v_items, 'price_visible', v_can_view);
end;
$$;

grant execute on function public.rpc_get_homepage_products_gated(text, text)
  to anon, authenticated, service_role;
