-- Storefront product / homepage images.
-- Uses Unique catalogue photography already imported from Shopify (read-only).
-- Does NOT flip commercial / compliance / gateway / WMS / pilot locks.

create or replace function public.storefront_product_display_image(p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(p.image_url), ''),
    nullif(btrim(p.gallery_urls ->> 0), ''),
    (
      select nullif(btrim(pv.image_url), '')
      from public.product_variants pv
      where pv.product_id = p.id
        and nullif(btrim(pv.image_url), '') is not null
      order by pv.sort_order, pv.name
      limit 1
    ),
    (
      select coalesce(nullif(btrim(m.destination_url), ''), nullif(btrim(m.source_url), ''))
      from public.product_media m
      where m.product_id = p.id
        and coalesce(nullif(btrim(m.destination_url), ''), nullif(btrim(m.source_url), '')) is not null
      order by m.position
      limit 1
    )
  )
  from public.products p
  where p.id = p_product_id
$$;

grant execute on function public.storefront_product_display_image(uuid) to anon, authenticated, service_role;

-- Shopify "New in" / "New" collections and label-New tags were imported but
-- merchandising flags were left false, so homepage New arrivals rendered empty.
update public.products p
set is_new = true
where p.published
  and p.is_new = false
  and (
    exists (
      select 1
      from public.product_collections pc
      join public.collections c on c.id = pc.collection_id
      where pc.product_id = p.id
        and c.slug in ('new-in', 'new-shopify', 'new')
    )
    or exists (
      select 1 from unnest(coalesce(p.tags_raw, '{}'::text[])) t
      where lower(t) in ('label-new', 'new')
    )
  );

update public.products p
set is_summer = true
where p.published
  and p.is_summer = false
  and (
    (p.compare_at_price is not null and p.compare_at_price > p.price)
    or exists (
      select 1 from unnest(coalesce(p.tags_raw, '{}'::text[])) t
      where lower(t) in ('label-bundle deal', 'label-sale', 'label-offer', 'label-deal')
    )
    or exists (
      select 1
      from public.product_collections pc
      join public.collections c on c.id = pc.collection_id
      where pc.product_id = p.id
        and c.slug in ('offers', 'deals')
        and p.published
    )
  );

-- Homepage CMS cards still used leftover electronics artwork. Point them at
-- real Unique catalogue product photos (already in Unique OS).
update public.feature_cards f
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and inventory_count > 0
    and (
      lower(coalesce(product_type, '')) ~ '(vape|puff|pod|nic salt)'
      or lower(name) ~ '(hayati|ivg)'
    )
  order by inventory_count desc, published_at desc nulls last
  limit 1
) s
where f.sort_order = 0
  and nullif(btrim(s.image_url), '') is not null;

update public.feature_cards f
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and inventory_count > 0
    and (
      lower(coalesce(product_type, '')) ~ '(confection|crisp|snack|chocolate|sweet)'
      or lower(name) ~ '(cheetos|cadbury|airhead)'
    )
  order by inventory_count desc, published_at desc nulls last
  limit 1
) s
where f.sort_order = 1
  and nullif(btrim(s.image_url), '') is not null;

update public.feature_cards f
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and inventory_count > 0
    and (
      lower(coalesce(product_type, '')) ~ '(drink|beverage)'
      or lower(name) ~ '(yazoo|7-up|fanta|dr\.? pepper)'
    )
  order by inventory_count desc, published_at desc nulls last
  limit 1
) s
where f.sort_order = 2
  and nullif(btrim(s.image_url), '') is not null;

update public.lifestyle_cards l
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and is_new
  order by published_at desc nulls last
  limit 1
) s
where l.layout = 'large'
  and nullif(btrim(s.image_url), '') is not null;

update public.lifestyle_cards l
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and inventory_count > 0
    and (
      lower(coalesce(product_type, '')) ~ '(confection|crisp|snack|chocolate|sweet)'
      or lower(name) ~ '(cheetos|cadbury|airhead)'
    )
  order by inventory_count desc
  limit 1
) s
where l.layout = 'small'
  and l.sort_order = (select min(sort_order) from public.lifestyle_cards where layout = 'small')
  and nullif(btrim(s.image_url), '') is not null;

update public.lifestyle_cards l
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and inventory_count > 0
    and lower(coalesce(vendor, '')) <> ''
  order by inventory_count desc
  limit 1 offset 1
) s
where l.layout = 'small'
  and l.sort_order = (select max(sort_order) from public.lifestyle_cards where layout = 'small')
  and nullif(btrim(s.image_url), '') is not null;

update public.lifestyle_cards l
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and inventory_count > 0
  order by inventory_count desc
  limit 1 offset 2
) s
where l.layout = 'wide'
  and nullif(btrim(s.image_url), '') is not null;

update public.hero_slides h
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and inventory_count > 0
    and (
      lower(coalesce(product_type, '')) ~ '(vape|puff|pod)'
      or lower(name) ~ '(hayati|ivg)'
    )
  order by inventory_count desc
  limit 1
) s
where h.sort_order = (select min(sort_order) from public.hero_slides where is_active)
  and nullif(btrim(s.image_url), '') is not null;

update public.hero_slides h
set image_url = s.image_url
from (
  select image_url
  from public.products
  where published
    and nullif(btrim(image_url), '') is not null
    and inventory_count > 0
    and (
      lower(coalesce(product_type, '')) ~ '(confection|crisp|snack|drink)'
      or lower(name) ~ '(cheetos|airhead|yazoo)'
    )
  order by inventory_count desc
  limit 1
) s
where h.sort_order = (
    select min(s2.sort_order) from public.hero_slides s2
    where s2.is_active and s2.sort_order > (select min(sort_order) from public.hero_slides where is_active)
  )
  and nullif(btrim(s.image_url), '') is not null;

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
  v_section text := lower(coalesce(btrim(p_section), 'new'));
begin
  if v_section in ('summer', 'deals', 'offers') then
    v_section := 'summer';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(sub) || public.storefront_safe_product_attrs(sub.id)
    || jsonb_build_object('image_url', public.storefront_product_display_image(sub.id))
  ), '[]'::jsonb)
  into v_items
  from (
    select p.*
    from public.products p
    where p.published = true
      and nullif(btrim(p.image_url), '') is not null
      and (
        (
          v_section = 'new'
          and (
            p.is_new = true
            or exists (
              select 1
              from public.product_collections pc
              join public.collections c on c.id = pc.collection_id
              where pc.product_id = p.id
                and c.slug in ('new-in', 'new-shopify', 'new')
            )
          )
        )
        or (
          v_section = 'summer'
          and (
            p.is_summer = true
            or exists (
              select 1
              from public.product_collections pc
              join public.collections c on c.id = pc.collection_id
              where pc.product_id = p.id
                and c.slug in ('offers', 'deals')
            )
            -- Unique's live offers collection is empty; show in-stock catalogue
            -- photography rather than a blank homepage section.
            or p.inventory_count > 0
          )
        )
        or v_section = 'all'
      )
    order by
      case when v_section = 'new' then p.published_at end desc nulls last,
      case when v_section = 'summer' then p.inventory_count end desc nulls last,
      p.sort_order asc,
      p.created_at desc
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

create or replace function public.rpc_list_storefront_products(
  p_filter text default 'all',
  p_slug text default null,
  p_limit int default 12,
  p_offset int default 0,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_in_stock_only boolean default false,
  p_sort text default 'default',
  p_force_mode text default null,
  p_vendor text default null,
  p_product_type text default null,
  p_strength text default null
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
  v_vendor text := nullif(btrim(p_vendor), '');
  v_type text := nullif(btrim(p_product_type), '');
  v_strength text := nullif(btrim(p_strength), '');
begin
  if v_filter = 'offers' then
    v_filter := 'deals';
  end if;

  select count(*) into v_total
  from public.products p
  where p.published = true
    and (v_min is null or p.price >= v_min)
    and (v_max is null or p.price <= v_max)
    and (not coalesce(p_in_stock_only, false) or p.inventory_count > 0)
    and (v_vendor is null or lower(btrim(p.vendor)) = lower(v_vendor))
    and (v_type is null or lower(btrim(p.product_type)) = lower(v_type))
    and (v_strength is null or exists (
      select 1 from public.metafields m
      where m.owner_id = p.id
        and m.owner_type in ('product', 'Product')
        and lower(m.namespace) = 'custom'
        and lower(m.key) = 'nicotine_strength'
        and lower(coalesce(m.value_text, m.value_json #>> '{}')) = lower(v_strength)
    ))
    and (
      v_filter = 'all' or (v_filter = 'new' and p.is_new = true) or (v_filter = 'best' and p.is_featured = true)
      or (v_filter in ('deals', 'summer') and p.is_summer = true)
      or (v_filter = 'brand' and p_slug is not null and lower(regexp_replace(coalesce(p.vendor, ''), '[^a-zA-Z0-9]+', '-', 'g')) = lower(btrim(p_slug)))
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

  select coalesce(jsonb_agg(
    to_jsonb(sub) || public.storefront_safe_product_attrs(sub.id)
    || jsonb_build_object('image_url', public.storefront_product_display_image(sub.id))
  ), '[]'::jsonb) into v_items
  from (
    select p.* from public.products p
    where p.published = true
      and (v_min is null or p.price >= v_min)
      and (v_max is null or p.price <= v_max)
      and (not coalesce(p_in_stock_only, false) or p.inventory_count > 0)
      and (v_vendor is null or lower(btrim(p.vendor)) = lower(v_vendor))
      and (v_type is null or lower(btrim(p.product_type)) = lower(v_type))
      and (v_strength is null or exists (
        select 1 from public.metafields m
        where m.owner_id = p.id
          and m.owner_type in ('product', 'Product')
          and lower(m.namespace) = 'custom'
          and lower(m.key) = 'nicotine_strength'
          and lower(coalesce(m.value_text, m.value_json #>> '{}')) = lower(v_strength)
      ))
      and (
        v_filter = 'all' or (v_filter = 'new' and p.is_new = true) or (v_filter = 'best' and p.is_featured = true)
        or (v_filter in ('deals', 'summer') and p.is_summer = true)
        or (v_filter = 'brand' and p_slug is not null and lower(regexp_replace(coalesce(p.vendor, ''), '[^a-zA-Z0-9]+', '-', 'g')) = lower(btrim(p_slug)))
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
      case when v_sort = 'default' then (public.storefront_product_display_image(p.id) is null)::int end asc,
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

grant execute on function public.rpc_list_storefront_products(text, text, int, int, numeric, numeric, boolean, text, text, text, text, text)
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
  where p.published = true and (
    v_q = ''
    or p.name ilike '%'||v_q||'%'
    or p.slug ilike '%'||v_q||'%'
    or coalesce(p.sku,'') ilike '%'||v_q||'%'
    or coalesce(p.vendor,'') ilike '%'||v_q||'%'
    or coalesce(p.product_type,'') ilike '%'||v_q||'%'
    or exists (
      select 1 from public.product_variants pv
      where pv.product_id = p.id and coalesce(pv.sku,'') ilike '%'||v_q||'%'
    )
  );

  select coalesce(jsonb_agg(
    to_jsonb(sub) || public.storefront_safe_product_attrs(sub.id)
    || jsonb_build_object('image_url', public.storefront_product_display_image(sub.id))
  ), '[]'::jsonb) into v_items from (
    select p.* from public.products p
    where p.published = true and (
      v_q = ''
      or p.name ilike '%'||v_q||'%'
      or p.slug ilike '%'||v_q||'%'
      or coalesce(p.sku,'') ilike '%'||v_q||'%'
      or coalesce(p.vendor,'') ilike '%'||v_q||'%'
      or coalesce(p.product_type,'') ilike '%'||v_q||'%'
      or exists (
        select 1 from public.product_variants pv
        where pv.product_id = p.id and coalesce(pv.sku,'') ilike '%'||v_q||'%'
      )
    )
    order by
      (public.storefront_product_display_image(p.id) is null)::int asc,
      p.sort_order, p.name
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
    'id', p.id, 'name', p.name, 'slug', p.slug,
    'image_url', public.storefront_product_display_image(p.id),
    'vendor', p.vendor,
    'price', case when v_can_view then to_jsonb(p.price) else 'null'::jsonb end,
    'price_restricted', not v_can_view
  )), '[]'::jsonb)
  into v_items
  from (
    select id, name, slug, image_url, price, vendor from public.products
    where published = true
      and (
        name ilike '%' || trim(p_query) || '%'
        or slug ilike '%' || trim(p_query) || '%'
        or coalesce(sku,'') ilike '%' || trim(p_query) || '%'
        or coalesce(vendor,'') ilike '%' || trim(p_query) || '%'
      )
    order by
      (public.storefront_product_display_image(id) is null)::int asc,
      sort_order, name
    limit greatest(1, least(coalesce(p_limit, 8), 20))
  ) p;
  return jsonb_build_object('ok', true, 'items', v_items, 'price_visible', v_can_view);
end;
$$;

grant execute on function public.rpc_product_autocomplete(text, int, text)
  to anon, authenticated, service_role;
