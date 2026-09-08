-- Phase 3A follow-up: delivery metrics must use fulfillment.display_status
-- (historical Shopify rows have display_status DELIVERED/OUT_FOR_DELIVERY/IN_TRANSIT
-- but delivered_at / in_transit_at columns are empty).

create or replace function public.rpc_admin_fulfilment_metrics(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_include_test boolean := coalesce((v_filters->>'include_test')::boolean, false);
  v_date_from timestamptz := nullif(btrim(coalesce(v_filters->>'date_from', '')), '')::timestamptz;
  v_date_to timestamptz := nullif(btrim(coalesce(v_filters->>'date_to', '')), '')::timestamptz;
  v_unfulfilled bigint := 0;
  v_partial bigint := 0;
  v_fulfilled_today bigint := 0;
  v_tracking_missing bigint := 0;
  v_in_transit bigint := 0;
  v_delivered bigint := 0;
  v_failed bigint := 0;
begin
  if not public.can_view_fulfilment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select
    count(*) filter (where upper(coalesce(o.commerce_fulfillment_status, 'UNFULFILLED')) = 'UNFULFILLED'),
    count(*) filter (where upper(coalesce(o.commerce_fulfillment_status, '')) = 'PARTIALLY_FULFILLED'),
    count(*) filter (
      where upper(coalesce(o.commerce_fulfillment_status, '')) in ('FULFILLED', 'PARTIALLY_FULFILLED')
        and not exists (
          select 1 from public.fulfillments f
          where f.order_id = o.id
            and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
            and f.tracking_number is not null and btrim(f.tracking_number) <> ''
        )
    ),
    count(*) filter (
      where upper(coalesce(o.delivery_status, '')) in ('IN_TRANSIT', 'OUT_FOR_DELIVERY')
         or exists (
           select 1 from public.fulfillments f
           where f.order_id = o.id
             and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
             and (
               f.in_transit_at is not null and f.delivered_at is null
               or upper(coalesce(f.display_status, '')) in ('IN_TRANSIT', 'OUT_FOR_DELIVERY')
             )
         )
    ),
    count(*) filter (
      where upper(coalesce(o.delivery_status, '')) = 'DELIVERED'
         or exists (
           select 1 from public.fulfillments f
           where f.order_id = o.id
             and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
             and (
               f.delivered_at is not null
               or upper(coalesce(f.display_status, '')) = 'DELIVERED'
             )
         )
    ),
    count(*) filter (
      where upper(coalesce(o.delivery_status, '')) = 'FAILED'
         or exists (
           select 1 from public.fulfillments f
           where f.order_id = o.id
             and upper(coalesce(f.display_status, '')) in ('NOT_DELIVERED', 'FAILED')
         )
    )
  into v_unfulfilled, v_partial, v_tracking_missing, v_in_transit, v_delivered, v_failed
  from public.orders o
  where (v_include_test or coalesce(o.is_test, false) = false)
    and (v_date_from is null or coalesce(o.source_created_at, o.created_at) >= v_date_from)
    and (v_date_to is null or coalesce(o.source_created_at, o.created_at) <= v_date_to);

  select count(distinct f.order_id)::bigint
  into v_fulfilled_today
  from public.fulfillments f
  join public.orders o on o.id = f.order_id
  where (v_include_test or coalesce(o.is_test, false) = false)
    and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
    and coalesce(f.fulfilled_at, f.source_created_at, f.created_at)::date = (timezone('utc', now()))::date
    and (v_date_from is null or coalesce(f.fulfilled_at, f.source_created_at, f.created_at) >= v_date_from)
    and (v_date_to is null or coalesce(f.fulfilled_at, f.source_created_at, f.created_at) <= v_date_to);

  return jsonb_build_object(
    'ok', true,
    'unfulfilled', v_unfulfilled,
    'partially_fulfilled', v_partial,
    'fulfilled_today', v_fulfilled_today,
    'tracking_missing', v_tracking_missing,
    'in_transit', v_in_transit,
    'delivered', v_delivered,
    'failed', v_failed,
    'note', 'FULFILLED ≠ DELIVERED. Delivery counts use display_status when delivered_at empty (Shopify import).'
  );
end;
$$;

grant execute on function public.rpc_admin_fulfilment_metrics(jsonb) to authenticated, service_role;

-- Align workspace delivery filters with display_status evidence
create or replace function public.rpc_list_admin_fulfilment_workspace(
  p_filters jsonb default '{}'::jsonb,
  p_limit int default 25,
  p_offset int default 0,
  p_sort text default 'date_desc'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_ff text[] := null;
  v_delivery text := nullif(btrim(coalesce(
    v_filters->>'delivery_bucket',
    v_filters->>'delivery',
    ''
  )), '');
  v_carrier text := nullif(btrim(coalesce(v_filters->>'carrier', '')), '');
  v_location uuid := nullif(btrim(coalesce(v_filters->>'location_id', '')), '')::uuid;
  v_date_from timestamptz := nullif(btrim(coalesce(v_filters->>'date_from', '')), '')::timestamptz;
  v_date_to timestamptz := nullif(btrim(coalesce(v_filters->>'date_to', '')), '')::timestamptz;
  v_search text := nullif(btrim(coalesce(v_filters->>'search', '')), '');
  v_tracking_missing boolean := coalesce((v_filters->>'tracking_missing')::boolean, false);
  v_include_test boolean := coalesce((v_filters->>'include_test')::boolean, false);
  v_salesperson uuid := nullif(btrim(coalesce(v_filters->>'salesperson_id', '')), '')::uuid;
  v_company uuid := nullif(btrim(coalesce(v_filters->>'company_id', '')), '')::uuid;
  v_customer uuid := nullif(btrim(coalesce(v_filters->>'customer_id', '')), '')::uuid;
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  if not public.can_view_fulfilment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_filters ? 'fulfillment_statuses' and jsonb_typeof(v_filters->'fulfillment_statuses') = 'array' then
    select array_agg(upper(x)) into v_ff
    from jsonb_array_elements_text(v_filters->'fulfillment_statuses') t(x);
  elsif v_filters ? 'fulfillment_status' and jsonb_typeof(v_filters->'fulfillment_status') = 'array' then
    select array_agg(upper(x)) into v_ff
    from jsonb_array_elements_text(v_filters->'fulfillment_status') t(x);
  elsif nullif(btrim(coalesce(v_filters->>'fulfillment_status', '')), '') is not null then
    v_ff := array[upper(btrim(v_filters->>'fulfillment_status'))];
  end if;

  if upper(coalesce(v_delivery, '')) = 'TRACKING_MISSING' then
    v_tracking_missing := true;
    v_delivery := null;
  end if;

  with filtered as (
    select o.id
    from public.orders o
    where (v_include_test or coalesce(o.is_test, false) = false)
      and (v_ff is null or upper(coalesce(o.commerce_fulfillment_status, '')) = any(v_ff))
      and (v_salesperson is null or o.salesperson_id = v_salesperson)
      and (v_company is null or o.company_id = v_company)
      and (v_customer is null or o.customer_id = v_customer)
      and (
        v_delivery is null
        or upper(coalesce(o.delivery_status, o.dpd_delivery_status, '')) = upper(v_delivery)
        or (
          upper(v_delivery) = 'IN_TRANSIT'
          and exists (
            select 1 from public.fulfillments f
            where f.order_id = o.id
              and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
              and (
                (f.in_transit_at is not null and f.delivered_at is null)
                or upper(coalesce(f.display_status, '')) in ('IN_TRANSIT', 'OUT_FOR_DELIVERY')
              )
          )
        )
        or (
          upper(v_delivery) = 'OUT_FOR_DELIVERY'
          and exists (
            select 1 from public.fulfillments f
            where f.order_id = o.id
              and upper(coalesce(f.display_status, '')) = 'OUT_FOR_DELIVERY'
          )
        )
        or (
          upper(v_delivery) = 'DELIVERED'
          and (
            upper(coalesce(o.delivery_status, '')) = 'DELIVERED'
            or exists (
              select 1 from public.fulfillments f
              where f.order_id = o.id
                and (
                  f.delivered_at is not null
                  or upper(coalesce(f.display_status, '')) = 'DELIVERED'
                )
            )
          )
        )
        or (
          upper(v_delivery) = 'FAILED'
          and (
            upper(coalesce(o.delivery_status, '')) = 'FAILED'
            or exists (
              select 1 from public.fulfillments f
              where f.order_id = o.id
                and upper(coalesce(f.display_status, '')) in ('NOT_DELIVERED', 'FAILED')
            )
          )
        )
        or (
          upper(v_delivery) = 'TRACKING_PRESENT'
          and exists (
            select 1 from public.fulfillments f
            where f.order_id = o.id
              and f.tracking_number is not null and btrim(f.tracking_number) <> ''
          )
        )
        or (
          upper(v_delivery) = 'NOT_DISPATCHED'
          and upper(coalesce(o.delivery_status, '')) = 'NOT_DISPATCHED'
        )
      )
      and (
        not v_tracking_missing
        or (
          upper(coalesce(o.commerce_fulfillment_status, '')) in ('FULFILLED', 'PARTIALLY_FULFILLED')
          and not exists (
            select 1 from public.fulfillments f
            where f.order_id = o.id
              and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
              and f.tracking_number is not null and btrim(f.tracking_number) <> ''
          )
        )
      )
      and (
        v_carrier is null
        or o.carrier ilike '%' || v_carrier || '%'
        or exists (
          select 1 from public.fulfillments f
          where f.order_id = o.id and f.tracking_company ilike '%' || v_carrier || '%'
        )
      )
      and (
        v_location is null
        or exists (
          select 1 from public.fulfillments f
          where f.order_id = o.id and f.inventory_location_id = v_location
        )
      )
      and (v_date_from is null or coalesce(o.source_created_at, o.created_at) >= v_date_from)
      and (v_date_to is null or coalesce(o.source_created_at, o.created_at) <= v_date_to)
      and (
        v_search is null
        or o.order_number ilike '%' || v_search || '%'
        or coalesce(o.email, '') ilike '%' || v_search || '%'
        or coalesce(o.trading_name, '') ilike '%' || v_search || '%'
        or exists (
          select 1 from public.fulfillments f
          where f.order_id = o.id and coalesce(f.tracking_number, '') ilike '%' || v_search || '%'
        )
      )
  ),
  counted as (
    select count(*)::bigint as total from filtered
  ),
  page as (
    select f.id
    from filtered f
    join public.orders o on o.id = f.id
    order by
      case when p_sort = 'date_asc' then coalesce(o.source_created_at, o.created_at) end asc nulls last,
      case when p_sort = 'order_asc' then o.order_number end asc nulls last,
      case when p_sort = 'status_asc' then o.commerce_fulfillment_status end asc nulls last,
      case when p_sort is distinct from 'date_asc' and p_sort is distinct from 'order_asc' and p_sort is distinct from 'status_asc'
        then coalesce(o.source_created_at, o.created_at) end desc nulls last,
      o.created_at desc
    limit v_limit offset v_offset
  )
  select
    (select total from counted),
    coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.sort_at desc nulls last)
      from (
        select
          o.id,
          o.order_number,
          o.email,
          o.trading_name,
          o.commerce_fulfillment_status,
          o.delivery_status,
          o.dpd_delivery_status,
          o.carrier,
          o.tracking_number,
          o.is_test,
          o.company_id,
          o.customer_id,
          o.salesperson_id,
          coalesce(o.source_created_at, o.created_at) as sort_at,
          coalesce(o.source_created_at, o.created_at) as order_date,
          (
            select count(*)::int from public.fulfillments ff
            where ff.order_id = o.id
              and upper(coalesce(ff.status, '')) not in ('CANCELLED', 'CANCELED')
          ) as active_fulfillment_count,
          (
            select ff.tracking_company from public.fulfillments ff
            where ff.order_id = o.id
              and upper(coalesce(ff.status, '')) not in ('CANCELLED', 'CANCELED')
            order by coalesce(ff.source_created_at, ff.created_at) desc
            limit 1
          ) as primary_carrier,
          (
            select ff.tracking_number from public.fulfillments ff
            where ff.order_id = o.id
              and upper(coalesce(ff.status, '')) not in ('CANCELLED', 'CANCELED')
              and ff.tracking_number is not null
            order by coalesce(ff.source_created_at, ff.created_at) desc
            limit 1
          ) as primary_tracking,
          (
            select upper(coalesce(ff.display_status, '')) from public.fulfillments ff
            where ff.order_id = o.id
              and upper(coalesce(ff.status, '')) not in ('CANCELLED', 'CANCELED')
            order by coalesce(ff.source_created_at, ff.created_at) desc
            limit 1
          ) as primary_display_status,
          exists (
            select 1 from public.fulfillments ff
            where ff.order_id = o.id
              and upper(coalesce(ff.status, '')) not in ('CANCELLED', 'CANCELED')
              and ff.tracking_number is not null and btrim(ff.tracking_number) <> ''
          ) as has_tracking
        from page p
        join public.orders o on o.id = p.id
      ) x
    ), '[]'::jsonb)
  into v_total, v_items;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'items', v_items,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

grant execute on function public.rpc_list_admin_fulfilment_workspace(jsonb, int, int, text) to authenticated, service_role;
