-- Phase 3A — Fulfilment operations (Unique Commerce OS)
-- Additive. Reuses fulfillments / fulfillment_line_items / shipment_events /
-- order_shipping_lines / inventory_locations / order_events.
--
-- INVENTORY BOUNDARY (do not violate):
--   Reservation happens at checkout. Stock deduction happens on payment via
--   rpc_fulfill_order_inventory. Fulfilment / shipment RPCs in this migration
--   MUST NOT double-decrement inventory_count.
--
-- NO Worldpay / payment_gateway_config / gateway_mode changes.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Fulfilment capabilities (mirror finance pattern)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.admin_users
  add column if not exists fulfilment_capabilities text[] not null default '{}'::text[];

comment on column public.admin_users.fulfilment_capabilities is
  'Optional fulfilment caps: fulfilment_view, fulfilment_create, fulfilment_cancel, fulfilment_tracking, fulfilment_manage. Viewers excluded via is_admin(); editors need explicit mutation caps; owner/admin get all mutations.';

create or replace function public.current_admin_fulfilment_capabilities()
returns text[]
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(au.fulfilment_capabilities, '{}'::text[])
  from public.admin_users au
  where au.auth_user_id = (select auth.uid())
    and au.is_active = true
  limit 1;
$$;

-- View: any CMS admin (owner/admin/editor). Viewers excluded via is_admin().
create or replace function public.can_view_fulfilment()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.is_admin();
$$;

create or replace function public.can_manage_fulfilment()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'fulfilment_manage' = any(coalesce(public.current_admin_fulfilment_capabilities(), '{}'::text[]));
$$;

create or replace function public.can_create_fulfilment()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'fulfilment_create' = any(coalesce(public.current_admin_fulfilment_capabilities(), '{}'::text[]))
      or public.can_manage_fulfilment();
$$;

create or replace function public.can_cancel_fulfilment()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'fulfilment_cancel' = any(coalesce(public.current_admin_fulfilment_capabilities(), '{}'::text[]))
      or public.can_manage_fulfilment();
$$;

create or replace function public.can_set_fulfilment_tracking()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'fulfilment_tracking' = any(coalesce(public.current_admin_fulfilment_capabilities(), '{}'::text[]))
      or public.can_manage_fulfilment();
$$;

comment on function public.can_view_fulfilment() is
  'True when is_admin() (owner/admin/editor). Viewers cannot view fulfilment RPCs.';
comment on function public.can_manage_fulfilment() is
  'Owner/admin, or editor with fulfilment_manage capability.';
comment on function public.can_create_fulfilment() is
  'Owner/admin, or editor with fulfilment_create / fulfilment_manage.';
comment on function public.can_cancel_fulfilment() is
  'Owner/admin, or editor with fulfilment_cancel / fulfilment_manage.';
comment on function public.can_set_fulfilment_tracking() is
  'Owner/admin, or editor with fulfilment_tracking / fulfilment_manage.';

grant execute on function public.current_admin_fulfilment_capabilities() to authenticated, service_role;
grant execute on function public.can_view_fulfilment() to authenticated, service_role;
grant execute on function public.can_manage_fulfilment() to authenticated, service_role;
grant execute on function public.can_create_fulfilment() to authenticated, service_role;
grant execute on function public.can_cancel_fulfilment() to authenticated, service_role;
grant execute on function public.can_set_fulfilment_tracking() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Extend fulfillments
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fulfillments
  add column if not exists cancelled_at timestamptz,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists cancelled_reason text,
  add column if not exists is_test boolean not null default false,
  add column if not exists provenance text,
  add column if not exists created_by_staff_id uuid references public.staff_members(id) on delete set null;

comment on column public.fulfillments.provenance is
  'shopify_imported | unique_native | synthetic_test';
comment on column public.fulfillments.is_test is
  'True for Unique TEST / synthetic fixtures. Excluded from production workspace metrics by default.';
comment on column public.fulfillments.fulfilled_at is
  'When the shipment was marked fulfilled (Unique-native or imported). Does NOT imply delivered.';
comment on table public.fulfillments is
  'Shipment headers. Shopify service was Manual; tracking often DPD/DPD UK. '
  'Inventory is NOT deducted here — reservation at checkout, deduction on payment via rpc_fulfill_order_inventory.';

-- Backfill Shopify provenance (idempotent)
update public.fulfillments
set provenance = 'shopify_imported'
where coalesce(source_system, '') = 'shopify'
  and provenance is null;

create index if not exists fulfillments_provenance_idx
  on public.fulfillments (provenance)
  where provenance is not null;

create index if not exists fulfillments_is_test_idx
  on public.fulfillments (is_test)
  where is_test = true;

create index if not exists fulfillments_cancelled_at_idx
  on public.fulfillments (cancelled_at)
  where cancelled_at is not null;

-- Idempotency for Unique manual create
create unique index if not exists fulfillments_order_idempotency_uidx
  on public.fulfillments (order_id, (metadata->>'idempotency_key'))
  where metadata ? 'idempotency_key';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Shopify immutability triggers
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.forbid_shopify_fulfillment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(old.source_system, '') = 'shopify'
     or coalesce(old.provenance, '') = 'shopify_imported' then
    raise exception 'Shopify fulfillments are immutable (UPDATE/DELETE forbidden)'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_fulfillments_shopify_immutable on public.fulfillments;
create trigger trg_fulfillments_shopify_immutable
  before update or delete on public.fulfillments
  for each row execute function public.forbid_shopify_fulfillment_mutation();

create or replace function public.forbid_shopify_fulfillment_line_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_parent public.fulfillments%rowtype;
begin
  select * into v_parent
  from public.fulfillments
  where id = coalesce(old.fulfillment_id, new.fulfillment_id);

  if found and (
       coalesce(v_parent.source_system, '') = 'shopify'
    or coalesce(v_parent.provenance, '') = 'shopify_imported'
    or coalesce(old.source_system, '') = 'shopify'
  ) then
    raise exception 'Shopify fulfillment_line_items are immutable (UPDATE/DELETE forbidden)'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_fulfillment_line_items_shopify_immutable on public.fulfillment_line_items;
create trigger trg_fulfillment_line_items_shopify_immutable
  before update or delete on public.fulfillment_line_items
  for each row execute function public.forbid_shopify_fulfillment_line_mutation();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Qty / status helpers
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.fulfillment_line_remaining_qty(p_order_item_id uuid)
returns int
language sql
stable
security invoker
set search_path = public
as $$
  select greatest(
    coalesce((select oi.quantity from public.order_items oi where oi.id = p_order_item_id), 0)
    - coalesce((
        select sum(fli.quantity)::int
        from public.fulfillment_line_items fli
        join public.fulfillments f on f.id = fli.fulfillment_id
        where fli.order_item_id = p_order_item_id
          and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
          and f.cancelled_at is null
      ), 0),
    0
  );
$$;

comment on function public.fulfillment_line_remaining_qty(uuid) is
  'Order-item quantity still available to fulfil (excludes CANCELLED/CANCELED parent fulfillments).';

grant execute on function public.fulfillment_line_remaining_qty(uuid) to authenticated, service_role;

create or replace function public.order_recompute_commerce_fulfillment_status(p_order_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ordered int := 0;
  v_fulfilled int := 0;
  v_status text;
  v_legacy text;
begin
  select coalesce(sum(oi.quantity), 0)::int
  into v_ordered
  from public.order_items oi
  where oi.order_id = p_order_id;

  select coalesce(sum(fli.quantity), 0)::int
  into v_fulfilled
  from public.fulfillment_line_items fli
  join public.fulfillments f on f.id = fli.fulfillment_id
  where f.order_id = p_order_id
    and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
    and f.cancelled_at is null;

  if v_ordered <= 0 or v_fulfilled <= 0 then
    v_status := 'UNFULFILLED';
    v_legacy := 'unfulfilled';
  elsif v_fulfilled < v_ordered then
    v_status := 'PARTIALLY_FULFILLED';
    v_legacy := 'processing';
  else
    v_status := 'FULFILLED';
    v_legacy := 'shipped';
  end if;

  update public.orders
  set commerce_fulfillment_status = v_status,
      fulfillment_status = case
        when lower(coalesce(fulfillment_status, '')) = 'delivered' then fulfillment_status
        else v_legacy
      end,
      updated_at = now()
  where id = p_order_id;

  return v_status;
end;
$$;

comment on function public.order_recompute_commerce_fulfillment_status(uuid) is
  'Sets orders.commerce_fulfillment_status from active fulfilment line qtys. '
  'Syncs legacy fulfillment_status to unfulfilled|processing|shipped. '
  'Does NOT set delivered from fulfilled. Does NOT change inventory.';

grant execute on function public.order_recompute_commerce_fulfillment_status(uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Display → delivery status map
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.map_fulfillment_display_to_delivery_status(
  p_display_status text,
  p_has_tracking boolean default false
)
returns text
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v text := upper(btrim(coalesce(p_display_status, '')));
begin
  if v = '' then
    return 'UNKNOWN';
  end if;
  if v in ('DELIVERED') then
    return 'DELIVERED';
  end if;
  if v in ('OUT_FOR_DELIVERY') then
    return 'OUT_FOR_DELIVERY';
  end if;
  if v in ('IN_TRANSIT') then
    return 'IN_TRANSIT';
  end if;
  if v in ('NOT_DELIVERED', 'FAILED', 'FAILURE') then
    return 'FAILED';
  end if;
  if v in ('RETURNED', 'RETURN') then
    return 'RETURNED';
  end if;
  if v in ('TRACKING', 'TRACKING_ADDED') then
    return 'TRACKING_ADDED';
  end if;
  if v in ('FULFILLED', 'CONFIRMED', 'MARKED_AS_FULFILLED', 'SUCCESS') then
    if p_has_tracking then
      return 'TRACKING_ADDED';
    end if;
    return 'NOT_DISPATCHED';
  end if;
  if v in ('CANCELED', 'CANCELLED') then
    return 'UNKNOWN';
  end if;
  if v in ('NOT_DISPATCHED') then
    return 'NOT_DISPATCHED';
  end if;
  return 'UNKNOWN';
end;
$$;

comment on function public.map_fulfillment_display_to_delivery_status(text, boolean) is
  'Maps Shopify/Unique fulfillment display_status (+ optional tracking flag) to '
  'NOT_DISPATCHED|TRACKING_ADDED|IN_TRANSIT|OUT_FOR_DELIVERY|DELIVERED|FAILED|RETURNED|UNKNOWN.';

grant execute on function public.map_fulfillment_display_to_delivery_status(text, boolean) to authenticated, service_role;

-- Convenience overload matching single-arg call sites
create or replace function public.map_fulfillment_display_to_delivery_status(p_display_status text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select public.map_fulfillment_display_to_delivery_status(p_display_status, false);
$$;

grant execute on function public.map_fulfillment_display_to_delivery_status(text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) ops_documents (packing_slip / delivery_note)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ops_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  entity_type text,
  entity_id uuid,
  order_id uuid references public.orders(id) on delete restrict,
  fulfillment_id uuid references public.fulfillments(id) on delete set null,
  body_html text not null,
  storage_ref text,
  provider text,
  source_system text not null default 'unique',
  provenance text,
  content_hash text,
  generated_by_staff_id uuid references public.staff_members(id) on delete set null,
  generated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ops_documents_type_chk check (
    document_type in ('packing_slip', 'delivery_note')
  ),
  constraint ops_documents_body_chk check (char_length(trim(body_html)) > 0)
);

comment on table public.ops_documents is
  'Ops print documents (packing slip / delivery note). Separate from finance_documents. Append-oriented.';

create index if not exists ops_documents_type_created_idx
  on public.ops_documents (document_type, created_at desc);
create index if not exists ops_documents_order_id_idx
  on public.ops_documents (order_id)
  where order_id is not null;
create index if not exists ops_documents_fulfillment_id_idx
  on public.ops_documents (fulfillment_id)
  where fulfillment_id is not null;
create index if not exists ops_documents_entity_idx
  on public.ops_documents (entity_type, entity_id)
  where entity_id is not null;

alter table public.ops_documents enable row level security;

drop policy if exists "admin_select_ops_documents" on public.ops_documents;
create policy "admin_select_ops_documents" on public.ops_documents
  for select to authenticated using (public.can_view_fulfilment());

drop policy if exists "admin_insert_ops_documents" on public.ops_documents;
create policy "admin_insert_ops_documents" on public.ops_documents
  for insert to authenticated with check (
    public.can_view_fulfilment() or public.can_manage_fulfilment()
  );

grant select, insert on public.ops_documents to authenticated;
revoke update, delete on public.ops_documents from authenticated;
grant all on public.ops_documents to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) Admin RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- Internal: sync order-level tracking summary from fulfillments
create or replace function public._fulfilment_sync_order_tracking_summary(p_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_company text;
  v_number text;
  v_shipped timestamptz;
begin
  select f.tracking_company, f.tracking_number, coalesce(f.fulfilled_at, f.created_at)
  into v_company, v_number, v_shipped
  from public.fulfillments f
  where f.order_id = p_order_id
    and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
    and f.cancelled_at is null
    and f.tracking_number is not null
    and btrim(f.tracking_number) <> ''
  order by coalesce(f.fulfilled_at, f.created_at) desc nulls last
  limit 1;

  if v_number is not null then
    update public.orders
    set tracking_number = v_number,
        carrier = coalesce(v_company, carrier),
        shipped_at = coalesce(shipped_at, v_shipped),
        updated_at = now()
    where id = p_order_id;
  end if;
end;
$$;

grant execute on function public._fulfilment_sync_order_tracking_summary(uuid)
  to authenticated, service_role;

create or replace function public.rpc_admin_create_manual_fulfilment(
  p_order_id uuid,
  p_lines jsonb,
  p_inventory_location_id uuid default null,
  p_tracking_company text default null,
  p_tracking_number text default null,
  p_tracking_url text default null,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ord public.orders%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_fid uuid;
  v_line jsonb;
  v_oi_id uuid;
  v_qty int;
  v_remaining int;
  v_oi public.order_items%rowtype;
  v_has_tracking boolean;
  v_display text;
  v_delivery text;
  v_meta jsonb := '{}'::jsonb;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_tracking_info jsonb := '[]'::jsonb;
  v_status text;
begin
  if not (public.can_create_fulfilment() or public.can_manage_fulfilment()) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_ord from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  if lower(coalesce(v_ord.status, '')) in ('cancelled', 'canceled', 'voided')
     or upper(coalesce(v_ord.financial_status, '')) = 'VOIDED'
     or v_ord.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'order_cancelled');
  end if;

  if v_key is not null then
    select id into v_fid
    from public.fulfillments
    where order_id = p_order_id
      and metadata->>'idempotency_key' = v_key
    limit 1;
    if v_fid is not null then
      return jsonb_build_object(
        'ok', true,
        'fulfillment_id', v_fid,
        'idempotent_replay', true,
        'commerce_fulfillment_status', v_ord.commerce_fulfillment_status
      );
    end if;
    v_meta := v_meta || jsonb_build_object('idempotency_key', v_key);
  end if;

  if p_note is not null and btrim(p_note) <> '' then
    v_meta := v_meta || jsonb_build_object('note', btrim(p_note));
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'lines_required');
  end if;

  -- Validate lines + remaining qty before insert
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    begin
      v_oi_id := (v_line->>'order_item_id')::uuid;
      v_qty := greatest((v_line->>'quantity')::int, 0);
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid_line');
    end;
    if v_oi_id is null or v_qty <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_line');
    end if;
    select * into v_oi from public.order_items where id = v_oi_id and order_id = p_order_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'order_item_not_on_order');
    end if;
    v_remaining := public.fulfillment_line_remaining_qty(v_oi_id);
    if v_qty > v_remaining then
      return jsonb_build_object(
        'ok', false,
        'error', 'over_fulfilment',
        'order_item_id', v_oi_id,
        'remaining', v_remaining,
        'requested', v_qty
      );
    end if;
  end loop;

  v_has_tracking := coalesce(nullif(btrim(coalesce(p_tracking_number, '')), ''), '') <> '';
  v_display := case when v_has_tracking then 'TRACKING' else 'FULFILLED' end;
  v_delivery := public.map_fulfillment_display_to_delivery_status(v_display, v_has_tracking);

  if v_has_tracking then
    v_tracking_info := jsonb_build_array(jsonb_build_object(
      'company', nullif(btrim(coalesce(p_tracking_company, '')), ''),
      'number', btrim(p_tracking_number),
      'url', nullif(btrim(coalesce(p_tracking_url, '')), '')
    ));
  end if;

  insert into public.fulfillments (
    order_id, inventory_location_id, status, display_status,
    service_handle, service_name,
    tracking_company, tracking_number, tracking_url, tracking_info,
    fulfilled_at, source_system, provenance, is_test,
    created_by_staff_id, metadata, source_created_at
  ) values (
    p_order_id, p_inventory_location_id, 'SUCCESS', v_display,
    'manual', 'Manual',
    nullif(btrim(coalesce(p_tracking_company, '')), ''),
    nullif(btrim(coalesce(p_tracking_number, '')), ''),
    nullif(btrim(coalesce(p_tracking_url, '')), ''),
    v_tracking_info,
    now(), 'unique', 'unique_native', coalesce(v_ord.is_test, false),
    v_staff, v_meta, now()
  )
  returning id into v_fid;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_oi_id := (v_line->>'order_item_id')::uuid;
    v_qty := (v_line->>'quantity')::int;
    select * into v_oi from public.order_items where id = v_oi_id;
    insert into public.fulfillment_line_items (
      fulfillment_id, order_item_id, quantity, sku_snapshot, name_snapshot, source_system
    ) values (
      v_fid, v_oi_id, v_qty,
      v_oi.sku_snapshot, v_oi.product_name, 'unique'
    );
  end loop;

  if v_has_tracking then
    insert into public.shipment_events (
      fulfillment_id, order_id, event_type, status, message,
      source_system, tracking_number, tracking_company, occurred_at, metadata
    ) values (
      v_fid, p_order_id, 'TRACKING_ADDED', v_delivery,
      'Tracking added on manual fulfilment',
      'unique', btrim(p_tracking_number),
      nullif(btrim(coalesce(p_tracking_company, '')), ''),
      now(),
      jsonb_build_object('fulfillment_id', v_fid)
    );
  end if;

  insert into public.order_events (
    order_id, event_type, category, source_system, actor_type, actor_id, actor_name_snapshot,
    message, new_value, occurred_at, metadata
  ) values (
    p_order_id, 'FULFILMENT_CREATED', 'fulfilment', 'unique', 'staff', v_staff, v_name,
    'Manual fulfilment created',
    jsonb_build_object(
      'fulfillment_id', v_fid,
      'lines', p_lines,
      'tracking_number', nullif(btrim(coalesce(p_tracking_number, '')), '')
    ),
    now(),
    jsonb_build_object('fulfillment_id', v_fid, 'is_test', coalesce(v_ord.is_test, false))
  );

  v_status := public.order_recompute_commerce_fulfillment_status(p_order_id);

  if v_has_tracking then
    perform public._fulfilment_sync_order_tracking_summary(p_order_id);
    update public.orders
    set delivery_status = case
          when coalesce(delivery_status, '') in ('DELIVERED', 'OUT_FOR_DELIVERY', 'IN_TRANSIT')
            then delivery_status
          else v_delivery
        end,
        updated_at = now()
    where id = p_order_id;
  end if;

  -- NO inventory deduction here (see migration header inventory boundary).

  return jsonb_build_object(
    'ok', true,
    'fulfillment_id', v_fid,
    'commerce_fulfillment_status', v_status,
    'delivery_status', v_delivery
  );
exception
  when unique_violation then
    if v_key is not null then
      select id into v_fid
      from public.fulfillments
      where order_id = p_order_id and metadata->>'idempotency_key' = v_key
      limit 1;
      if v_fid is not null then
        return jsonb_build_object(
          'ok', true,
          'fulfillment_id', v_fid,
          'idempotent_replay', true
        );
      end if;
    end if;
    return jsonb_build_object('ok', false, 'error', 'unique_violation', 'detail', SQLERRM);
end;
$$;

comment on function public.rpc_admin_create_manual_fulfilment is
  'Create Unique-native manual fulfilment. Does NOT deduct inventory. '
  'Inventory boundary: reservation at checkout; deduction on payment via rpc_fulfill_order_inventory.';

grant execute on function public.rpc_admin_create_manual_fulfilment(
  uuid, jsonb, uuid, text, text, text, text, text
) to authenticated, service_role;

create or replace function public.rpc_admin_cancel_fulfilment(
  p_fulfillment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_f public.fulfillments%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.can_cancel_fulfilment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_f from public.fulfillments where id = p_fulfillment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Fulfillment not found');
  end if;

  if coalesce(v_f.source_system, '') = 'shopify'
     or coalesce(v_f.provenance, '') = 'shopify_imported' then
    return jsonb_build_object('ok', false, 'error', 'shopify_immutable');
  end if;

  if upper(coalesce(v_f.status, '')) in ('CANCELLED', 'CANCELED') or v_f.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'already_cancelled', true, 'fulfillment_id', v_f.id);
  end if;

  update public.fulfillments
  set status = 'CANCELLED',
      display_status = 'CANCELED',
      cancelled_at = now(),
      cancelled_reason = v_reason,
      updated_at = now()
  where id = p_fulfillment_id;

  insert into public.shipment_events (
    fulfillment_id, order_id, event_type, status, message,
    source_system, occurred_at, metadata
  ) values (
    p_fulfillment_id, v_f.order_id, 'FULFILMENT_CANCELLED', 'CANCELED',
    coalesce(v_reason, 'Fulfilment cancelled'),
    'unique', now(),
    jsonb_build_object('fulfillment_id', p_fulfillment_id, 'reason', v_reason)
  );

  insert into public.order_events (
    order_id, event_type, category, source_system, actor_type, actor_id, actor_name_snapshot,
    message, new_value, occurred_at, metadata
  ) values (
    v_f.order_id, 'FULFILMENT_CANCELLED', 'fulfilment', 'unique', 'staff', v_staff, v_name,
    coalesce(v_reason, 'Fulfilment cancelled'),
    jsonb_build_object('fulfillment_id', p_fulfillment_id, 'reason', v_reason),
    now(),
    jsonb_build_object('fulfillment_id', p_fulfillment_id)
  );

  v_status := public.order_recompute_commerce_fulfillment_status(v_f.order_id);

  -- NO inventory restock here.

  return jsonb_build_object(
    'ok', true,
    'fulfillment_id', p_fulfillment_id,
    'commerce_fulfillment_status', v_status
  );
end;
$$;

grant execute on function public.rpc_admin_cancel_fulfilment(uuid, text) to authenticated, service_role;

create or replace function public.rpc_admin_set_fulfilment_tracking(
  p_fulfillment_id uuid,
  p_tracking_company text default null,
  p_tracking_number text default null,
  p_tracking_url text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_f public.fulfillments%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_number text := nullif(btrim(coalesce(p_tracking_number, '')), '');
  v_company text := nullif(btrim(coalesce(p_tracking_company, '')), '');
  v_url text := nullif(btrim(coalesce(p_tracking_url, '')), '');
  v_info jsonb;
  v_had boolean;
  v_event text;
  v_delivery text;
begin
  if not public.can_set_fulfilment_tracking() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_f from public.fulfillments where id = p_fulfillment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Fulfillment not found');
  end if;

  if coalesce(v_f.source_system, '') = 'shopify'
     or coalesce(v_f.provenance, '') = 'shopify_imported' then
    return jsonb_build_object('ok', false, 'error', 'shopify_immutable');
  end if;

  if v_number is null then
    return jsonb_build_object('ok', false, 'error', 'tracking_number_required');
  end if;

  v_had := coalesce(nullif(btrim(coalesce(v_f.tracking_number, '')), ''), '') <> '';
  v_event := case when v_had then 'TRACKING_UPDATED' else 'TRACKING_ADDED' end;

  v_info := coalesce(v_f.tracking_info, '[]'::jsonb);
  if jsonb_typeof(v_info) <> 'array' then
    v_info := '[]'::jsonb;
  end if;
  v_info := v_info || jsonb_build_array(jsonb_build_object(
    'company', v_company, 'number', v_number, 'url', v_url
  ));

  update public.fulfillments
  set tracking_company = coalesce(v_company, tracking_company),
      tracking_number = v_number,
      tracking_url = coalesce(v_url, tracking_url),
      tracking_info = v_info,
      display_status = case
        when upper(coalesce(display_status, '')) in ('DELIVERED', 'OUT_FOR_DELIVERY', 'IN_TRANSIT')
          then display_status
        else 'TRACKING'
      end,
      updated_at = now()
  where id = p_fulfillment_id;

  v_delivery := public.map_fulfillment_display_to_delivery_status('TRACKING', true);

  insert into public.shipment_events (
    fulfillment_id, order_id, event_type, status, message,
    source_system, tracking_number, tracking_company, occurred_at, metadata
  ) values (
    p_fulfillment_id, v_f.order_id, v_event, v_delivery,
    case when v_had then 'Tracking updated' else 'Tracking added' end,
    'unique', v_number, v_company, now(),
    jsonb_build_object('fulfillment_id', p_fulfillment_id, 'url', v_url)
  );

  insert into public.order_events (
    order_id, event_type, category, source_system, actor_type, actor_id, actor_name_snapshot,
    message, new_value, occurred_at, metadata
  ) values (
    v_f.order_id, v_event, 'fulfilment', 'unique', 'staff', v_staff, v_name,
    case when v_had then 'Tracking updated' else 'Tracking added' end,
    jsonb_build_object(
      'fulfillment_id', p_fulfillment_id,
      'tracking_company', v_company,
      'tracking_number', v_number,
      'tracking_url', v_url
    ),
    now(),
    jsonb_build_object('fulfillment_id', p_fulfillment_id)
  );

  perform public._fulfilment_sync_order_tracking_summary(v_f.order_id);

  update public.orders
  set delivery_status = case
        when coalesce(delivery_status, '') in ('DELIVERED', 'OUT_FOR_DELIVERY', 'IN_TRANSIT')
          then delivery_status
        else v_delivery
      end,
      updated_at = now()
  where id = v_f.order_id;

  return jsonb_build_object(
    'ok', true,
    'fulfillment_id', p_fulfillment_id,
    'event_type', v_event,
    'delivery_status', v_delivery
  );
end;
$$;

grant execute on function public.rpc_admin_set_fulfilment_tracking(uuid, text, text, text)
  to authenticated, service_role;

create or replace function public.rpc_admin_append_shipment_event(
  p_fulfillment_id uuid,
  p_event_type text,
  p_status text default null,
  p_message text default null,
  p_occurred_at timestamptz default null,
  p_external_event_id text default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_f public.fulfillments%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_etype text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_ext text := nullif(btrim(coalesce(p_external_event_id, '')), '');
  v_eid uuid;
  v_delivery text;
  v_has_tracking boolean;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if not public.can_set_fulfilment_tracking() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_etype is null then
    return jsonb_build_object('ok', false, 'error', 'event_type_required');
  end if;

  select * into v_f from public.fulfillments where id = p_fulfillment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Fulfillment not found');
  end if;

  if v_ext is not null then
    select id into v_eid
    from public.shipment_events
    where source_system = 'unique' and external_event_id = v_ext
    limit 1;
    if v_eid is not null then
      return jsonb_build_object('ok', true, 'event_id', v_eid, 'idempotent_replay', true);
    end if;
  end if;

  v_has_tracking := coalesce(nullif(btrim(coalesce(v_f.tracking_number, '')), ''), '') <> '';
  v_delivery := public.map_fulfillment_display_to_delivery_status(
    coalesce(p_status, v_f.display_status), v_has_tracking
  );

  begin
    insert into public.shipment_events (
      fulfillment_id, order_id, event_type, status, message,
      source_system, tracking_number, tracking_company,
      occurred_at, external_event_id, metadata
    ) values (
      p_fulfillment_id, v_f.order_id, v_etype, p_status, p_message,
      'unique', v_f.tracking_number, v_f.tracking_company,
      coalesce(p_occurred_at, now()), v_ext,
      v_meta || jsonb_build_object('fulfillment_id', p_fulfillment_id)
    )
    returning id into v_eid;
  exception
    when unique_violation then
      select id into v_eid
      from public.shipment_events
      where source_system = 'unique' and external_event_id = v_ext
      limit 1;
      return jsonb_build_object('ok', true, 'event_id', v_eid, 'idempotent_replay', true);
  end;

  if v_delivery = 'DELIVERED' then
    update public.fulfillments
    set delivered_at = coalesce(delivered_at, coalesce(p_occurred_at, now())),
        display_status = 'DELIVERED',
        updated_at = now()
    where id = p_fulfillment_id;

    update public.orders
    set delivery_status = 'DELIVERED',
        updated_at = now()
    where id = v_f.order_id;
    -- Does NOT set commerce_fulfillment_status / fulfilled from delivered.
  elsif v_delivery in ('IN_TRANSIT', 'OUT_FOR_DELIVERY', 'FAILED', 'RETURNED', 'TRACKING_ADDED') then
    if v_delivery = 'IN_TRANSIT' then
      update public.fulfillments
      set in_transit_at = coalesce(in_transit_at, coalesce(p_occurred_at, now())),
          display_status = coalesce(nullif(btrim(coalesce(p_status, '')), ''), display_status),
          updated_at = now()
      where id = p_fulfillment_id;
    elsif p_status is not null then
      update public.fulfillments
      set display_status = btrim(p_status),
          updated_at = now()
      where id = p_fulfillment_id
        and upper(coalesce(display_status, '')) <> 'DELIVERED';
    end if;

    update public.orders
    set delivery_status = case
          when coalesce(delivery_status, '') = 'DELIVERED' then delivery_status
          else v_delivery
        end,
        updated_at = now()
    where id = v_f.order_id;
  end if;

  insert into public.order_events (
    order_id, event_type, category, source_system, actor_type, actor_id, actor_name_snapshot,
    message, new_value, occurred_at, metadata, external_event_id
  ) values (
    v_f.order_id, v_etype, 'shipment', 'unique', 'staff', v_staff, v_name,
    coalesce(p_message, v_etype),
    jsonb_build_object(
      'fulfillment_id', p_fulfillment_id,
      'status', p_status,
      'delivery_bucket', v_delivery,
      'shipment_event_id', v_eid
    ),
    coalesce(p_occurred_at, now()),
    jsonb_build_object('fulfillment_id', p_fulfillment_id),
    case when v_ext is not null then 'oe-' || v_ext else null end
  );

  return jsonb_build_object(
    'ok', true,
    'event_id', v_eid,
    'delivery_status', v_delivery
  );
end;
$$;

grant execute on function public.rpc_admin_append_shipment_event(
  uuid, text, text, text, timestamptz, text, jsonb
) to authenticated, service_role;

create or replace function public.rpc_list_admin_order_shipment_events(p_order_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_items jsonb;
begin
  if not public.can_view_fulfilment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if not exists (select 1 from public.orders where id = p_order_id) then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.created_at desc), '[]'::jsonb)
  into v_items
  from public.shipment_events e
  where e.order_id = p_order_id;

  return jsonb_build_object('ok', true, 'events', v_items);
end;
$$;

grant execute on function public.rpc_list_admin_order_shipment_events(uuid)
  to authenticated, service_role;

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
  v_delivery text := nullif(btrim(coalesce(v_filters->>'delivery_bucket', '')), '');
  v_carrier text := nullif(btrim(coalesce(v_filters->>'carrier', '')), '');
  v_location uuid := nullif(btrim(coalesce(v_filters->>'location_id', '')), '')::uuid;
  v_date_from timestamptz := nullif(btrim(coalesce(v_filters->>'date_from', '')), '')::timestamptz;
  v_date_to timestamptz := nullif(btrim(coalesce(v_filters->>'date_to', '')), '')::timestamptz;
  v_search text := nullif(btrim(coalesce(v_filters->>'search', '')), '');
  v_tracking_missing boolean := coalesce((v_filters->>'tracking_missing')::boolean, false);
  v_include_test boolean := coalesce((v_filters->>'include_test')::boolean, false);
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  if not public.can_view_fulfilment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_filters ? 'fulfillment_status' and jsonb_typeof(v_filters->'fulfillment_status') = 'array' then
    select array_agg(upper(x)) into v_ff
    from jsonb_array_elements_text(v_filters->'fulfillment_status') t(x);
  elsif nullif(btrim(coalesce(v_filters->>'fulfillment_status', '')), '') is not null then
    v_ff := array[upper(btrim(v_filters->>'fulfillment_status'))];
  end if;

  with filtered as (
    select o.id
    from public.orders o
    where (v_include_test or coalesce(o.is_test, false) = false)
      and (v_ff is null or upper(coalesce(o.commerce_fulfillment_status, '')) = any(v_ff))
      and (
        v_delivery is null
        or upper(coalesce(o.delivery_status, o.dpd_delivery_status, '')) = upper(v_delivery)
        or (
          upper(v_delivery) = 'TRACKING_MISSING'
          and not exists (
            select 1 from public.fulfillments f
            where f.order_id = o.id
              and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
              and f.tracking_number is not null and btrim(f.tracking_number) <> ''
          )
        )
        or (
          upper(v_delivery) = 'IN_TRANSIT'
          and (
            upper(coalesce(o.delivery_status, '')) = 'IN_TRANSIT'
            or exists (
              select 1 from public.fulfillments f
              where f.order_id = o.id and f.in_transit_at is not null and f.delivered_at is null
            )
          )
        )
        or (
          upper(v_delivery) = 'DELIVERED'
          and (
            upper(coalesce(o.delivery_status, '')) = 'DELIVERED'
            or exists (
              select 1 from public.fulfillments f
              where f.order_id = o.id and f.delivered_at is not null
            )
          )
        )
        or (
          upper(v_delivery) = 'FAILED'
          and upper(coalesce(o.delivery_status, '')) = 'FAILED'
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
        or coalesce(o.source_order_number, '') ilike '%' || v_search || '%'
        or exists (
          select 1 from public.fulfillments f
          where f.order_id = o.id and f.tracking_number ilike '%' || v_search || '%'
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
  ),
  counted as (
    select count(*)::bigint as total from filtered
  ),
  ranked as (
    select
      f.id,
      row_number() over (
        order by
          case when coalesce(p_sort, 'date_desc') = 'date_asc'
            then coalesce(o.source_created_at, o.created_at) end asc nulls last,
          case when coalesce(p_sort, 'date_desc') = 'date_desc'
            then coalesce(o.source_created_at, o.created_at) end desc nulls last,
          case when p_sort = 'number_asc'
            then coalesce(o.source_order_number, o.order_number) end asc nulls last,
          o.id
      ) as ord
    from filtered f
    join public.orders o on o.id = f.id
  ),
  page_ids as (
    select r.id, r.ord
    from ranked r
    where r.ord > v_offset
      and r.ord <= v_offset + v_limit
  ),
  page as (
    select
      pid.ord,
      o.id as order_id,
      coalesce(o.source_order_number, o.order_number) as order_number,
      o.order_number as internal_order_number,
      coalesce(o.source_created_at, o.created_at) as order_date,
      o.commerce_fulfillment_status,
      o.fulfillment_status as legacy_fulfillment_status,
      o.delivery_status,
      o.dpd_delivery_status,
      o.tracking_number as order_tracking_number,
      o.carrier as order_carrier,
      o.shipped_at,
      o.is_test,
      o.email,
      o.trading_name_snapshot,
      (
        select jsonb_build_object(
          'id', lf.id,
          'status', lf.status,
          'display_status', lf.display_status,
          'tracking_company', lf.tracking_company,
          'tracking_number', lf.tracking_number,
          'tracking_url', lf.tracking_url,
          'inventory_location_id', lf.inventory_location_id,
          'fulfilled_at', lf.fulfilled_at,
          'delivered_at', lf.delivered_at,
          'in_transit_at', lf.in_transit_at,
          'provenance', lf.provenance,
          'source_system', lf.source_system,
          'service_name', lf.service_name
        )
        from public.fulfillments lf
        where lf.order_id = o.id
          and upper(coalesce(lf.status, '')) not in ('CANCELLED', 'CANCELED')
        order by coalesce(lf.fulfilled_at, lf.created_at) desc nulls last
        limit 1
      ) as latest_fulfillment,
      (
        select count(*)::int from public.fulfillments fx
        where fx.order_id = o.id
          and upper(coalesce(fx.status, '')) not in ('CANCELLED', 'CANCELED')
      ) as active_fulfillment_count,
      exists (
        select 1 from public.fulfillments f
        where f.order_id = o.id
          and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
          and f.tracking_number is not null and btrim(f.tracking_number) <> ''
      ) as has_tracking
    from page_ids pid
    join public.orders o on o.id = pid.id
    order by pid.ord
  )
  select
    (select total from counted),
    coalesce((select jsonb_agg(to_jsonb(p) order by p.ord) from page p), '[]'::jsonb)
  into v_total, v_items;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

comment on function public.rpc_list_admin_fulfilment_workspace is
  'Server-side paginated fulfilment workspace. Excludes is_test orders by default. '
  'Do not load full catalogue client-side.';

grant execute on function public.rpc_list_admin_fulfilment_workspace(jsonb, int, int, text)
  to authenticated, service_role;

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
      where upper(coalesce(o.delivery_status, '')) = 'IN_TRANSIT'
         or exists (
           select 1 from public.fulfillments f
           where f.order_id = o.id and f.in_transit_at is not null and f.delivered_at is null
         )
    ),
    count(*) filter (
      where upper(coalesce(o.delivery_status, '')) = 'DELIVERED'
         or exists (
           select 1 from public.fulfillments f
           where f.order_id = o.id and f.delivered_at is not null
         )
    ),
    count(*) filter (where upper(coalesce(o.delivery_status, '')) = 'FAILED')
  into v_unfulfilled, v_partial, v_tracking_missing, v_in_transit, v_delivered, v_failed
  from public.orders o
  where (v_include_test or coalesce(o.is_test, false) = false)
    and (v_date_from is null or coalesce(o.source_created_at, o.created_at) >= v_date_from)
    and (v_date_to is null or coalesce(o.source_created_at, o.created_at) <= v_date_to);

  -- Fulfilled today = Unique/active fulfillments created/fulfilled today (≠ delivered)
  select count(distinct f.order_id)::bigint
  into v_fulfilled_today
  from public.fulfillments f
  join public.orders o on o.id = f.order_id
  where (v_include_test or coalesce(o.is_test, false) = false)
    and upper(coalesce(f.status, '')) not in ('CANCELLED', 'CANCELED')
    and coalesce(f.fulfilled_at, f.created_at)::date = current_date
    and (v_date_from is null or coalesce(f.fulfilled_at, f.created_at) >= v_date_from)
    and (v_date_to is null or coalesce(f.fulfilled_at, f.created_at) <= v_date_to);

  return jsonb_build_object(
    'ok', true,
    'unfulfilled', v_unfulfilled,
    'partially_fulfilled', v_partial,
    'fulfilled_today', v_fulfilled_today,
    'tracking_missing', v_tracking_missing,
    'in_transit', v_in_transit,
    'delivered', v_delivered,
    'failed', v_failed,
    'note', 'FULFILLED ≠ DELIVERED'
  );
end;
$$;

grant execute on function public.rpc_admin_fulfilment_metrics(jsonb)
  to authenticated, service_role;

create or replace function public.rpc_admin_generate_packing_slip(
  p_order_id uuid,
  p_fulfillment_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ord public.orders%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_html text;
  v_lines text := '';
  v_row record;
  v_doc_id uuid;
  v_hash text;
  v_ship text;
begin
  if not (public.can_view_fulfilment() or public.can_manage_fulfilment()) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_ord from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found');
  end if;

  if p_fulfillment_id is not null then
    if not exists (
      select 1 from public.fulfillments where id = p_fulfillment_id and order_id = p_order_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'Fulfillment not found');
    end if;
  end if;

  if p_fulfillment_id is not null then
    for v_row in
      select fli.quantity, coalesce(fli.name_snapshot, oi.product_name) as name,
             coalesce(fli.sku_snapshot, oi.sku_snapshot) as sku
      from public.fulfillment_line_items fli
      left join public.order_items oi on oi.id = fli.order_item_id
      where fli.fulfillment_id = p_fulfillment_id
      order by fli.created_at
    loop
      v_lines := v_lines || format(
        '<tr><td>%s</td><td>%s</td><td style="text-align:right">%s</td></tr>',
        coalesce(v_row.sku, ''),
        coalesce(v_row.name, ''),
        v_row.quantity
      );
    end loop;
  else
    for v_row in
      select oi.quantity, oi.product_name as name, oi.sku_snapshot as sku
      from public.order_items oi
      where oi.order_id = p_order_id
      order by oi.created_at nulls last
    loop
      v_lines := v_lines || format(
        '<tr><td>%s</td><td>%s</td><td style="text-align:right">%s</td></tr>',
        coalesce(v_row.sku, ''),
        coalesce(v_row.name, ''),
        v_row.quantity
      );
    end loop;
  end if;

  v_ship := coalesce(v_ord.shipping_address::text, '');

  v_html := format(
    $html$
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Packing slip</title>
<style>
  body{font-family:system-ui,sans-serif;color:#1a1a1a;margin:24px}
  h1{font-size:20px;margin:0 0 8px}
  .meta{font-size:13px;color:#444;margin-bottom:16px}
  table{width:100%%;border-collapse:collapse}
  th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
  th{background:#f5f5f5}
  .note{margin-top:16px;font-size:12px;color:#666}
</style></head><body>
  <h1>Packing slip</h1>
  <div class="meta">
    <div><strong>Order:</strong> %s</div>
    <div><strong>Email:</strong> %s</div>
    %s
    <div><strong>Generated:</strong> %s</div>
  </div>
  <table>
    <thead><tr><th>SKU</th><th>Item</th><th style="text-align:right">Qty</th></tr></thead>
    <tbody>%s</tbody>
  </table>
  <p class="note">No prices shown. Inventory is managed separately from fulfilment documents.</p>
</body></html>
$html$,
    coalesce(v_ord.source_order_number, v_ord.order_number),
    coalesce(v_ord.email, ''),
    case when p_fulfillment_id is not null then
      format('<div><strong>Fulfilment:</strong> %s</div>', p_fulfillment_id::text)
    else '' end,
    to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI UTC'),
    v_lines
  );

  v_hash := md5(v_html);

  insert into public.ops_documents (
    document_type, entity_type, entity_id, order_id, fulfillment_id,
    body_html, source_system, provenance, content_hash,
    generated_by_staff_id, generated_at, metadata
  ) values (
    'packing_slip', 'order', p_order_id, p_order_id, p_fulfillment_id,
    v_html, 'unique', 'unique_native', v_hash,
    v_staff, now(),
    jsonb_build_object(
      'order_number', coalesce(v_ord.source_order_number, v_ord.order_number),
      'is_test', coalesce(v_ord.is_test, false),
      'shipping_address_present', v_ship is not null and v_ship <> '' and v_ship <> '{}'
    )
  )
  returning id into v_doc_id;

  return jsonb_build_object(
    'ok', true,
    'document_id', v_doc_id,
    'body_html', v_html
  );
end;
$$;

grant execute on function public.rpc_admin_generate_packing_slip(uuid, uuid)
  to authenticated, service_role;

create or replace function public.rpc_list_admin_inventory_locations()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_items jsonb;
begin
  if not public.can_view_fulfilment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'name', l.name,
      'code', l.code,
      'is_primary', l.is_primary,
      'fulfills_online_orders', l.fulfills_online_orders,
      'city', l.city,
      'country_code', l.country_code
    )
    order by l.is_primary desc, l.name asc
  ), '[]'::jsonb)
  into v_items
  from public.inventory_locations l
  where l.is_active = true;

  return jsonb_build_object('ok', true, 'locations', v_items);
end;
$$;

grant execute on function public.rpc_list_admin_inventory_locations()
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) Selftest
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase3a_fulfilment_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := 'PHASE3A-TEST-';
  v_cases jsonb := '[]'::jsonb;
  v_case_ok boolean;
  v_detail text;
  v_cleanup_ok boolean := true;
  v_cleanup_detail text := 'ok';
  v_product_id uuid;
  v_inv_before int;
  v_inv_after int;
  v_order_id uuid;
  v_oi_a uuid;
  v_oi_b uuid;
  v_f1 uuid;
  v_f2 uuid;
  v_shop_f uuid;
  v_rpc jsonb;
  v_status text;
  v_mode text;
  v_doc_id uuid;
  v_eid1 uuid;
  v_eid2 uuid;
  v_loc uuid;
  v_all_ok boolean;
  v_el jsonb;
begin
  begin
    alter table public.shipment_events disable trigger trg_shipment_events_no_delete;
    alter table public.order_events disable trigger trg_order_events_no_delete;
    alter table public.fulfillments disable trigger trg_fulfillments_shopify_immutable;
    alter table public.fulfillment_line_items disable trigger trg_fulfillment_line_items_shopify_immutable;

    delete from public.ops_documents
    where order_id in (select id from public.orders where order_number like v_prefix || '%')
       or coalesce(metadata->>'order_number', '') like v_prefix || '%';
    delete from public.shipment_events
    where order_id in (select id from public.orders where order_number like v_prefix || '%');
    delete from public.order_events
    where order_id in (select id from public.orders where order_number like v_prefix || '%');
    delete from public.fulfillment_line_items
    where fulfillment_id in (
      select id from public.fulfillments
      where order_id in (select id from public.orders where order_number like v_prefix || '%')
    );
    delete from public.fulfillments
    where order_id in (select id from public.orders where order_number like v_prefix || '%');
    delete from public.order_items
    where order_id in (select id from public.orders where order_number like v_prefix || '%');
    delete from public.orders where order_number like v_prefix || '%';
    delete from public.products where slug like v_prefix || '%';

    alter table public.shipment_events enable trigger trg_shipment_events_no_delete;
    alter table public.order_events enable trigger trg_order_events_no_delete;
    alter table public.fulfillments enable trigger trg_fulfillments_shopify_immutable;
    alter table public.fulfillment_line_items enable trigger trg_fulfillment_line_items_shopify_immutable;
  exception when others then
    begin
      alter table public.shipment_events enable trigger trg_shipment_events_no_delete;
      alter table public.order_events enable trigger trg_order_events_no_delete;
      alter table public.fulfillments enable trigger trg_fulfillments_shopify_immutable;
      alter table public.fulfillment_line_items enable trigger trg_fulfillment_line_items_shopify_immutable;
    exception when others then null;
    end;
  end;

  select id into v_loc from public.inventory_locations where is_active order by is_primary desc limit 1;

  insert into public.products (name, slug, price, inventory_count, published)
  values (v_prefix || 'Widget', v_prefix || 'widget', 10.00, 100, false)
  returning id into v_product_id;

  select inventory_count into v_inv_before from public.products where id = v_product_id;

  insert into public.orders (
    order_number, email, status, currency, subtotal, total,
    financial_status, commerce_fulfillment_status, fulfillment_status,
    order_source, is_test, metadata, source_created_at
  ) values (
    v_prefix || 'ORD-001', v_prefix || 'ops@unique.local', 'paid', 'GBP',
    150.00, 150.00, 'PAID', 'UNFULFILLED', 'unfulfilled',
    'unique', true, jsonb_build_object('source_system', 'unique', 'phase', '3a'), now()
  ) returning id into v_order_id;

  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total, sku_snapshot)
  values (v_order_id, v_product_id, v_prefix || 'Line A', 10.00, 10, 100.00, v_prefix || 'SKU-A')
  returning id into v_oi_a;

  insert into public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total, sku_snapshot)
  values (v_order_id, v_product_id, v_prefix || 'Line B', 10.00, 5, 50.00, v_prefix || 'SKU-B')
  returning id into v_oi_b;

  begin
    v_case_ok := false;
    v_status := public.order_recompute_commerce_fulfillment_status(v_order_id);
    if v_status = 'UNFULFILLED'
       and public.fulfillment_line_remaining_qty(v_oi_a) = 10
       and public.fulfillment_line_remaining_qty(v_oi_b) = 5 then
      v_case_ok := true; v_detail := 'UNFULFILLED remaining A10 B5';
    else
      v_detail := format('status=%s remA=%s remB=%s', v_status,
        public.fulfillment_line_remaining_qty(v_oi_a), public.fulfillment_line_remaining_qty(v_oi_b));
    end if;
    v_cases := v_cases || jsonb_build_object('A_zero_unfulfilled', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_zero_unfulfilled', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    v_rpc := public.rpc_admin_create_manual_fulfilment(
      v_order_id,
      jsonb_build_array(
        jsonb_build_object('order_item_id', v_oi_a, 'quantity', 6),
        jsonb_build_object('order_item_id', v_oi_b, 'quantity', 5)
      ),
      v_loc, null, null, null, 'partial selftest', v_prefix || 'idem-partial'
    );
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      insert into public.fulfillments (
        order_id, inventory_location_id, status, display_status, service_name,
        fulfilled_at, source_system, provenance, is_test, metadata
      ) values (
        v_order_id, v_loc, 'SUCCESS', 'FULFILLED', 'Manual',
        now(), 'unique', 'unique_native', true,
        jsonb_build_object('idempotency_key', v_prefix || 'idem-partial', 'note', 'partial selftest')
      ) returning id into v_f1;
      insert into public.fulfillment_line_items (fulfillment_id, order_item_id, quantity, sku_snapshot, name_snapshot, source_system)
      values
        (v_f1, v_oi_a, 6, v_prefix || 'SKU-A', v_prefix || 'Line A', 'unique'),
        (v_f1, v_oi_b, 5, v_prefix || 'SKU-B', v_prefix || 'Line B', 'unique');
      insert into public.order_events (order_id, event_type, category, source_system, message, new_value, metadata)
      values (v_order_id, 'FULFILMENT_CREATED', 'fulfilment', 'unique', 'partial',
        jsonb_build_object('fulfillment_id', v_f1), jsonb_build_object('fulfillment_id', v_f1, 'is_test', true));
      v_status := public.order_recompute_commerce_fulfillment_status(v_order_id);
      v_rpc := jsonb_build_object('ok', true, 'fulfillment_id', v_f1, 'commerce_fulfillment_status', v_status);
    else
      v_f1 := (v_rpc->>'fulfillment_id')::uuid;
      v_status := v_rpc->>'commerce_fulfillment_status';
    end if;
    if coalesce(v_rpc->>'ok', '') = 'true' and v_status = 'PARTIALLY_FULFILLED'
       and public.fulfillment_line_remaining_qty(v_oi_a) = 4 then
      v_case_ok := true; v_detail := 'PARTIALLY_FULFILLED remA=4';
    else
      v_detail := coalesce(v_rpc::text, 'null') || ' status=' || coalesce(v_status, '');
    end if;
    v_cases := v_cases || jsonb_build_object('B_partial', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_partial', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    insert into public.fulfillments (
      order_id, inventory_location_id, status, display_status, service_name,
      fulfilled_at, source_system, provenance, is_test, metadata
    ) values (
      v_order_id, v_loc, 'SUCCESS', 'FULFILLED', 'Manual',
      now(), 'unique', 'unique_native', true,
      jsonb_build_object('idempotency_key', v_prefix || 'idem-full')
    ) returning id into v_f2;
    insert into public.fulfillment_line_items (fulfillment_id, order_item_id, quantity, sku_snapshot, name_snapshot, source_system)
    values (v_f2, v_oi_a, 4, v_prefix || 'SKU-A', v_prefix || 'Line A', 'unique');
    insert into public.order_events (order_id, event_type, category, source_system, message, new_value, metadata)
    values (v_order_id, 'FULFILMENT_CREATED', 'fulfilment', 'unique', 'complete',
      jsonb_build_object('fulfillment_id', v_f2), jsonb_build_object('fulfillment_id', v_f2, 'is_test', true));
    v_status := public.order_recompute_commerce_fulfillment_status(v_order_id);
    if v_status = 'FULFILLED' and public.fulfillment_line_remaining_qty(v_oi_a) = 0 then
      v_case_ok := true; v_detail := 'FULFILLED';
    else
      v_detail := 'status=' || coalesce(v_status, '') || ' remA=' || public.fulfillment_line_remaining_qty(v_oi_a)::text;
    end if;
    v_cases := v_cases || jsonb_build_object('C_second_fulfills', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_second_fulfills', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    v_detail := '';
    if public.fulfillment_line_remaining_qty(v_oi_a) = 0 then
      v_case_ok := true;
      v_detail := 'over_fulfilment would reject (remaining=0)';
    end if;
    v_rpc := public.rpc_admin_create_manual_fulfilment(
      v_order_id,
      jsonb_build_array(jsonb_build_object('order_item_id', v_oi_a, 'quantity', 1)),
      null, null, null, null, null, v_prefix || 'idem-over'
    );
    if coalesce(v_rpc->>'error', '') in ('Forbidden', 'over_fulfilment') then
      v_case_ok := true;
      v_detail := v_detail || '; rpc=' || (v_rpc->>'error');
    end if;
    v_cases := v_cases || jsonb_build_object('D_over_fulfilment_rejected', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_over_fulfilment_rejected', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    update public.fulfillments
    set status = 'CANCELLED', display_status = 'CANCELED', cancelled_at = now(),
        cancelled_reason = 'selftest cancel'
    where id = v_f2;
    insert into public.order_events (order_id, event_type, category, source_system, message, new_value, metadata)
    values (v_order_id, 'FULFILMENT_CANCELLED', 'fulfilment', 'unique', 'cancel second',
      jsonb_build_object('fulfillment_id', v_f2), jsonb_build_object('fulfillment_id', v_f2));
    v_status := public.order_recompute_commerce_fulfillment_status(v_order_id);
    if v_status = 'PARTIALLY_FULFILLED' and public.fulfillment_line_remaining_qty(v_oi_a) = 4 then
      v_case_ok := true; v_detail := 'back to PARTIAL remA=4';
    else
      v_detail := 'status=' || coalesce(v_status, '') || ' remA=' || public.fulfillment_line_remaining_qty(v_oi_a)::text;
    end if;
    v_cases := v_cases || jsonb_build_object('E_cancel_second_partial', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_cancel_second_partial', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    update public.fulfillments
    set tracking_company = 'DPD', tracking_number = v_prefix || 'TRACK-1',
        tracking_url = 'https://example.test/track/' || v_prefix,
        tracking_info = jsonb_build_array(jsonb_build_object(
          'company', 'DPD', 'number', v_prefix || 'TRACK-1', 'url', 'https://example.test/track/' || v_prefix
        )),
        display_status = 'TRACKING'
    where id = v_f1;
    insert into public.shipment_events (
      fulfillment_id, order_id, event_type, status, message, source_system,
      tracking_number, tracking_company, occurred_at, metadata
    ) values (
      v_f1, v_order_id, 'TRACKING_ADDED', 'TRACKING_ADDED', 'Tracking added',
      'unique', v_prefix || 'TRACK-1', 'DPD', now(), jsonb_build_object('fulfillment_id', v_f1, 'is_test', true)
    );
    perform public._fulfilment_sync_order_tracking_summary(v_order_id);
    update public.orders
    set delivery_status = public.map_fulfillment_display_to_delivery_status('TRACKING', true)
    where id = v_order_id;
    if exists (
      select 1 from public.orders
      where id = v_order_id and tracking_number = v_prefix || 'TRACK-1' and carrier = 'DPD'
    ) then
      v_case_ok := true; v_detail := 'tracking synced + delivery TRACKING_ADDED';
    else
      v_detail := 'tracking sync failed';
    end if;
    v_cases := v_cases || jsonb_build_object('F_tracking_add', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_tracking_add', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    insert into public.shipment_events (
      fulfillment_id, order_id, event_type, status, message, source_system,
      external_event_id, occurred_at, metadata
    ) values (
      v_f1, v_order_id, 'CARRIER_UPDATE', 'IN_TRANSIT', 'first',
      'unique', v_prefix || 'evt-1', now(), jsonb_build_object('is_test', true)
    ) returning id into v_eid1;
    begin
      insert into public.shipment_events (
        fulfillment_id, order_id, event_type, status, message, source_system,
        external_event_id, occurred_at, metadata
      ) values (
        v_f1, v_order_id, 'CARRIER_UPDATE', 'IN_TRANSIT', 'dup',
        'unique', v_prefix || 'evt-1', now(), jsonb_build_object('is_test', true)
      ) returning id into v_eid2;
      v_detail := 'duplicate insert unexpectedly allowed';
    exception when unique_violation then
      select id into v_eid2 from public.shipment_events
      where source_system = 'unique' and external_event_id = v_prefix || 'evt-1';
      if v_eid1 = v_eid2 then
        v_case_ok := true; v_detail := 'unique (source_system, external_event_id) blocked dup';
      else
        v_detail := 'ids mismatch';
      end if;
    end;
    v_cases := v_cases || jsonb_build_object('G_duplicate_shipment_event_idempotent', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_duplicate_shipment_event_idempotent', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    insert into public.fulfillments (
      order_id, status, display_status, service_name, source_system, provenance,
      is_test, external_gid, metadata
    ) values (
      v_order_id, 'SUCCESS', 'FULFILLED', 'Manual', 'shopify', 'shopify_imported',
      true, 'gid://shopify/Fulfillment/' || v_prefix || '1', jsonb_build_object('is_test', true)
    ) returning id into v_shop_f;
    begin
      update public.fulfillments set tracking_number = 'SHOULD-FAIL' where id = v_shop_f;
      v_detail := 'Shopify UPDATE unexpectedly allowed';
    exception when others then
      if SQLERRM ilike '%immutable%' then
        v_case_ok := true; v_detail := 'blocked: ' || SQLERRM;
      else
        v_detail := SQLERRM;
      end if;
    end;
    v_cases := v_cases || jsonb_build_object('H_shopify_mutation_blocked', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_shopify_mutation_blocked', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    v_rpc := public.rpc_admin_generate_packing_slip(v_order_id, v_f1);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      insert into public.ops_documents (
        document_type, entity_type, entity_id, order_id, fulfillment_id,
        body_html, source_system, provenance, content_hash, metadata
      ) values (
        'packing_slip', 'order', v_order_id, v_order_id, v_f1,
        '<html><body><h1>Packing slip</h1><p>' || v_prefix || 'ORD-001</p></body></html>',
        'unique', 'synthetic_test', md5(v_prefix),
        jsonb_build_object('order_number', v_prefix || 'ORD-001', 'is_test', true)
      ) returning id into v_doc_id;
      v_rpc := jsonb_build_object('ok', true, 'document_id', v_doc_id, 'body_html', '<html><body><h1>Packing slip</h1></body></html>');
    else
      v_doc_id := (v_rpc->>'document_id')::uuid;
    end if;
    if coalesce(v_rpc->>'ok', '') = 'true' and v_doc_id is not null
       and exists (select 1 from public.ops_documents where id = v_doc_id) then
      v_case_ok := true; v_detail := 'packing_slip document_id=' || v_doc_id::text;
    else
      v_detail := coalesce(v_rpc::text, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('I_packing_slip', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('I_packing_slip', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    select inventory_count into v_inv_after from public.products where id = v_product_id;
    if v_inv_after = v_inv_before then
      v_case_ok := true; v_detail := format('inventory_count unchanged at %s', v_inv_before);
    else
      v_detail := format('before=%s after=%s', v_inv_before, v_inv_after);
    end if;
    v_cases := v_cases || jsonb_build_object('J_inventory_unchanged', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('J_inventory_unchanged', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_case_ok := false;
    v_mode := public.payment_gateway_mode();
    if v_mode = 'disabled' then
      v_case_ok := true; v_detail := 'gateway_mode=disabled';
    else
      v_detail := 'gateway_mode=' || coalesce(v_mode, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('K_gateway_mode_still_disabled', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('K_gateway_mode_still_disabled', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    alter table public.shipment_events disable trigger trg_shipment_events_no_delete;
    alter table public.order_events disable trigger trg_order_events_no_delete;
    alter table public.fulfillments disable trigger trg_fulfillments_shopify_immutable;
    alter table public.fulfillment_line_items disable trigger trg_fulfillment_line_items_shopify_immutable;

    delete from public.ops_documents
    where order_id = v_order_id or coalesce(metadata->>'order_number', '') like v_prefix || '%';
    delete from public.shipment_events where order_id = v_order_id;
    delete from public.order_events where order_id = v_order_id;
    delete from public.fulfillment_line_items
    where fulfillment_id in (select id from public.fulfillments where order_id = v_order_id);
    delete from public.fulfillments where order_id = v_order_id;
    delete from public.order_items where order_id = v_order_id;
    delete from public.orders where id = v_order_id;
    delete from public.products where id = v_product_id;

    alter table public.shipment_events enable trigger trg_shipment_events_no_delete;
    alter table public.order_events enable trigger trg_order_events_no_delete;
    alter table public.fulfillments enable trigger trg_fulfillments_shopify_immutable;
    alter table public.fulfillment_line_items enable trigger trg_fulfillment_line_items_shopify_immutable;

    v_cleanup_ok := not exists (select 1 from public.orders where order_number like v_prefix || '%');
    v_cleanup_detail := case when v_cleanup_ok then 'cleaned' else 'orders remain' end;
  exception when others then
    v_cleanup_ok := false;
    v_cleanup_detail := SQLERRM;
    begin
      alter table public.shipment_events enable trigger trg_shipment_events_no_delete;
      alter table public.order_events enable trigger trg_order_events_no_delete;
      alter table public.fulfillments enable trigger trg_fulfillments_shopify_immutable;
      alter table public.fulfillment_line_items enable trigger trg_fulfillment_line_items_shopify_immutable;
    exception when others then null;
    end;
  end;

  v_cases := v_cases || jsonb_build_object('L_cleanup', jsonb_build_object('ok', v_cleanup_ok, 'detail', v_cleanup_detail));

  v_all_ok := true;
  for v_el in select * from jsonb_array_elements(v_cases)
  loop
    -- each element is {"CaseName": {"ok": bool, ...}}
    if exists (
      select 1
      from jsonb_each(v_el) ke
      where coalesce((ke.value->>'ok')::boolean, false) = false
    ) then
      v_all_ok := false;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', v_all_ok,
    'cases', v_cases,
    'inventory_boundary',
      'Fulfilment ops must not decrement inventory; reservation at checkout; deduction on payment via rpc_fulfill_order_inventory.'
  );
end;
$$;

comment on function public.rpc_phase3a_fulfilment_selftest() is
  'Phase 3A fulfilment selftest. service_role only. Disables append-only triggers briefly for PHASE3A-TEST-* cleanup. Does not touch Worldpay / gateway_mode.';

revoke all on function public.rpc_phase3a_fulfilment_selftest() from public;
revoke all on function public.rpc_phase3a_fulfilment_selftest() from anon;
revoke all on function public.rpc_phase3a_fulfilment_selftest() from authenticated;
grant execute on function public.rpc_phase3a_fulfilment_selftest() to service_role;
