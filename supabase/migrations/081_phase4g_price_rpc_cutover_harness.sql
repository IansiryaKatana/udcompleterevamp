-- Phase 4G part 2 — storefront RPC price redaction, assert add_to_cart, bind spoof,
-- pilot proposal, cutover regression selftest, INTERNAL_TEST fixtures.
-- Production mode remains catalogue_open; cutover flag remains false.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';

-- ── Assert: add_to_cart + richer shadow reason codes ─────────────────────────
create or replace function public.rpc_assert_storefront_commercial_action(
  p_action text,
  p_payment_option text default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_pay text := lower(btrim(coalesce(p_payment_option, '')));
  v_uid uuid := (select auth.uid());
  v_customer_id uuid := p_customer_id;
  v_mode text;
  v_cu public.customers%rowtype;
  v_policy jsonb;
  v_shadow jsonb;
  v_has_crm boolean := false;
  v_ok boolean := true;
  v_err text;
  v_msg text;
  v_shadow_ok boolean;
  v_reason text;
begin
  select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_mode
  from public.site_settings where key = 'commercial_access_mode' limit 1;
  v_mode := coalesce(v_mode, 'catalogue_open');

  -- Never trust client customer_id as authority when auth is linked differently
  if v_uid is not null then
    select id into v_customer_id from public.customers where auth_user_id = v_uid limit 1;
  elsif p_customer_id is not null and v_uid is null then
    -- Anonymous callers may not force a customer context for privileges
    v_customer_id := null;
  end if;

  if v_customer_id is not null then
    select * into v_cu from public.customers where id = v_customer_id;
    if found then
      v_has_crm := true;
      v_policy := public.commercial_policy_evaluate(
        v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
        v_mode, true, v_cu.customer_type, v_cu.payment_terms
      );
      v_shadow := public.commercial_policy_evaluate(
        v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
        'trade_required', true, v_cu.customer_type, v_cu.payment_terms
      );
    end if;
  end if;

  if v_policy is null then
    v_policy := public.commercial_policy_evaluate('ineligible', false, 'active', v_mode, false, null, null);
    v_shadow := public.commercial_policy_evaluate('ineligible', false, 'active', 'trade_required', false, null, null);
  end if;

  if v_uid is null then v_reason := 'ANONYMOUS';
  elsif not v_has_crm then v_reason := 'AUTH_UNLINKED';
  elsif v_cu.trade_access_status = 'pending' then v_reason := 'TRADE_PENDING';
  elsif v_cu.trade_access_status = 'approved' then v_reason := 'TRADE_APPROVED';
  elsif v_cu.trade_access_status in ('suspended', 'rejected') then v_reason := 'TRADE_SUSPENDED';
  else v_reason := 'TRADE_INELIGIBLE';
  end if;

  if v_pay in ('pay_later', 'pay later', 'order now, pay later') then
    if not coalesce((v_policy->>'can_use_pay_later')::boolean, false) then
      v_ok := false; v_err := 'PAY_LATER_NOT_PERMITTED'; v_msg := 'PAY LATER is not enabled for this account';
      v_reason := 'PAY_LATER_NOT_ELIGIBLE';
    end if;
  end if;

  if v_ok and v_action in ('purchase', 'checkout', 'place_order') then
    if not coalesce((v_policy->>'can_checkout')::boolean, coalesce((v_policy->>'can_purchase')::boolean, false)) then
      v_ok := false; v_err := 'TRADE_PURCHASE_NOT_PERMITTED'; v_msg := 'Trade eligibility required to purchase';
      perform public.commercial_observe('purchase_denied', v_reason, v_action, '{}'::jsonb);
    end if;
  elsif v_ok and v_action in ('add_to_cart', 'cart_add') then
    if not coalesce((v_policy->>'can_add_to_cart')::boolean, false) then
      v_ok := false; v_err := 'CART_NOT_PERMITTED'; v_msg := 'Add to cart requires approved trade access under trade_required';
      perform public.commercial_observe('cart_denied', v_reason, v_action, '{}'::jsonb);
    end if;
  elsif v_ok and v_action in ('view_price') then
    if v_mode = 'trade_required' and not coalesce((v_policy->>'can_view_price')::boolean, false) then
      v_ok := false; v_err := 'PRICE_RESTRICTED'; v_msg := 'Protected trade prices require approved trade account';
      v_reason := 'PRICE_REDACTED';
      perform public.commercial_observe('price_access_denied', v_reason, v_action, '{}'::jsonb);
    end if;
  elsif v_ok and v_action in ('view_catalogue', 'view_product') then
    null;
  elsif v_ok and v_action in ('quote', 'request_quote') then
    if not coalesce((v_policy->>'can_request_quote')::boolean, false) then
      v_ok := false; v_err := 'TRADE_QUOTE_NOT_PERMITTED'; v_msg := 'Quote not permitted';
    end if;
  end if;

  if v_action in ('view_price') then
    v_shadow_ok := coalesce((v_shadow->>'can_view_price')::boolean, false);
  elsif v_action in ('purchase', 'checkout', 'place_order') then
    v_shadow_ok := coalesce((v_shadow->>'can_checkout')::boolean, false);
  elsif v_action in ('add_to_cart', 'cart_add') then
    v_shadow_ok := coalesce((v_shadow->>'can_add_to_cart')::boolean, false);
  elsif v_action in ('quote', 'request_quote') then
    v_shadow_ok := coalesce((v_shadow->>'can_request_quote')::boolean, false);
  elsif v_pay like '%pay%later%' then
    v_shadow_ok := coalesce((v_shadow->>'can_use_pay_later')::boolean, false);
  else
    v_shadow_ok := true;
  end if;

  perform public.commercial_shadow_log(
    coalesce(nullif(v_action, ''), 'unknown'),
    v_ok,
    v_shadow_ok,
    case when v_ok = v_shadow_ok then 'MATCH' else v_reason end,
    v_customer_id,
    jsonb_build_object('payment_option', p_payment_option, 'account_class', v_reason)
  );

  return jsonb_build_object(
    'ok', v_ok,
    'error', v_err,
    'message', v_msg,
    'reason_code', v_reason,
    'policy', v_policy,
    'commercial_access_mode', v_mode
  );
end;
$$;

grant execute on function public.rpc_assert_storefront_commercial_action(text, text, uuid)
  to anon, authenticated, service_role;

-- ── Bind: reject client CRM IDs unless they match session exactly ────────────
create or replace function public.rpc_storefront_bind_order_commercial_context(
  p_order_id uuid,
  p_payment_option text default null,
  p_client_customer_id uuid default null,
  p_client_company_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session jsonb;
  v_session_customer uuid;
  v_session_company uuid;
  v_uid uuid := (select auth.uid());
begin
  v_session := public.rpc_storefront_commercial_session(null);
  v_session_customer := nullif(v_session->>'customer_id', '')::uuid;
  v_session_company := nullif(v_session->>'company_id', '')::uuid;

  if p_client_customer_id is not null or p_client_company_id is not null then
    if v_session_customer is null
       or (p_client_customer_id is not null and p_client_customer_id is distinct from v_session_customer)
       or (p_client_company_id is not null and (
            v_session_company is null or p_client_company_id is distinct from v_session_company
          ))
    then
      perform public.commercial_observe('spoof_rejected', 'CLIENT_CRM_ID_SPOOF', 'bind_order', '{}'::jsonb);
      return jsonb_build_object(
        'ok', false,
        'error', 'CUSTOMER_ID_SPOOF_REJECTED',
        'message', 'Client CRM IDs are not authoritative'
      );
    end if;
  end if;

  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_REQUIRED');
  end if;

  update public.orders o set
    customer_id = coalesce(v_session_customer, o.customer_id),
    company_id = coalesce(v_session_company, o.company_id),
    updated_at = now()
  where o.id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'customer_id', v_session_customer,
    'company_id', v_session_company,
    'auth_user_id', v_uid,
    'spoof_attempt', false
  );
end;
$$;

grant execute on function public.rpc_storefront_bind_order_commercial_context(uuid, text, uuid, uuid)
  to anon, authenticated, service_role;

-- ── Product detail (force_mode for harness) ──────────────────────────────────
drop function if exists public.rpc_get_storefront_product(text);
create or replace function public.rpc_get_storefront_product(
  p_slug text,
  p_force_mode text default null
)
returns jsonb
language plpgsql
stable
security invoker
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

  v_delivery := public.resolve_product_delivery_text(v_row.id);
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

-- ── Autocomplete ─────────────────────────────────────────────────────────────
drop function if exists public.rpc_product_autocomplete(text, int);
create or replace function public.rpc_product_autocomplete(
  p_query text, p_limit int default 8, p_force_mode text default null
)
returns jsonb
language plpgsql
stable
security invoker
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

grant execute on function public.rpc_product_autocomplete(text, int, text) to anon, authenticated, service_role;

-- ── List products ────────────────────────────────────────────────────────────
drop function if exists public.rpc_list_storefront_products(text, text, int, int);
drop function if exists public.rpc_list_storefront_products(text, text, int, int, numeric, numeric, boolean, text);

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
security invoker
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

-- ── Search ───────────────────────────────────────────────────────────────────
drop function if exists public.rpc_search_storefront_products(text, int, int);
create or replace function public.rpc_search_storefront_products(
  p_query text, p_limit int default 12, p_offset int default 0, p_force_mode text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total bigint;
  v_items jsonb;
  v_can_view boolean := public.storefront_can_view_protected_price(p_force_mode);
  v_q text := trim(coalesce(p_query, ''));
begin
  select count(*) into v_total from public.products p
  where p.published = true and (v_q = '' or p.name ilike '%'||v_q||'%' or p.slug ilike '%'||v_q||'%');

  select coalesce(jsonb_agg(to_jsonb(sub)), '[]'::jsonb) into v_items from (
    select p.* from public.products p
    where p.published = true and (v_q = '' or p.name ilike '%'||v_q||'%' or p.slug ilike '%'||v_q||'%')
    order by p.sort_order, p.name
    limit greatest(coalesce(p_limit, 12), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) sub;

  if not v_can_view then
    v_items := public.redact_protected_price_fields(v_items, false);
  end if;
  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total, 'price_visible', v_can_view);
end;
$$;

grant execute on function public.rpc_search_storefront_products(text, int, int, text)
  to anon, authenticated, service_role;

-- ── Homepage as jsonb (price NOT NULL on products — cannot null in setof) ─────
create or replace function public.rpc_get_homepage_products_gated(
  p_section text default 'new',
  p_force_mode text default null
)
returns jsonb
language plpgsql
stable
security invoker
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

-- Keep legacy setof homepage for catalogue_open compatibility (prices visible in open mode).
-- Under trade_required live flip, clients should use rpc_get_homepage_products_gated.
create or replace function public.rpc_get_homepage_products(p_section text default 'new')
returns setof public.products
language sql
stable
security invoker
set search_path = public
as $$
  select * from public.products p
  where p.published = true
    and (
      (p_section = 'new' and p.is_new = true)
      or (p_section = 'summer' and p.is_summer = true)
      or (p_section = 'all')
    )
  order by p.sort_order asc, p.created_at desc
  limit 8;
$$;

grant execute on function public.rpc_get_homepage_products(text) to anon, authenticated, service_role;
