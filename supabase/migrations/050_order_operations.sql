-- Phase 2A: Order operations — indexes, customer_type_snapshot, admin RPCs.
-- Additive only. Does not rewrite Shopify history.

create extension if not exists pg_trgm;

-- ── Additive column ──────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists customer_type_snapshot text;

comment on column public.orders.customer_type_snapshot is
  'Operational snapshot of customer type (from CRM/metafield). Raw metafields remain authoritative.';

create index if not exists orders_customer_type_snapshot_idx
  on public.orders (customer_type_snapshot)
  where customer_type_snapshot is not null;

-- Backfill from customers.customer_type then metafield custom.customer_type
update public.orders o
set customer_type_snapshot = c.customer_type
from public.customers c
where o.customer_id = c.id
  and o.customer_type_snapshot is null
  and c.customer_type is not null
  and btrim(c.customer_type) <> '';

update public.orders o
set customer_type_snapshot = m.value_text
from public.metafields m
where o.customer_type_snapshot is null
  and m.owner_type = 'customer'
  and m.owner_id = o.customer_id
  and m.namespace = 'custom'
  and m.key = 'customer_type'
  and m.value_text is not null
  and btrim(m.value_text) <> '';

update public.orders o
set customer_type_snapshot = m.value_text
from public.metafields m
where o.customer_type_snapshot is null
  and m.owner_type = 'order'
  and m.owner_id = o.id
  and m.namespace = 'custom'
  and m.key = 'customer_type'
  and m.value_text is not null
  and btrim(m.value_text) <> '';

-- ── Indexes for ops list/search ──────────────────────────────────────────────
create index if not exists orders_order_number_trgm_idx
  on public.orders using gin (order_number gin_trgm_ops);
create index if not exists orders_source_order_number_trgm_idx
  on public.orders using gin (source_order_number gin_trgm_ops);
create index if not exists orders_email_trgm_idx
  on public.orders using gin (email gin_trgm_ops);
create index if not exists orders_trading_name_trgm_idx
  on public.orders using gin (trading_name_snapshot gin_trgm_ops);
create index if not exists orders_po_trgm_idx
  on public.orders using gin (purchase_order_number gin_trgm_ops);

create index if not exists orders_source_created_at_desc_idx
  on public.orders (source_created_at desc nulls last);
create index if not exists orders_created_at_desc_idx
  on public.orders (created_at desc);

create index if not exists orders_outstanding_positive_idx
  on public.orders (total_outstanding)
  where total_outstanding > 0;

create index if not exists orders_payment_due_outstanding_idx
  on public.orders (payment_due_on)
  where payment_due_on is not null and total_outstanding > 0;

create index if not exists orders_draft_order_id_idx
  on public.orders (draft_order_id)
  where draft_order_id is not null;

create index if not exists orders_cg_assigned_id_idx
  on public.orders (cg_assigned_id)
  where cg_assigned_id is not null;

create index if not exists orders_referrer_id_idx
  on public.orders (referrer_id)
  where referrer_id is not null;

create index if not exists order_items_order_sku_idx
  on public.order_items (order_id, sku_snapshot);
create index if not exists order_items_product_name_trgm_idx
  on public.order_items using gin (product_name gin_trgm_ops);

create index if not exists fulfillments_tracking_trgm_idx
  on public.fulfillments using gin (tracking_number gin_trgm_ops);

create index if not exists staff_members_name_trgm_idx
  on public.staff_members using gin (name gin_trgm_ops);

create index if not exists customers_display_name_trgm_idx
  on public.customers using gin (display_name gin_trgm_ops);
create index if not exists companies_name_trgm_idx
  on public.companies using gin (name gin_trgm_ops);

-- ── Helper: current admin staff member ───────────────────────────────────────
create or replace function public.current_admin_staff_id()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select au.staff_member_id
  from public.admin_users au
  where au.auth_user_id = (select auth.uid())
    and au.is_active = true
  limit 1;
$$;

create or replace function public.current_admin_display_name()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select sm.name from public.staff_members sm where sm.id = public.current_admin_staff_id()),
    (select au.email from public.admin_users au where au.auth_user_id = (select auth.uid()) and au.is_active limit 1),
    'Admin'
  );
$$;
-- Phase 2A RPCs (part of 050_order_operations)

-- ── Facets ───────────────────────────────────────────────────────────────────
create or replace function public.rpc_admin_order_filter_facets()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'financial_statuses', coalesce((
      select jsonb_agg(x order by x)
      from (select distinct financial_status as x from public.orders where financial_status is not null) s
    ), '[]'::jsonb),
    'fulfillment_statuses', coalesce((
      select jsonb_agg(x order by x)
      from (select distinct commerce_fulfillment_status as x from public.orders where commerce_fulfillment_status is not null) s
    ), '[]'::jsonb),
    'order_sources', coalesce((
      select jsonb_agg(x order by x)
      from (select distinct order_source as x from public.orders where order_source is not null) s
    ), '[]'::jsonb),
    'customer_types', coalesce((
      select jsonb_agg(x order by x)
      from (select distinct customer_type_snapshot as x from public.orders where customer_type_snapshot is not null) s
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', sm.id, 'name', sm.name) order by sm.name)
      from public.staff_members sm
      where sm.active = true
    ), '[]'::jsonb),
    'delivery_statuses', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct coalesce(dpd_delivery_status, delivery_status) as x
        from public.orders
        where coalesce(dpd_delivery_status, delivery_status) is not null
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_admin_order_filter_facets() to authenticated;

-- ── List v2 ──────────────────────────────────────────────────────────────────
create or replace function public.rpc_list_admin_orders_v2(
  p_limit int default 25,
  p_offset int default 0,
  p_sort text default 'date_desc',
  p_filters jsonb default '{}'::jsonb
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
  v_search text := nullif(btrim(coalesce(p_filters->>'search', '')), '');
  v_date_preset text := nullif(btrim(coalesce(p_filters->>'date_preset', '')), '');
  v_date_from timestamptz := nullif(p_filters->>'date_from', '')::timestamptz;
  v_date_to timestamptz := nullif(p_filters->>'date_to', '')::timestamptz;
  v_fin text[] := case when jsonb_typeof(p_filters->'financial_statuses') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'financial_statuses')) else null end;
  v_ff text[] := case when jsonb_typeof(p_filters->'fulfillment_statuses') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'fulfillment_statuses')) else null end;
  v_sources text[] := case when jsonb_typeof(p_filters->'order_sources') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'order_sources')) else null end;
  v_tags text[] := case when jsonb_typeof(p_filters->'tags') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'tags')) else null end;
  v_outstanding boolean := coalesce((p_filters->>'outstanding_gt_0')::boolean, false);
  v_overdue boolean := coalesce((p_filters->>'overdue')::boolean, false);
  v_has_draft boolean := case when p_filters ? 'has_draft' then (p_filters->>'has_draft')::boolean else null end;
  v_delivery text := nullif(btrim(coalesce(p_filters->>'delivery', '')), '');
  v_customer_type text := nullif(btrim(coalesce(p_filters->>'customer_type', '')), '');
  v_trading text := nullif(btrim(coalesce(p_filters->>'trading_name', '')), '');
  v_salesperson uuid := nullif(p_filters->>'salesperson_id', '')::uuid;
  v_cg uuid := nullif(p_filters->>'cg_assigned_id', '')::uuid;
  v_referrer uuid := nullif(p_filters->>'referrer_id', '')::uuid;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_min numeric := nullif(p_filters->>'min_total', '')::numeric;
  v_max numeric := nullif(p_filters->>'max_total', '')::numeric;
  v_due_from date := nullif(p_filters->>'payment_due_from', '')::date;
  v_due_to date := nullif(p_filters->>'payment_due_to', '')::date;
  v_source_group text := nullif(btrim(coalesce(p_filters->>'source_group', '')), '');
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_date_preset = 'today' then
    v_date_from := date_trunc('day', now());
    v_date_to := v_date_from + interval '1 day';
  elsif v_date_preset = 'yesterday' then
    v_date_from := date_trunc('day', now()) - interval '1 day';
    v_date_to := date_trunc('day', now());
  elsif v_date_preset = 'this_week' then
    v_date_from := date_trunc('week', now());
    v_date_to := now();
  elsif v_date_preset = 'this_month' then
    v_date_from := date_trunc('month', now());
    v_date_to := now();
  end if;

  with filtered as (
    select o.id
    from public.orders o
    left join public.customers cu on cu.id = o.customer_id
    left join public.companies co on co.id = o.company_id
    left join public.staff_members sp on sp.id = o.salesperson_id
    left join public.staff_members cg on cg.id = o.cg_assigned_id
    left join public.staff_members rf on rf.id = o.referrer_id
    where
      (v_date_from is null or coalesce(o.source_created_at, o.created_at) >= v_date_from)
      and (v_date_to is null or coalesce(o.source_created_at, o.created_at) < v_date_to)
      and (v_fin is null or o.financial_status = any(v_fin))
      and (v_ff is null or o.commerce_fulfillment_status = any(v_ff))
      and (v_sources is null or o.order_source = any(v_sources))
      and (not v_outstanding or o.total_outstanding > 0)
      and (not v_overdue or (o.payment_due_on is not null and o.payment_due_on < current_date and o.total_outstanding > 0))
      and (v_has_draft is null or (v_has_draft and o.draft_order_id is not null) or (not v_has_draft and o.draft_order_id is null))
      and (v_customer_type is null or o.customer_type_snapshot ilike v_customer_type)
      and (v_trading is null or o.trading_name_snapshot ilike '%' || v_trading || '%')
      and (v_salesperson is null or o.salesperson_id = v_salesperson)
      and (v_cg is null or o.cg_assigned_id = v_cg)
      and (v_referrer is null or o.referrer_id = v_referrer)
      and (v_customer is null or o.customer_id = v_customer)
      and (v_company is null or o.company_id = v_company)
      and (v_min is null or o.total >= v_min)
      and (v_max is null or o.total <= v_max)
      and (v_due_from is null or o.payment_due_on >= v_due_from)
      and (v_due_to is null or o.payment_due_on <= v_due_to)
      and (
        v_source_group is null
        or (v_source_group = 'web' and o.order_source = 'web')
        or (v_source_group = 'draft' and (o.order_source = 'shopify_draft_order' or o.draft_order_id is not null))
        or (v_source_group = 'pos' and o.order_source = 'pos')
        or (v_source_group = 'sales_portal' and (
          coalesce(o.source_app, '') ilike '%sales%portal%'
          or exists (
            select 1 from public.entity_tags et
            where et.entity_type = 'order' and et.entity_id = o.id
              and et.raw_value ilike '%sales%portal%'
          )
        ))
      )
      and (
        v_delivery is null
        or (v_delivery = 'tracking_present' and exists (
          select 1 from public.fulfillments f
          where f.order_id = o.id and f.tracking_number is not null and btrim(f.tracking_number) <> ''
        ))
        or (v_delivery = 'no_tracking' and not exists (
          select 1 from public.fulfillments f
          where f.order_id = o.id and f.tracking_number is not null and btrim(f.tracking_number) <> ''
        ))
        or (v_delivery = 'in_transit' and (
          o.dpd_delivery_status ilike '%transit%'
          or o.delivery_status ilike '%transit%'
          or exists (select 1 from public.fulfillments f where f.order_id = o.id and f.in_transit_at is not null and f.delivered_at is null)
        ))
        or (v_delivery = 'delivered' and (
          o.dpd_delivery_status ilike '%deliver%'
          or o.delivery_status ilike '%deliver%'
          or exists (select 1 from public.fulfillments f where f.order_id = o.id and f.delivered_at is not null)
        ))
      )
      and (
        v_tags is null
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'order' and et.entity_id = o.id and et.raw_value = any(v_tags)
        )
      )
      and (
        v_search is null
        or o.order_number ilike '%' || v_search || '%'
        or o.source_order_number ilike '%' || v_search || '%'
        or o.email ilike '%' || v_search || '%'
        or o.trading_name_snapshot ilike '%' || v_search || '%'
        or o.purchase_order_number ilike '%' || v_search || '%'
        or cu.display_name ilike '%' || v_search || '%'
        or cu.email ilike '%' || v_search || '%'
        or (cu.first_name || ' ' || cu.last_name) ilike '%' || v_search || '%'
        or co.name ilike '%' || v_search || '%'
        or sp.name ilike '%' || v_search || '%'
        or cg.name ilike '%' || v_search || '%'
        or rf.name ilike '%' || v_search || '%'
        or exists (
          select 1 from public.order_items oi
          where oi.order_id = o.id
            and (oi.sku_snapshot ilike '%' || v_search || '%' or oi.product_name ilike '%' || v_search || '%')
        )
        or exists (
          select 1 from public.fulfillments f
          where f.order_id = o.id and f.tracking_number ilike '%' || v_search || '%'
        )
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'order' and et.entity_id = o.id and et.raw_value ilike '%' || v_search || '%'
        )
      )
  )
  select count(*) into v_total from filtered;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by ord), '[]'::jsonb)
  into v_items
  from (
    select
      case coalesce(p_sort, 'date_desc')
        when 'date_asc' then row_number() over (order by coalesce(o.source_created_at, o.created_at) asc)
        when 'total_desc' then row_number() over (order by o.total desc)
        when 'total_asc' then row_number() over (order by o.total asc)
        when 'outstanding_desc' then row_number() over (order by o.total_outstanding desc)
        when 'number_asc' then row_number() over (order by coalesce(o.source_order_number, o.order_number) asc)
        else row_number() over (order by coalesce(o.source_created_at, o.created_at) desc)
      end as ord,
      o.id,
      coalesce(o.source_order_number, o.order_number) as order_number,
      o.order_number as internal_order_number,
      coalesce(o.source_created_at, o.created_at) as order_date,
      o.email,
      o.financial_status,
      o.commerce_fulfillment_status,
      o.fulfillment_status as legacy_fulfillment_status,
      o.status as legacy_status,
      o.order_source,
      o.source_app,
      o.trading_name_snapshot,
      o.customer_type_snapshot,
      o.total,
      o.total_received,
      o.total_outstanding,
      o.currency,
      o.payment_due_on,
      o.draft_order_id,
      (o.draft_order_id is not null) as from_draft,
      o.customer_id,
      o.company_id,
      o.salesperson_id,
      o.cg_assigned_id,
      o.referrer_id,
      o.dpd_delivery_status,
      o.delivery_status,
      cu.display_name as customer_name,
      coalesce(cu.email, o.email) as customer_email,
      co.name as company_name,
      sp.name as salesperson_name,
      cg.name as cg_name,
      rf.name as referrer_name,
      (select coalesce(sum(oi.quantity), 0)::int from public.order_items oi where oi.order_id = o.id) as item_quantity,
      (select count(*)::int from public.order_items oi where oi.order_id = o.id) as line_count,
      (select osl.title from public.order_shipping_lines osl where osl.order_id = o.id order by osl.created_at nulls last limit 1) as shipping_method,
      exists (
        select 1 from public.fulfillments f
        where f.order_id = o.id and f.tracking_number is not null and btrim(f.tracking_number) <> ''
      ) as has_tracking,
      (
        select coalesce(jsonb_agg(t.raw_value order by t.raw_value), '[]'::jsonb)
        from (
          select et.raw_value
          from public.entity_tags et
          where et.entity_type = 'order' and et.entity_id = o.id
          order by et.raw_value
          limit 8
        ) t
      ) as tags
    from filtered f
    join public.orders o on o.id = f.id
    left join public.customers cu on cu.id = o.customer_id
    left join public.companies co on co.id = o.company_id
    left join public.staff_members sp on sp.id = o.salesperson_id
    left join public.staff_members cg on cg.id = o.cg_assigned_id
    left join public.staff_members rf on rf.id = o.referrer_id
    order by ord
    limit greatest(coalesce(p_limit, 25), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) row_data;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.rpc_list_admin_orders_v2(int, int, text, jsonb) to authenticated;
-- Phase 2A detail / mutate RPCs (part of 050)

create or replace function public.rpc_get_admin_order_workspace(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_event_count bigint;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  select count(*) into v_event_count from public.order_events where order_id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'order', to_jsonb(v_order),
    'customer', (
      select to_jsonb(c) from public.customers c where c.id = v_order.customer_id
    ),
    'company', (
      select to_jsonb(c) from public.companies c where c.id = v_order.company_id
    ),
    'company_location', (
      select to_jsonb(l) from public.company_locations l where l.id = v_order.company_location_id
    ),
    'salesperson', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_order.salesperson_id
    ),
    'cg_assigned', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_order.cg_assigned_id
    ),
    'referrer', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_order.referrer_id
    ),
    'draft', (
      select jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'status', d.status,
        'source_created_at', d.source_created_at,
        'created_at', d.created_at,
        'shopify_draft_gid', d.shopify_draft_gid,
        'salesperson_id', d.salesperson_id,
        'referrer_id', d.referrer_id
      )
      from public.draft_orders d
      where d.id = v_order.draft_order_id
    ),
    'shipping_lines', coalesce((
      select jsonb_agg(to_jsonb(sl) order by sl.created_at)
      from public.order_shipping_lines sl where sl.order_id = p_order_id
    ), '[]'::jsonb),
    'line_summary', (
      select jsonb_build_object(
        'line_count', count(*)::int,
        'item_quantity', coalesce(sum(quantity), 0)::int
      )
      from public.order_items where order_id = p_order_id
    ),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('raw_value', et.raw_value, 'tag_id', et.tag_id) order by et.raw_value)
      from public.entity_tags et
      where et.entity_type = 'order' and et.entity_id = p_order_id
    ), '[]'::jsonb),
    'customer_tags', coalesce((
      select jsonb_agg(et.raw_value order by et.raw_value)
      from public.entity_tags et
      where et.entity_type = 'customer' and et.entity_id = v_order.customer_id
    ), '[]'::jsonb),
    'metafields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'namespace', m.namespace,
        'key', m.key,
        'value_type', m.value_type,
        'value_text', m.value_text,
        'value_json', m.value_json
      ) order by m.namespace, m.key)
      from public.metafields m
      where m.owner_type = 'order' and m.owner_id = p_order_id
    ), '[]'::jsonb),
    'credit_note_flag', (
      select m.value_text
      from public.metafields m
      where m.owner_type = 'order' and m.owner_id = p_order_id
        and m.namespace = 'custom' and m.key = 'credit_note'
      limit 1
    ),
    'refunded_total', coalesce((
      select sum(r.total_refunded) from public.refunds r where r.order_id = p_order_id
    ), 0),
    'event_count', v_event_count,
    'unique_comment_count', (
      select count(*)::int from public.order_comments
      where order_id = p_order_id and coalesce(source_system, '') = 'unique'
    ),
    'shopify_comment_count', (
      select count(*)::int from public.order_comments
      where order_id = p_order_id and coalesce(source_system, '') = 'shopify'
    )
  );
end;
$$;

grant execute on function public.rpc_get_admin_order_workspace(uuid) to authenticated;

create or replace function public.rpc_list_admin_order_items(
  p_order_id uuid,
  p_limit int default 50,
  p_offset int default 0,
  p_search text default null
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
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_total
  from public.order_items oi
  where oi.order_id = p_order_id
    and (
      v_q is null
      or oi.product_name ilike '%' || v_q || '%'
      or oi.sku_snapshot ilike '%' || v_q || '%'
      or oi.variant_title_snapshot ilike '%' || v_q || '%'
    );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_key), '[]'::jsonb)
  into v_items
  from (
    select
      oi.*,
      coalesce((
        select sum(fli.quantity)::int
        from public.fulfillment_line_items fli
        join public.fulfillments f on f.id = fli.fulfillment_id
        where f.order_id = oi.order_id
          and (
            fli.order_item_id = oi.id
            or (fli.order_item_id is null and fli.sku_snapshot is not distinct from oi.sku_snapshot)
          )
      ), 0) as fulfilled_quantity,
      oi.created_at as sort_key
    from public.order_items oi
    where oi.order_id = p_order_id
      and (
        v_q is null
        or oi.product_name ilike '%' || v_q || '%'
        or oi.sku_snapshot ilike '%' || v_q || '%'
        or oi.variant_title_snapshot ilike '%' || v_q || '%'
      )
    order by oi.created_at
    limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) x;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.rpc_list_admin_order_items(uuid, int, int, text) to authenticated;

create or replace function public.rpc_list_admin_order_payments(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'transactions', coalesce((
      select jsonb_agg(to_jsonb(t) order by coalesce(t.processed_at, t.source_created_at, t.created_at))
      from public.payment_transactions t
      where t.order_id = p_order_id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(to_jsonb(r) order by coalesce(r.source_created_at, r.created_at))
      from public.refunds r
      where r.order_id = p_order_id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_list_admin_order_payments(uuid) to authenticated;

create or replace function public.rpc_list_admin_order_fulfillments(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'fulfillments', coalesce((
      select jsonb_agg(
        to_jsonb(f) || jsonb_build_object(
          'lines', coalesce((
            select jsonb_agg(to_jsonb(fli) order by fli.created_at)
            from public.fulfillment_line_items fli
            where fli.fulfillment_id = f.id
          ), '[]'::jsonb)
        )
        order by coalesce(f.source_created_at, f.created_at)
      )
      from public.fulfillments f
      where f.order_id = p_order_id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_list_admin_order_fulfillments(uuid) to authenticated;

create or replace function public.rpc_list_admin_order_timeline(
  p_order_id uuid,
  p_limit int default 50,
  p_offset int default 0
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
  v_comments jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_total from public.order_events where order_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select *
    from public.order_events
    where order_id = p_order_id
    order by occurred_at desc, created_at desc
    limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) e;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.occurred_at desc), '[]'::jsonb)
  into v_comments
  from public.order_comments c
  where c.order_id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'events', v_items,
    'total', v_total,
    'comments', v_comments
  );
end;
$$;

grant execute on function public.rpc_list_admin_order_timeline(uuid, int, int) to authenticated;

create or replace function public.rpc_admin_add_order_comment(p_order_id uuid, p_body text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'Note body is required');
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  insert into public.order_comments (
    order_id, author_staff_id, author_name_snapshot, body, source_system, occurred_at
  ) values (
    p_order_id, v_staff, v_name, v_body, 'unique', now()
  )
  returning id into v_id;

  insert into public.order_events (
    order_id, event_type, category, source_system, actor_type, actor_id, actor_name_snapshot,
    message, new_value, occurred_at
  ) values (
    p_order_id, 'staff_note_added', 'note', 'unique', 'staff', v_staff, v_name,
    left(v_body, 500),
    jsonb_build_object('comment_id', v_id, 'body', v_body),
    now()
  );

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function public.rpc_admin_add_order_comment(uuid, text) to authenticated;

create or replace function public.rpc_admin_update_order_ops(p_order_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.orders%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_changes jsonb := '{}'::jsonb;
  v_sp uuid;
  v_cg uuid;
  v_rf uuid;
  v_note text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  -- Reject unsafe keys
  if p_patch ? 'total' or p_patch ? 'subtotal' or p_patch ? 'discount_total'
     or p_patch ? 'tax_total' or p_patch ? 'shipping_total'
     or p_patch ? 'total_received' or p_patch ? 'total_outstanding'
     or p_patch ? 'financial_status' or p_patch ? 'status'
     or p_patch ? 'commerce_fulfillment_status' then
    return jsonb_build_object('ok', false, 'error', 'Unsafe field in patch');
  end if;

  if p_patch ? 'salesperson_id' then
    v_sp := nullif(p_patch->>'salesperson_id', '')::uuid;
    if v_sp is distinct from v_old.salesperson_id then
      v_changes := v_changes || jsonb_build_object(
        'salesperson_id', jsonb_build_object('old', v_old.salesperson_id, 'new', v_sp)
      );
    end if;
  else
    v_sp := v_old.salesperson_id;
  end if;

  if p_patch ? 'cg_assigned_id' then
    v_cg := nullif(p_patch->>'cg_assigned_id', '')::uuid;
    if v_cg is distinct from v_old.cg_assigned_id then
      v_changes := v_changes || jsonb_build_object(
        'cg_assigned_id', jsonb_build_object('old', v_old.cg_assigned_id, 'new', v_cg)
      );
    end if;
  else
    v_cg := v_old.cg_assigned_id;
  end if;

  if p_patch ? 'referrer_id' then
    v_rf := nullif(p_patch->>'referrer_id', '')::uuid;
    if v_rf is distinct from v_old.referrer_id then
      v_changes := v_changes || jsonb_build_object(
        'referrer_id', jsonb_build_object('old', v_old.referrer_id, 'new', v_rf)
      );
    end if;
  else
    v_rf := v_old.referrer_id;
  end if;

  if p_patch ? 'note' then
    v_note := p_patch->>'note';
    if v_note is distinct from v_old.note then
      v_changes := v_changes || jsonb_build_object(
        'note', jsonb_build_object('old', v_old.note, 'new', v_note)
      );
    end if;
  else
    v_note := v_old.note;
  end if;

  if v_changes = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.orders
  set
    salesperson_id = v_sp,
    cg_assigned_id = v_cg,
    referrer_id = v_rf,
    note = v_note,
    updated_at = now()
  where id = p_order_id;

  insert into public.order_events (
    order_id, event_type, category, source_system, actor_type, actor_id, actor_name_snapshot,
    message, old_value, new_value, occurred_at
  ) values (
    p_order_id, 'order_ops_updated', 'ops', 'unique', 'staff', v_staff, v_name,
    'Operational fields updated',
    jsonb_build_object('before', v_changes),
    jsonb_build_object('after', v_changes),
    now()
  );

  return jsonb_build_object('ok', true, 'changed', true, 'changes', v_changes);
end;
$$;

grant execute on function public.rpc_admin_update_order_ops(uuid, jsonb) to authenticated;
