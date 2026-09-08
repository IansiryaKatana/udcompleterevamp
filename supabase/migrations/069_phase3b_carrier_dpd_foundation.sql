-- Phase 3B — DPD product discovery foundation (Unique Commerce OS)
--
-- CRITICAL CONSTRAINTS:
--   * DO NOT enable live DPD.
--   * DO NOT invent DPD API endpoints or service codes.
--   * DO NOT mutate historical Shopify fulfillments except additive nullable
--     carrier columns + derived carrier_provider (preserves tracking_company
--     as carrier_name_raw). tracking_company / status / tracking_* unchanged.
--   * DO NOT change inventory (reservation at checkout; deduction on payment
--     via rpc_fulfill_order_inventory — fulfilment/carrier ops never double-decrement).
--   * DO NOT touch payment_gateway_config / gateway_mode / Worldpay.
--   * carrier_mode must remain 'disabled' (credentials do NOT exist in env /
--     private_settings — test mode must not be enabled without them).
--   * SKULabs remains an external WMS boundary — out of scope here.
--
-- Confirmed evidence (forensic; encode for future adapters):
--   * Historical path: Shopify app "DPD Integration by WSA" (WebShopAssist)
--     writing tracking + "DPD Delivery Status" into fulfillments.
--   * Tracking URLs: www.dpdlocal.co.uk and www.dpd.co.uk (UK).
--   * Raw labels observed: DPD, DPD UK, DPD Local.
--   * Exact DPD UK national API family (GeoSession / Shipper / etc.) = UNCONFIRMED.
--   * No DPD credentials in env / private_settings.
--   * Shopify "Standard Delivery" maps to Other more often than DPD —
--     do NOT hardcode Standard Delivery → a specific DPD service code.
--
-- Multi-parcel justification: forensic count of DPD fulfillments with
-- jsonb_array_length(tracking_info) > 1 ≈ 2592 (report-only; no backfill here).

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) carrier_gateway_config (singleton gate — mirrors payment_gateway_config)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.carrier_gateway_config (
  id uuid primary key default gen_random_uuid(),
  key text not null unique default 'default',
  carrier_mode text not null default 'disabled'
    check (carrier_mode in ('disabled', 'test', 'live')),
  provider text not null default 'dpd',
  product_key text not null default 'unconfirmed',
  product_status text not null default 'unconfirmed'
    check (product_status in ('unconfirmed', 'confirmed')),
  phase_3b_live_blocked boolean not null default true,
  test_credentials_present boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid
);

comment on table public.carrier_gateway_config is
  'Carrier activation gate. Phase 3B: carrier_mode stays disabled; live blocked; '
  'DPD product/API family UNCONFIRMED. No secrets stored here. '
  'Inventory boundary: carrier ops never decrement stock. SKULabs out of scope.';

comment on column public.carrier_gateway_config.product_key is
  'Stable product identifier once known (e.g. dpd_uk_unconfirmed until business confirms).';
comment on column public.carrier_gateway_config.product_status is
  'unconfirmed until merchant confirms official DPD product + API family. Separate from carrier_mode.';
comment on column public.carrier_gateway_config.phase_3b_live_blocked is
  'Hard block for carrier_mode=live in Phase 3B. Must stay true until a later authorized phase.';
comment on column public.carrier_gateway_config.test_credentials_present is
  'False: no DPD credentials in env/private_settings. Do not flip without verified secrets.';

insert into public.carrier_gateway_config (
  key, carrier_mode, provider, product_key, product_status,
  phase_3b_live_blocked, test_credentials_present, notes, metadata
) values (
  'default',
  'disabled',
  'dpd',
  'dpd_uk_unconfirmed',
  'unconfirmed',
  true,
  false,
  'Phase 3B discovery only. Historical Shopify footprint via "DPD Integration by WSA" '
  '(WebShopAssist): tracking numbers/URLs + "DPD Delivery Status". '
  'Observed UK tracking hosts: www.dpdlocal.co.uk, www.dpd.co.uk. '
  'Raw company labels: DPD, DPD UK, DPD Local. '
  'Exact DPD UK national API (GeoSession/Shipper/etc.) UNCONFIRMED — do not invent endpoints. '
  'No credentials present. Live DPD blocked. Business must confirm product + supply official service codes.',
  jsonb_build_object(
    'phase', '3b',
    'historical_app', 'DPD Integration by WSA (WebShopAssist)',
    'tracking_hosts', jsonb_build_array('www.dpdlocal.co.uk', 'www.dpd.co.uk'),
    'raw_labels', jsonb_build_array('DPD', 'DPD UK', 'DPD Local'),
    'api_family', 'unconfirmed',
    'credentials', 'absent',
    'live_enabled', false,
    'note_standard_delivery',
      'Standard Delivery maps to Other more often than DPD — do not hardcode Standard→DPD service'
  )
)
on conflict (key) do nothing;

alter table public.carrier_gateway_config enable row level security;

drop policy if exists "admin_select_carrier_gateway_config" on public.carrier_gateway_config;
create policy "admin_select_carrier_gateway_config" on public.carrier_gateway_config
  for select to authenticated using (public.can_view_fulfilment());

drop policy if exists "admin_update_carrier_gateway_config" on public.carrier_gateway_config;
create policy "admin_update_carrier_gateway_config" on public.carrier_gateway_config
  for update to authenticated
  using (public.current_admin_is_owner_or_admin())
  with check (
    public.current_admin_is_owner_or_admin()
    and (
      carrier_mode <> 'live'
      or phase_3b_live_blocked = false
    )
    and (
      -- Refuse enabling test/live while product unconfirmed or credentials absent
      carrier_mode = 'disabled'
      or (
        product_status = 'confirmed'
        and test_credentials_present = true
        and phase_3b_live_blocked = false
      )
      or (
        carrier_mode = 'test'
        and product_status = 'confirmed'
        and test_credentials_present = true
      )
    )
  );

grant select on public.carrier_gateway_config to authenticated;
grant update on public.carrier_gateway_config to authenticated;
grant all on public.carrier_gateway_config to service_role;

create or replace function public.carrier_gateway_mode()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select carrier_mode from public.carrier_gateway_config where key = 'default'),
    'disabled'
  );
$$;

-- Product confirmation is independent of carrier_mode.
create or replace function public.carrier_product_confirmed()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select product_status = 'confirmed' from public.carrier_gateway_config where key = 'default'),
    false
  );
$$;

create or replace function public.carrier_gateway_live_blocked()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select phase_3b_live_blocked from public.carrier_gateway_config where key = 'default'),
    true
  );
$$;

-- Whether Unique may attempt outbound carrier shipment creation.
-- Phase 3B: never live; never invent success; product unconfirmed → refuse.
create or replace function public.carrier_shipment_actions_permitted()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_mode text := public.carrier_gateway_mode();
  v_confirmed boolean := public.carrier_product_confirmed();
  v_blocked boolean := public.carrier_gateway_live_blocked();
  v_creds boolean;
begin
  select coalesce(test_credentials_present, false)
  into v_creds
  from public.carrier_gateway_config
  where key = 'default';

  if v_mode = 'disabled' then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'allowed', false,
      'product_confirmed', v_confirmed,
      'error', 'carrier_disabled'
    );
  end if;

  if not v_confirmed then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'allowed', false,
      'product_confirmed', false,
      'error', 'dpd_product_unconfirmed'
    );
  end if;

  if v_mode = 'live' and v_blocked then
    return jsonb_build_object(
      'ok', false,
      'mode', v_mode,
      'allowed', false,
      'product_confirmed', v_confirmed,
      'error', 'production_carrier_blocked_phase_3b'
    );
  end if;

  if not coalesce(v_creds, false) then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'allowed', false,
      'product_confirmed', v_confirmed,
      'error', 'carrier_credentials_absent'
    );
  end if;

  if v_mode = 'test' then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'allowed', true,
      'product_confirmed', true,
      'environment', 'test',
      'note', 'SQL never calls DPD HTTP; edge/adapter required. No invented endpoints.'
    );
  end if;

  if v_mode = 'live' then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'allowed', true,
      'product_confirmed', true,
      'environment', 'live',
      'note', 'Live only after Phase 3B gate removed by authorized later phase'
    );
  end if;

  return jsonb_build_object(
    'ok', false, 'allowed', false, 'error', 'unknown_mode', 'mode', v_mode
  );
end;
$$;

grant execute on function public.carrier_gateway_mode() to authenticated, service_role, anon;
grant execute on function public.carrier_product_confirmed() to authenticated, service_role, anon;
grant execute on function public.carrier_gateway_live_blocked() to authenticated, service_role, anon;
grant execute on function public.carrier_shipment_actions_permitted() to authenticated, service_role, anon;

comment on function public.carrier_gateway_mode() is
  'Returns carrier_gateway_config.carrier_mode (default disabled).';
comment on function public.carrier_product_confirmed() is
  'True only when product_status=confirmed. Independent of carrier_mode.';
comment on function public.carrier_shipment_actions_permitted() is
  'Gate for outbound Unique-native carrier shipment creation. Phase 3B refuses disabled/unconfirmed/live-blocked.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) carrier_service_mappings (configurable; codes NULL until business supplies)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.carrier_service_mappings (
  id uuid primary key default gen_random_uuid(),
  shipping_title_pattern text not null,
  shipping_code_pattern text,
  destination_country_code text,
  carrier_provider text not null default 'dpd',
  carrier_service_code text,  -- NULL until official DPD codes supplied — do not invent
  carrier_service_label text,
  priority int not null default 100,
  is_active boolean not null default false,  -- inactive until codes confirmed
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.carrier_service_mappings is
  'Suggested shipping-title → carrier service mappings. Phase 3B: all inactive, '
  'carrier_service_code NULL. Do not invent DPD service codes. '
  'Standard Delivery must NOT be hard-mapped to a specific DPD product without evidence.';

comment on column public.carrier_service_mappings.carrier_service_code is
  'Official carrier service code when known. NULL = pending_official_dpd_service_code.';

create index if not exists carrier_service_mappings_active_priority_idx
  on public.carrier_service_mappings (is_active, priority, carrier_provider);

alter table public.carrier_service_mappings enable row level security;

drop policy if exists "admin_select_carrier_service_mappings" on public.carrier_service_mappings;
create policy "admin_select_carrier_service_mappings" on public.carrier_service_mappings
  for select to authenticated using (public.can_view_fulfilment());

drop policy if exists "admin_insert_carrier_service_mappings" on public.carrier_service_mappings;
create policy "admin_insert_carrier_service_mappings" on public.carrier_service_mappings
  for insert to authenticated with check (public.can_manage_fulfilment());

drop policy if exists "admin_update_carrier_service_mappings" on public.carrier_service_mappings;
create policy "admin_update_carrier_service_mappings" on public.carrier_service_mappings
  for update to authenticated
  using (public.can_manage_fulfilment())
  with check (public.can_manage_fulfilment());

grant select, insert, update on public.carrier_service_mappings to authenticated;
revoke delete on public.carrier_service_mappings from authenticated;
grant all on public.carrier_service_mappings to service_role;

-- Suggested inactive rows (idempotent by title pattern + provider)
insert into public.carrier_service_mappings (
  shipping_title_pattern, shipping_code_pattern, destination_country_code,
  carrier_provider, carrier_service_code, carrier_service_label,
  priority, is_active, metadata
)
select v.shipping_title_pattern, null, 'GB', 'dpd', null, v.carrier_service_label,
       v.priority, false,
       jsonb_build_object(
         'pending_official_dpd_service_code', true,
         'phase', '3b',
         'note', v.note
       )
from (values
  (
    'Standard Delivery',
    'Standard Delivery (pending code)',
    100,
    'Suggested only. Forensic: Standard Delivery maps to Other more often than DPD — do NOT activate or invent a DPD code.'
  ),
  (
    'Saturday',
    'Saturday (pending code)',
    90,
    'Suggested Saturday pattern only; official DPD Saturday service code unknown.'
  ),
  (
    'Free Delivery',
    'Free Delivery (pending code)',
    110,
    'Commercial title ≠ carrier product. Code unknown until business confirms.'
  ),
  (
    'Next Day',
    'Next Day (pending code)',
    80,
    'Suggested Next Day pattern only; official DPD next-day service code unknown.'
  )
) as v(shipping_title_pattern, carrier_service_label, priority, note)
where not exists (
  select 1
  from public.carrier_service_mappings m
  where m.shipping_title_pattern = v.shipping_title_pattern
    and m.carrier_provider = 'dpd'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Extend fulfillments (additive only) + Shopify-safe backfill
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fulfillments
  add column if not exists carrier_provider text,
  add column if not exists carrier_name_raw text,
  add column if not exists consignment_reference text,
  add column if not exists shipment_reference text,
  add column if not exists label_reference text,
  add column if not exists parcel_count int,
  add column if not exists shipment_weight_kg numeric(12,3),
  add column if not exists carrier_cost numeric(14,2),
  add column if not exists carrier_cost_currency text,
  add column if not exists carrier_created_at timestamptz,
  add column if not exists carrier_mode text,
  add column if not exists carrier_idempotency_key text;

alter table public.fulfillments
  drop constraint if exists fulfillments_carrier_provider_chk;
alter table public.fulfillments
  add constraint fulfillments_carrier_provider_chk
  check (
    carrier_provider is null
    or carrier_provider in ('dpd', 'dx', 'ups', 'other', 'manual')
  );

alter table public.fulfillments
  drop constraint if exists fulfillments_carrier_mode_chk;
alter table public.fulfillments
  add constraint fulfillments_carrier_mode_chk
  check (
    carrier_mode is null
    or carrier_mode in ('disabled', 'test', 'live')
  );

comment on column public.fulfillments.carrier_provider is
  'Canonical provider: dpd | dx | ups | other | manual | null. Derived for Shopify imports; does not rewrite tracking_company.';
comment on column public.fulfillments.carrier_name_raw is
  'Preserves original tracking_company / raw carrier label.';
comment on column public.fulfillments.carrier_cost is
  'Unique-native carrier label cost (separate from customer shipping charge on the order).';
comment on column public.fulfillments.carrier_mode is
  'disabled|test|live for Unique-native carrier ops on this shipment. Null for historical imports.';
comment on column public.fulfillments.carrier_idempotency_key is
  'Idempotency key for Unique-native carrier create-shipment. Null for Shopify imports.';

create unique index if not exists fulfillments_carrier_idempotency_uidx
  on public.fulfillments (carrier_idempotency_key)
  where carrier_idempotency_key is not null;

create index if not exists fulfillments_carrier_provider_idx
  on public.fulfillments (carrier_provider)
  where carrier_provider is not null;

-- Allow ONLY additive Phase 3B carrier columns on Shopify-imported rows.
-- Historical tracking_company / status / tracking_* remain immutable.
create or replace function public.forbid_shopify_fulfillment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(old.source_system, '') = 'shopify'
     or coalesce(old.provenance, '') = 'shopify_imported' then

    if tg_op = 'DELETE' then
      raise exception 'Shopify fulfillments are immutable (UPDATE/DELETE forbidden)'
        using errcode = 'restrict_violation';
    end if;

    -- UPDATE: permit only additive carrier enrichment columns (+ updated_at).
    if new.id is distinct from old.id
       or new.order_id is distinct from old.order_id
       or new.inventory_location_id is distinct from old.inventory_location_id
       or new.status is distinct from old.status
       or new.display_status is distinct from old.display_status
       or new.name is distinct from old.name
       or new.service_handle is distinct from old.service_handle
       or new.service_name is distinct from old.service_name
       or new.tracking_company is distinct from old.tracking_company
       or new.tracking_number is distinct from old.tracking_number
       or new.tracking_url is distinct from old.tracking_url
       or new.tracking_info is distinct from old.tracking_info
       or new.carrier_status is distinct from old.carrier_status
       or new.carrier_status_raw is distinct from old.carrier_status_raw
       or new.estimated_delivery_at is distinct from old.estimated_delivery_at
       or new.in_transit_at is distinct from old.in_transit_at
       or new.delivered_at is distinct from old.delivered_at
       or new.source_created_at is distinct from old.source_created_at
       or new.source_updated_at is distinct from old.source_updated_at
       or new.source_system is distinct from old.source_system
       or new.external_gid is distinct from old.external_gid
       or new.metadata is distinct from old.metadata
       or new.imported_at is distinct from old.imported_at
       or new.created_at is distinct from old.created_at
       or new.cancelled_at is distinct from old.cancelled_at
       or new.fulfilled_at is distinct from old.fulfilled_at
       or new.cancelled_reason is distinct from old.cancelled_reason
       or new.is_test is distinct from old.is_test
       or new.provenance is distinct from old.provenance
       or new.created_by_staff_id is distinct from old.created_by_staff_id
    then
      raise exception 'Shopify fulfillments are immutable (UPDATE/DELETE forbidden)'
        using errcode = 'restrict_violation';
    end if;
    -- Additive carrier_* columns may change; return new.
    return new;
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

comment on function public.forbid_shopify_fulfillment_mutation() is
  'Blocks Shopify fulfillment mutation except additive Phase 3B carrier enrichment columns.';

-- Backfill ONLY additive columns for Shopify rows (does not change tracking_company).
update public.fulfillments
set
  carrier_name_raw = coalesce(carrier_name_raw, tracking_company),
  carrier_provider = coalesce(
    carrier_provider,
    case
      when tracking_company ilike '%dpd%' then 'dpd'
      when tracking_company ilike '%ups%' then 'ups'
      when tracking_company ilike '%dx%' then 'dx'
      when tracking_company is not null and btrim(tracking_company) <> '' then 'other'
      else null
    end
  )
where coalesce(source_system, '') = 'shopify'
  and (
    carrier_name_raw is null
    or carrier_provider is null
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) fulfillment_parcels (multi-parcel model; NO tracking_info backfill)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.fulfillment_parcels (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.fulfillments(id) on delete cascade,
  sequence int not null,
  tracking_number text,
  tracking_url text,
  tracking_company text,
  weight_kg numeric(12,3),
  external_parcel_ref text,
  metadata jsonb not null default '{}'::jsonb,
  source_system text,
  created_at timestamptz not null default now(),
  constraint fulfillment_parcels_sequence_uidx unique (fulfillment_id, sequence)
);

comment on table public.fulfillment_parcels is
  'Per-parcel tracking for multi-parcel shipments. Justified by ~2592 DPD '
  'fulfillments with multi-element tracking_info. Phase 3B: schema only — '
  'DO NOT backfill from tracking_info in this migration (preview helper only).';

create index if not exists fulfillment_parcels_fulfillment_id_idx
  on public.fulfillment_parcels (fulfillment_id);
create index if not exists fulfillment_parcels_tracking_number_idx
  on public.fulfillment_parcels (tracking_number)
  where tracking_number is not null;

alter table public.fulfillment_parcels enable row level security;

drop policy if exists "admin_select_fulfillment_parcels" on public.fulfillment_parcels;
create policy "admin_select_fulfillment_parcels" on public.fulfillment_parcels
  for select to authenticated using (public.can_view_fulfilment());

drop policy if exists "admin_insert_fulfillment_parcels" on public.fulfillment_parcels;
create policy "admin_insert_fulfillment_parcels" on public.fulfillment_parcels
  for insert to authenticated with check (
    public.can_create_fulfilment() or public.can_manage_fulfilment()
  );

drop policy if exists "admin_update_fulfillment_parcels" on public.fulfillment_parcels;
create policy "admin_update_fulfillment_parcels" on public.fulfillment_parcels
  for update to authenticated
  using (public.can_create_fulfilment() or public.can_manage_fulfilment())
  with check (public.can_create_fulfilment() or public.can_manage_fulfilment());

-- No delete for authenticated — Unique-native deletes may come via RPC later.
grant select, insert, update on public.fulfillment_parcels to authenticated;
revoke delete on public.fulfillment_parcels from authenticated;
grant all on public.fulfillment_parcels to service_role;

-- Preview-only: counts of multi-parcel candidates (no inserts).
create or replace function public.rpc_phase3b_fulfillment_parcels_preview_counts()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_dpd_multi bigint;
  v_dpd_total bigint;
  v_any_multi bigint;
begin
  if not public.can_view_fulfilment()
     and auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) filter (
           where jsonb_typeof(tracking_info) = 'array'
             and jsonb_array_length(tracking_info) > 1
         ),
         count(*)
  into v_dpd_multi, v_dpd_total
  from public.fulfillments
  where coalesce(carrier_provider, '') = 'dpd'
     or tracking_company ilike '%dpd%';

  select count(*)
  into v_any_multi
  from public.fulfillments
  where jsonb_typeof(tracking_info) = 'array'
    and jsonb_array_length(tracking_info) > 1;

  return jsonb_build_object(
    'ok', true,
    'dpd_fulfillments', v_dpd_total,
    'dpd_multi_tracking_info', v_dpd_multi,
    'any_multi_tracking_info', v_any_multi,
    'backfill_executed', false,
    'note', 'Report-only. Phase 3B does not insert fulfillment_parcels from tracking_info.'
  );
end;
$$;

grant execute on function public.rpc_phase3b_fulfillment_parcels_preview_counts()
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) ops_documents: allow shipping_label
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.ops_documents
  drop constraint if exists ops_documents_type_chk;

alter table public.ops_documents
  add constraint ops_documents_type_chk check (
    document_type in ('packing_slip', 'delivery_note', 'shipping_label')
  );

comment on table public.ops_documents is
  'Ops print documents (packing_slip / delivery_note / shipping_label). '
  'Separate from finance_documents. Append-oriented. '
  'shipping_label used for Unique-native carrier labels when product confirmed; '
  'Phase 3B does not generate live DPD labels.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) carrier_shipment_requests + admin RPCs (security invoker; no HTTP)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.carrier_shipment_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  fulfillment_id uuid references public.fulfillments(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'rejected', 'succeeded', 'failed')),
  error_code text,
  request_payload_redacted jsonb not null default '{}'::jsonb,
  response_redacted jsonb not null default '{}'::jsonb,
  external_reference text,
  carrier_provider text not null default 'dpd',
  carrier_mode text not null default 'disabled'
    check (carrier_mode in ('disabled', 'test', 'live')),
  created_by_staff_id uuid references public.staff_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_shipment_requests_idempotency_uidx unique (idempotency_key)
);

comment on table public.carrier_shipment_requests is
  'Unique-native carrier create-shipment request log (Worldpay-stub pattern). '
  'SQL never calls DPD HTTP. Phase 3B inserts rejected rows when gated. '
  'When product confirmed later, an edge function may process pending requests.';

create index if not exists carrier_shipment_requests_fulfillment_idx
  on public.carrier_shipment_requests (fulfillment_id)
  where fulfillment_id is not null;
create index if not exists carrier_shipment_requests_status_idx
  on public.carrier_shipment_requests (status, created_at desc);

alter table public.carrier_shipment_requests enable row level security;

drop policy if exists "admin_select_carrier_shipment_requests" on public.carrier_shipment_requests;
create policy "admin_select_carrier_shipment_requests" on public.carrier_shipment_requests
  for select to authenticated using (public.can_view_fulfilment());

drop policy if exists "admin_insert_carrier_shipment_requests" on public.carrier_shipment_requests;
create policy "admin_insert_carrier_shipment_requests" on public.carrier_shipment_requests
  for insert to authenticated with check (
    public.can_create_fulfilment() or public.can_manage_fulfilment()
  );

drop policy if exists "admin_update_carrier_shipment_requests" on public.carrier_shipment_requests;
create policy "admin_update_carrier_shipment_requests" on public.carrier_shipment_requests
  for update to authenticated
  using (public.can_manage_fulfilment())
  with check (public.can_manage_fulfilment());

grant select, insert, update on public.carrier_shipment_requests to authenticated;
revoke delete on public.carrier_shipment_requests from authenticated;
grant all on public.carrier_shipment_requests to service_role;

create or replace function public.rpc_admin_carrier_config_get()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_cfg public.carrier_gateway_config%rowtype;
begin
  if not public.can_view_fulfilment() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_cfg from public.carrier_gateway_config where key = 'default';

  return jsonb_build_object(
    'ok', true,
    'carrier_mode', v_cfg.carrier_mode,
    'provider', v_cfg.provider,
    'product_key', v_cfg.product_key,
    'product_status', v_cfg.product_status,
    'product_confirmed', public.carrier_product_confirmed(),
    'phase_3b_live_blocked', v_cfg.phase_3b_live_blocked,
    'test_credentials_present', v_cfg.test_credentials_present,
    'notes', v_cfg.notes,
    'gate', public.carrier_shipment_actions_permitted(),
    -- Explicitly no secrets
    'secrets_included', false
  );
end;
$$;

grant execute on function public.rpc_admin_carrier_config_get() to authenticated, service_role;

comment on function public.rpc_admin_carrier_config_get() is
  'Admin carrier gate summary. No secrets. Mode/product/live_blocked only.';

-- Validates + records request. Never invents success. Never calls external HTTP.
create or replace function public.rpc_admin_carrier_create_shipment(
  p_fulfillment_id uuid,
  p_idempotency_key text,
  p_request_payload_redacted jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_gate jsonb;
  v_mode text;
  v_f public.fulfillments%rowtype;
  v_existing public.carrier_shipment_requests%rowtype;
  v_id uuid;
  v_error text;
  v_status text := 'rejected';
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if not (public.can_create_fulfilment() or public.can_manage_fulfilment()) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'idempotency_key_required');
  end if;

  select * into v_existing
  from public.carrier_shipment_requests
  where idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', false,
      'duplicate', true,
      'error', coalesce(v_existing.error_code, v_existing.status),
      'request_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  if p_fulfillment_id is not null then
    select * into v_f from public.fulfillments where id = p_fulfillment_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'fulfillment_not_found');
    end if;
    if coalesce(v_f.source_system, '') = 'shopify'
       or coalesce(v_f.provenance, '') = 'shopify_imported' then
      return jsonb_build_object(
        'ok', false,
        'error', 'shopify_fulfillment_immutable',
        'note', 'Create Unique-native fulfillment first; do not mutate Shopify rows for live carrier ops'
      );
    end if;
  end if;

  v_gate := public.carrier_shipment_actions_permitted();
  v_mode := public.carrier_gateway_mode();
  v_error := coalesce(v_gate->>'error', 'carrier_disabled');

  if not coalesce((v_gate->>'allowed')::boolean, false) then
    insert into public.carrier_shipment_requests (
      idempotency_key, fulfillment_id, order_id, status, error_code,
      request_payload_redacted, response_redacted,
      carrier_provider, carrier_mode
    ) values (
      v_key,
      p_fulfillment_id,
      v_f.order_id,
      'rejected',
      v_error,
      coalesce(p_request_payload_redacted, '{}'::jsonb),
      jsonb_build_object(
        'ok', false,
        'error', v_error,
        'gate', v_gate,
        'note', 'SQL cannot call DPD HTTP; no invented endpoints or service codes'
      ),
      'dpd',
      v_mode
    )
    returning id into v_id;

    return jsonb_build_object(
      'ok', false,
      'error', v_error,
      'request_id', v_id,
      'status', 'rejected',
      'gate', v_gate,
      'carrier_mode', v_mode,
      'product_confirmed', public.carrier_product_confirmed()
    );
  end if;

  -- Allowed path (not reachable in Phase 3B with current seed): record pending
  -- for an edge function — still no HTTP from SQL, still no invented success.
  insert into public.carrier_shipment_requests (
    idempotency_key, fulfillment_id, order_id, status, error_code,
    request_payload_redacted, response_redacted,
    carrier_provider, carrier_mode
  ) values (
    v_key,
    p_fulfillment_id,
    v_f.order_id,
    'pending',
    null,
    coalesce(p_request_payload_redacted, '{}'::jsonb),
    jsonb_build_object(
      'ok', true,
      'status', 'pending',
      'note', 'Awaiting edge/adapter processing; SQL does not call DPD'
    ),
    'dpd',
    v_mode
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'pending',
    'request_id', v_id,
    'gate', v_gate,
    'note', 'Pending adapter/edge processing only — no live DPD call from SQL'
  );
end;
$$;

grant execute on function public.rpc_admin_carrier_create_shipment(uuid, text, jsonb)
  to authenticated, service_role;

comment on function public.rpc_admin_carrier_create_shipment(uuid, text, jsonb) is
  'Phase 3B stub: validates carrier gate, inserts rejected/pending request. '
  'Never calls DPD HTTP. Never invents success while product unconfirmed / mode disabled.';

-- Preview-only shipment event backfill counts (no inserts).
create or replace function public.rpc_phase3b_shipment_event_backfill_preview()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tracking_added bigint;
  v_delivered bigint;
  v_ofd bigint;
  v_in_transit bigint;
  v_not_delivered bigint;
begin
  if not public.can_view_fulfilment()
     and auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select
    count(*) filter (
      where tracking_number is not null and btrim(tracking_number) <> ''
    ),
    count(*) filter (
      where upper(coalesce(display_status, '')) = 'DELIVERED'
         or delivered_at is not null
    ),
    count(*) filter (
      where upper(coalesce(display_status, '')) = 'OUT_FOR_DELIVERY'
    ),
    count(*) filter (
      where upper(coalesce(display_status, '')) = 'IN_TRANSIT'
         or in_transit_at is not null
    ),
    count(*) filter (
      where upper(coalesce(display_status, '')) in ('NOT_DELIVERED', 'FAILED')
    )
  into v_tracking_added, v_delivered, v_ofd, v_in_transit, v_not_delivered
  from public.fulfillments
  where coalesce(carrier_provider, '') = 'dpd'
     or tracking_company ilike '%dpd%';

  return jsonb_build_object(
    'ok', true,
    'backfill_executed', false,
    'proposed_tracking_added', v_tracking_added,
    'proposed_delivered', v_delivered,
    'proposed_ofd', v_ofd,
    'proposed_in_transit', v_in_transit,
    'proposed_not_delivered', v_not_delivered,
    'source', 'shopify_import',
    'note',
      'Counts only. Source would be shopify_import (WSA/DPD Delivery Status footprint), '
      'NOT direct DPD API. Do not insert shipment_events in Phase 3B foundation.',
    'confidence',
      jsonb_build_object(
        'tracking_urls', 'confirmed UK Local/national hosts in historical data',
        'api_family', 'unconfirmed',
        'direct_dpd_events', 'none — Shopify-imported display_status / tracking only',
        'standard_delivery_mapping', 'do not infer DPD service from Standard Delivery title'
      )
  );
end;
$$;

grant execute on function public.rpc_phase3b_shipment_event_backfill_preview()
  to authenticated, service_role;

comment on function public.rpc_phase3b_shipment_event_backfill_preview() is
  'Phase 3B preview: proposed shipment_event backfill counts from DPD Shopify fulfillments. No inserts.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) Selftest
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase3b_carrier_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := 'PHASE3B-CARRIER-';
  v_cases jsonb := '[]'::jsonb;
  v_case_ok boolean;
  v_detail text;
  v_mode text;
  v_confirmed boolean;
  v_gate jsonb;
  v_rpc jsonb;
  v_preview jsonb;
  v_dpd_count bigint;
  v_pay_mode text;
  v_inactive int;
  v_null_codes int;
  v_inv_before bigint;
  v_inv_after bigint;
  v_cleanup_ok boolean := true;
  v_cleanup_detail text := 'ok';
  v_all_ok boolean;
  v_el jsonb;
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is not null then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  -- Pre-cleanup any prior synthetic requests
  delete from public.carrier_shipment_requests
  where idempotency_key like v_prefix || '%';

  select coalesce(sum(inventory_count), 0) into v_inv_before from public.products;

  -- A mode disabled
  begin
    v_mode := public.carrier_gateway_mode();
    v_case_ok := v_mode = 'disabled';
    v_detail := 'carrier_mode=' || coalesce(v_mode, 'null');
    v_cases := v_cases || jsonb_build_object('A_mode_disabled', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_mode_disabled', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- B product unconfirmed
  begin
    v_confirmed := public.carrier_product_confirmed();
    v_case_ok := v_confirmed = false
      and exists (
        select 1 from public.carrier_gateway_config
        where key = 'default'
          and product_status = 'unconfirmed'
          and phase_3b_live_blocked = true
          and test_credentials_present = false
      );
    v_detail := 'product_confirmed=' || v_confirmed::text;
    v_cases := v_cases || jsonb_build_object('B_product_unconfirmed', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_product_unconfirmed', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- C create shipment rejected (gate + optional request row)
  begin
    v_gate := public.carrier_shipment_actions_permitted();
    v_rpc := public.rpc_admin_carrier_create_shipment(
      null,
      v_prefix || 'idem-1',
      jsonb_build_object('phase', '3b', 'selftest', true)
    );
    -- Without admin session: Forbidden; with caps: carrier_disabled.
    -- Gate helper must independently report carrier_disabled.
    v_case_ok :=
      coalesce((v_gate->>'allowed')::boolean, true) = false
      and coalesce(v_gate->>'error', '') = 'carrier_disabled'
      and coalesce(v_rpc->>'ok', 'true') = 'false'
      and coalesce(v_rpc->>'error', '') in (
        'Forbidden', 'carrier_disabled', 'dpd_product_unconfirmed'
      );
    v_detail := format('gate=%s rpc=%s', v_gate->>'error', v_rpc->>'error');
    v_cases := v_cases || jsonb_build_object('C_create_shipment_rejected', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_create_shipment_rejected', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- D service mappings inactive / null codes
  begin
    select count(*) filter (where is_active),
           count(*) filter (where carrier_service_code is not null)
    into v_inactive, v_null_codes
    from public.carrier_service_mappings
    where carrier_provider = 'dpd'
      and shipping_title_pattern in ('Standard Delivery', 'Saturday', 'Free Delivery', 'Next Day');

    -- v_inactive here counts active=true (should be 0); v_null_codes counts non-null codes (should be 0)
    v_case_ok := coalesce(v_inactive, -1) = 0
      and coalesce(v_null_codes, -1) = 0
      and (
        select count(*) from public.carrier_service_mappings
        where carrier_provider = 'dpd'
          and shipping_title_pattern in ('Standard Delivery', 'Saturday', 'Free Delivery', 'Next Day')
      ) >= 4;
    v_detail := format('active=%s nonnull_codes=%s', v_inactive, v_null_codes);
    v_cases := v_cases || jsonb_build_object('D_mappings_inactive_null_codes', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_mappings_inactive_null_codes', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- E carrier_provider backfill dpd count > 0
  begin
    select count(*) into v_dpd_count
    from public.fulfillments
    where carrier_provider = 'dpd'
      and coalesce(source_system, '') = 'shopify';
    v_case_ok := coalesce(v_dpd_count, 0) > 0;
    v_detail := format('shopify_dpd_provider_count=%s', v_dpd_count);
    v_cases := v_cases || jsonb_build_object('E_carrier_provider_backfill_dpd', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_carrier_provider_backfill_dpd', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- F payment gateway_mode still disabled
  begin
    v_pay_mode := public.payment_gateway_mode();
    v_case_ok := v_pay_mode = 'disabled';
    v_detail := 'payment_gateway_mode=' || coalesce(v_pay_mode, 'null');
    v_cases := v_cases || jsonb_build_object('F_payment_gateway_still_disabled', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_payment_gateway_still_disabled', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- G preview backfill returns counts
  begin
    v_preview := public.rpc_phase3b_shipment_event_backfill_preview();
    v_case_ok := coalesce(v_preview->>'ok', 'false') = 'true'
      and coalesce((v_preview->>'backfill_executed')::boolean, true) = false
      and v_preview ? 'proposed_tracking_added'
      and v_preview ? 'proposed_delivered'
      and v_preview ? 'proposed_ofd'
      and v_preview ? 'proposed_in_transit'
      and v_preview ? 'proposed_not_delivered';
    v_detail := format(
      'tracking=%s delivered=%s ofd=%s',
      v_preview->>'proposed_tracking_added',
      v_preview->>'proposed_delivered',
      v_preview->>'proposed_ofd'
    );
    v_cases := v_cases || jsonb_build_object('G_preview_backfill_counts', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_preview_backfill_counts', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- H cleanup synthetic + inventory unchanged + shopify still immutable for tracking
  begin
    delete from public.carrier_shipment_requests
    where idempotency_key like v_prefix || '%';

    select coalesce(sum(inventory_count), 0) into v_inv_after from public.products;
    v_cleanup_ok := v_inv_after = v_inv_before
      and not exists (
        select 1 from public.carrier_shipment_requests
        where idempotency_key like v_prefix || '%'
      );

    -- Shopify historical rows: mutating tracking_company must still fail
    begin
      update public.fulfillments
      set tracking_company = tracking_company || ' X'
      where id = (
        select f.id
        from public.fulfillments f
        where coalesce(f.source_system, '') = 'shopify'
          and f.tracking_company is not null
        limit 1
      );
      v_cleanup_ok := false;
      v_cleanup_detail := 'Shopify tracking_company UPDATE unexpectedly allowed';
    exception when others then
      if SQLERRM ilike '%immutable%' then
        v_cleanup_detail := format(
          'cleaned; inventory_unchanged=%s; shopify_immutable_ok',
          (v_inv_after = v_inv_before)::text
        );
      else
        v_cleanup_ok := false;
        v_cleanup_detail := SQLERRM;
      end if;
    end;

    v_cases := v_cases || jsonb_build_object(
      'H_cleanup_inventory_shopify_immutable',
      jsonb_build_object('ok', v_cleanup_ok, 'detail', v_cleanup_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'H_cleanup_inventory_shopify_immutable',
      jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  v_all_ok := true;
  for v_el in select * from jsonb_array_elements(v_cases)
  loop
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
      'Carrier/fulfilment ops must not decrement inventory; reservation at checkout; deduction on payment.',
    'skulabs_boundary',
      'SKULabs remains external WMS — Phase 3B does not integrate or replace SKULabs.',
    'live_dpd', false,
    'payment_gateway_untouched', true
  );
end;
$$;

comment on function public.rpc_phase3b_carrier_selftest() is
  'Phase 3B carrier foundation selftest. service_role only. '
  'Verifies disabled mode, unconfirmed product, rejected create, inactive mappings, '
  'dpd backfill, payment gateway still disabled, preview counts, cleanup. '
  'Does not enable live DPD or change inventory.';

revoke all on function public.rpc_phase3b_carrier_selftest() from public;
revoke all on function public.rpc_phase3b_carrier_selftest() from anon;
revoke all on function public.rpc_phase3b_carrier_selftest() from authenticated;
grant execute on function public.rpc_phase3b_carrier_selftest() to service_role;

commit;
