-- Phase 3B — Shipment / delivery events (DPD WSA, SKULabs, carrier updates)
-- Additive. Complements order_events with shipment-scoped timeline.

create table if not exists public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: append-only events must not be removed via fulfillment CASCADE.
  fulfillment_id uuid references public.fulfillments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  event_type text not null,
  status text,
  message text,
  source_system text,
  source_app text,
  tracking_number text,
  tracking_company text,
  location_label text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  external_event_id text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  constraint shipment_events_event_type_chk check (char_length(trim(event_type)) > 0)
);

comment on table public.shipment_events is
  'Delivery/carrier timeline. source_app examples: DPD Integration by WSA, SKULabs. Prefer linking fulfillment_id when known.';

create index if not exists shipment_events_order_occurred_idx
  on public.shipment_events (order_id, occurred_at);

create index if not exists shipment_events_fulfillment_occurred_idx
  on public.shipment_events (fulfillment_id, occurred_at)
  where fulfillment_id is not null;

create index if not exists shipment_events_source_app_idx
  on public.shipment_events (source_app)
  where source_app is not null;

create unique index if not exists shipment_events_external_event_uidx
  on public.shipment_events (source_system, external_event_id)
  where external_event_id is not null and source_system is not null;

-- Append-oriented: block UPDATE/DELETE like order_events.
create or replace function public.forbid_shipment_events_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'shipment_events is append-only; UPDATE/DELETE are not allowed'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_shipment_events_no_update on public.shipment_events;
create trigger trg_shipment_events_no_update
  before update on public.shipment_events
  for each row execute function public.forbid_shipment_events_mutation();

drop trigger if exists trg_shipment_events_no_delete on public.shipment_events;
create trigger trg_shipment_events_no_delete
  before delete on public.shipment_events
  for each row execute function public.forbid_shipment_events_mutation();

alter table public.shipment_events enable row level security;

drop policy if exists "admin_select_shipment_events" on public.shipment_events;
create policy "admin_select_shipment_events" on public.shipment_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_shipment_events" on public.shipment_events;
create policy "admin_insert_shipment_events" on public.shipment_events
  for insert to authenticated with check (public.is_admin());

grant select, insert on public.shipment_events to authenticated;
revoke update, delete on public.shipment_events from authenticated;
revoke update, delete on public.shipment_events from anon;
grant select, insert on public.shipment_events to service_role;

drop policy if exists "customer_read_own_shipment_events" on public.shipment_events;
create policy "customer_read_own_shipment_events" on public.shipment_events
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = shipment_events.order_id
        and (
          o.user_id = (select auth.uid())
          or exists (
            select 1 from public.customers c
            where c.id = o.customer_id and c.auth_user_id = (select auth.uid())
          )
        )
    )
  );

-- Order-level delivery summary fields (parallel to simple CMS tracking cols).
alter table public.orders
  add column if not exists primary_fulfillment_id uuid references public.fulfillments(id) on delete set null,
  add column if not exists dpd_delivery_status text;

comment on column public.orders.dpd_delivery_status is
  'Snapshot of Shopify custom attribute DPD Delivery Status when present.';
comment on column public.orders.primary_fulfillment_id is
  'Optional pointer to the primary/latest fulfillment for quick UI joins.';

create index if not exists orders_dpd_delivery_status_idx
  on public.orders (dpd_delivery_status)
  where dpd_delivery_status is not null;

create index if not exists orders_primary_fulfillment_id_idx
  on public.orders (primary_fulfillment_id)
  where primary_fulfillment_id is not null;
