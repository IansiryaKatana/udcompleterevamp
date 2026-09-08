-- Phase 5H — storefront UX RPCs, CMS IA/copy, customer-safe account surfaces.
-- Does NOT flip commercial/compliance/gateway/WMS/pilot locks.

-- ── Nav locations ──────────────────────────────────────────────────────────
alter table public.nav_links drop constraint if exists nav_links_location_check;
alter table public.nav_links add constraint nav_links_location_check
  check (location in (
    'header',
    'footer_categories',
    'footer_legal',
    'footer_help',
    'footer_shop',
    'footer_trade',
    'footer_company',
    'footer_support'
  ));

-- ── Site settings (insert only if missing; never overwrite lock keys) ─────
insert into public.site_settings (key, value) values
  ('hero_supporting_copy', 'Vapes, nicotine products, confectionery, drinks, accessories and retail essentials supplied to UK businesses through one trade platform.'),
  ('hero_secondary_cta_label', 'Open a trade account'),
  ('hero_secondary_cta_url', '/trade'),
  ('lifestyle_heading', 'Shop the trade catalogue'),
  ('lifestyle_subtitle', 'Browse wholesale ranges used by UK retailers.'),
  ('contact_company_legal_name', 'UNIQUE WHOLESALE & DISTRIBUTION LIMITED'),
  ('contact_company_number', '15678913'),
  ('contact_address', '124 City Road, London, United Kingdom, EC1V 2NX'),
  ('contact_hours', 'Monday – Friday: 9:00–20:00. Saturday: 11:00–15:00.')
on conflict (key) do nothing;

update public.site_settings
set value = 'UK wholesale distributor supplying retailers from one trade catalogue.'
where key = 'footer_tagline'
  and (
    value ilike '%electronics%'
    or value ilike '%tech drops%'
    or value = ''
    or value ilike '%work, play%'
  );

update public.site_settings
set value = 'Trade updates from Unique Distribution'
where key = 'newsletter_heading'
  and (value ilike '%tech%' or value ilike '%drops%' or value = '');

update public.site_settings
set value = 'GBP'
where key = 'currency_code' and value in ('USD', 'usd', '');

update public.site_settings
set value = 'en-GB'
where key = 'currency_locale' and value in ('en-US', 'en_US', '');

-- ── CMS homepage copy (electronics → B2B wholesale) ───────────────────────
update public.hero_slides
set headline_lines = '["Wholesale products","built for retail."]'::jsonb,
    cta_label = 'Shop wholesale',
    cta_url = '/collection/all'
where is_active = true
  and sort_order = (select min(sort_order) from public.hero_slides where is_active);

update public.hero_slides
set headline_lines = '["Open a Unique","trade account."]'::jsonb,
    cta_label = 'Apply for trade',
    cta_url = '/trade'
where is_active = true
  and sort_order = (
    select min(s.sort_order) from public.hero_slides s
    where s.is_active and s.sort_order > (select min(sort_order) from public.hero_slides where is_active)
  );

update public.feature_cards set
  title = 'Vapes & nicotine products for retail shelves.',
  cta_label = 'Shop vapes',
  cta_url = '/collection/all'
where sort_order = 0;

update public.feature_cards set
  title = 'Confectionery, drinks and everyday retail essentials.',
  cta_label = 'Browse catalogue',
  cta_url = '/collection/all'
where sort_order = 1;

update public.feature_cards set
  title = 'Trade pricing, quotes and repeat wholesale ordering.',
  cta_label = 'Open trade account',
  cta_url = '/trade'
where sort_order = 2;

update public.lifestyle_cards set
  title = 'New wholesale arrivals',
  cta_label = 'Shop new',
  cta_url = '/collection/new'
where layout = 'large';

update public.lifestyle_cards set
  title = 'Current offers',
  cta_label = 'View offers',
  cta_url = '/collection/deals'
where layout = 'small' and sort_order = (
  select min(sort_order) from public.lifestyle_cards where layout = 'small'
);

update public.lifestyle_cards set
  title = 'Shop by brand',
  cta_label = 'Browse brands',
  cta_url = '/brands'
where layout = 'small' and sort_order = (
  select max(sort_order) from public.lifestyle_cards where layout = 'small'
);

update public.lifestyle_cards set
  title = 'Full trade catalogue',
  cta_label = 'View all products',
  cta_url = '/collection/all'
where layout = 'wide';

update public.homepage_sections set
  title = 'New arrivals',
  subtitle = 'Latest additions to the Unique wholesale catalogue.',
  cta_label = 'View new products',
  cta_url = '/collection/new'
where section_key = 'newly_dropped';

update public.homepage_sections set
  title = 'Offers',
  subtitle = 'Featured wholesale offers currently merchandised in the catalogue.',
  cta_label = 'View offers',
  cta_url = '/collection/deals'
where section_key = 'summer_collections';

update public.homepage_sections set
  title = 'Stock your shop from one UK wholesale platform.',
  cta_label = 'Open a trade account',
  cta_url = '/trade'
where section_key = 'final_cta';

insert into public.homepage_sections (section_key, title, subtitle, image_url, cta_label, cta_url, sort_order, is_active)
select
  'trade_proof',
  'Built for retailers',
  'A trade catalogue, wholesale ordering, quotes and account support — without consumer-store theatre.',
  '',
  'Why trade with Unique',
  '/trade',
  5,
  true
where not exists (select 1 from public.homepage_sections where section_key = 'trade_proof');

-- ── Navigation ────────────────────────────────────────────────────────────
update public.nav_links set is_active = false
where location = 'header' and href in ('/', '/bundles');

insert into public.nav_links (id, label, href, location, sort_order, is_active) values
  ('a1111111-5a00-4000-8000-000000000001', 'Brands', '/brands', 'header', 10, true),
  ('a1111111-5a00-4000-8000-000000000002', 'New', '/collection/new', 'header', 20, true),
  ('a1111111-5a00-4000-8000-000000000003', 'Offers', '/collection/deals', 'header', 30, true),
  ('a1111111-5a00-4000-8000-000000000004', 'Trade', '/trade', 'header', 40, true),
  ('a1111111-5a00-4000-8000-000000000005', 'About', '/pages/about', 'header', 50, true),
  ('a1111111-5a00-4000-8000-000000000006', 'Contact', '/pages/contact', 'header', 60, true),
  ('a1111111-5a00-4000-8000-000000000010', 'Categories', '/collection/all', 'footer_shop', 0, true),
  ('a1111111-5a00-4000-8000-000000000011', 'Brands', '/brands', 'footer_shop', 1, true),
  ('a1111111-5a00-4000-8000-000000000012', 'New arrivals', '/collection/new', 'footer_shop', 2, true),
  ('a1111111-5a00-4000-8000-000000000013', 'Offers', '/collection/deals', 'footer_shop', 3, true),
  ('a1111111-5a00-4000-8000-000000000020', 'Open a trade account', '/trade', 'footer_trade', 0, true),
  ('a1111111-5a00-4000-8000-000000000021', 'Trade login', '/account', 'footer_trade', 1, true),
  ('a1111111-5a00-4000-8000-000000000022', 'Request a quote', '/cart', 'footer_trade', 2, true),
  ('a1111111-5a00-4000-8000-000000000023', 'Delivery information', '/pages/shipping', 'footer_trade', 3, true),
  ('a1111111-5a00-4000-8000-000000000030', 'About', '/pages/about', 'footer_company', 0, true),
  ('a1111111-5a00-4000-8000-000000000031', 'Contact', '/pages/contact', 'footer_company', 1, true),
  ('a1111111-5a00-4000-8000-000000000040', 'Help', '/pages/help', 'footer_support', 0, true),
  ('a1111111-5a00-4000-8000-000000000041', 'Account support', '/account', 'footer_support', 1, true),
  ('a1111111-5a00-4000-8000-000000000042', 'Order support', '/pages/contact', 'footer_support', 2, true),
  ('a1111111-5a00-4000-8000-000000000050', 'Terms & Conditions', '/pages/terms', 'footer_legal', 0, true),
  ('a1111111-5a00-4000-8000-000000000051', 'Privacy Policy', '/pages/privacy', 'footer_legal', 1, true),
  ('a1111111-5a00-4000-8000-000000000052', 'Cookie Policy', '/pages/cookies', 'footer_legal', 2, true)
on conflict (id) do update set
  label = excluded.label,
  href = excluded.href,
  location = excluded.location,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

update public.nav_links
set is_active = false
where location in ('footer_categories', 'footer_help')
  and id not in (
    'a1111111-5a00-4000-8000-000000000010',
    'a1111111-5a00-4000-8000-000000000040'
  );

update public.nav_links
set is_active = false
where location = 'footer_legal'
  and id not in (
    'a1111111-5a00-4000-8000-000000000050',
    'a1111111-5a00-4000-8000-000000000051',
    'a1111111-5a00-4000-8000-000000000052'
  );

-- ── Marketing pages (format / positioning; no invented legal duties) ──────
insert into public.marketing_pages (id, title, slug, body_html, meta_description, published, sort_order)
values
(
  'b1111111-5a00-4000-8000-000000000001',
  'About Unique Distribution',
  'about',
  $html$<p>Unique Distribution is a UK wholesale distributor supplying retailers with vapes, nicotine products, confectionery, drinks, accessories and retail essentials from one trade platform.</p>
<p>We are a supply partner for shops — not a consumer lifestyle store. Trade customers can browse the catalogue, request quotes, and apply for a Unique trade account.</p>
<p>When you work with Unique you gain a catalogue built for restocking, not end-user browsing.</p>$html$,
  'Unique Distribution is a UK wholesale distributor and retail supply partner.',
  true,
  10
),
(
  'b1111111-5a00-4000-8000-000000000002',
  'Help & support',
  'help',
  $html$<p>Need help with an order, trade application, delivery question or account issue? Contact Unique Distribution and our team will point you to the right place.</p>
<ul>
<li><strong>Orders:</strong> sign in to your account for recent orders, or contact us with your order reference.</li>
<li><strong>Trade applications:</strong> apply at <a href="/trade">Open a trade account</a>.</li>
<li><strong>Quotes:</strong> request a quote from a product, your cart, or checkout.</li>
<li><strong>Delivery:</strong> see <a href="/pages/shipping">Delivery information</a>.</li>
</ul>
<p><a href="/pages/contact">Contact Unique Distribution</a></p>$html$,
  'Help with Unique Distribution orders, trade accounts, quotes and delivery.',
  true,
  11
)
on conflict (slug) do update set
  title = excluded.title,
  body_html = excluded.body_html,
  meta_description = excluded.meta_description,
  published = true;

update public.marketing_pages
set title = 'Contact Unique Distribution',
    meta_description = 'Trade enquiries, order support and general contact for Unique Distribution.',
    body_html = $html$<p>Use this form for trade enquiries, order or account support, and general questions. Include your trading name and order reference where relevant.</p>$html$
where slug = 'contact';

update public.marketing_pages
set title = 'Delivery information',
    meta_description = 'Delivery information for Unique Distribution wholesale orders.',
    body_html = $html$<p>Unique Distribution supplies UK trade customers. Delivery options, cut-offs and Saturday arrangements are confirmed with your account or quote — Unique’s native carrier integration is not live on this platform yet.</p>
<p>The live Unique Distribution business currently publishes next-working-day dispatch for qualifying orders placed on weekdays by 16:00, with Saturday delivery arranged through your account manager. Treat those as Unique’s current published trade terms until this platform’s own fulfilment settings are confirmed.</p>
<p>Tracking appears on your order only after a shipment has actually been created. This site does not show Unique DPD tracking while carrier mode is disabled.</p>
<p>Questions: <a href="/pages/contact">contact support</a>.</p>$html$
where slug = 'shipping';

update public.marketing_pages
set body_html = replace(replace(body_html,
  'operates this online store for components, phones, consoles, and related accessories',
  'operates this wholesale trade platform for UK retailers'),
  'including payment providers (Stripe), email delivery services, shipping carriers, and hosting providers',
  'including payment providers where enabled, email delivery services, shipping carriers, and hosting providers')
where slug = 'privacy'
  and body_html ilike '%components, phones%';

update public.marketing_pages
set body_html = replace(body_html,
  'We sell new and refurbished electronics including PC components, mobile devices, and gaming hardware.',
  'We supply wholesale products to trade customers, including vapes, nicotine products, confectionery, drinks, accessories and retail essentials. Trade pricing and checkout eligibility follow Unique commercial policy.')
where slug = 'terms'
  and body_html ilike '%refurbished electronics%';

-- ── Safe product attributes (whitelist only) ──────────────────────────────
create or replace function public.storefront_safe_product_attrs(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'vendor', nullif(btrim(p.vendor), ''),
    'product_type', nullif(btrim(p.product_type), ''),
    'nicotine_strength', (
      select nullif(btrim(coalesce(m.value_text, m.value_json #>> '{}')), '')
      from public.metafields m
      where m.owner_type in ('product', 'Product')
        and m.owner_id = p.id
        and lower(m.namespace) = 'custom'
        and lower(m.key) = 'nicotine_strength'
      limit 1
    ),
    'pack_quantity', (
      select nullif(btrim(coalesce(m.value_text, m.value_json #>> '{}')), '')
      from public.metafields m
      where m.owner_type in ('product', 'Product')
        and m.owner_id = p.id
        and lower(m.namespace) = 'custom'
        and lower(m.key) in ('pack_quantity', 'box_qty', 'pack_size', 'box_quantity')
      order by case lower(m.key)
        when 'pack_quantity' then 0
        when 'box_qty' then 1
        else 2
      end
      limit 1
    )
  ))
  from public.products p
  where p.id = p_product_id
$$;

grant execute on function public.storefront_safe_product_attrs(uuid) to anon, authenticated, service_role;

create or replace function public.storefront_linked_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.customers c
  where c.auth_user_id = (select auth.uid())
  limit 1
$$;

grant execute on function public.storefront_linked_customer_id() to authenticated, service_role;

-- ── Shop mega-nav from real collections ───────────────────────────────────
create or replace function public.rpc_storefront_shop_nav()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_groups jsonb := '[
    {"label":"Vapes","match":"vape|dispos"},
    {"label":"Nic Salts","match":"nic salt|nic-salt|nicotine salt|nic salt"},
    {"label":"Nicotine Pouches","match":"pouch"},
    {"label":"Smoking Accessories","match":"accessor|smoking"},
    {"label":"Confectionery","match":"confection|sweet|candy|chocolate"},
    {"label":"Drinks","match":"drink|beverage|soft drink"},
    {"label":"Essentials","match":"essential"},
    {"label":"Electronics","match":"electronic"}
  ]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_g jsonb;
  v_row record;
begin
  for v_g in select * from jsonb_array_elements(v_groups)
  loop
    select c.slug, c.title, c.cover_image_url,
           count(distinct pc.product_id) filter (where p.published)::int as product_count
      into v_row
    from public.collections c
    left join public.product_collections pc on pc.collection_id = c.id
    left join public.products p on p.id = pc.product_id
    where coalesce(c.is_active, true)
      and (
        c.slug ~* (v_g->>'match')
        or c.title ~* (v_g->>'match')
      )
    group by c.id, c.slug, c.title, c.cover_image_url
    having count(distinct pc.product_id) filter (where p.published) > 0
    order by count(distinct pc.product_id) filter (where p.published) desc
    limit 1;

    if found and v_row.slug is not null then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'label', v_g->>'label',
        'href', '/collection/' || v_row.slug,
        'slug', v_row.slug,
        'title', v_row.title,
        'product_count', v_row.product_count,
        'image_url', v_row.cover_image_url
      ));
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'label', x.title,
      'href', '/collection/' || x.slug,
      'slug', x.slug,
      'title', x.title,
      'product_count', x.product_count,
      'image_url', x.cover_image_url
    )), '[]'::jsonb)
    into v_items
    from (
      select c.slug, c.title, c.cover_image_url,
             count(distinct pc.product_id) filter (where p.published)::int as product_count
      from public.collections c
      join public.product_collections pc on pc.collection_id = c.id
      join public.products p on p.id = pc.product_id
      where coalesce(c.is_active, true)
      group by c.id, c.slug, c.title, c.cover_image_url
      having count(distinct pc.product_id) filter (where p.published) >= 8
      order by count(distinct pc.product_id) filter (where p.published) desc
      limit 8
    ) x;
  end if;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce(v_items, '[]'::jsonb),
    'view_all', jsonb_build_object('label', 'View all categories', 'href', '/collection/all')
  );
end;
$$;

grant execute on function public.rpc_storefront_shop_nav() to anon, authenticated, service_role;

create or replace function public.rpc_storefront_brands(p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  return jsonb_build_object(
    'ok', true,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'vendor', v.vendor,
        'handle', v.handle,
        'product_count', v.product_count
      ) order by v.vendor), '[]'::jsonb)
      from (
        select
          btrim(p.vendor) as vendor,
          lower(regexp_replace(btrim(p.vendor), '[^a-zA-Z0-9]+', '-', 'g')) as handle,
          count(*)::int as product_count
        from public.products p
        where p.published = true
          and nullif(btrim(p.vendor), '') is not null
          and (v_q = '' or lower(p.vendor) like '%' || v_q || '%')
        group by btrim(p.vendor)
        having count(*) >= 2
      ) v
    )
  );
end;
$$;

grant execute on function public.rpc_storefront_brands(text) to anon, authenticated, service_role;

create or replace function public.rpc_storefront_product_facets(p_slug text default null, p_filter text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_filter text := lower(coalesce(btrim(p_filter), 'all'));
  v_min_count int := 5;
begin
  return jsonb_build_object(
    'ok', true,
    'vendors', (
      select coalesce(jsonb_agg(jsonb_build_object('value', vendor, 'count', cnt) order by vendor), '[]'::jsonb)
      from (
        select btrim(p.vendor) as vendor, count(*)::int as cnt
        from public.products p
        where p.published and nullif(btrim(p.vendor), '') is not null
        group by btrim(p.vendor)
        having count(*) >= v_min_count
        order by count(*) desc
        limit 40
      ) s
    ),
    'product_types', (
      select coalesce(jsonb_agg(jsonb_build_object('value', product_type, 'count', cnt) order by product_type), '[]'::jsonb)
      from (
        select btrim(p.product_type) as product_type, count(*)::int as cnt
        from public.products p
        where p.published and nullif(btrim(p.product_type), '') is not null
        group by btrim(p.product_type)
        having count(*) >= v_min_count
        order by count(*) desc
        limit 30
      ) s
    ),
    'nicotine_strengths', (
      select coalesce(jsonb_agg(jsonb_build_object('value', strength, 'count', cnt) order by strength), '[]'::jsonb)
      from (
        select nullif(btrim(coalesce(m.value_text, m.value_json #>> '{}')), '') as strength,
               count(distinct m.owner_id)::int as cnt
        from public.metafields m
        join public.products p on p.id = m.owner_id and p.published
        where m.owner_type in ('product', 'Product')
          and lower(m.namespace) = 'custom'
          and lower(m.key) = 'nicotine_strength'
        group by 1
        having count(distinct m.owner_id) >= v_min_count
          and nullif(btrim(coalesce(max(m.value_text), '')), '') is not null
        limit 20
      ) s
      where s.strength is not null
    ),
    'featured_available', exists (select 1 from public.products where published and is_featured),
    'new_available', exists (select 1 from public.products where published and is_new),
    'offers_available', exists (select 1 from public.products where published and is_summer)
  );
end;
$$;

grant execute on function public.rpc_storefront_product_facets(text, text) to anon, authenticated, service_role;

create or replace function public.rpc_storefront_catalogue_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'published_products', (select count(*) from public.products where published),
    'shopify_sourced_products', (select count(*) from public.products where catalogue_origin = 'SHOPIFY' or shopify_product_gid is not null),
    'published_collections', (select count(*) from public.collections where coalesce(is_active, true)),
    'vendors', (select count(distinct btrim(vendor)) from public.products where published and nullif(btrim(vendor), '') is not null)
  );
$$;

grant execute on function public.rpc_storefront_catalogue_stats() to anon, authenticated, service_role;

-- ── Extend list/search (drop+recreate to add optional facet args) ─────────
drop function if exists public.rpc_list_storefront_products(text, text, int, int, numeric, numeric, boolean, text, text);

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

  select coalesce(jsonb_agg(to_jsonb(sub) || public.storefront_safe_product_attrs(sub.id)), '[]'::jsonb) into v_items
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

  select coalesce(jsonb_agg(to_jsonb(sub) || public.storefront_safe_product_attrs(sub.id)), '[]'::jsonb) into v_items from (
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
    order by sort_order, name
    limit greatest(1, least(coalesce(p_limit, 8), 20))
  ) p;
  return jsonb_build_object('ok', true, 'items', v_items, 'price_visible', v_can_view);
end;
$$;

grant execute on function public.rpc_product_autocomplete(text, int, text)
  to anon, authenticated, service_role;

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
    'product', to_jsonb(v_row) || public.storefront_safe_product_attrs(v_row.id),
    'variants', v_variants,
    'storefront_attrs', public.storefront_safe_product_attrs(v_row.id),
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

-- ── Customer-safe account RPCs ────────────────────────────────────────────
create or replace function public.rpc_list_my_quotes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cid uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  v_cid := public.storefront_linked_customer_id();
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'total', o.total,
      'currency', o.currency,
      'created_at', o.created_at
    ) order by o.created_at desc), '[]'::jsonb)
    from public.orders o
    where o.status in ('quote_requested', 'quote', 'quoted')
      and (
        (v_cid is not null and o.customer_id = v_cid)
        or o.user_id = v_uid
      )
    limit 50
  ));
end;
$$;

grant execute on function public.rpc_list_my_quotes() to authenticated;

create or replace function public.rpc_list_my_invoices()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cid uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  v_cid := public.storefront_linked_customer_id();
  if v_cid is null then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'invoice_number', i.invoice_number,
      'invoice_date', i.invoice_date,
      'due_date', i.due_date,
      'total', i.total,
      'outstanding', i.outstanding,
      'status', i.status,
      'currency', i.currency,
      'provenance', i.provenance,
      'display_kind', case
        when i.provenance = 'imported_original' then 'imported'
        else 'account_document'
      end
    ) order by i.invoice_date desc), '[]'::jsonb)
    from public.invoices i
    where i.customer_id = v_cid
      and i.status in ('issued', 'paid', 'partial')
    limit 50
  ));
end;
$$;

grant execute on function public.rpc_list_my_invoices() to authenticated;

create or replace function public.rpc_list_my_statements()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cid uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  v_cid := public.storefront_linked_customer_id();
  if v_cid is null then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'period_from', s.period_from,
      'period_to', s.period_to,
      'opening_balance', s.opening_balance,
      'closing_balance', s.closing_balance,
      'currency', s.currency,
      'source_system', s.source_system,
      'display_kind', 'account_document'
    ) order by s.period_to desc), '[]'::jsonb)
    from public.statements s
    where s.customer_id = v_cid
    limit 24
  ));
end;
$$;

grant execute on function public.rpc_list_my_statements() to authenticated;

create or replace function public.rpc_list_my_addresses()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cid uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  v_cid := public.storefront_linked_customer_id();
  if v_cid is null then
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'address_type', a.address_type,
      'is_default', a.is_default,
      'first_name', a.first_name,
      'last_name', a.last_name,
      'company', a.company,
      'address1', a.address1,
      'address2', a.address2,
      'city', a.city,
      'province', a.province,
      'postal_code', a.postal_code,
      'country', a.country,
      'phone', a.phone
    ) order by a.is_default desc, a.created_at desc), '[]'::jsonb)
    from public.customer_addresses a
    where a.customer_id = v_cid
  ));
end;
$$;

grant execute on function public.rpc_list_my_addresses() to authenticated;

create or replace function public.rpc_upsert_my_address(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cid uuid;
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  v_cid := public.storefront_linked_customer_id();
  if v_cid is null then
    return jsonb_build_object('ok', false, 'error', 'CUSTOMER_NOT_LINKED');
  end if;

  v_id := nullif(p_payload->>'id', '')::uuid;

  if v_id is not null then
    update public.customer_addresses set
      address_type = coalesce(nullif(p_payload->>'address_type', ''), address_type),
      first_name = nullif(p_payload->>'first_name', ''),
      last_name = nullif(p_payload->>'last_name', ''),
      company = nullif(p_payload->>'company', ''),
      address1 = nullif(p_payload->>'address1', ''),
      address2 = nullif(p_payload->>'address2', ''),
      city = nullif(p_payload->>'city', ''),
      province = nullif(p_payload->>'province', ''),
      postal_code = nullif(p_payload->>'postal_code', ''),
      country = nullif(p_payload->>'country', ''),
      phone = nullif(p_payload->>'phone', ''),
      is_default = coalesce((p_payload->>'is_default')::boolean, is_default),
      updated_at = now()
    where id = v_id and customer_id = v_cid
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
    end if;
  else
    insert into public.customer_addresses (
      customer_id, address_type, first_name, last_name, company,
      address1, address2, city, province, postal_code, country, phone, is_default
    ) values (
      v_cid,
      coalesce(nullif(p_payload->>'address_type', ''), 'shipping'),
      nullif(p_payload->>'first_name', ''),
      nullif(p_payload->>'last_name', ''),
      nullif(p_payload->>'company', ''),
      nullif(p_payload->>'address1', ''),
      nullif(p_payload->>'address2', ''),
      nullif(p_payload->>'city', ''),
      nullif(p_payload->>'province', ''),
      nullif(p_payload->>'postal_code', ''),
      nullif(p_payload->>'country', ''),
      nullif(p_payload->>'phone', ''),
      coalesce((p_payload->>'is_default')::boolean, false)
    ) returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function public.rpc_upsert_my_address(jsonb) to authenticated;

create or replace function public.rpc_get_my_company()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cid uuid;
  v_company uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  v_cid := public.storefront_linked_customer_id();
  if v_cid is null then
    return jsonb_build_object('ok', true, 'company', null);
  end if;

  select cc.company_id into v_company
  from public.company_contacts cc
  where cc.customer_id = v_cid
  order by cc.is_primary desc nulls last
  limit 1;
  if v_company is null then
    return jsonb_build_object('ok', true, 'company', null);
  end if;

  return jsonb_build_object('ok', true, 'company', (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'trading_name', c.trading_name,
      'status', c.status
    )
    from public.companies c
    where c.id = v_company
  ));
end;
$$;

grant execute on function public.rpc_get_my_company() to authenticated;

create or replace function public.rpc_payment_gateway_public_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'gateway_mode', public.payment_gateway_mode(),
    'card_operational', public.payment_gateway_mode() not in ('disabled', '')
  );
$$;

grant execute on function public.rpc_payment_gateway_public_status() to anon, authenticated, service_role;

-- ── Selftest (read-only locks) ────────────────────────────────────────────
create or replace function public.rpc_phase5h_storefront_selftest()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pilot text;
  v_auth text;
  v_mode text;
  v_cutover text;
  v_comp text;
  v_pay text;
  v_nav jsonb;
  v_list jsonb;
  v_products int;
  v_variants int;
  v_collections int;
begin
  select value into v_pilot from site_settings where key = 'PHASE4I_PILOT_001' limit 1;
  select value into v_auth from site_settings where key = 'pilot_send_authorized' limit 1;
  select value into v_mode from site_settings where key = 'commercial_access_mode' limit 1;
  select value into v_cutover from site_settings where key = 'trade_required_cutover_approved' limit 1;
  select value into v_comp from site_settings where key in ('compliance_enforcement_mode', 'compliance_mode') order by key limit 1;
  select public.payment_gateway_mode() into v_pay;
  v_nav := public.rpc_storefront_shop_nav();
  v_list := public.rpc_list_storefront_products('all', null, 3, 0, null, null, false, 'default', null, null, null, null);
  select count(*) into v_products from public.products where shopify_product_gid is not null;
  select count(*) into v_variants from public.product_variants where shopify_variant_gid is not null;
  select count(*) into v_collections from public.collections where shopify_collection_gid is not null;

  return jsonb_build_object(
    'ok', true,
    'PHASE4I_PILOT', coalesce(v_pilot, 'NOT_SENT'),
    'pilot_send_authorized', coalesce(v_auth, 'false'),
    'commercial_access_mode', coalesce(v_mode, 'catalogue_open'),
    'trade_required_cutover_approved', coalesce(v_cutover, 'false'),
    'compliance_mode', coalesce(v_comp, 'observe'),
    'payment_gateway_mode', coalesce(v_pay, 'disabled'),
    'shop_nav_ok', coalesce((v_nav->>'ok')::boolean, false),
    'shop_nav_count', jsonb_array_length(coalesce(v_nav->'items', '[]'::jsonb)),
    'list_ok', coalesce((v_list->>'ok')::boolean, false),
    'list_total', coalesce((v_list->>'total')::int, 0),
    'catalogue', jsonb_build_object(
      'shopify_products', v_products,
      'shopify_variants', v_variants,
      'shopify_collections', v_collections
    ),
    'locks_ok',
      coalesce(v_pilot, 'NOT_SENT') = 'NOT_SENT'
      and coalesce(v_auth, 'false') in ('false', '0', '')
      and coalesce(v_mode, 'catalogue_open') = 'catalogue_open'
      and coalesce(v_cutover, 'false') in ('false', '0', '')
      and coalesce(v_pay, 'disabled') = 'disabled'
  );
end;
$$;

grant execute on function public.rpc_phase5h_storefront_selftest() to authenticated, service_role;
