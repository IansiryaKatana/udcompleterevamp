-- Phase 2B: Draft order operations — schema, indexes, append-only events/notes, admin RPCs.
-- Additive only. Does not rewrite Shopify draft history.
-- Viewers cannot call admin RPCs (is_admin excludes viewer); mutate gates use is_admin() / can_mutate_drafts().

create extension if not exists pg_trgm;

-- ── draft_orders additive columns ────────────────────────────────────────────
alter table public.draft_orders
  add column if not exists cg_assigned_id uuid references public.staff_members(id) on delete set null,
  add column if not exists version int not null default 1,
  add column if not exists duplicated_from_draft_id uuid references public.draft_orders(id) on delete set null,
  add column if not exists created_by_staff_id uuid references public.staff_members(id) on delete set null,
  add column if not exists payment_terms text,
  add column if not exists discount_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists tax_snapshot jsonb not null default '{}'::jsonb;

comment on column public.draft_orders.version is
  'Optimistic concurrency counter; bumped on Unique commercial mutations.';
comment on column public.draft_orders.discount_snapshot is
  'Order-level discount snapshot {amount|value|value_type|title…}. Money is numeric text/json.';
comment on column public.draft_orders.tax_snapshot is
  'Server-computed VAT snapshot (prices VAT-exclusive; UK 20% unless tax_exempt).';
comment on column public.draft_orders.payment_terms is
  'Normalized free-text payment terms (Net 30, etc.).';

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists draft_orders_name_trgm_idx
  on public.draft_orders using gin (name gin_trgm_ops);
create index if not exists draft_orders_email_trgm_idx
  on public.draft_orders using gin (email gin_trgm_ops);
create index if not exists draft_orders_trading_name_trgm_idx
  on public.draft_orders using gin (trading_name_snapshot gin_trgm_ops);
create index if not exists draft_orders_po_number_trgm_idx
  on public.draft_orders using gin (po_number gin_trgm_ops);

create index if not exists draft_orders_status_idx
  on public.draft_orders (status);
create index if not exists draft_orders_source_system_idx
  on public.draft_orders (source_system)
  where source_system is not null;
create index if not exists draft_orders_payment_due_on_idx
  on public.draft_orders (payment_due_on)
  where payment_due_on is not null;
create index if not exists draft_orders_converted_order_id_idx
  on public.draft_orders (converted_order_id)
  where converted_order_id is not null;
create index if not exists draft_orders_cg_assigned_id_idx
  on public.draft_orders (cg_assigned_id)
  where cg_assigned_id is not null;
create index if not exists draft_orders_created_by_staff_id_idx
  on public.draft_orders (created_by_staff_id)
  where created_by_staff_id is not null;
create index if not exists draft_orders_duplicated_from_idx
  on public.draft_orders (duplicated_from_draft_id)
  where duplicated_from_draft_id is not null;

create index if not exists draft_orders_source_created_at_desc_idx
  on public.draft_orders (source_created_at desc nulls last);
create index if not exists draft_orders_updated_at_desc_idx
  on public.draft_orders (updated_at desc);
create index if not exists draft_orders_created_at_desc_idx
  on public.draft_orders (created_at desc);

create index if not exists draft_order_line_items_draft_sku_idx
  on public.draft_order_line_items (draft_order_id, sku_snapshot);
create index if not exists draft_order_line_items_title_trgm_idx
  on public.draft_order_line_items using gin (title gin_trgm_ops);
create index if not exists draft_order_line_items_sku_trgm_idx
  on public.draft_order_line_items using gin (sku_snapshot gin_trgm_ops);

-- ── draft_order_events (append-only) ─────────────────────────────────────────
create table if not exists public.draft_order_events (
  id uuid primary key default gen_random_uuid(),
  draft_order_id uuid not null references public.draft_orders(id) on delete restrict,
  event_type text not null,
  category text not null default 'system',
  source_system text,
  actor_type text,
  actor_id uuid,
  actor_name_snapshot text,
  message text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  external_event_id text,
  occurred_at timestamptz not null default now(),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  constraint draft_order_events_event_type_chk check (char_length(trim(event_type)) > 0),
  constraint draft_order_events_category_chk check (char_length(trim(category)) > 0)
);

comment on table public.draft_order_events is
  'Append-only draft timeline. UPDATE/DELETE blocked by trigger (mirrors order_events).';

create index if not exists draft_order_events_draft_occurred_idx
  on public.draft_order_events (draft_order_id, occurred_at);

create index if not exists draft_order_events_category_idx
  on public.draft_order_events (category);

create unique index if not exists draft_order_events_external_event_uidx
  on public.draft_order_events (source_system, external_event_id)
  where external_event_id is not null and source_system is not null;

create or replace function public.forbid_draft_order_events_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'draft_order_events is append-only; UPDATE/DELETE are not allowed'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_draft_order_events_no_update on public.draft_order_events;
create trigger trg_draft_order_events_no_update
  before update on public.draft_order_events
  for each row execute function public.forbid_draft_order_events_mutation();

drop trigger if exists trg_draft_order_events_no_delete on public.draft_order_events;
create trigger trg_draft_order_events_no_delete
  before delete on public.draft_order_events
  for each row execute function public.forbid_draft_order_events_mutation();

alter table public.draft_order_events enable row level security;

drop policy if exists "admin_select_draft_order_events" on public.draft_order_events;
create policy "admin_select_draft_order_events" on public.draft_order_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_draft_order_events" on public.draft_order_events;
create policy "admin_insert_draft_order_events" on public.draft_order_events
  for insert to authenticated with check (public.is_admin());

grant select, insert on public.draft_order_events to authenticated;
grant select, insert on public.draft_order_events to service_role;
revoke update, delete on public.draft_order_events from authenticated;
revoke update, delete on public.draft_order_events from anon;

-- ── draft_order_notes (append-only) ──────────────────────────────────────────
create table if not exists public.draft_order_notes (
  id uuid primary key default gen_random_uuid(),
  draft_order_id uuid not null references public.draft_orders(id) on delete restrict,
  body text not null,
  author_staff_id uuid references public.staff_members(id) on delete set null,
  author_name_snapshot text,
  source_system text not null default 'unique',
  created_at timestamptz not null default now(),
  constraint draft_order_notes_body_chk check (char_length(trim(body)) > 0)
);

comment on table public.draft_order_notes is
  'Append-only staff notes on drafts. No UPDATE/DELETE policies.';

create index if not exists draft_order_notes_draft_created_idx
  on public.draft_order_notes (draft_order_id, created_at);

alter table public.draft_order_notes enable row level security;

drop policy if exists "admin_select_draft_order_notes" on public.draft_order_notes;
create policy "admin_select_draft_order_notes" on public.draft_order_notes
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_draft_order_notes" on public.draft_order_notes;
create policy "admin_insert_draft_order_notes" on public.draft_order_notes
  for insert to authenticated with check (public.is_admin());

grant select, insert on public.draft_order_notes to authenticated;
grant select, insert on public.draft_order_notes to service_role;
revoke update, delete on public.draft_order_notes from authenticated;
revoke update, delete on public.draft_order_notes from anon;

-- ── Helpers ──────────────────────────────────────────────────────────────────
-- current_admin_staff_id / current_admin_display_name already defined in 050.

create or replace function public.can_mutate_drafts()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  -- Same gate as order ops: owner/admin/editor via is_admin(); viewers excluded.
  select public.is_admin();
$$;

comment on function public.can_mutate_drafts() is
  'True for owner/admin/editor. Viewers cannot mutate or call admin draft RPCs (is_admin gate).';

grant execute on function public.can_mutate_drafts() to authenticated;

create or replace function public.append_draft_event(
  p_draft_order_id uuid,
  p_event_type text,
  p_category text default 'system',
  p_message text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_system text default 'unique',
  p_actor_type text default null,
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_external_event_id text default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_actor_id uuid := coalesce(p_actor_id, public.current_admin_staff_id());
  v_actor_name text := coalesce(p_actor_name, public.current_admin_display_name());
  v_actor_type text := coalesce(p_actor_type, case when v_actor_id is not null then 'staff' else 'system' end);
begin
  insert into public.draft_order_events (
    draft_order_id, event_type, category, source_system,
    actor_type, actor_id, actor_name_snapshot,
    message, old_value, new_value, metadata,
    external_event_id, occurred_at
  ) values (
    p_draft_order_id, p_event_type, coalesce(nullif(btrim(p_category), ''), 'system'), p_source_system,
    v_actor_type, v_actor_id, v_actor_name,
    p_message, p_old_value, p_new_value, coalesce(p_metadata, '{}'::jsonb),
    p_external_event_id, coalesce(p_occurred_at, now())
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.append_draft_event(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text, uuid, text, text, timestamptz
) to authenticated;

-- Internal: shipping amount from shipping_line jsonb
create or replace function public.draft_shipping_amount(p_shipping_line jsonb)
returns numeric
language sql
immutable
security invoker
set search_path = public
as $$
  select round(coalesce(
    nullif(p_shipping_line->>'price', '')::numeric,
    nullif(p_shipping_line->>'amount', '')::numeric,
    nullif(p_shipping_line->>'discounted_price', '')::numeric,
    0
  ), 2);
$$;

-- Internal: order-level discount amount from discount_snapshot + merchandise subtotal
create or replace function public.draft_order_discount_amount(
  p_discount_snapshot jsonb,
  p_merchandise_subtotal numeric
)
returns numeric
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_amount numeric;
  v_value numeric;
  v_type text;
begin
  if p_discount_snapshot is null or p_discount_snapshot = '{}'::jsonb then
    return 0::numeric(14,2);
  end if;

  v_amount := nullif(p_discount_snapshot->>'amount', '')::numeric;
  if v_amount is not null then
    return round(greatest(v_amount, 0), 2);
  end if;

  v_value := coalesce(nullif(p_discount_snapshot->>'value', '')::numeric, 0);
  v_type := lower(coalesce(p_discount_snapshot->>'value_type', p_discount_snapshot->>'type', 'fixed'));

  if v_type in ('percentage', 'percent', 'percentage_discount') then
    return round(greatest(coalesce(p_merchandise_subtotal, 0) * v_value / 100.0, 0), 2);
  end if;

  return round(greatest(v_value, 0), 2);
end;
$$;

-- Recalculate Unique draft money columns from lines + shipping + discount + VAT 20%.
create or replace function public.recalc_unique_draft_totals(p_draft_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tax_exempt boolean;
  v_shipping numeric(14,2);
  v_discount_snap jsonb;
  v_subtotal numeric(14,2) := 0;
  v_line_discounts numeric(14,2) := 0;
  v_taxable numeric(14,2) := 0;
  v_order_discount numeric(14,2) := 0;
  v_taxable_after_disc numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_shipping_line jsonb;
begin
  select tax_exempt, shipping_line, discount_snapshot
  into v_tax_exempt, v_shipping_line, v_discount_snap
  from public.draft_orders
  where id = p_draft_id
  for update;

  if not found then
    return;
  end if;

  select
    coalesce(sum(coalesce(li.discounted_total, li.original_total)), 0),
    coalesce(sum(greatest(li.original_total - coalesce(li.discounted_total, li.original_total), 0)), 0),
    coalesce(sum(case when li.taxable then coalesce(li.discounted_total, li.original_total) else 0 end), 0)
  into v_subtotal, v_line_discounts, v_taxable
  from public.draft_order_line_items li
  where li.draft_order_id = p_draft_id;

  v_shipping := public.draft_shipping_amount(v_shipping_line);
  v_order_discount := public.draft_order_discount_amount(v_discount_snap, v_subtotal);
  if v_order_discount > v_subtotal then
    v_order_discount := v_subtotal;
  end if;

  -- Allocate order discount proportionally against taxable merchandise.
  if v_subtotal > 0 and v_taxable > 0 and v_order_discount > 0 then
    v_taxable_after_disc := round(greatest(v_taxable - (v_order_discount * v_taxable / v_subtotal), 0), 2);
  else
    v_taxable_after_disc := v_taxable;
  end if;

  if coalesce(v_tax_exempt, false) then
    v_tax := 0;
  else
    v_tax := round(v_taxable_after_disc * 0.20, 2);
  end if;

  v_total := round(v_subtotal - v_order_discount + v_shipping + v_tax, 2);

  update public.draft_orders
  set
    subtotal = v_subtotal,
    total_discounts = round(v_line_discounts + v_order_discount, 2),
    total_shipping = v_shipping,
    total_tax = v_tax,
    total_price = v_total,
    discount_snapshot = case
      when coalesce(v_discount_snap, '{}'::jsonb) = '{}'::jsonb then '{}'::jsonb
      else v_discount_snap || jsonb_build_object('amount', to_jsonb(v_order_discount))
    end,
    tax_snapshot = jsonb_build_object(
      'rate', 0.20,
      'prices_include_vat', false,
      'tax_exempt', coalesce(v_tax_exempt, false),
      'taxable_subtotal', v_taxable_after_disc,
      'total_tax', v_tax
    ),
    taxes_included = false,
    updated_at = now()
  where id = p_draft_id;
end;
$$;

create or replace function public.generate_unique_order_number()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_seq regclass;
  v_n bigint;
begin
  -- Prefer an existing sequence when present: 'UD' || nextval(...)
  v_seq := to_regclass('public.ud_order_number_seq');
  if v_seq is null then
    v_seq := to_regclass('public.orders_order_number_seq');
  end if;

  if v_seq is not null then
    execute format('select nextval(%L)', v_seq) into v_n;
    return 'UD' || v_n::text;
  end if;

  return 'UD-D-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
end;
$$;

-- Guard: Unique open draft only (Shopify history is read-only for commercial mutation)
create or replace function public.assert_unique_open_draft(
  p_draft_id uuid,
  p_expected_version int
)
returns public.draft_orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  o_draft public.draft_orders%rowtype;
begin
  select * into o_draft
  from public.draft_orders
  where id = p_draft_id
  for update;

  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if coalesce(o_draft.source_system, '') = 'shopify' then
    raise exception 'SHOPIFY_READONLY' using errcode = 'P0001';
  end if;

  if o_draft.status is distinct from 'open' then
    raise exception 'DRAFT_NOT_OPEN' using errcode = 'P0001';
  end if;

  if p_expected_version is not null and o_draft.version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;

  return o_draft;
end;
$$;

-- ── Facets ───────────────────────────────────────────────────────────────────
create or replace function public.rpc_admin_draft_filter_facets()
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
    'statuses', coalesce((
      select jsonb_agg(x order by x)
      from (select distinct status as x from public.draft_orders where status is not null) s
    ), '[]'::jsonb),
    'source_systems', coalesce((
      select jsonb_agg(x order by x)
      from (select distinct source_system as x from public.draft_orders where source_system is not null) s
    ), '[]'::jsonb),
    'customer_types', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct customer_type_snapshot as x
        from public.draft_orders
        where customer_type_snapshot is not null and btrim(customer_type_snapshot) <> ''
      ) s
    ), '[]'::jsonb),
    'payment_terms', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct payment_terms as x
        from public.draft_orders
        where payment_terms is not null and btrim(payment_terms) <> ''
      ) s
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', sm.id, 'name', sm.name) order by sm.name)
      from public.staff_members sm
      where sm.active = true
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_admin_draft_filter_facets() to authenticated;

-- ── List drafts ──────────────────────────────────────────────────────────────
create or replace function public.rpc_list_admin_drafts(
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

  with filtered as (
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
  )
  select count(*) into v_total from filtered;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by ord), '[]'::jsonb)
  into v_items
  from (
    select
      case coalesce(p_sort, 'date_desc')
        when 'date_asc' then row_number() over (order by coalesce(d.source_created_at, d.created_at) asc)
        when 'total_desc' then row_number() over (order by d.total_price desc)
        when 'total_asc' then row_number() over (order by d.total_price asc)
        when 'name_asc' then row_number() over (order by d.name asc nulls last)
        when 'updated_desc' then row_number() over (order by d.updated_at desc)
        else row_number() over (order by coalesce(d.source_created_at, d.created_at) desc)
      end as ord,
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
      coalesce(ord.source_order_number, ord.order_number) as converted_order_number,
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
    from filtered f
    join public.draft_orders d on d.id = f.id
    left join public.customers cu on cu.id = d.customer_id
    left join public.companies co on co.id = d.company_id
    left join public.staff_members sp on sp.id = d.salesperson_id
    left join public.staff_members cg on cg.id = d.cg_assigned_id
    left join public.staff_members rf on rf.id = d.referrer_id
    left join public.orders ord on ord.id = d.converted_order_id
    order by ord
    limit greatest(coalesce(p_limit, 25), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) row_data;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.rpc_list_admin_drafts(int, int, text, jsonb) to authenticated;

-- ── Workspace ────────────────────────────────────────────────────────────────
create or replace function public.rpc_get_admin_draft_workspace(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_draft public.draft_orders%rowtype;
  v_can_edit boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_draft from public.draft_orders where id = p_draft_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Draft not found');
  end if;

  -- Shopify historical drafts: commercial mutation locked; Unique (and non-shopify) open drafts editable.
  v_can_edit := (
    v_draft.status = 'open'
    and (
      coalesce(v_draft.source_system, '') = 'unique'
      or v_draft.source_system is distinct from 'shopify'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'draft', to_jsonb(v_draft),
    'can_edit', v_can_edit,
    'can_duplicate', true,
    'customer', (
      select to_jsonb(c) from public.customers c where c.id = v_draft.customer_id
    ),
    'company', (
      select to_jsonb(c) from public.companies c where c.id = v_draft.company_id
    ),
    'company_location', (
      select to_jsonb(l) from public.company_locations l where l.id = v_draft.company_location_id
    ),
    'salesperson', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_draft.salesperson_id
    ),
    'cg_assigned', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_draft.cg_assigned_id
    ),
    'referrer', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_draft.referrer_id
    ),
    'created_by', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_draft.created_by_staff_id
    ),
    'converted_order', (
      select jsonb_build_object(
        'id', o.id,
        'order_number', coalesce(o.source_order_number, o.order_number),
        'internal_order_number', o.order_number,
        'financial_status', o.financial_status,
        'commerce_fulfillment_status', o.commerce_fulfillment_status,
        'total', o.total,
        'currency', o.currency,
        'created_at', o.created_at
      )
      from public.orders o
      where o.id = v_draft.converted_order_id
    ),
    'line_summary', (
      select jsonb_build_object(
        'line_count', count(*)::int,
        'item_quantity', coalesce(sum(quantity), 0)::int
      )
      from public.draft_order_line_items
      where draft_order_id = p_draft_id
    ),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('raw_value', et.raw_value, 'tag_id', et.tag_id) order by et.raw_value)
      from public.entity_tags et
      where et.entity_type = 'draft_order' and et.entity_id = p_draft_id
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
      where m.owner_type = 'draft_order' and m.owner_id = p_draft_id
    ), '[]'::jsonb),
    'note_count', (
      select count(*)::int from public.draft_order_notes where draft_order_id = p_draft_id
    ),
    'event_count', (
      select count(*)::int from public.draft_order_events where draft_order_id = p_draft_id
    )
  );
end;
$$;

grant execute on function public.rpc_get_admin_draft_workspace(uuid) to authenticated;

-- ── Lines ────────────────────────────────────────────────────────────────────
create or replace function public.rpc_list_admin_draft_lines(
  p_draft_id uuid,
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
  from public.draft_order_line_items li
  where li.draft_order_id = p_draft_id
    and (
      v_q is null
      or li.title ilike '%' || v_q || '%'
      or li.sku_snapshot ilike '%' || v_q || '%'
      or li.variant_title ilike '%' || v_q || '%'
    );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order, x.created_at), '[]'::jsonb)
  into v_items
  from (
    select li.*
    from public.draft_order_line_items li
    where li.draft_order_id = p_draft_id
      and (
        v_q is null
        or li.title ilike '%' || v_q || '%'
        or li.sku_snapshot ilike '%' || v_q || '%'
        or li.variant_title ilike '%' || v_q || '%'
      )
    order by li.sort_order, li.created_at
    limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) x;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.rpc_list_admin_draft_lines(uuid, int, int, text) to authenticated;

-- ── Timeline (events + notes merged) ─────────────────────────────────────────
create or replace function public.rpc_list_admin_draft_timeline(
  p_draft_id uuid,
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
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with merged as (
    select
      e.id,
      'event'::text as kind,
      e.event_type,
      e.category,
      e.message,
      e.actor_type,
      e.actor_id,
      e.actor_name_snapshot,
      e.old_value,
      e.new_value,
      e.metadata,
      e.source_system,
      e.occurred_at as occurred_at,
      e.created_at,
      null::text as body
    from public.draft_order_events e
    where e.draft_order_id = p_draft_id
    union all
    select
      n.id,
      'note'::text as kind,
      'staff_note'::text as event_type,
      'note'::text as category,
      left(n.body, 500) as message,
      'staff'::text as actor_type,
      n.author_staff_id as actor_id,
      n.author_name_snapshot,
      null::jsonb as old_value,
      jsonb_build_object('note_id', n.id) as new_value,
      '{}'::jsonb as metadata,
      n.source_system,
      n.created_at as occurred_at,
      n.created_at,
      n.body
    from public.draft_order_notes n
    where n.draft_order_id = p_draft_id
  )
  select count(*) into v_total from merged;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.occurred_at desc, m.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select *
    from (
      select
        e.id,
        'event'::text as kind,
        e.event_type,
        e.category,
        e.message,
        e.actor_type,
        e.actor_id,
        e.actor_name_snapshot,
        e.old_value,
        e.new_value,
        e.metadata,
        e.source_system,
        e.occurred_at,
        e.created_at,
        null::text as body
      from public.draft_order_events e
      where e.draft_order_id = p_draft_id
      union all
      select
        n.id,
        'note'::text as kind,
        'staff_note'::text,
        'note'::text,
        left(n.body, 500),
        'staff'::text,
        n.author_staff_id,
        n.author_name_snapshot,
        null::jsonb,
        jsonb_build_object('note_id', n.id),
        '{}'::jsonb,
        n.source_system,
        n.created_at,
        n.created_at,
        n.body
      from public.draft_order_notes n
      where n.draft_order_id = p_draft_id
    ) u
    order by u.occurred_at desc, u.created_at desc
    limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) m;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.rpc_list_admin_draft_timeline(uuid, int, int) to authenticated;

-- ── Add note ─────────────────────────────────────────────────────────────────
create or replace function public.rpc_admin_add_draft_note(p_draft_id uuid, p_body text)
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
  if not exists (select 1 from public.draft_orders where id = p_draft_id) then
    return jsonb_build_object('ok', false, 'error', 'Draft not found');
  end if;

  insert into public.draft_order_notes (
    draft_order_id, body, author_staff_id, author_name_snapshot, source_system
  ) values (
    p_draft_id, v_body, v_staff, v_name, 'unique'
  )
  returning id into v_id;

  perform public.append_draft_event(
    p_draft_id,
    'staff_note_added',
    'note',
    left(v_body, 500),
    null,
    jsonb_build_object('note_id', v_id, 'body', v_body),
    '{}'::jsonb,
    'unique',
    'staff',
    v_staff,
    v_name
  );

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function public.rpc_admin_add_draft_note(uuid, text) to authenticated;

-- ── Customer / company picker ────────────────────────────────────────────────
create or replace function public.rpc_admin_search_customers_companies(
  p_search text default null,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'customers', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.rank)
      from (
        select
          cu.id,
          cu.display_name,
          cu.email,
          cu.phone,
          cu.trading_name,
          cu.customer_type,
          cu.company_name_snapshot,
          1 as rank
        from public.customers cu
        where v_q is null
          or cu.display_name ilike '%' || v_q || '%'
          or cu.email ilike '%' || v_q || '%'
          or cu.phone ilike '%' || v_q || '%'
          or cu.trading_name ilike '%' || v_q || '%'
          or (cu.first_name || ' ' || cu.last_name) ilike '%' || v_q || '%'
        order by
          case when v_q is not null and cu.email ilike v_q then 0 else 1 end,
          cu.display_name nulls last
        limit v_lim
      ) c
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.rank)
      from (
        select
          co.id,
          co.name,
          co.trading_name,
          co.customer_type,
          (
            select cl.email from public.company_locations cl
            where cl.company_id = co.id
            order by cl.is_primary desc, cl.created_at
            limit 1
          ) as email,
          (
            select cl.phone from public.company_locations cl
            where cl.company_id = co.id
            order by cl.is_primary desc, cl.created_at
            limit 1
          ) as phone,
          1 as rank
        from public.companies co
        where v_q is null
          or co.name ilike '%' || v_q || '%'
          or co.trading_name ilike '%' || v_q || '%'
          or exists (
            select 1 from public.company_locations cl
            where cl.company_id = co.id
              and (cl.email ilike '%' || v_q || '%' or cl.phone ilike '%' || v_q || '%')
          )
        order by co.name
        limit v_lim
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_admin_search_customers_companies(text, int) to authenticated;

-- ── Catalog variant picker ───────────────────────────────────────────────────
create or replace function public.rpc_admin_search_catalog_variants(
  p_search text default null,
  p_limit int default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_items jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_name, x.name), '[]'::jsonb)
  into v_items
  from (
    select
      pv.id,
      pv.product_id,
      pv.name,
      pv.sku,
      coalesce(pv.price, p.price) as price,
      pv.inventory_count,
      p.name as product_name,
      p.slug as product_slug,
      coalesce(pv.image_url, p.image_url) as image_url,
      coalesce(p.specs->>'barcode', p.specs->>'Barcode', '') as barcode
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where coalesce(pv.is_active, true) = true
      and (
        v_q is null
        or pv.name ilike '%' || v_q || '%'
        or pv.sku ilike '%' || v_q || '%'
        or p.name ilike '%' || v_q || '%'
        or p.slug ilike '%' || v_q || '%'
        or p.sku ilike '%' || v_q || '%'
        or coalesce(p.specs->>'barcode', '') ilike '%' || v_q || '%'
        or coalesce(p.specs->>'Barcode', '') ilike '%' || v_q || '%'
      )
    order by p.name, pv.sort_order, pv.name
    limit v_lim
  ) x;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

grant execute on function public.rpc_admin_search_catalog_variants(text, int) to authenticated;

-- ── Create Unique draft ──────────────────────────────────────────────────────
create or replace function public.rpc_admin_create_unique_draft(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_draft_name text;
begin
  if not public.can_mutate_drafts() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  v_draft_name := nullif(btrim(coalesce(v_payload->>'name', '')), '');
  if v_draft_name is null then
    v_draft_name := 'Draft ' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  end if;

  insert into public.draft_orders (
    name,
    status,
    email,
    phone,
    note,
    po_number,
    tax_exempt,
    currency,
    customer_id,
    company_id,
    company_location_id,
    salesperson_id,
    cg_assigned_id,
    referrer_id,
    trading_name_snapshot,
    customer_type_snapshot,
    payment_due_on,
    payment_terms,
    billing_address,
    shipping_address,
    shipping_line,
    custom_attributes,
    discount_snapshot,
    tax_snapshot,
    source_system,
    purchasing_entity_type,
    version,
    created_by_staff_id,
    source_created_at
  ) values (
    v_draft_name,
    'open',
    nullif(btrim(coalesce(v_payload->>'email', '')), ''),
    nullif(btrim(coalesce(v_payload->>'phone', '')), ''),
    nullif(v_payload->>'note', ''),
    nullif(btrim(coalesce(v_payload->>'po_number', '')), ''),
    coalesce((v_payload->>'tax_exempt')::boolean, false),
    coalesce(nullif(btrim(coalesce(v_payload->>'currency', '')), ''), 'GBP'),
    nullif(v_payload->>'customer_id', '')::uuid,
    nullif(v_payload->>'company_id', '')::uuid,
    nullif(v_payload->>'company_location_id', '')::uuid,
    nullif(v_payload->>'salesperson_id', '')::uuid,
    nullif(v_payload->>'cg_assigned_id', '')::uuid,
    nullif(v_payload->>'referrer_id', '')::uuid,
    nullif(btrim(coalesce(v_payload->>'trading_name_snapshot', '')), ''),
    nullif(btrim(coalesce(v_payload->>'customer_type_snapshot', '')), ''),
    nullif(v_payload->>'payment_due_on', '')::date,
    nullif(btrim(coalesce(v_payload->>'payment_terms', '')), ''),
    coalesce(v_payload->'billing_address', '{}'::jsonb),
    coalesce(v_payload->'shipping_address', '{}'::jsonb),
    v_payload->'shipping_line',
    coalesce(v_payload->'custom_attributes', '[]'::jsonb),
    coalesce(v_payload->'discount_snapshot', '{}'::jsonb),
    '{}'::jsonb,
    'unique',
    case
      when nullif(v_payload->>'company_id', '') is not null then 'PurchasingCompany'
      when nullif(v_payload->>'customer_id', '') is not null then 'Customer'
      else null
    end,
    1,
    v_staff,
    now()
  )
  returning id into v_id;

  perform public.append_draft_event(
    v_id,
    'draft_created',
    'lifecycle',
    'Unique draft created',
    null,
    jsonb_build_object('name', v_draft_name, 'source_system', 'unique'),
    '{}'::jsonb,
    'unique',
    'staff',
    v_staff,
    v_name
  );

  return jsonb_build_object('ok', true, 'draft_id', v_id, 'version', 1);
end;
$$;

grant execute on function public.rpc_admin_create_unique_draft(jsonb) to authenticated;

-- ── Update Unique draft header ───────────────────────────────────────────────
create or replace function public.rpc_admin_update_unique_draft(
  p_draft_id uuid,
  p_expected_version int,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.draft_orders%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_changes jsonb := '{}'::jsonb;
  v_new_version int;
begin
  if not public.can_mutate_drafts() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  begin
    v_old := public.assert_unique_open_draft(p_draft_id, p_expected_version);
  exception
    when others then
      if SQLERRM = 'DRAFT_NOT_FOUND' then
        return jsonb_build_object('ok', false, 'error', 'Draft not found');
      elsif SQLERRM = 'SHOPIFY_READONLY' then
        return jsonb_build_object('ok', false, 'error', 'Shopify drafts are read-only');
      elsif SQLERRM = 'DRAFT_NOT_OPEN' then
        return jsonb_build_object('ok', false, 'error', 'Draft is not open');
      elsif SQLERRM = 'VERSION_CONFLICT' then
        return jsonb_build_object(
          'ok', false,
          'error', 'conflict',
          'current_version', (select version from public.draft_orders where id = p_draft_id)
        );
      end if;
      raise;
  end;

  -- Apply allowed fields
  update public.draft_orders d
  set
    customer_id = case when v_payload ? 'customer_id' then nullif(v_payload->>'customer_id', '')::uuid else d.customer_id end,
    company_id = case when v_payload ? 'company_id' then nullif(v_payload->>'company_id', '')::uuid else d.company_id end,
    company_location_id = case when v_payload ? 'company_location_id' then nullif(v_payload->>'company_location_id', '')::uuid else d.company_location_id end,
    email = case when v_payload ? 'email' then nullif(btrim(coalesce(v_payload->>'email', '')), '') else d.email end,
    phone = case when v_payload ? 'phone' then nullif(btrim(coalesce(v_payload->>'phone', '')), '') else d.phone end,
    note = case when v_payload ? 'note' then v_payload->>'note' else d.note end,
    po_number = case when v_payload ? 'po_number' then nullif(btrim(coalesce(v_payload->>'po_number', '')), '') else d.po_number end,
    billing_address = case when v_payload ? 'billing_address' then coalesce(v_payload->'billing_address', '{}'::jsonb) else d.billing_address end,
    shipping_address = case when v_payload ? 'shipping_address' then coalesce(v_payload->'shipping_address', '{}'::jsonb) else d.shipping_address end,
    shipping_line = case when v_payload ? 'shipping_line' then v_payload->'shipping_line' else d.shipping_line end,
    salesperson_id = case when v_payload ? 'salesperson_id' then nullif(v_payload->>'salesperson_id', '')::uuid else d.salesperson_id end,
    cg_assigned_id = case when v_payload ? 'cg_assigned_id' then nullif(v_payload->>'cg_assigned_id', '')::uuid else d.cg_assigned_id end,
    referrer_id = case when v_payload ? 'referrer_id' then nullif(v_payload->>'referrer_id', '')::uuid else d.referrer_id end,
    trading_name_snapshot = case when v_payload ? 'trading_name_snapshot' then nullif(btrim(coalesce(v_payload->>'trading_name_snapshot', '')), '') else d.trading_name_snapshot end,
    customer_type_snapshot = case when v_payload ? 'customer_type_snapshot' then nullif(btrim(coalesce(v_payload->>'customer_type_snapshot', '')), '') else d.customer_type_snapshot end,
    payment_due_on = case when v_payload ? 'payment_due_on' then nullif(v_payload->>'payment_due_on', '')::date else d.payment_due_on end,
    payment_terms = case when v_payload ? 'payment_terms' then nullif(btrim(coalesce(v_payload->>'payment_terms', '')), '') else d.payment_terms end,
    tax_exempt = case when v_payload ? 'tax_exempt' then coalesce((v_payload->>'tax_exempt')::boolean, false) else d.tax_exempt end,
    discount_snapshot = case when v_payload ? 'discount_snapshot' then coalesce(v_payload->'discount_snapshot', '{}'::jsonb) else d.discount_snapshot end,
    custom_attributes = case when v_payload ? 'custom_attributes' then coalesce(v_payload->'custom_attributes', '[]'::jsonb) else d.custom_attributes end,
    version = d.version + 1,
    updated_at = now()
  where d.id = p_draft_id;

  -- Keep purchasing entity in sync when customer/company change
  if v_payload ? 'company_id' or v_payload ? 'customer_id' then
    update public.draft_orders d
    set purchasing_entity_type = case
      when d.company_id is not null then 'PurchasingCompany'
      when d.customer_id is not null then 'Customer'
      else null
    end
    where d.id = p_draft_id;
  end if;

  -- Build change set for audit (selected commercial fields)
  select jsonb_strip_nulls(jsonb_build_object(
    'customer_id', case when v_payload ? 'customer_id' and nullif(v_payload->>'customer_id','')::uuid is distinct from v_old.customer_id
      then jsonb_build_object('old', v_old.customer_id, 'new', nullif(v_payload->>'customer_id','')::uuid) end,
    'company_id', case when v_payload ? 'company_id' and nullif(v_payload->>'company_id','')::uuid is distinct from v_old.company_id
      then jsonb_build_object('old', v_old.company_id, 'new', nullif(v_payload->>'company_id','')::uuid) end,
    'email', case when v_payload ? 'email' and nullif(btrim(coalesce(v_payload->>'email','')),'') is distinct from v_old.email
      then jsonb_build_object('old', v_old.email, 'new', nullif(btrim(coalesce(v_payload->>'email','')),'')) end,
    'phone', case when v_payload ? 'phone' and nullif(btrim(coalesce(v_payload->>'phone','')),'') is distinct from v_old.phone
      then jsonb_build_object('old', v_old.phone, 'new', nullif(btrim(coalesce(v_payload->>'phone','')),'')) end,
    'note', case when v_payload ? 'note' and (v_payload->>'note') is distinct from v_old.note
      then jsonb_build_object('old', v_old.note, 'new', v_payload->>'note') end,
    'po_number', case when v_payload ? 'po_number' and nullif(btrim(coalesce(v_payload->>'po_number','')),'') is distinct from v_old.po_number
      then jsonb_build_object('old', v_old.po_number, 'new', nullif(btrim(coalesce(v_payload->>'po_number','')),'')) end,
    'salesperson_id', case when v_payload ? 'salesperson_id' and nullif(v_payload->>'salesperson_id','')::uuid is distinct from v_old.salesperson_id
      then jsonb_build_object('old', v_old.salesperson_id, 'new', nullif(v_payload->>'salesperson_id','')::uuid) end,
    'cg_assigned_id', case when v_payload ? 'cg_assigned_id' and nullif(v_payload->>'cg_assigned_id','')::uuid is distinct from v_old.cg_assigned_id
      then jsonb_build_object('old', v_old.cg_assigned_id, 'new', nullif(v_payload->>'cg_assigned_id','')::uuid) end,
    'referrer_id', case when v_payload ? 'referrer_id' and nullif(v_payload->>'referrer_id','')::uuid is distinct from v_old.referrer_id
      then jsonb_build_object('old', v_old.referrer_id, 'new', nullif(v_payload->>'referrer_id','')::uuid) end,
    'payment_due_on', case when v_payload ? 'payment_due_on' and nullif(v_payload->>'payment_due_on','')::date is distinct from v_old.payment_due_on
      then jsonb_build_object('old', v_old.payment_due_on, 'new', nullif(v_payload->>'payment_due_on','')::date) end,
    'payment_terms', case when v_payload ? 'payment_terms' and nullif(btrim(coalesce(v_payload->>'payment_terms','')),'') is distinct from v_old.payment_terms
      then jsonb_build_object('old', v_old.payment_terms, 'new', nullif(btrim(coalesce(v_payload->>'payment_terms','')),'')) end,
    'tax_exempt', case when v_payload ? 'tax_exempt' and coalesce((v_payload->>'tax_exempt')::boolean, false) is distinct from v_old.tax_exempt
      then jsonb_build_object('old', v_old.tax_exempt, 'new', coalesce((v_payload->>'tax_exempt')::boolean, false)) end,
    'discount_snapshot', case when v_payload ? 'discount_snapshot' and coalesce(v_payload->'discount_snapshot','{}'::jsonb) is distinct from v_old.discount_snapshot
      then jsonb_build_object('old', v_old.discount_snapshot, 'new', coalesce(v_payload->'discount_snapshot','{}'::jsonb)) end,
    'shipping_line', case when v_payload ? 'shipping_line' and (v_payload->'shipping_line') is distinct from v_old.shipping_line
      then jsonb_build_object('old', v_old.shipping_line, 'new', v_payload->'shipping_line') end
  )) into v_changes;

  perform public.recalc_unique_draft_totals(p_draft_id);

  select version into v_new_version from public.draft_orders where id = p_draft_id;

  if v_changes is not null and v_changes <> '{}'::jsonb then
    perform public.append_draft_event(
      p_draft_id,
      'draft_updated',
      'ops',
      'Draft commercial fields updated',
      jsonb_build_object('before', v_changes),
      jsonb_build_object('after', v_changes, 'version', v_new_version),
      '{}'::jsonb,
      'unique',
      'staff',
      v_staff,
      v_name
    );
  else
    perform public.append_draft_event(
      p_draft_id,
      'draft_totals_recalculated',
      'ops',
      'Draft totals recalculated',
      null,
      jsonb_build_object('version', v_new_version),
      '{}'::jsonb,
      'unique',
      'staff',
      v_staff,
      v_name
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'draft_id', p_draft_id,
    'version', v_new_version,
    'changes', coalesce(v_changes, '{}'::jsonb),
    'totals', (
      select jsonb_build_object(
        'subtotal', subtotal,
        'total_discounts', total_discounts,
        'total_shipping', total_shipping,
        'total_tax', total_tax,
        'total_price', total_price,
        'tax_snapshot', tax_snapshot,
        'discount_snapshot', discount_snapshot
      )
      from public.draft_orders where id = p_draft_id
    )
  );
end;
$$;

grant execute on function public.rpc_admin_update_unique_draft(uuid, int, jsonb) to authenticated;

-- ── Replace lines ────────────────────────────────────────────────────────────
create or replace function public.rpc_admin_replace_unique_draft_lines(
  p_draft_id uuid,
  p_expected_version int,
  p_lines jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.draft_orders%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_line jsonb;
  v_idx int := 0;
  v_qty int;
  v_orig_unit numeric(14,2);
  v_disc_unit numeric(14,2);
  v_orig_total numeric(14,2);
  v_disc_total numeric(14,2);
  v_title text;
  v_new_version int;
  v_line_count int := 0;
begin
  if not public.can_mutate_drafts() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'p_lines must be a JSON array');
  end if;

  begin
    v_old := public.assert_unique_open_draft(p_draft_id, p_expected_version);
  exception
    when others then
      if SQLERRM = 'DRAFT_NOT_FOUND' then
        return jsonb_build_object('ok', false, 'error', 'Draft not found');
      elsif SQLERRM = 'SHOPIFY_READONLY' then
        return jsonb_build_object('ok', false, 'error', 'Shopify drafts are read-only');
      elsif SQLERRM = 'DRAFT_NOT_OPEN' then
        return jsonb_build_object('ok', false, 'error', 'Draft is not open');
      elsif SQLERRM = 'VERSION_CONFLICT' then
        return jsonb_build_object(
          'ok', false,
          'error', 'conflict',
          'current_version', (select version from public.draft_orders where id = p_draft_id)
        );
      end if;
      raise;
  end;

  delete from public.draft_order_line_items where draft_order_id = p_draft_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_title := nullif(btrim(coalesce(v_line->>'title', '')), '');
    if v_title is null then
      return jsonb_build_object('ok', false, 'error', 'Each line requires a title');
    end if;

    v_qty := greatest(coalesce((v_line->>'quantity')::int, 1), 1);
    v_orig_unit := round(coalesce(nullif(v_line->>'original_unit_price', '')::numeric, 0), 2);
    v_disc_unit := round(coalesce(
      nullif(v_line->>'discounted_unit_price', '')::numeric,
      v_orig_unit
    ), 2);
    v_orig_total := round(v_orig_unit * v_qty, 2);
    v_disc_total := round(v_disc_unit * v_qty, 2);

    insert into public.draft_order_line_items (
      draft_order_id,
      product_id,
      variant_id,
      title,
      variant_title,
      sku_snapshot,
      quantity,
      original_unit_price,
      discounted_unit_price,
      original_total,
      discounted_total,
      taxable,
      custom_attributes,
      tax_lines,
      sort_order,
      deleted_product
    ) values (
      p_draft_id,
      nullif(v_line->>'product_id', '')::uuid,
      nullif(v_line->>'variant_id', '')::uuid,
      v_title,
      nullif(btrim(coalesce(v_line->>'variant_title', '')), ''),
      nullif(btrim(coalesce(v_line->>'sku_snapshot', v_line->>'sku', '')), ''),
      v_qty,
      v_orig_unit,
      v_disc_unit,
      v_orig_total,
      v_disc_total,
      coalesce((v_line->>'taxable')::boolean, true),
      coalesce(v_line->'custom_attributes', '[]'::jsonb),
      coalesce(v_line->'tax_lines', '[]'::jsonb),
      v_idx,
      coalesce((v_line->>'deleted_product')::boolean, false)
    );

    v_idx := v_idx + 1;
    v_line_count := v_line_count + 1;
  end loop;

  update public.draft_orders
  set version = version + 1, updated_at = now()
  where id = p_draft_id;

  perform public.recalc_unique_draft_totals(p_draft_id);

  select version into v_new_version from public.draft_orders where id = p_draft_id;

  perform public.append_draft_event(
    p_draft_id,
    'draft_lines_replaced',
    'ops',
    'Draft line items replaced',
    jsonb_build_object('previous_version', v_old.version),
    jsonb_build_object('line_count', v_line_count, 'version', v_new_version),
    '{}'::jsonb,
    'unique',
    'staff',
    v_staff,
    v_name
  );

  return jsonb_build_object(
    'ok', true,
    'draft_id', p_draft_id,
    'version', v_new_version,
    'line_count', v_line_count,
    'totals', (
      select jsonb_build_object(
        'subtotal', subtotal,
        'total_discounts', total_discounts,
        'total_shipping', total_shipping,
        'total_tax', total_tax,
        'total_price', total_price
      )
      from public.draft_orders where id = p_draft_id
    )
  );
end;
$$;

grant execute on function public.rpc_admin_replace_unique_draft_lines(uuid, int, jsonb) to authenticated;

-- ── Duplicate as Unique ──────────────────────────────────────────────────────
create or replace function public.rpc_admin_duplicate_draft_as_unique(p_source_draft_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_src public.draft_orders%rowtype;
  v_new_id uuid;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_new_name text;
begin
  if not public.can_mutate_drafts() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_src from public.draft_orders where id = p_source_draft_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Draft not found');
  end if;

  v_new_name := 'Copy of ' || coalesce(nullif(btrim(v_src.name), ''), 'Draft');

  insert into public.draft_orders (
    name, status, email, phone, note, po_number,
    tax_exempt, taxes_included, currency, ready,
    subtotal, total_tax, total_shipping, total_discounts, total_price,
    purchasing_entity_type, customer_id, company_id, company_location_id,
    salesperson_id, cg_assigned_id, referrer_id,
    trading_name_snapshot, customer_type_snapshot,
    payment_due_on, payment_terms,
    billing_address, shipping_address, custom_attributes, shipping_line,
    discount_snapshot, tax_snapshot,
    source_system, version, duplicated_from_draft_id, created_by_staff_id,
    source_created_at
  ) values (
    v_new_name, 'open', v_src.email, v_src.phone, v_src.note, v_src.po_number,
    v_src.tax_exempt, false, coalesce(v_src.currency, 'GBP'), false,
    v_src.subtotal, v_src.total_tax, v_src.total_shipping, v_src.total_discounts, v_src.total_price,
    v_src.purchasing_entity_type, v_src.customer_id, v_src.company_id, v_src.company_location_id,
    v_src.salesperson_id, v_src.cg_assigned_id, v_src.referrer_id,
    v_src.trading_name_snapshot, v_src.customer_type_snapshot,
    v_src.payment_due_on, v_src.payment_terms,
    coalesce(v_src.billing_address, '{}'::jsonb),
    coalesce(v_src.shipping_address, '{}'::jsonb),
    coalesce(v_src.custom_attributes, '[]'::jsonb),
    v_src.shipping_line,
    coalesce(v_src.discount_snapshot, '{}'::jsonb),
    coalesce(v_src.tax_snapshot, '{}'::jsonb),
    'unique', 1, v_src.id, v_staff,
    now()
  )
  returning id into v_new_id;

  insert into public.draft_order_line_items (
    draft_order_id, product_id, variant_id, title, variant_title, sku_snapshot, vendor_snapshot,
    quantity, original_unit_price, discounted_unit_price, original_total, discounted_total,
    taxable, requires_shipping, custom_attributes, tax_lines,
    product_shopify_gid, variant_shopify_gid, deleted_product, sort_order
  )
  select
    v_new_id, product_id, variant_id, title, variant_title, sku_snapshot, vendor_snapshot,
    quantity, original_unit_price, discounted_unit_price, original_total, discounted_total,
    taxable, requires_shipping, custom_attributes, tax_lines,
    product_shopify_gid, variant_shopify_gid, deleted_product, sort_order
  from public.draft_order_line_items
  where draft_order_id = p_source_draft_id
  order by sort_order, created_at;

  perform public.recalc_unique_draft_totals(v_new_id);

  perform public.append_draft_event(
    p_source_draft_id,
    'draft_duplicated',
    'lifecycle',
    'Draft duplicated as Unique draft',
    null,
    jsonb_build_object('new_draft_id', v_new_id),
    '{}'::jsonb,
    'unique',
    'staff',
    v_staff,
    v_name
  );

  perform public.append_draft_event(
    v_new_id,
    'draft_created_from_duplicate',
    'lifecycle',
    'Created by duplicating draft',
    null,
    jsonb_build_object('source_draft_id', p_source_draft_id, 'source_system', v_src.source_system),
    '{}'::jsonb,
    'unique',
    'staff',
    v_staff,
    v_name
  );

  return jsonb_build_object('ok', true, 'draft_id', v_new_id, 'version', 1, 'name', v_new_name);
end;
$$;

grant execute on function public.rpc_admin_duplicate_draft_as_unique(uuid) to authenticated;

-- ── Convert Unique draft → live order ────────────────────────────────────────
create or replace function public.rpc_admin_convert_unique_draft(
  p_draft_id uuid,
  p_expected_version int
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_draft public.draft_orders%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_order_id uuid;
  v_order_number text;
  v_email text;
  v_existing_number text;
  v_line record;
  v_unit numeric(14,2);
  v_line_total numeric(14,2);
  v_new_version int;
begin
  if not public.can_mutate_drafts() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_draft
  from public.draft_orders
  where id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Draft not found');
  end if;

  -- Idempotent: already converted
  if v_draft.converted_order_id is not null then
    select order_number into v_existing_number
    from public.orders where id = v_draft.converted_order_id;
    return jsonb_build_object(
      'ok', true,
      'order_id', v_draft.converted_order_id,
      'order_number', v_existing_number,
      'idempotent', true
    );
  end if;

  if coalesce(v_draft.source_system, '') <> 'unique' then
    return jsonb_build_object('ok', false, 'error', 'Only Unique drafts can be converted');
  end if;

  if v_draft.status is distinct from 'open' then
    return jsonb_build_object('ok', false, 'error', 'Draft is not open');
  end if;

  if p_expected_version is not null and v_draft.version is distinct from p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'current_version', v_draft.version
    );
  end if;

  perform public.recalc_unique_draft_totals(p_draft_id);
  select * into v_draft from public.draft_orders where id = p_draft_id;

  v_email := coalesce(
    nullif(btrim(v_draft.email), ''),
    (select nullif(btrim(email), '') from public.customers where id = v_draft.customer_id),
    (
      select nullif(btrim(cl.email), '')
      from public.company_locations cl
      where cl.company_id = v_draft.company_id
         or cl.id = v_draft.company_location_id
      order by (cl.id = v_draft.company_location_id) desc, cl.is_primary desc, cl.created_at
      limit 1
    ),
    'draft-converted@unique.local'
  );

  v_order_number := public.generate_unique_order_number();

  insert into public.orders (
    order_number,
    email,
    status,
    currency,
    subtotal,
    shipping_total,
    tax_total,
    discount_total,
    total,
    shipping_address,
    metadata,
    customer_id,
    company_id,
    company_location_id,
    financial_status,
    commerce_fulfillment_status,
    fulfillment_status,
    order_source,
    source_app,
    purchase_order_number,
    trading_name_snapshot,
    customer_type_snapshot,
    salesperson_id,
    cg_assigned_id,
    referrer_id,
    total_received,
    total_outstanding,
    taxes_included,
    payment_due_on,
    note,
    draft_order_id,
    source_created_at,
    processed_at
  ) values (
    v_order_number,
    v_email,
    'pending',
    coalesce(v_draft.currency, 'GBP'),
    v_draft.subtotal,
    v_draft.total_shipping,
    v_draft.total_tax,
    v_draft.total_discounts,
    v_draft.total_price,
    coalesce(v_draft.shipping_address, '{}'::jsonb),
    jsonb_build_object(
      'source_system', 'unique',
      'from_draft_id', p_draft_id,
      'payment_terms', v_draft.payment_terms,
      'discount_snapshot', v_draft.discount_snapshot,
      'tax_snapshot', v_draft.tax_snapshot,
      'billing_address', v_draft.billing_address
    ),
    v_draft.customer_id,
    v_draft.company_id,
    v_draft.company_location_id,
    'PENDING',
    'UNFULFILLED',
    'unfulfilled',
    'unique_draft',
    'Unique Draft',
    v_draft.po_number,
    v_draft.trading_name_snapshot,
    v_draft.customer_type_snapshot,
    v_draft.salesperson_id,
    v_draft.cg_assigned_id,
    v_draft.referrer_id,
    0,
    v_draft.total_price,
    false,
    v_draft.payment_due_on,
    v_draft.note,
    p_draft_id,
    now(),
    now()
  )
  returning id into v_order_id;

  for v_line in
    select * from public.draft_order_line_items
    where draft_order_id = p_draft_id
    order by sort_order, created_at
  loop
    v_unit := round(coalesce(v_line.discounted_unit_price, v_line.original_unit_price), 2);
    v_line_total := round(coalesce(v_line.discounted_total, v_line.original_total), 2);

    insert into public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      product_slug,
      image_url,
      unit_price,
      quantity,
      line_total,
      variant_name,
      sku_snapshot,
      variant_title_snapshot,
      vendor_snapshot,
      original_unit_price,
      discount_total,
      tax_total,
      taxable,
      properties,
      deleted_product,
      product_shopify_gid,
      variant_shopify_gid
    )
    select
      v_order_id,
      v_line.product_id,
      v_line.variant_id,
      v_line.title,
      p.slug,
      p.image_url,
      v_unit,
      v_line.quantity,
      v_line_total,
      v_line.variant_title,
      v_line.sku_snapshot,
      v_line.variant_title,
      v_line.vendor_snapshot,
      v_line.original_unit_price,
      round(greatest(v_line.original_total - coalesce(v_line.discounted_total, v_line.original_total), 0), 2),
      0,
      v_line.taxable,
      coalesce(v_line.custom_attributes, '[]'::jsonb),
      v_line.deleted_product,
      v_line.product_shopify_gid,
      v_line.variant_shopify_gid
    from (select 1) _
    left join public.products p on p.id = v_line.product_id;
  end loop;

  update public.draft_orders
  set
    converted_order_id = v_order_id,
    status = 'completed',
    completed_at = now(),
    version = version + 1,
    updated_at = now()
  where id = p_draft_id
  returning version into v_new_version;

  perform public.append_draft_event(
    p_draft_id,
    'draft_converted',
    'lifecycle',
    'Draft converted to order ' || v_order_number,
    jsonb_build_object('status', 'open'),
    jsonb_build_object(
      'status', 'completed',
      'order_id', v_order_id,
      'order_number', v_order_number,
      'version', v_new_version
    ),
    '{}'::jsonb,
    'unique',
    'staff',
    v_staff,
    v_name
  );

  insert into public.order_events (
    order_id, event_type, category, source_system,
    actor_type, actor_id, actor_name_snapshot,
    message, new_value, occurred_at
  ) values (
    v_order_id, 'order_created_from_draft', 'lifecycle', 'unique',
    'staff', v_staff, v_name,
    'Order created from Unique draft',
    jsonb_build_object('draft_order_id', p_draft_id, 'order_number', v_order_number),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'draft_version', v_new_version
  );
end;
$$;

grant execute on function public.rpc_admin_convert_unique_draft(uuid, int) to authenticated;
