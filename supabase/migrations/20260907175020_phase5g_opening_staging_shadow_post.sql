-- Phase 5G part 2 — staging build, shadow import/post, rehearsals, readiness, selftest

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- Inventory source baseline + open-order exposure
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5g_inventory_baseline()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fin jsonb;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  begin
    v_fin := public.finance_cutover_readiness_status();
  exception when others then
    v_fin := jsonb_build_object('status', 'REVIEW_REQUIRED');
  end;

  return jsonb_build_object(
    'ok', true,
    'metrics', jsonb_build_object(
      'inventory_items_snapshots', (select count(*) from shopify_inventory_snapshots),
      'variants', (select count(*) from product_variants),
      'products', (select count(*) from products),
      'tracked_snapshot_rows', (select count(*) from shopify_inventory_snapshots where tracked is true),
      'untracked_snapshot_rows', (select count(*) from shopify_inventory_snapshots where tracked is false or tracked is null),
      'sum_available', (select coalesce(sum(available),0) from shopify_inventory_snapshots),
      'sum_on_hand', (select coalesce(sum(on_hand),0) from shopify_inventory_snapshots),
      'sum_committed', (select coalesce(sum(committed),0) from shopify_inventory_snapshots),
      'sum_incoming', (select coalesce(sum(incoming),0) from shopify_inventory_snapshots),
      'snapshot_to_variant_exact_matches', (
        select count(*) from shopify_inventory_snapshots s
        join product_variants v on v.shopify_inventory_item_gid = s.shopify_inventory_item_gid
      ),
      'missing_sku_variants', (select count(*) from product_variants where coalesce(nullif(btrim(sku),''),'') = ''),
      'duplicate_sku_groups', (
        select count(*) from (
          select 1 from product_variants where coalesce(nullif(btrim(sku),''),'') <> ''
          group by lower(btrim(sku)) having count(*) > 1
        ) z
      ),
      'missing_barcode_variants', (select count(*) from product_variants where coalesce(nullif(btrim(barcode),''),'') = ''),
      'duplicate_barcode_groups', (
        select count(*) from (
          select 1 from product_variants where coalesce(nullif(btrim(barcode),''),'') <> ''
          group by lower(btrim(barcode)) having count(*) > 1
        ) z
      ),
      'inventory_reservations', (select count(*) from inventory_reservations),
      'orders_unfulfilled', (select count(*) from orders where lower(coalesce(fulfillment_status,'')) = 'unfulfilled'),
      'orders_processing', (select count(*) from orders where lower(coalesce(fulfillment_status,'')) = 'processing')
    ),
    'source_semantics', jsonb_build_object(
      'ON_HAND', 'Physical/system quantity at location including stock already committed to orders',
      'AVAILABLE', 'ON_HAND minus COMMITTED (sellable remainder in Shopify semantics)',
      'COMMITTED', 'Reserved against open/unfulfilled demand in Shopify',
      'INCOMING', 'Expected inbound — NOT physical on hand',
      'not_interchangeable', true
    ),
    'opening_basis_options', jsonb_build_array(
      jsonb_build_object('code','SHOPIFY_ON_HAND','represents','Shopify on_hand incl. committed',
        'advantage','Closest to physical warehouse quantity if Shopify synced','risk','Double-count if Unique also allocates open orders without importing commitments','cutover_requirement','Either seed ALLOCATED from open demand OR freeze Shopify fulfilments'),
      jsonb_build_object('code','SHOPIFY_AVAILABLE','represents','Shopify available (net of committed)',
        'advantage','Avoids importing committed as free stock','risk','Understates physical if committed still sits in warehouse; open orders then re-allocate','cutover_requirement','Allocate open unfulfilled after opening WITHOUT subtracting committed again'),
      jsonb_build_object('code','PHYSICAL_COUNT','represents','Warehouse counted quantity','advantage','Ground truth','risk','Operational cost/time','cutover_requirement','Count sheets + variance review'),
      jsonb_build_object('code','VERIFIED_WAREHOUSE_EXPORT','represents','Trusted WMS/export file','advantage','May include bin detail','risk','SKULabs access unavailable historically','cutover_requirement','Signed export + checksum'),
      jsonb_build_object('code','RECONCILED_PHYSICAL_SYSTEM','represents','Physical + system reconciled approved qty','advantage','Defensible opening','risk','Requires process','cutover_requirement','Business/warehouse approval')
    ),
    'preferred_production_basis', 'BUSINESS_APPROVAL_REQUIRED — do not silent-choose AVAILABLE or ON_HAND',
    'committed_cutover_semantics', jsonb_build_object(
      'forbid', 'opening ON_HAND + re-allocate open orders without accounting for COMMITTED',
      'forbid_also', 'opening AVAILABLE then subtracting COMMITTED again',
      'allowed_patterns', jsonb_build_array(
        'OPENING=ON_HAND then seed ALLOCATED from open unfulfilled demand (no second Shopify committed subtract)',
        'OPENING=AVAILABLE then allocate open orders after cutover (AVAILABLE already net)'
      )
    ),
    'draft_reservation', jsonb_build_object(
      'inventory_reservations_count', (select count(*) from inventory_reservations),
      'historical_shopify_drafts', 'Do not assume drafts reserve inventory',
      'future_decision', jsonb_build_array('NOT_RESERVE','SOFT_RESERVE','HARD_RESERVE'),
      'recommendation_default', 'NOT_RESERVE until business decides',
      'no_historical_backfill', true
    ),
    'incoming_stock_decision', jsonb_build_object(
      'do_not_include_in_opening_on_hand', true,
      'options', jsonb_build_array('open_inbound_reference','separate_expected_stock','ignore_until_physical_receipt'),
      'required_business_decision', true
    ),
    'negative_inventory_policy', jsonb_build_object(
      'on_hand', 'PREVENT (allocation/pick must fail when available insufficient)',
      'available', 'DERIVED on_hand - allocated; never write directly',
      'race_protection', 'SELECT FOR UPDATE on inventory_balances'
    ),
    'reservation_model', jsonb_build_object(
      'inventory_reservations', 'DEPRECATED for WMS SoT — map future demand to inventory_allocations',
      'do_not_maintain_two_systems', true
    ),
    'finance_readiness', coalesce(v_fin->>'status', 'REVIEW_REQUIRED'),
    'wms_enabled', (select value from site_settings where key='wms_enabled' limit 1),
    'locations', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from wms_location_classifications c)
  );
end;
$$;

revoke all on function public.rpc_phase5g_inventory_baseline() from public, anon;
grant execute on function public.rpc_phase5g_inventory_baseline() to authenticated, service_role;

create or replace function public.rpc_phase5g_open_order_stock_exposure()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders bigint;
  v_lines bigint;
  v_units numeric;
  v_skus bigint;
  v_unmapped bigint;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(distinct o.id),
         count(oi.id),
         coalesce(sum(oi.quantity),0),
         count(distinct coalesce(oi.variant_id::text, oi.sku_snapshot)),
         count(*) filter (where oi.variant_id is null and coalesce(nullif(btrim(oi.sku_snapshot),''),'') = '')
  into v_orders, v_lines, v_units, v_skus, v_unmapped
  from orders o
  join order_items oi on oi.order_id = o.id
  where lower(coalesce(o.fulfillment_status,'')) in ('unfulfilled','processing','partial','partially_fulfilled');

  return jsonb_build_object(
    'ok', true,
    'orders_requiring_stock', v_orders,
    'lines', v_lines,
    'units', v_units,
    'skus_or_variant_keys', v_skus,
    'unmapped_lines', v_unmapped,
    'note', 'Exposure only — no production allocation',
    'partial_fulfilment_cases', (
      select count(*) from orders
      where lower(coalesce(fulfillment_status,'')) in ('partial','partially_fulfilled')
    )
  );
end;
$$;

revoke all on function public.rpc_phase5g_open_order_stock_exposure() from public, anon;
grant execute on function public.rpc_phase5g_open_order_stock_exposure() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Build staging from Shopify snapshots (candidate only)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5g_build_opening_staging(
  p_batch_code text,
  p_source_basis text default 'SHOPIFY_ON_HAND',
  p_target_warehouse_code text default 'UD_SHADOW'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_rows int := 0;
  v_units numeric := 0;
  v_map_err int := 0;
  v_review int := 0;
  v_ts timestamptz;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if p_source_basis not in ('SHOPIFY_ON_HAND','SHOPIFY_AVAILABLE','PHYSICAL_COUNT','VERIFIED_WAREHOUSE_EXPORT','RECONCILED_PHYSICAL_SYSTEM') then
    return jsonb_build_object('ok', false, 'error', 'invalid_source_basis');
  end if;
  -- Production warehouse staging allowed for preview, but posting blocked elsewhere
  if p_target_warehouse_code not in ('UD_SHADOW', 'UD_WH_1') then
    return jsonb_build_object('ok', false, 'error', 'invalid_warehouse');
  end if;

  select max(snapshot_at) into v_ts from shopify_inventory_snapshots;

  insert into wms_opening_batches (
    batch_code, source_system, source_timestamp, target_warehouse_code, source_basis, status, created_by, notes
  ) values (
    p_batch_code, 'shopify_inventory_snapshots', v_ts, p_target_warehouse_code, p_source_basis, 'STAGED', auth.uid(),
    'Phase 5G candidate staging — not production posted'
  )
  on conflict (batch_code) do update set
    source_timestamp = excluded.source_timestamp,
    source_basis = excluded.source_basis,
    target_warehouse_code = excluded.target_warehouse_code,
    status = 'STAGED',
    updated_at = now()
  returning id into v_batch_id;

  delete from wms_opening_staging where batch_id = v_batch_id;

  insert into wms_opening_staging (
    batch_id, warehouse_code, location_code,
    shopify_inventory_item_gid, shopify_variant_gid, shopify_location_gid,
    product_id, variant_id, sku, barcode, identity_class,
    source_on_hand, source_available, source_committed, source_incoming,
    source_quantity, source_basis, status, source_timestamp, reconciliation_note
  )
  select
    v_batch_id,
    p_target_warehouse_code,
    case when p_target_warehouse_code = 'UD_SHADOW' then 'SHADOW_DEFAULT' else 'DEFAULT' end,
    s.shopify_inventory_item_gid,
    coalesce(s.shopify_variant_gid, v.shopify_variant_gid),
    s.shopify_location_gid,
    v.product_id,
    v.id,
    coalesce(nullif(btrim(v.sku),''), nullif(btrim(s.sku),'')),
    coalesce(nullif(btrim(v.barcode),''), nullif(btrim(s.barcode),'')),
    case
      when v.id is null then 'MISSING_VARIANT'
      when v.shopify_inventory_item_gid is not null then 'EXACT_SOURCE_ID_MATCH'
      else 'VALID'
    end,
    s.on_hand, s.available, s.committed, s.incoming,
    case
      when p_source_basis = 'SHOPIFY_AVAILABLE' then coalesce(s.available, 0)
      else coalesce(s.on_hand, 0)
    end,
    p_source_basis,
    case when v.id is null then 'REVIEW_REQUIRED' else 'MAPPED' end,
    s.snapshot_at,
    case when v.id is null then 'No Unique variant for inventory_item_gid' else null end
  from shopify_inventory_snapshots s
  left join product_variants v on v.shopify_inventory_item_gid = s.shopify_inventory_item_gid
  where coalesce(s.location_name, '') = 'UD WH 1'
     or exists (
       select 1 from wms_location_classifications c
       where c.shopify_location_name = s.location_name and c.include_in_opening
     );

  select count(*), coalesce(sum(source_quantity),0),
         count(*) filter (where variant_id is null),
         count(*) filter (where status = 'REVIEW_REQUIRED')
  into v_rows, v_units, v_map_err, v_review
  from wms_opening_staging where batch_id = v_batch_id;

  -- Flag duplicate SKU rows as review (still mapped by variant id)
  update wms_opening_staging st
  set identity_class = 'DUPLICATE_SKU',
      status = case when status = 'MAPPED' then 'REVIEW_REQUIRED' else status end,
      reconciliation_note = coalesce(reconciliation_note, 'SKU belongs to duplicate group — identity remains variant_id')
  where batch_id = v_batch_id
    and sku is not null
    and exists (
      select 1 from wms_identity_reviews r
      where r.review_type = 'DUPLICATE_SKU' and r.identity_key = lower(btrim(st.sku))
    );

  update wms_opening_batches set
    row_count = v_rows,
    unit_total = v_units,
    mapping_errors = v_map_err,
    review_errors = (select count(*) from wms_opening_staging where batch_id = v_batch_id and status = 'REVIEW_REQUIRED'),
    status = case when v_map_err > 0 or v_review > 0 then 'REVIEW_REQUIRED' else 'STAGED' end,
    updated_at = now()
  where id = v_batch_id;

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'batch_code', p_batch_code,
    'rows', v_rows,
    'units', v_units,
    'mapping_errors', v_map_err,
    'target_warehouse', p_target_warehouse_code,
    'source_basis', p_source_basis,
    'posted', false,
    'note', 'Staging only — no WMS ledger write'
  );
end;
$$;

revoke all on function public.rpc_phase5g_build_opening_staging(text, text, text) from public, anon;
grant execute on function public.rpc_phase5g_build_opening_staging(text, text, text) to authenticated, service_role;

-- Approve staging rows (owner/admin) — does not post
create or replace function public.rpc_phase5g_approve_opening_batch(
  p_batch_id uuid,
  p_approve_mapped_only boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch public.wms_opening_batches%rowtype;
  v_n int;
begin
  if not public.current_admin_is_owner_or_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden — opening approval requires owner/admin');
  end if;

  select * into v_batch from wms_opening_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'batch_not_found');
  end if;

  update wms_opening_staging
  set status = 'APPROVED',
      approved_quantity = coalesce(approved_quantity, source_quantity)
  where batch_id = p_batch_id
    and status in ('MAPPED', 'APPROVED', 'READY_TO_POST')
    and (not p_approve_mapped_only or variant_id is not null);
  get diagnostics v_n = row_count;

  update wms_opening_batches set
    approved_rows = v_n,
    approved_by = auth.uid(),
    approved_at = now(),
    status = 'APPROVED',
    updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object('ok', true, 'approved_rows', v_n, 'batch_id', p_batch_id, 'posted', false);
end;
$$;

revoke all on function public.rpc_phase5g_approve_opening_batch(uuid, boolean) from public, anon;
grant execute on function public.rpc_phase5g_approve_opening_batch(uuid, boolean) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Post opening — SHADOW always; production UD_WH_1 hard-gated OFF
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5g_post_opening_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.wms_opening_batches%rowtype;
  v_wh uuid;
  v_loc uuid;
  v_loc_code text;
  v_posted int := 0;
  v_units numeric := 0;
  v_auth text;
  r record;
  v_existing int;
begin
  if auth.uid() is not null and not public.current_admin_is_owner_or_admin() and not public.is_admin() then
    -- service_role (null uid) allowed for shadow selftests
    if auth.uid() is not null then
      return jsonb_build_object('ok', false, 'error', 'Forbidden');
    end if;
  end if;

  select * into v_batch from wms_opening_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'batch_not_found');
  end if;

  if v_batch.target_warehouse_code = 'UD_WH_1' then
    select value into v_auth from site_settings where key = 'wms_opening_post_authorized' limit 1;
    if coalesce(v_auth, 'false') <> 'true' then
      return jsonb_build_object(
        'ok', false,
        'error', 'PRODUCTION_OPENING_BLOCKED',
        'message', 'UD_WH_1 opening post disabled. Use UD_SHADOW. Do not set wms_opening_post_authorized in Phase 5G.'
      );
    end if;
    if coalesce((select value from site_settings where key='wms_enabled'),'false') = 'true' then
      return jsonb_build_object('ok', false, 'error', 'Refuse — unexpected wms_enabled');
    end if;
  end if;

  if v_batch.status not in ('APPROVED', 'SHADOW_POSTED', 'READY_TO_POST') then
    return jsonb_build_object('ok', false, 'error', 'batch_not_approved', 'status', v_batch.status);
  end if;

  select id into v_wh from warehouses where code = v_batch.target_warehouse_code;
  v_loc_code := case when v_batch.target_warehouse_code = 'UD_SHADOW' then 'SHADOW_DEFAULT' else 'DEFAULT' end;
  select id into v_loc from warehouse_locations where warehouse_id = v_wh and code = v_loc_code;
  if v_wh is null or v_loc is null then
    return jsonb_build_object('ok', false, 'error', 'warehouse_or_location_missing');
  end if;

  -- Idempotency: refuse duplicate OPENING for same batch+variant
  select count(*) into v_existing
  from inventory_movements m
  where m.warehouse_id = v_wh
    and m.movement_type = 'OPENING'
    and m.metadata->>'opening_batch_id' = p_batch_id::text;
  if v_existing > 0 then
    return jsonb_build_object('ok', false, 'error', 'duplicate_batch', 'existing_movements', v_existing);
  end if;

  for r in
    select * from wms_opening_staging
    where batch_id = p_batch_id
      and status in ('APPROVED', 'READY_TO_POST')
      and variant_id is not null
      and coalesce(approved_quantity, source_quantity) >= 0
  loop
    insert into inventory_movements (
      warehouse_id, location_id, product_id, variant_id, sku,
      movement_type, quantity_delta, reason, reference_type, reference_id, metadata
    ) values (
      v_wh, v_loc, r.product_id, r.variant_id, r.sku,
      'OPENING', coalesce(r.approved_quantity, r.source_quantity),
      'Phase5G opening batch ' || v_batch.batch_code,
      'wms_opening_batch', p_batch_id,
      jsonb_build_object(
        'opening_batch_id', p_batch_id,
        'source_basis', r.source_basis,
        'shadow', v_batch.target_warehouse_code = 'UD_SHADOW',
        'shopify_inventory_item_gid', r.shopify_inventory_item_gid
      )
    );

    insert into inventory_balances (warehouse_id, location_id, product_id, variant_id, sku, on_hand, allocated)
    values (v_wh, v_loc, r.product_id, r.variant_id, r.sku, coalesce(r.approved_quantity, r.source_quantity), 0)
    on conflict (warehouse_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set
      on_hand = excluded.on_hand,
      sku = excluded.sku,
      updated_at = now();

    v_posted := v_posted + 1;
    v_units := v_units + coalesce(r.approved_quantity, r.source_quantity);
  end loop;

  update wms_opening_batches set
    status = case when target_warehouse_code = 'UD_SHADOW' then 'SHADOW_POSTED' else 'POSTED' end,
    metadata = metadata || jsonb_build_object('posted_rows', v_posted, 'posted_units', v_units, 'posted_at', now()),
    updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'ok', true,
    'posted_rows', v_posted,
    'posted_units', v_units,
    'warehouse', v_batch.target_warehouse_code,
    'wms_enabled', (select value from site_settings where key='wms_enabled' limit 1)
  );
end;
$$;

revoke all on function public.rpc_phase5g_post_opening_batch(uuid) from public, anon;
grant execute on function public.rpc_phase5g_post_opening_batch(uuid) to authenticated, service_role;

-- Shadow reconcile: source = opening ledger = balance
create or replace function public.rpc_phase5g_shadow_reconcile(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_src numeric;
  v_mov numeric;
  v_bal numeric;
  v_mismatch bigint;
begin
  select id into v_wh from warehouses where code = 'UD_SHADOW';

  select coalesce(sum(coalesce(approved_quantity, source_quantity)),0)
  into v_src
  from wms_opening_staging
  where batch_id = p_batch_id and status in ('APPROVED','READY_TO_POST') and variant_id is not null;

  select coalesce(sum(quantity_delta),0) into v_mov
  from inventory_movements
  where warehouse_id = v_wh and movement_type = 'OPENING'
    and metadata->>'opening_batch_id' = p_batch_id::text;

  select coalesce(sum(on_hand),0) into v_bal
  from inventory_balances where warehouse_id = v_wh;

  select count(*) into v_mismatch
  from wms_opening_staging st
  where st.batch_id = p_batch_id
    and st.variant_id is not null
    and st.status in ('APPROVED','READY_TO_POST')
    and coalesce(st.approved_quantity, st.source_quantity)
        is distinct from coalesce((
          select b.on_hand from inventory_balances b
          where b.warehouse_id = v_wh and b.variant_id = st.variant_id
          limit 1
        ), -1);

  return jsonb_build_object(
    'ok', v_src = v_mov and v_mov = v_bal and v_mismatch = 0,
    'source_candidate_qty', v_src,
    'opening_ledger_qty', v_mov,
    'shadow_balance_qty', v_bal,
    'row_mismatches', v_mismatch,
    'rule', 'SOURCE = OPENING LEDGER = SHADOW BALANCE (approved mapped rows)'
  );
end;
$$;

revoke all on function public.rpc_phase5g_shadow_reconcile(uuid) from public, anon;
grant execute on function public.rpc_phase5g_shadow_reconcile(uuid) to authenticated, service_role;

-- Compensating reversal design for shadow (rollback rehearsal — not production)
create or replace function public.rpc_phase5g_shadow_opening_reversal(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_n int := 0;
  r record;
begin
  select id into v_wh from warehouses where code = 'UD_SHADOW';
  if v_wh is null then
    return jsonb_build_object('ok', false, 'error', 'SHADOW_MISSING');
  end if;

  -- Do not delete immutable movements — post compensating CORRECTION
  for r in
    select * from inventory_movements
    where warehouse_id = v_wh and movement_type = 'OPENING'
      and metadata->>'opening_batch_id' = p_batch_id::text
  loop
    insert into inventory_movements (
      warehouse_id, location_id, product_id, variant_id, sku,
      movement_type, quantity_delta, reason, reference_type, reference_id, metadata
    ) values (
      r.warehouse_id, r.location_id, r.product_id, r.variant_id, r.sku,
      'CORRECTION', -r.quantity_delta,
      'Phase5G shadow opening reversal',
      'wms_opening_batch_reversal', p_batch_id,
      jsonb_build_object('reverses_movement_id', r.id, 'opening_batch_id', p_batch_id, 'shadow', true)
    );
    update inventory_balances
    set on_hand = on_hand - r.quantity_delta, updated_at = now()
    where warehouse_id = v_wh and variant_id is not distinct from r.variant_id;
    v_n := v_n + 1;
  end loop;

  update wms_opening_batches set status = 'REVERSED', updated_at = now() where id = p_batch_id;

  return jsonb_build_object(
    'ok', true,
    'reversed_movements', v_n,
    'mechanism', 'compensating CORRECTION movements — never delete OPENING ledger rows',
    'production_note', 'Same pattern for abort-after-post; prefer pre-activation transaction when possible'
  );
end;
$$;

revoke all on function public.rpc_phase5g_shadow_opening_reversal(uuid) from public, anon;
grant execute on function public.rpc_phase5g_shadow_opening_reversal(uuid) to authenticated, service_role;

commit;
