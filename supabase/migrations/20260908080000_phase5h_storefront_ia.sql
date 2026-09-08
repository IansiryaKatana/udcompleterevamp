-- Unique storefront IA: pinned collection routes, age-gate display on, no electronics fallback.
-- Does NOT flip commercial / gateway / WMS / pilot locks.

update public.site_settings
set value = 'true'
where key = 'age_gate_display_enabled';

insert into public.site_settings (key, value)
values ('age_gate_display_enabled', 'true')
on conflict (key) do update set value = 'true';

insert into public.site_settings (key, value)
values ('contact_phone', '+44 7340 676909')
on conflict (key) do update
set value = excluded.value
where btrim(coalesce(site_settings.value, '')) = '';

update public.homepage_sections
set
  title = 'Shop by category',
  subtitle = 'Browse wholesale ranges used by UK retailers.',
  cta_label = '',
  cta_url = ''
where section_key = 'shop_by_category';

update public.homepage_sections
set
  section_key = 'shop_by_category',
  title = 'Shop by category',
  subtitle = 'Browse wholesale ranges used by UK retailers.',
  cta_label = '',
  cta_url = ''
where section_key = 'trade_proof'
  and not exists (
    select 1 from public.homepage_sections where section_key = 'shop_by_category'
  );

update public.nav_links
set is_active = false
where location = 'header'
  and id not in (
    'a1111111-5a00-4000-8000-000000000061',
    'a1111111-5a00-4000-8000-000000000062',
    'a1111111-5a00-4000-8000-000000000063',
    'a1111111-5a00-4000-8000-000000000064',
    'a1111111-5a00-4000-8000-000000000065',
    'a1111111-5a00-4000-8000-000000000066',
    'a1111111-5a00-4000-8000-000000000067',
    'a1111111-5a00-4000-8000-000000000068',
    'a1111111-5a00-4000-8000-000000000069'
  );

insert into public.nav_links (id, label, href, location, sort_order, is_active)
values
  ('a1111111-5a00-4000-8000-000000000061', 'Vapes', '/collection/vapes', 'header', 10, true),
  ('a1111111-5a00-4000-8000-000000000062', 'Nic Salts', '/collection/10ml-nic-salt', 'header', 20, true),
  ('a1111111-5a00-4000-8000-000000000063', 'Nic Pouches', '/collection/nicotine-pouches', 'header', 30, true),
  ('a1111111-5a00-4000-8000-000000000064', 'Confectionery', '/collection/confectionery', 'header', 40, true),
  ('a1111111-5a00-4000-8000-000000000065', 'Drinks', '/collection/drinks', 'header', 50, true),
  ('a1111111-5a00-4000-8000-000000000066', 'Smoking Accessories', '/collection/smoking-accessories', 'header', 60, true),
  ('a1111111-5a00-4000-8000-000000000067', 'Essentials', '/collection/essentials', 'header', 70, true),
  ('a1111111-5a00-4000-8000-000000000068', 'Offers', '/collection/deals', 'header', 80, true),
  ('a1111111-5a00-4000-8000-000000000069', 'CBD', '/collection/haze-cbd', 'header', 90, true)
on conflict (id) do update set
  label = excluded.label,
  href = excluded.href,
  location = excluded.location,
  sort_order = excluded.sort_order,
  is_active = true;

create or replace function public.storefront_first_active_collection_slug(p_slugs text[])
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select c.slug
  from unnest(p_slugs) with ordinality as wanted(slug, ord)
  join public.collections c on c.slug = wanted.slug
  where coalesce(c.is_active, true)
  order by wanted.ord
  limit 1;
$$;

create or replace function public.rpc_storefront_shop_nav()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_header jsonb := '[]'::jsonb;
  v_shop jsonb := '[]'::jsonb;
  v_others jsonb := '[]'::jsonb;
  v_cbd text;
  v_item record;
begin
  v_cbd := coalesce(
    public.storefront_first_active_collection_slug(array['cbd', 'haze-cbd']),
    'haze-cbd'
  );

  for v_item in
    select * from (
      values
        (10, 'Vapes', public.storefront_first_active_collection_slug(array['vapes']), false),
        (20, 'Nic Salts', public.storefront_first_active_collection_slug(array['10ml-nic-salt']), false),
        (30, 'Nic Pouches', public.storefront_first_active_collection_slug(array['nicotine-pouches']), false),
        (40, 'Confectionery', public.storefront_first_active_collection_slug(array['confectionery']), false),
        (50, 'Drinks', public.storefront_first_active_collection_slug(array['drinks']), false),
        (60, 'Smoking Accessories', public.storefront_first_active_collection_slug(array['smoking-accessories']), false),
        (70, 'Essentials', public.storefront_first_active_collection_slug(array['essentials']), false),
        (80, 'Offers', coalesce(public.storefront_first_active_collection_slug(array['deals', 'offers']), 'deals'), true),
        (90, 'CBD', v_cbd, false)
    ) as t(sort_order, label, slug, highlight)
  loop
    if v_item.slug is not null then
      v_header := v_header || jsonb_build_array(jsonb_build_object(
        'label', v_item.label,
        'href', '/collection/' || v_item.slug,
        'slug', v_item.slug,
        'highlight', v_item.highlight
      ));
    end if;
  end loop;

  for v_item in
    select * from (
      values
        (10, '10ml Nic Salt', public.storefront_first_active_collection_slug(array['10ml-nic-salt'])),
        (20, 'Legal Big Puff', public.storefront_first_active_collection_slug(array['legal-big-puff-device', 'legal-big-puff'])),
        (30, 'Legal Big Puff Pods', public.storefront_first_active_collection_slug(array['legal-big-puff-pods'])),
        (40, 'Nicotine Pouches', public.storefront_first_active_collection_slug(array['nicotine-pouches'])),
        (50, 'Shortfills & Nic Shots', public.storefront_first_active_collection_slug(array['shortfills-nic-shots'])),
        (60, 'Vape coils/pods', public.storefront_first_active_collection_slug(array['vape-coils-pods'])),
        (70, 'Vape Pod Kits', public.storefront_first_active_collection_slug(array['wholesale-vape-pod-kits', 'vape-pod-kits'])),
        (80, 'Smoking Accessories', public.storefront_first_active_collection_slug(array['smoking-accessories'])),
        (90, 'Shop Essentials', public.storefront_first_active_collection_slug(array['essentials'])),
        (100, 'CBD', v_cbd),
        (110, 'Confectionery', public.storefront_first_active_collection_slug(array['confectionery'])),
        (120, 'Drinks', public.storefront_first_active_collection_slug(array['drinks']))
    ) as t(sort_order, label, slug)
  loop
    if v_item.slug is not null then
      v_shop := v_shop || jsonb_build_array(jsonb_build_object(
        'label', v_item.label,
        'href', '/collection/' || v_item.slug,
        'slug', v_item.slug
      ));
    end if;
  end loop;

  v_others := jsonb_build_array(
    jsonb_build_object('label', 'Brands', 'href', '/brands'),
    jsonb_build_object('label', 'New arrivals', 'href', '/collection/new'),
    jsonb_build_object('label', 'Legal Big Puff', 'href', '/collection/' || coalesce(public.storefront_first_active_collection_slug(array['legal-big-puff-device', 'legal-big-puff']), 'legal-big-puff-device')),
    jsonb_build_object('label', 'Shortfills & Nic Shots', 'href', '/collection/' || coalesce(public.storefront_first_active_collection_slug(array['shortfills-nic-shots']), 'shortfills-nic-shots')),
    jsonb_build_object('label', 'Vape coils/pods', 'href', '/collection/' || coalesce(public.storefront_first_active_collection_slug(array['vape-coils-pods']), 'vape-coils-pods')),
    jsonb_build_object('label', 'Vape Pod Kits', 'href', '/collection/' || coalesce(public.storefront_first_active_collection_slug(array['wholesale-vape-pod-kits', 'vape-pod-kits']), 'wholesale-vape-pod-kits')),
    jsonb_build_object('label', 'All products', 'href', '/collection/all')
  );

  return jsonb_build_object(
    'ok', true,
    'header', v_header,
    'shop_by_category', v_shop,
    'items', v_shop,
    'others', v_others,
    'view_all', jsonb_build_object('label', 'View all categories', 'href', '/collection/all')
  );
end;
$$;

grant execute on function public.storefront_first_active_collection_slug(text[]) to anon, authenticated, service_role;
grant execute on function public.rpc_storefront_shop_nav() to anon, authenticated, service_role;
