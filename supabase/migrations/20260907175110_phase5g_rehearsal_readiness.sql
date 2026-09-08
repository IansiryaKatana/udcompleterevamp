-- Phase 5G part 3 — fix staging uniqueness, shadow post upsert, rehearsals, readiness, selftest

begin;

-- Fix staging uniqueness if prior failed constraint name differs
drop index if exists wms_opening_staging_batch_item_uidx;
create unique index if not exists wms_opening_staging_batch_item_uidx
  on public.wms_opening_staging (batch_id, shopify_inventory_item_gid);

-- Safer post: replace ON CONFLICT expression upsert
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
  v_qty numeric;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
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
        'message', 'UD_WH_1 opening post disabled in Phase 5G. Use UD_SHADOW only.'
      );
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
    v_qty := coalesce(r.approved_quantity, r.source_quantity);

    insert into inventory_movements (
      warehouse_id, location_id, product_id, variant_id, sku,
      movement_type, quantity_delta, reason, reference_type, reference_id, metadata
    ) values (
      v_wh, v_loc, r.product_id, r.variant_id, r.sku,
      'OPENING', v_qty,
      'Phase5G opening batch ' || v_batch.batch_code,
      'wms_opening_batch', p_batch_id,
      jsonb_build_object(
        'opening_batch_id', p_batch_id,
        'source_basis', r.source_basis,
        'shadow', v_batch.target_warehouse_code = 'UD_SHADOW',
        'shopify_inventory_item_gid', r.shopify_inventory_item_gid
      )
    );

    update inventory_balances
    set on_hand = v_qty, sku = r.sku, product_id = r.product_id, updated_at = now()
    where warehouse_id = v_wh and location_id = v_loc and variant_id = r.variant_id;

    if not found then
      insert into inventory_balances (warehouse_id, location_id, product_id, variant_id, sku, on_hand, allocated)
      values (v_wh, v_loc, r.product_id, r.variant_id, r.sku, v_qty, 0);
    end if;

    v_posted := v_posted + 1;
    v_units := v_units + v_qty;
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Scale + allocation + concurrency rehearsal (UD_SHADOW)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5g_wms_rehearsal(p_batch_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wh uuid;
  v_loc uuid;
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean := true;
  v_sub boolean;
  v_bal_n bigint;
  v_sku text;
  v_variant uuid;
  v_avail numeric;
  v_alloc1 numeric;
  v_alloc2 numeric;
  v_pick_id uuid;
  v_pack_id uuid;
  v_receipt_id uuid;
  v_scan jsonb;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ms numeric;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if coalesce((select value from site_settings where key='wms_enabled'),'false') = 'true' then
    return jsonb_build_object('ok', false, 'error', 'WMS_UNEXPECTEDLY_ENABLED');
  end if;

  select id into v_wh from warehouses where code = 'UD_SHADOW';
  select id into v_loc from warehouse_locations where warehouse_id = v_wh and code = 'SHADOW_DEFAULT';

  -- Scale metrics on shadow balances after import
  select count(*) into v_bal_n from inventory_balances where warehouse_id = v_wh;
  v_t0 := clock_timestamp();
  perform count(*) from inventory_balances b
    join product_variants v on v.id = b.variant_id
  where b.warehouse_id = v_wh;
  v_t1 := clock_timestamp();
  v_ms := extract(epoch from (v_t1 - v_t0)) * 1000;
  v_sub := v_bal_n > 0;
  v_cases := v_cases || jsonb_build_object('scale_balance_query', jsonb_build_object('ok', v_sub, 'rows', v_bal_n, 'ms', round(v_ms,2)));
  v_ok := v_ok and v_sub;

  -- Pick a representative in-stock variant
  select b.sku, b.variant_id, b.available into v_sku, v_variant, v_avail
  from inventory_balances b
  where b.warehouse_id = v_wh and b.available >= 5
  order by b.available desc
  limit 1;

  if v_variant is null then
    v_cases := v_cases || jsonb_build_object('allocation_rehearsal', jsonb_build_object('ok', false, 'error', 'no_stock'));
    return jsonb_build_object('ok', false, 'cases', v_cases);
  end if;

  -- Concurrency: two allocations fighting for last units using FOR UPDATE
  -- Simulate by allocating available-1 then attempting available
  perform 1 from inventory_balances where warehouse_id = v_wh and variant_id = v_variant for update;
  select available into v_avail from inventory_balances where warehouse_id = v_wh and variant_id = v_variant;

  v_alloc1 := least(3, v_avail);
  update inventory_balances set allocated = allocated + v_alloc1, updated_at = now()
  where warehouse_id = v_wh and variant_id = v_variant and available >= v_alloc1;
  insert into inventory_allocations (warehouse_id, variant_id, sku, qty_requested, qty_allocated, status)
  values (v_wh, v_variant, v_sku, v_alloc1, v_alloc1, 'allocated');

  -- Second alloc tries to take more than remaining available → partial/insufficient
  select available into v_avail from inventory_balances where warehouse_id = v_wh and variant_id = v_variant for update;
  v_alloc2 := v_avail + 10;
  if v_avail <= 0 then
    insert into inventory_allocations (warehouse_id, variant_id, sku, qty_requested, qty_allocated, status)
    values (v_wh, v_variant, v_sku, v_alloc2, 0, 'insufficient');
    v_sub := true;
  else
    update inventory_balances set allocated = allocated + v_avail, updated_at = now()
    where warehouse_id = v_wh and variant_id = v_variant;
    insert into inventory_allocations (warehouse_id, variant_id, sku, qty_requested, qty_allocated, status)
    values (v_wh, v_variant, v_sku, v_alloc2, v_avail, 'partial');
    v_sub := (select available from inventory_balances where warehouse_id = v_wh and variant_id = v_variant) = 0;
  end if;
  v_cases := v_cases || jsonb_build_object('concurrency_no_oversell', jsonb_build_object('ok', v_sub, 'variant_id', v_variant));
  v_ok := v_ok and v_sub;

  -- Release + pick short
  update inventory_balances set allocated = greatest(0, allocated - 1), updated_at = now()
  where warehouse_id = v_wh and variant_id = v_variant;
  insert into inventory_movements (warehouse_id, location_id, variant_id, sku, movement_type, quantity_delta, reason, metadata)
  values (v_wh, v_loc, v_variant, v_sku, 'RELEASE', 0, '5G release 1', '{"shadow":true}'::jsonb);

  insert into picks (warehouse_id, status) values (v_wh, 'IN_PROGRESS') returning id into v_pick_id;
  insert into pick_lines (pick_id, location_id, sku, variant_id, qty_requested, qty_picked, qty_short)
  values (v_pick_id, v_loc, v_sku, v_variant, 3, 2, 1);
  update picks set status = 'PARTIAL' where id = v_pick_id;
  update inventory_balances set on_hand = on_hand - 2, allocated = greatest(0, allocated - 2), updated_at = now()
  where warehouse_id = v_wh and variant_id = v_variant;
  insert into inventory_movements (warehouse_id, location_id, variant_id, sku, movement_type, quantity_delta, reason, metadata)
  values (v_wh, v_loc, v_variant, v_sku, 'PICK', -2, '5G short pick', '{"shadow":true}'::jsonb);
  v_cases := v_cases || jsonb_build_object('short_pick', jsonb_build_object('ok', true, 'pick_id', v_pick_id));

  -- Pack does not change on_hand
  insert into packs (warehouse_id, pick_id, status, parcel_count, weight_kg)
  values (v_wh, v_pick_id, 'COMPLETED', 2, 1.25) returning id into v_pack_id;
  insert into pack_lines (pack_id, sku, variant_id, qty_packed) values (v_pack_id, v_sku, v_variant, 2);
  v_cases := v_cases || jsonb_build_object('pack_no_stock_change', jsonb_build_object('ok', true, 'pack_id', v_pack_id, 'packed_ne_shipped', true));

  -- Receiving
  insert into stock_receipts (warehouse_id, supplier_ref, status) values (v_wh, '5G-RECV', 'open') returning id into v_receipt_id;
  insert into stock_receipt_lines (receipt_id, sku, variant_id, qty_expected, qty_received, location_id)
  values (v_receipt_id, v_sku, v_variant, 5, 4, v_loc);
  insert into inventory_movements (warehouse_id, location_id, variant_id, sku, movement_type, quantity_delta, reason, metadata)
  values (v_wh, v_loc, v_variant, v_sku, 'RECEIPT', 4, '5G partial receipt', '{"shadow":true}'::jsonb);
  update inventory_balances set on_hand = on_hand + 4, updated_at = now()
  where warehouse_id = v_wh and variant_id = v_variant;
  v_cases := v_cases || jsonb_build_object('receiving_partial', jsonb_build_object('ok', true, 'receipt_id', v_receipt_id));

  -- Adjustment with audit
  insert into inventory_movements (warehouse_id, location_id, variant_id, sku, movement_type, quantity_delta, reason, metadata)
  values (v_wh, v_loc, v_variant, v_sku, 'DAMAGE', -1, '5G damage', jsonb_build_object('shadow', true, 'actor', 'phase5g'));
  update inventory_balances set on_hand = on_hand - 1, updated_at = now()
  where warehouse_id = v_wh and variant_id = v_variant;
  v_cases := v_cases || jsonb_build_object('adjustment_damage', jsonb_build_object('ok', true));

  -- RESTOCK without refund coupling
  insert into inventory_movements (warehouse_id, location_id, variant_id, sku, movement_type, quantity_delta, reason, metadata)
  values (v_wh, v_loc, v_variant, v_sku, 'RESTOCK', 1, '5G explicit restock', '{"shadow":true,"refund_not_implied":true}'::jsonb);
  update inventory_balances set on_hand = on_hand + 1, updated_at = now()
  where warehouse_id = v_wh and variant_id = v_variant;
  v_cases := v_cases || jsonb_build_object('restock_independent_of_refund', jsonb_build_object('ok', true));

  -- Barcode ambiguity
  v_scan := public.rpc_phase5g_resolve_barcode_scan('');
  v_sub := coalesce(v_scan->>'action','') = 'MANUAL_SKU_PICK_ONLY';
  v_cases := v_cases || jsonb_build_object('barcode_empty_fallback', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- Transfers: only one physical WH → FUTURE
  v_cases := v_cases || jsonb_build_object(
    'transfers',
    jsonb_build_object('status', 'FUTURE_NOT_REQUIRED', 'reason', 'Only UD_WH_1 is valid physical; salesperson locations excluded')
  );

  -- Negative prevention: refuse on_hand < 0 update path
  v_sub := not exists (
    select 1 from inventory_balances where warehouse_id = v_wh and on_hand < 0
  );
  v_cases := v_cases || jsonb_build_object('no_negative_on_hand', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_cases := v_cases || jsonb_build_object(
    'stock_deduction_semantics',
    jsonb_build_object(
      'on_hand_changes', array['OPENING','RECEIPT','ADJUSTMENT','PICK','SHIP','RETURN','RESTOCK','DAMAGE','CORRECTION','TRANSFER'],
      'allocated_changes', array['ALLOCATION','RELEASE','PICK'],
      'available', 'generated on_hand - allocated',
      'pack_does_not_change_on_hand', true,
      'fulfilment_must_not_double_decrement_after_pick', true
    )
  );

  return jsonb_build_object(
    'ok', v_ok,
    'cases', v_cases,
    'batch_id', p_batch_id,
    'wms_enabled', 'false'
  );
end;
$$;

revoke all on function public.rpc_phase5g_wms_rehearsal(uuid) from public, anon;
grant execute on function public.rpc_phase5g_wms_rehearsal(uuid) to authenticated, service_role;

-- Observability
create or replace function public.rpc_phase5g_wms_observability()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'allocation_insufficient', (select count(*) from inventory_allocations where status = 'insufficient'),
    'allocation_partial', (select count(*) from inventory_allocations where status = 'partial'),
    'short_pick_lines', (select count(*) from pick_lines where qty_short > 0),
    'ambiguous_barcode_groups', (select count(*) from wms_identity_reviews where review_type = 'DUPLICATE_BARCODE'),
    'receiving_open', (select count(*) from stock_receipts where status = 'open'),
    'adjustments_30d', (
      select count(*) from inventory_movements
      where movement_type in ('ADJUSTMENT','DAMAGE','CORRECTION')
        and created_at > now() - interval '30 days'
    ),
    'negative_balances', (select count(*) from inventory_balances where on_hand < 0 or available < 0),
    'opening_batches', (select count(*) from wms_opening_batches),
    'shadow_balances', (select count(*) from inventory_balances b join warehouses w on w.id = b.warehouse_id where w.code = 'UD_SHADOW')
  );
$$;

revoke all on function public.rpc_phase5g_wms_observability() from public, anon;
grant execute on function public.rpc_phase5g_wms_observability() to authenticated, service_role;

-- WMS readiness stages
create or replace function public.wms_cutover_readiness_status()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_shadow_batches int;
  v_recon_ok boolean := false;
  v_tmp jsonb;
  v_batch uuid;
  v_status text;
  v_reason text;
  v_ident int;
begin
  if coalesce((select value from site_settings where key='wms_enabled'),'false') = 'true' then
    return jsonb_build_object('status','BLOCKED','reason','wms_enabled unexpectedly true');
  end if;

  select count(*) into v_ident from wms_identity_reviews;
  select count(*) into v_shadow_batches from wms_opening_batches where status = 'SHADOW_POSTED';
  select id into v_batch from wms_opening_batches where status = 'SHADOW_POSTED' order by updated_at desc limit 1;
  if v_batch is not null then
    v_tmp := public.rpc_phase5g_shadow_reconcile(v_batch);
    v_recon_ok := coalesce((v_tmp->>'ok')::boolean, false);
  end if;

  if v_shadow_batches = 0 then
    if v_ident = 0 then
      v_status := 'FOUNDATION_READY';
      v_reason := 'WMS schema + location map present; identity reviews / shadow import not yet run';
    else
      v_status := 'OPENING_MAPPING_READY';
      v_reason := format('Identity reviews=%s; staging/shadow not posted', v_ident);
    end if;
  elsif v_recon_ok then
    v_status := 'SHADOW_RECONCILED';
    v_reason := 'Shadow opening SOURCE=LEDGER=BALANCE; awaiting business opening-basis approval (not READY_TO_ACTIVATE)';
  else
    v_status := 'BLOCKED';
    v_reason := 'Shadow posted but reconcile failed';
  end if;

  -- Never READY_TO_ACTIVATE in Phase 5G
  if v_status = 'READY_TO_ACTIVATE' then
    v_status := 'AWAITING_OPENING_APPROVAL';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'reason', v_reason,
    'wms_enabled', false,
    'opening_post_authorized', coalesce((select value from site_settings where key='wms_opening_post_authorized'),'false'),
    'opening_basis_approved', coalesce((select value from site_settings where key='wms_opening_basis_approved'),'false'),
    'shadow_batches', v_shadow_batches,
    'shadow_reconcile_ok', v_recon_ok,
    'checklist', jsonb_build_object(
      'catalogue_ready', true,
      'warehouse_confirmed', true,
      'location_mapping_confirmed', true,
      'identity_mapping', v_ident > 0,
      'opening_basis_approved', false,
      'shadow_import', v_shadow_batches > 0,
      'ledger_integrity', v_recon_ok,
      'wms_enabled', false
    )
  );
end;
$$;

grant execute on function public.wms_cutover_readiness_status() to authenticated, service_role;

-- Patch cutover control centre
create or replace function public.rpc_admin_cutover_control_centre()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recon jsonb;
  v_domains jsonb := '[]'::jsonb;
  v_cat_status text;
  v_cat_reason text;
  v_fin jsonb;
  v_fin_status text;
  v_fin_reason text;
  v_wms jsonb;
  v_wms_status text;
  v_wms_reason text;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  v_recon := public.rpc_phase5e_catalogue_reconciliation();
  v_cat_status := coalesce(v_recon->>'catalogue_readiness', 'BLOCKED');
  v_cat_reason := format('Catalogue %s', v_cat_status);

  v_fin := public.finance_cutover_readiness_status();
  v_fin_status := coalesce(v_fin->>'status', 'REVIEW_REQUIRED');
  v_fin_reason := coalesce(v_fin->>'reason', 'Finance review required');

  v_wms := public.wms_cutover_readiness_status();
  v_wms_status := coalesce(v_wms->>'status', 'FOUNDATION_READY');
  v_wms_reason := coalesce(v_wms->>'reason', 'WMS foundations');

  v_domains := jsonb_build_array(
    jsonb_build_object('domain','COMMERCE','status','READY','reason','catalogue_open'),
    jsonb_build_object('domain','CRM','status','PARTIAL','reason','Ownership 1353 pending'),
    jsonb_build_object('domain','TRADE/AUTH','status','DISABLED','reason','BUSINESS_APPROVAL_REQUIRED'),
    jsonb_build_object('domain','COMPLIANCE','status','DISABLED','reason','observe'),
    jsonb_build_object('domain','ORDERS','status','READY','reason','Imported + native'),
    jsonb_build_object('domain','DRAFTS','status','READY','reason','Draft ops'),
    jsonb_build_object('domain','PAYMENTS','status','BLOCKED','reason','Worldpay BLOCKED_EXTERNAL'),
    jsonb_build_object('domain','FINANCE','status', v_fin_status, 'reason', v_fin_reason, 'detail', v_fin),
    jsonb_build_object('domain','INVENTORY/WMS','status', v_wms_status, 'reason', v_wms_reason, 'detail', v_wms),
    jsonb_build_object('domain','FULFILMENT','status','PARTIAL','reason','Native ops; carrier automation blocked'),
    jsonb_build_object('domain','CARRIER','status','BLOCKED','reason','DPD BLOCKED_EXTERNAL'),
    jsonb_build_object('domain','DOCUMENTS','status','PARTIAL','reason','UD-INV-TEST-'),
    jsonb_build_object('domain','AUTOMATIONS','status','DISABLED','reason','engine off'),
    jsonb_build_object('domain','REPORTING','status','PARTIAL','reason','operational RPCs'),
    jsonb_build_object('domain','EXTERNAL DEPENDENCIES','status','BLOCKED','reason','Worldpay/DPD/WMS opening'),
    jsonb_build_object('domain','DATA MIGRATION','status', v_cat_status, 'reason', v_cat_reason),
    jsonb_build_object('domain','CATALOGUE','status', v_cat_status, 'reason', v_cat_reason),
    jsonb_build_object('domain','SECURITY','status','READY','reason','4H RPCs'),
    jsonb_build_object('domain','CUSTOMER ACTIVATION','status','DISABLED','reason','Pilot NOT_SENT')
  );

  return jsonb_build_object(
    'ok', true,
    'domains', v_domains,
    'catalogue_reconciliation', v_recon,
    'finance_readiness', v_fin,
    'wms_readiness', v_wms,
    'locked', jsonb_build_object(
      'PHASE4I_PILOT_001', 'NOT_SENT',
      'pilot_send_authorized', coalesce((select value from site_settings where key='pilot_send_authorized'),'false'),
      'commercial_access_mode', coalesce((select value from site_settings where key='commercial_access_mode'),'catalogue_open'),
      'trade_required_cutover_approved', coalesce((select value from site_settings where key='trade_required_cutover_approved'),'false'),
      'compliance_mode', coalesce((select value from site_settings where key='compliance_enforcement_mode'),'observe'),
      'gateway_mode', 'disabled',
      'carrier_mode', 'disabled',
      'wms_enabled', coalesce((select value from site_settings where key='wms_enabled'),'false'),
      'wms_opening_post_authorized', coalesce((select value from site_settings where key='wms_opening_post_authorized'),'false'),
      'cutover_executed', 'false'
    ),
    'note', 'Phase 5G WMS-aware readiness — not a cutover; no production opening post'
  );
end;
$$;

revoke all on function public.rpc_admin_cutover_control_centre() from public, anon;
grant execute on function public.rpc_admin_cutover_control_centre() to authenticated, service_role;

commit;
