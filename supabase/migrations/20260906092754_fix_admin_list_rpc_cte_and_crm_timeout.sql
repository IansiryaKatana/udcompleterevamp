-- Fix list RPCs:
-- 1. Orders/drafts: WITH filtered was only in scope for the first statement
--    ("relation filtered does not exist").
-- 2. CRM customers/companies: listing timed out because every request aggregated
--    all orders/refunds/drafts before paging. Filter with EXISTS, then metrics
--    only for the current page.

CREATE OR REPLACE FUNCTION public.rpc_list_admin_orders_v2(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_sort text DEFAULT 'date_desc'::text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
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

  with filtered as materialized (
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
  ),
  counted as (
    select count(*)::bigint as total from filtered
  ),
  ranked as (
    select
      o.id,
      row_number() over (
        order by
          case when coalesce(p_sort, 'date_desc') = 'date_asc' then coalesce(o.source_created_at, o.created_at) end asc nulls last,
          case when coalesce(p_sort, 'date_desc') = 'date_desc' then coalesce(o.source_created_at, o.created_at) end desc nulls last,
          case when p_sort = 'total_desc' then o.total end desc nulls last,
          case when p_sort = 'total_asc' then o.total end asc nulls last,
          case when p_sort = 'outstanding_desc' then o.total_outstanding end desc nulls last,
          case when p_sort = 'number_asc' then coalesce(o.source_order_number, o.order_number) end asc nulls last,
          o.id
      ) as ord
    from filtered f
    join public.orders o on o.id = f.id
  ),
  page_ids as (
    select r.id, r.ord
    from ranked r
    where r.ord > greatest(coalesce(p_offset, 0), 0)
      and r.ord <= greatest(coalesce(p_offset, 0), 0) + greatest(coalesce(p_limit, 25), 1)
  ),
  page as (
    select
      pid.ord,
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
    from page_ids pid
    join public.orders o on o.id = pid.id
    left join public.customers cu on cu.id = o.customer_id
    left join public.companies co on co.id = o.company_id
    left join public.staff_members sp on sp.id = o.salesperson_id
    left join public.staff_members cg on cg.id = o.cg_assigned_id
    left join public.staff_members rf on rf.id = o.referrer_id
    order by pid.ord
  )
  select
    c.total,
    coalesce((select jsonb_agg(to_jsonb(p) order by p.ord) from page p), '[]'::jsonb)
  into v_total, v_items
  from counted c;

  return jsonb_build_object('ok', true, 'items', coalesce(v_items, '[]'::jsonb), 'total', coalesce(v_total, 0));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_list_admin_drafts(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_sort text DEFAULT 'date_desc'::text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare
  v_total bigint;
  v_items jsonb;
  v_search text := nullif(btrim(coalesce(p_filters->>'search', '')), '');
  v_date_preset text := nullif(btrim(coalesce(p_filters->>'date_preset', '')), '');
  v_date_from timestamptz := nullif(p_filters->>'date_from', '')::timestamptz;
  v_date_to timestamptz := nullif(p_filters->>'date_to', '')::timestamptz;
  v_statuses text[] := case when jsonb_typeof(p_filters->'statuses') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'statuses')) else null end;
  v_sources text[] := case when jsonb_typeof(p_filters->'source_systems') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'source_systems')) else null end;
  v_tags text[] := case when jsonb_typeof(p_filters->'tags') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'tags')) else null end;
  v_converted boolean := case when p_filters ? 'converted' and nullif(p_filters->>'converted', '') is not null
    then (p_filters->>'converted')::boolean else null end;
  v_overdue boolean := coalesce((p_filters->>'overdue')::boolean, false);
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
  v_payment_terms text := nullif(btrim(coalesce(p_filters->>'payment_terms', '')), '');
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

  with filtered as materialized (
    select d.id
    from public.draft_orders d
    left join public.customers cu on cu.id = d.customer_id
    left join public.companies co on co.id = d.company_id
    left join public.staff_members sp on sp.id = d.salesperson_id
    left join public.staff_members cg on cg.id = d.cg_assigned_id
    left join public.staff_members rf on rf.id = d.referrer_id
    left join public.orders ord on ord.id = d.converted_order_id
    where
      (v_date_from is null or coalesce(d.source_created_at, d.created_at) >= v_date_from)
      and (v_date_to is null or coalesce(d.source_created_at, d.created_at) < v_date_to)
      and (v_statuses is null or d.status = any(v_statuses))
      and (v_sources is null or d.source_system = any(v_sources))
      and (
        v_converted is null
        or (v_converted and d.converted_order_id is not null)
        or (not v_converted and d.converted_order_id is null)
      )
      and (
        not v_overdue
        or (
          d.payment_due_on is not null
          and d.payment_due_on < current_date
          and d.status = 'open'
        )
      )
      and (v_customer_type is null or d.customer_type_snapshot ilike v_customer_type)
      and (v_trading is null or d.trading_name_snapshot ilike '%' || v_trading || '%')
      and (v_salesperson is null or d.salesperson_id = v_salesperson)
      and (v_cg is null or d.cg_assigned_id = v_cg)
      and (v_referrer is null or d.referrer_id = v_referrer)
      and (v_customer is null or d.customer_id = v_customer)
      and (v_company is null or d.company_id = v_company)
      and (v_min is null or d.total_price >= v_min)
      and (v_max is null or d.total_price <= v_max)
      and (v_due_from is null or d.payment_due_on >= v_due_from)
      and (v_due_to is null or d.payment_due_on <= v_due_to)
      and (v_payment_terms is null or d.payment_terms ilike v_payment_terms)
      and (
        v_source_group is null
        or (v_source_group = 'shopify' and d.source_system = 'shopify')
        or (v_source_group = 'unique' and coalesce(d.source_system, '') = 'unique')
      )
      and (
        v_tags is null
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'draft_order' and et.entity_id = d.id and et.raw_value = any(v_tags)
        )
      )
      and (
        v_search is null
        or d.name ilike '%' || v_search || '%'
        or d.email ilike '%' || v_search || '%'
        or d.phone ilike '%' || v_search || '%'
        or d.po_number ilike '%' || v_search || '%'
        or d.trading_name_snapshot ilike '%' || v_search || '%'
        or d.payment_terms ilike '%' || v_search || '%'
        or cu.display_name ilike '%' || v_search || '%'
        or cu.email ilike '%' || v_search || '%'
        or (cu.first_name || ' ' || cu.last_name) ilike '%' || v_search || '%'
        or co.name ilike '%' || v_search || '%'
        or sp.name ilike '%' || v_search || '%'
        or cg.name ilike '%' || v_search || '%'
        or rf.name ilike '%' || v_search || '%'
        or ord.order_number ilike '%' || v_search || '%'
        or ord.source_order_number ilike '%' || v_search || '%'
        or exists (
          select 1 from public.draft_order_line_items li
          where li.draft_order_id = d.id
            and (li.sku_snapshot ilike '%' || v_search || '%' or li.title ilike '%' || v_search || '%')
        )
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'draft_order' and et.entity_id = d.id
            and et.raw_value ilike '%' || v_search || '%'
        )
      )
  ),
  counted as (
    select count(*)::bigint as total from filtered
  ),
  ranked as (
    select
      d.id,
      row_number() over (
        order by
          case when coalesce(p_sort, 'date_desc') = 'date_asc' then coalesce(d.source_created_at, d.created_at) end asc nulls last,
          case when coalesce(p_sort, 'date_desc') = 'date_desc' then coalesce(d.source_created_at, d.created_at) end desc nulls last,
          case when p_sort = 'total_desc' then d.total_price end desc nulls last,
          case when p_sort = 'total_asc' then d.total_price end asc nulls last,
          case when p_sort = 'name_asc' then d.name end asc nulls last,
          case when p_sort = 'updated_desc' then d.updated_at end desc nulls last,
          d.id
      ) as ord
    from filtered f
    join public.draft_orders d on d.id = f.id
  ),
  page_ids as (
    select r.id, r.ord
    from ranked r
    where r.ord > greatest(coalesce(p_offset, 0), 0)
      and r.ord <= greatest(coalesce(p_offset, 0), 0) + greatest(coalesce(p_limit, 25), 1)
  ),
  page as (
    select
      pid.ord,
      d.id,
      d.name,
      d.status,
      d.email,
      d.phone,
      d.po_number,
      d.currency,
      d.subtotal,
      d.total_tax,
      d.total_shipping,
      d.total_discounts,
      d.total_price,
      d.source_system,
      d.trading_name_snapshot,
      d.customer_type_snapshot,
      d.payment_due_on,
      d.payment_terms,
      d.tax_exempt,
      d.version,
      d.customer_id,
      d.company_id,
      d.salesperson_id,
      d.cg_assigned_id,
      d.referrer_id,
      d.converted_order_id,
      d.completed_at,
      coalesce(d.source_created_at, d.created_at) as draft_date,
      d.created_at,
      d.updated_at,
      cu.display_name as customer_name,
      coalesce(cu.email, d.email) as customer_email,
      co.name as company_name,
      sp.name as salesperson_name,
      cg.name as cg_name,
      rf.name as referrer_name,
      coalesce(converted_ord.source_order_number, converted_ord.order_number) as converted_order_number,
      (select count(*)::int from public.draft_order_line_items li where li.draft_order_id = d.id) as line_count,
      (select coalesce(sum(li.quantity), 0)::int from public.draft_order_line_items li where li.draft_order_id = d.id) as item_quantity,
      (
        select coalesce(jsonb_agg(t.raw_value order by t.raw_value), '[]'::jsonb)
        from (
          select et.raw_value
          from public.entity_tags et
          where et.entity_type = 'draft_order' and et.entity_id = d.id
          order by et.raw_value
          limit 8
        ) t
      ) as tags
    from page_ids pid
    join public.draft_orders d on d.id = pid.id
    left join public.customers cu on cu.id = d.customer_id
    left join public.companies co on co.id = d.company_id
    left join public.staff_members sp on sp.id = d.salesperson_id
    left join public.staff_members cg on cg.id = d.cg_assigned_id
    left join public.staff_members rf on rf.id = d.referrer_id
    left join public.orders converted_ord on converted_ord.id = d.converted_order_id
    order by pid.ord
  )
  select
    c.total,
    coalesce((select jsonb_agg(to_jsonb(p) order by p.ord) from page p), '[]'::jsonb)
  into v_total, v_items
  from counted c;

  return jsonb_build_object('ok', true, 'items', coalesce(v_items, '[]'::jsonb), 'total', coalesce(v_total, 0));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_list_admin_crm_customers(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_sort text DEFAULT 'created_desc'::text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare
  v_total bigint;
  v_items jsonb;
  v_search text := nullif(btrim(coalesce(p_filters->>'search', '')), '');
  v_has_company boolean := case when p_filters ? 'has_company' and nullif(p_filters->>'has_company', '') is not null
    then (p_filters->>'has_company')::boolean else null end;
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_types text[] := case when jsonb_typeof(p_filters->'customer_types') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'customer_types')) else null end;
  v_salesperson uuid := nullif(p_filters->>'salesperson_id', '')::uuid;
  v_cg uuid := nullif(p_filters->>'cg_assigned_id', '')::uuid;
  v_referrer uuid := nullif(p_filters->>'referrer_id', '')::uuid;
  v_unassigned_sp boolean := coalesce((p_filters->>'unassigned_salesperson')::boolean, false);
  v_has_outstanding boolean := coalesce((p_filters->>'has_outstanding')::boolean, false);
  v_min_life numeric := nullif(p_filters->>'min_lifetime', '')::numeric;
  v_max_life numeric := nullif(p_filters->>'max_lifetime', '')::numeric;
  v_has_orders boolean := case when p_filters ? 'has_orders' and nullif(p_filters->>'has_orders', '') is not null
    then (p_filters->>'has_orders')::boolean else null end;
  v_has_open_drafts boolean := case when p_filters ? 'has_open_drafts' and nullif(p_filters->>'has_open_drafts', '') is not null
    then (p_filters->>'has_open_drafts')::boolean else null end;
  v_payment_terms text := nullif(btrim(coalesce(p_filters->>'payment_terms', '')), '');
  v_sources text[] := case when jsonb_typeof(p_filters->'source_systems') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'source_systems')) else null end;
  v_source_group text := nullif(btrim(coalesce(p_filters->>'source_group', '')), '');
  v_tags text[] := case when jsonb_typeof(p_filters->'tags') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'tags')) else null end;
  v_inactive_since date := nullif(p_filters->>'inactive_since', '')::date;
  v_created_preset text := nullif(btrim(coalesce(p_filters->>'created_preset', p_filters->>'date_preset', '')), '');
  v_created_from timestamptz := coalesce(
    nullif(p_filters->>'created_from', ''),
    nullif(p_filters->>'date_from', '')
  )::timestamptz;
  v_created_to timestamptz := coalesce(
    nullif(p_filters->>'created_to', ''),
    nullif(p_filters->>'date_to', '')
  )::timestamptz;
  v_last_order_preset text := nullif(btrim(coalesce(p_filters->>'last_order_preset', '')), '');
  v_last_order_from timestamptz := nullif(p_filters->>'last_order_from', '')::timestamptz;
  v_last_order_to timestamptz := nullif(p_filters->>'last_order_to', '')::timestamptz;
  v_bounds record;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_created_preset is not null then
    v_bounds := public.crm_date_preset_bounds(v_created_preset);
    v_created_from := coalesce(v_created_from, v_bounds.o_from);
    v_created_to := coalesce(v_created_to, v_bounds.o_to);
  end if;
  if v_last_order_preset is not null then
    v_bounds := public.crm_date_preset_bounds(v_last_order_preset);
    v_last_order_from := coalesce(v_last_order_from, v_bounds.o_from);
    v_last_order_to := coalesce(v_last_order_to, v_bounds.o_to);
  end if;

  with filtered as materialized (
    select cu.id
    from public.customers cu
    left join public.staff_members sp on sp.id = cu.salesperson_id
    left join public.staff_members cg on cg.id = cu.cg_assigned_id
    left join public.staff_members rf on rf.id = cu.referrer_id
    where
      (v_created_from is null or cu.created_at >= v_created_from)
      and (v_created_to is null or cu.created_at < v_created_to)
      and (v_types is null or cu.customer_type = any(v_types))
      and (v_salesperson is null or cu.salesperson_id = v_salesperson)
      and (v_cg is null or cu.cg_assigned_id = v_cg)
      and (v_referrer is null or cu.referrer_id = v_referrer)
      and (not v_unassigned_sp or cu.salesperson_id is null)
      and (v_payment_terms is null or cu.payment_terms ilike v_payment_terms)
      and (v_sources is null or cu.source_system = any(v_sources))
      and (
        v_source_group is null
        or (v_source_group = 'shopify' and cu.source_system = 'shopify')
        or (v_source_group = 'unique' and coalesce(cu.source_system, '') = 'unique')
      )
      and (
        v_company is null
        or exists (
          select 1 from public.company_contacts cc
          where cc.customer_id = cu.id and cc.company_id = v_company
        )
      )
      and (
        v_has_company is null
        or (v_has_company and exists (select 1 from public.company_contacts cc where cc.customer_id = cu.id))
        or (not v_has_company and not exists (select 1 from public.company_contacts cc where cc.customer_id = cu.id))
      )
      and (not v_has_outstanding or exists (
        select 1 from public.orders o
        where o.customer_id = cu.id and coalesce(o.total_outstanding, 0) > 0
      ))
      and (v_min_life is null or (
        select coalesce(sum(o.total), 0) from public.orders o where o.customer_id = cu.id
      ) >= v_min_life)
      and (v_max_life is null or (
        select coalesce(sum(o.total), 0) from public.orders o where o.customer_id = cu.id
      ) <= v_max_life)
      and (
        v_has_orders is null
        or (v_has_orders and exists (select 1 from public.orders o where o.customer_id = cu.id))
        or (not v_has_orders and not exists (select 1 from public.orders o where o.customer_id = cu.id))
      )
      and (
        v_has_open_drafts is null
        or (v_has_open_drafts and exists (
          select 1 from public.draft_orders d where d.customer_id = cu.id and d.status = 'open'
        ))
        or (not v_has_open_drafts and not exists (
          select 1 from public.draft_orders d where d.customer_id = cu.id and d.status = 'open'
        ))
      )
      and (v_last_order_from is null or exists (
        select 1 from public.orders o
        where o.customer_id = cu.id
          and coalesce(o.source_created_at, o.created_at) >= v_last_order_from
      ))
      and (v_last_order_to is null or (
        select max(coalesce(o.source_created_at, o.created_at))
        from public.orders o where o.customer_id = cu.id
      ) < v_last_order_to)
      and (
        v_inactive_since is null
        or not exists (
          select 1 from public.orders o
          where o.customer_id = cu.id
            and coalesce(o.source_created_at, o.created_at) >= v_inactive_since::timestamptz
        )
      )
      and (
        v_tags is null
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'customer' and et.entity_id = cu.id and et.raw_value = any(v_tags)
        )
      )
      and (
        v_search is null
        or cu.display_name ilike '%' || v_search || '%'
        or cu.email ilike '%' || v_search || '%'
        or cu.phone ilike '%' || v_search || '%'
        or cu.trading_name ilike '%' || v_search || '%'
        or cu.company_name_snapshot ilike '%' || v_search || '%'
        or cu.payment_terms ilike '%' || v_search || '%'
        or (cu.first_name || ' ' || cu.last_name) ilike '%' || v_search || '%'
        or sp.name ilike '%' || v_search || '%'
        or cg.name ilike '%' || v_search || '%'
        or rf.name ilike '%' || v_search || '%'
        or exists (
          select 1 from public.company_contacts cc
          join public.companies co on co.id = cc.company_id
          where cc.customer_id = cu.id
            and (co.name ilike '%' || v_search || '%' or co.trading_name ilike '%' || v_search || '%')
        )
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'customer' and et.entity_id = cu.id
            and et.raw_value ilike '%' || v_search || '%'
        )
        or exists (
          select 1 from public.external_system_refs esr
          where esr.entity_type = 'customer' and esr.entity_id = cu.id
            and (
              esr.external_gid ilike '%' || v_search || '%'
              or esr.external_legacy_id ilike '%' || v_search || '%'
              or esr.external_number ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.orders o
          where o.customer_id = cu.id
            and (
              o.order_number ilike '%' || v_search || '%'
              or o.source_order_number ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.draft_orders d
          where d.customer_id = cu.id
            and d.name ilike '%' || v_search || '%'
        )
      )
  ),
  counted as (
    select count(*)::bigint as total from filtered
  ),
  ranked as (
    select
      cu.id,
      row_number() over (
        order by
          case when coalesce(p_sort, 'created_desc') = 'name_asc' then coalesce(cu.display_name, cu.email) end asc nulls last,
          case when p_sort = 'name_desc' then coalesce(cu.display_name, cu.email) end desc nulls last,
          case when p_sort = 'created_asc' then cu.created_at end asc nulls last,
          case when coalesce(p_sort, 'created_desc') = 'created_desc' then cu.created_at end desc nulls last,
          case when p_sort = 'updated_desc' then cu.updated_at end desc nulls last,
          case when p_sort = 'lifetime_desc' then (
            select coalesce(sum(o.total), 0) from public.orders o where o.customer_id = cu.id
          ) end desc nulls last,
          case when p_sort = 'lifetime_asc' then (
            select coalesce(sum(o.total), 0) from public.orders o where o.customer_id = cu.id
          ) end asc nulls last,
          case when p_sort = 'outstanding_desc' then (
            select coalesce(sum(o.total_outstanding), 0) from public.orders o where o.customer_id = cu.id
          ) end desc nulls last,
          case when p_sort = 'last_order_desc' then (
            select max(coalesce(o.source_created_at, o.created_at)) from public.orders o where o.customer_id = cu.id
          ) end desc nulls last,
          cu.id
      ) as ord
    from filtered f
    join public.customers cu on cu.id = f.id
  ),
  page_ids as (
    select r.id, r.ord
    from ranked r
    where r.ord > greatest(coalesce(p_offset, 0), 0)
      and r.ord <= greatest(coalesce(p_offset, 0), 0) + greatest(coalesce(p_limit, 25), 1)
  ),
  metrics as (
    select
      o.customer_id,
      count(*)::int as order_count,
      coalesce(sum(o.total), 0)::numeric(14,2) as lifetime_total,
      coalesce(sum(o.total_received), 0)::numeric(14,2) as total_received,
      coalesce(sum(o.total_outstanding), 0)::numeric(14,2) as total_outstanding,
      min(coalesce(o.source_created_at, o.created_at)) as first_order_at,
      max(coalesce(o.source_created_at, o.created_at)) as last_order_at
    from public.orders o
    where o.customer_id in (select id from page_ids)
    group by o.customer_id
  ),
  refunds_agg as (
    select o.customer_id, coalesce(sum(r.total_refunded), 0)::numeric(14,2) as refund_total
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where o.customer_id in (select id from page_ids)
    group by o.customer_id
  ),
  drafts_agg as (
    select d.customer_id,
      count(*) filter (where d.status = 'open')::int as open_draft_count,
      coalesce(sum(d.total_price) filter (where d.status = 'open'), 0)::numeric(14,2) as open_draft_value
    from public.draft_orders d
    where d.customer_id in (select id from page_ids)
    group by d.customer_id
  ),
  page as (
    select
      pid.ord,
      cu.id,
      cu.display_name,
      cu.first_name,
      cu.last_name,
      cu.email,
      cu.phone,
      cu.trading_name,
      cu.company_name_snapshot,
      cu.customer_type,
      cu.payment_terms,
      cu.status,
      cu.approval_status,
      cu.source_system,
      cu.salesperson_id,
      cu.cg_assigned_id,
      cu.referrer_id,
      cu.version,
      cu.created_at,
      cu.updated_at,
      sp.name as salesperson_name,
      cg.name as cg_name,
      rf.name as referrer_name,
      coalesce(m.order_count, 0) as order_count,
      coalesce(m.lifetime_total, 0) as lifetime_total,
      coalesce(m.total_received, 0) as total_received,
      coalesce(m.total_outstanding, 0) as total_outstanding,
      coalesce(ra.refund_total, 0) as refund_total,
      case when coalesce(m.order_count, 0) > 0
        then round(m.lifetime_total / m.order_count, 2) else null end as avg_order_value,
      m.first_order_at,
      m.last_order_at,
      coalesce(da.open_draft_count, 0) as open_draft_count,
      coalesce(da.open_draft_value, 0) as open_draft_value,
      (
        select coalesce(jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name) order by co.name), '[]'::jsonb)
        from public.company_contacts cc
        join public.companies co on co.id = cc.company_id
        where cc.customer_id = cu.id
      ) as companies,
      (
        select coalesce(jsonb_agg(t.raw_value order by t.raw_value), '[]'::jsonb)
        from (
          select et.raw_value from public.entity_tags et
          where et.entity_type = 'customer' and et.entity_id = cu.id
          order by et.raw_value limit 8
        ) t
      ) as tags
    from page_ids pid
    join public.customers cu on cu.id = pid.id
    left join metrics m on m.customer_id = cu.id
    left join refunds_agg ra on ra.customer_id = cu.id
    left join drafts_agg da on da.customer_id = cu.id
    left join public.staff_members sp on sp.id = cu.salesperson_id
    left join public.staff_members cg on cg.id = cu.cg_assigned_id
    left join public.staff_members rf on rf.id = cu.referrer_id
    order by pid.ord
  )
  select
    c.total,
    coalesce((select jsonb_agg(to_jsonb(p) order by p.ord) from page p), '[]'::jsonb)
  into v_total, v_items
  from counted c;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_list_admin_crm_companies(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_sort text DEFAULT 'created_desc'::text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare
  v_total bigint;
  v_items jsonb;
  v_search text := nullif(btrim(coalesce(p_filters->>'search', '')), '');
  v_has_contacts boolean := case when p_filters ? 'has_company' and nullif(p_filters->>'has_company', '') is not null
    then (p_filters->>'has_company')::boolean
    when p_filters ? 'has_contacts' and nullif(p_filters->>'has_contacts', '') is not null
    then (p_filters->>'has_contacts')::boolean else null end;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_types text[] := case when jsonb_typeof(p_filters->'customer_types') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'customer_types')) else null end;
  v_salesperson uuid := nullif(p_filters->>'salesperson_id', '')::uuid;
  v_cg uuid := nullif(p_filters->>'cg_assigned_id', '')::uuid;
  v_referrer uuid := nullif(p_filters->>'referrer_id', '')::uuid;
  v_unassigned_sp boolean := coalesce((p_filters->>'unassigned_salesperson')::boolean, false);
  v_has_outstanding boolean := coalesce((p_filters->>'has_outstanding')::boolean, false);
  v_min_life numeric := nullif(p_filters->>'min_lifetime', '')::numeric;
  v_max_life numeric := nullif(p_filters->>'max_lifetime', '')::numeric;
  v_has_orders boolean := case when p_filters ? 'has_orders' and nullif(p_filters->>'has_orders', '') is not null
    then (p_filters->>'has_orders')::boolean else null end;
  v_has_open_drafts boolean := case when p_filters ? 'has_open_drafts' and nullif(p_filters->>'has_open_drafts', '') is not null
    then (p_filters->>'has_open_drafts')::boolean else null end;
  v_payment_terms text := nullif(btrim(coalesce(p_filters->>'payment_terms', '')), '');
  v_sources text[] := case when jsonb_typeof(p_filters->'source_systems') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'source_systems')) else null end;
  v_source_group text := nullif(btrim(coalesce(p_filters->>'source_group', '')), '');
  v_tags text[] := case when jsonb_typeof(p_filters->'tags') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'tags')) else null end;
  v_inactive_since date := nullif(p_filters->>'inactive_since', '')::date;
  v_created_preset text := nullif(btrim(coalesce(p_filters->>'created_preset', p_filters->>'date_preset', '')), '');
  v_created_from timestamptz := coalesce(
    nullif(p_filters->>'created_from', ''),
    nullif(p_filters->>'date_from', '')
  )::timestamptz;
  v_created_to timestamptz := coalesce(
    nullif(p_filters->>'created_to', ''),
    nullif(p_filters->>'date_to', '')
  )::timestamptz;
  v_last_order_preset text := nullif(btrim(coalesce(p_filters->>'last_order_preset', '')), '');
  v_last_order_from timestamptz := nullif(p_filters->>'last_order_from', '')::timestamptz;
  v_last_order_to timestamptz := nullif(p_filters->>'last_order_to', '')::timestamptz;
  v_bounds record;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_created_preset is not null then
    v_bounds := public.crm_date_preset_bounds(v_created_preset);
    v_created_from := coalesce(v_created_from, v_bounds.o_from);
    v_created_to := coalesce(v_created_to, v_bounds.o_to);
  end if;
  if v_last_order_preset is not null then
    v_bounds := public.crm_date_preset_bounds(v_last_order_preset);
    v_last_order_from := coalesce(v_last_order_from, v_bounds.o_from);
    v_last_order_to := coalesce(v_last_order_to, v_bounds.o_to);
  end if;

  with filtered as materialized (
    select co.id
    from public.companies co
    left join public.staff_members sp on sp.id = co.salesperson_id
    left join public.staff_members cg on cg.id = co.cg_assigned_id
    left join public.staff_members rf on rf.id = co.referrer_id
    where
      (v_created_from is null or co.created_at >= v_created_from)
      and (v_created_to is null or co.created_at < v_created_to)
      and (v_types is null or co.customer_type = any(v_types))
      and (v_salesperson is null or co.salesperson_id = v_salesperson)
      and (v_cg is null or co.cg_assigned_id = v_cg)
      and (v_referrer is null or co.referrer_id = v_referrer)
      and (not v_unassigned_sp or co.salesperson_id is null)
      and (v_payment_terms is null or co.payment_terms ilike v_payment_terms)
      and (v_sources is null or co.source_system = any(v_sources))
      and (
        v_source_group is null
        or (v_source_group = 'shopify' and co.source_system = 'shopify')
        or (v_source_group = 'unique' and coalesce(co.source_system, '') = 'unique')
      )
      and (
        v_customer is null
        or exists (
          select 1 from public.company_contacts cc
          where cc.company_id = co.id and cc.customer_id = v_customer
        )
      )
      and (
        v_has_contacts is null
        or (v_has_contacts and exists (select 1 from public.company_contacts cc where cc.company_id = co.id))
        or (not v_has_contacts and not exists (select 1 from public.company_contacts cc where cc.company_id = co.id))
      )
      and (not v_has_outstanding or exists (
        select 1 from public.orders o
        where o.company_id = co.id and coalesce(o.total_outstanding, 0) > 0
      ))
      and (v_min_life is null or (
        select coalesce(sum(o.total), 0) from public.orders o where o.company_id = co.id
      ) >= v_min_life)
      and (v_max_life is null or (
        select coalesce(sum(o.total), 0) from public.orders o where o.company_id = co.id
      ) <= v_max_life)
      and (
        v_has_orders is null
        or (v_has_orders and exists (select 1 from public.orders o where o.company_id = co.id))
        or (not v_has_orders and not exists (select 1 from public.orders o where o.company_id = co.id))
      )
      and (
        v_has_open_drafts is null
        or (v_has_open_drafts and exists (
          select 1 from public.draft_orders d where d.company_id = co.id and d.status = 'open'
        ))
        or (not v_has_open_drafts and not exists (
          select 1 from public.draft_orders d where d.company_id = co.id and d.status = 'open'
        ))
      )
      and (v_last_order_from is null or exists (
        select 1 from public.orders o
        where o.company_id = co.id
          and coalesce(o.source_created_at, o.created_at) >= v_last_order_from
      ))
      and (v_last_order_to is null or (
        select max(coalesce(o.source_created_at, o.created_at))
        from public.orders o where o.company_id = co.id
      ) < v_last_order_to)
      and (
        v_inactive_since is null
        or not exists (
          select 1 from public.orders o
          where o.company_id = co.id
            and coalesce(o.source_created_at, o.created_at) >= v_inactive_since::timestamptz
        )
      )
      and (
        v_tags is null
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'company' and et.entity_id = co.id and et.raw_value = any(v_tags)
        )
      )
      and (
        v_search is null
        or co.name ilike '%' || v_search || '%'
        or co.trading_name ilike '%' || v_search || '%'
        or co.legal_name ilike '%' || v_search || '%'
        or co.payment_terms ilike '%' || v_search || '%'
        or co.company_number ilike '%' || v_search || '%'
        or co.vat_number ilike '%' || v_search || '%'
        or sp.name ilike '%' || v_search || '%'
        or cg.name ilike '%' || v_search || '%'
        or rf.name ilike '%' || v_search || '%'
        or exists (
          select 1 from public.company_contacts cc
          join public.customers cu on cu.id = cc.customer_id
          where cc.company_id = co.id
            and (
              cu.display_name ilike '%' || v_search || '%'
              or cu.email ilike '%' || v_search || '%'
              or cu.trading_name ilike '%' || v_search || '%'
              or (cu.first_name || ' ' || cu.last_name) ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.company_locations cl
          where cl.company_id = co.id
            and (
              cl.name ilike '%' || v_search || '%'
              or cl.postal_code ilike '%' || v_search || '%'
              or cl.email ilike '%' || v_search || '%'
              or cl.phone ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'company' and et.entity_id = co.id
            and et.raw_value ilike '%' || v_search || '%'
        )
        or exists (
          select 1 from public.external_system_refs esr
          where esr.entity_type = 'company' and esr.entity_id = co.id
            and (
              esr.external_gid ilike '%' || v_search || '%'
              or esr.external_legacy_id ilike '%' || v_search || '%'
              or esr.external_number ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.orders o
          where o.company_id = co.id
            and (
              o.order_number ilike '%' || v_search || '%'
              or o.source_order_number ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.draft_orders d
          where d.company_id = co.id and d.name ilike '%' || v_search || '%'
        )
      )
  ),
  counted as (
    select count(*)::bigint as total from filtered
  ),
  ranked as (
    select
      co.id,
      row_number() over (
        order by
          case when coalesce(p_sort, 'created_desc') = 'name_asc' then co.name end asc nulls last,
          case when p_sort = 'name_desc' then co.name end desc nulls last,
          case when p_sort = 'created_asc' then co.created_at end asc nulls last,
          case when coalesce(p_sort, 'created_desc') = 'created_desc' then co.created_at end desc nulls last,
          case when p_sort = 'updated_desc' then co.updated_at end desc nulls last,
          case when p_sort = 'lifetime_desc' then (
            select coalesce(sum(o.total), 0) from public.orders o where o.company_id = co.id
          ) end desc nulls last,
          case when p_sort = 'lifetime_asc' then (
            select coalesce(sum(o.total), 0) from public.orders o where o.company_id = co.id
          ) end asc nulls last,
          case when p_sort = 'outstanding_desc' then (
            select coalesce(sum(o.total_outstanding), 0) from public.orders o where o.company_id = co.id
          ) end desc nulls last,
          case when p_sort = 'last_order_desc' then (
            select max(coalesce(o.source_created_at, o.created_at)) from public.orders o where o.company_id = co.id
          ) end desc nulls last,
          co.id
      ) as ord
    from filtered f
    join public.companies co on co.id = f.id
  ),
  page_ids as (
    select r.id, r.ord
    from ranked r
    where r.ord > greatest(coalesce(p_offset, 0), 0)
      and r.ord <= greatest(coalesce(p_offset, 0), 0) + greatest(coalesce(p_limit, 25), 1)
  ),
  metrics as (
    select
      o.company_id,
      count(*)::int as order_count,
      coalesce(sum(o.total), 0)::numeric(14,2) as lifetime_total,
      coalesce(sum(o.total_received), 0)::numeric(14,2) as total_received,
      coalesce(sum(o.total_outstanding), 0)::numeric(14,2) as total_outstanding,
      min(coalesce(o.source_created_at, o.created_at)) as first_order_at,
      max(coalesce(o.source_created_at, o.created_at)) as last_order_at
    from public.orders o
    where o.company_id in (select id from page_ids)
    group by o.company_id
  ),
  refunds_agg as (
    select o.company_id, coalesce(sum(r.total_refunded), 0)::numeric(14,2) as refund_total
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where o.company_id in (select id from page_ids)
    group by o.company_id
  ),
  drafts_agg as (
    select d.company_id,
      count(*) filter (where d.status = 'open')::int as open_draft_count,
      coalesce(sum(d.total_price) filter (where d.status = 'open'), 0)::numeric(14,2) as open_draft_value
    from public.draft_orders d
    where d.company_id in (select id from page_ids)
    group by d.company_id
  ),
  page as (
    select
      pid.ord,
      co.id,
      co.name,
      co.trading_name,
      co.legal_name,
      co.customer_type,
      co.payment_terms,
      co.status,
      co.source_system,
      co.salesperson_id,
      co.cg_assigned_id,
      co.referrer_id,
      co.version,
      co.created_at,
      co.updated_at,
      sp.name as salesperson_name,
      cg.name as cg_name,
      rf.name as referrer_name,
      coalesce(m.order_count, 0) as order_count,
      coalesce(m.lifetime_total, 0) as lifetime_total,
      coalesce(m.total_received, 0) as total_received,
      coalesce(m.total_outstanding, 0) as total_outstanding,
      coalesce(ra.refund_total, 0) as refund_total,
      case when coalesce(m.order_count, 0) > 0
        then round(m.lifetime_total / m.order_count, 2) else null end as avg_order_value,
      m.first_order_at,
      m.last_order_at,
      coalesce(da.open_draft_count, 0) as open_draft_count,
      coalesce(da.open_draft_value, 0) as open_draft_value,
      (select count(*)::int from public.company_contacts cc where cc.company_id = co.id) as contact_count,
      (select count(*)::int from public.company_locations cl where cl.company_id = co.id) as location_count,
      (
        select coalesce(jsonb_agg(t.raw_value order by t.raw_value), '[]'::jsonb)
        from (
          select et.raw_value from public.entity_tags et
          where et.entity_type = 'company' and et.entity_id = co.id
          order by et.raw_value limit 8
        ) t
      ) as tags
    from page_ids pid
    join public.companies co on co.id = pid.id
    left join metrics m on m.company_id = co.id
    left join refunds_agg ra on ra.company_id = co.id
    left join drafts_agg da on da.company_id = co.id
    left join public.staff_members sp on sp.id = co.salesperson_id
    left join public.staff_members cg on cg.id = co.cg_assigned_id
    left join public.staff_members rf on rf.id = co.referrer_id
    order by pid.ord
  )
  select
    c.total,
    coalesce((select jsonb_agg(to_jsonb(p) order by p.ord) from page p), '[]'::jsonb)
  into v_total, v_items
  from counted c;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$function$
;

grant execute on function public.rpc_list_admin_orders_v2(int, int, text, jsonb) to authenticated;
grant execute on function public.rpc_list_admin_drafts(int, int, text, jsonb) to authenticated;
grant execute on function public.rpc_list_admin_crm_customers(int, int, text, jsonb) to authenticated;
grant execute on function public.rpc_list_admin_crm_companies(int, int, text, jsonb) to authenticated;
