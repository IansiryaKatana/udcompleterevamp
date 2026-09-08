-- Phase 5G: negative opening qty policy + reconcile fix

begin;

-- Negatives cannot be opening ON_HAND
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
  v_ts timestamptz;
  v_qty numeric;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if p_source_basis not in ('SHOPIFY_ON_HAND','SHOPIFY_AVAILABLE','PHYSICAL_COUNT','VERIFIED_WAREHOUSE_EXPORT','RECONCILED_PHYSICAL_SYSTEM') then
    return jsonb_build_object('ok', false, 'error', 'invalid_source_basis');
  end if;
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
    case when p_source_basis = 'SHOPIFY_AVAILABLE' then coalesce(s.available, 0) else coalesce(s.on_hand, 0) end,
    p_source_basis,
    case
      when v.id is null then 'REVIEW_REQUIRED'
      when (case when p_source_basis = 'SHOPIFY_AVAILABLE' then coalesce(s.available, 0) else coalesce(s.on_hand, 0) end) < 0
        then 'REVIEW_REQUIRED'
      else 'MAPPED'
    end,
    s.snapshot_at,
    case
      when v.id is null then 'No Unique variant for inventory_item_gid'
      when (case when p_source_basis = 'SHOPIFY_AVAILABLE' then coalesce(s.available, 0) else coalesce(s.on_hand, 0) end) < 0
        then 'Negative source qty — cannot post as OPENING ON_HAND; business review'
      else null
    end
  from shopify_inventory_snapshots s
  left join product_variants v on v.shopify_inventory_item_gid = s.shopify_inventory_item_gid
  where coalesce(s.location_name, '') = 'UD WH 1'
     or exists (
       select 1 from wms_location_classifications c
       where c.shopify_location_name = s.location_name and c.include_in_opening
     );

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

  select count(*), coalesce(sum(source_quantity),0),
         count(*) filter (where variant_id is null)
  into v_rows, v_units, v_map_err
  from wms_opening_staging where batch_id = v_batch_id;

  update wms_opening_batches set
    row_count = v_rows,
    unit_total = v_units,
    mapping_errors = v_map_err,
    review_errors = (select count(*) from wms_opening_staging where batch_id = v_batch_id and status = 'REVIEW_REQUIRED'),
    status = case when v_map_err > 0 or exists (
      select 1 from wms_opening_staging where batch_id = v_batch_id and status = 'REVIEW_REQUIRED'
    ) then 'REVIEW_REQUIRED' else 'STAGED' end,
    updated_at = now()
  where id = v_batch_id;

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'batch_code', p_batch_code,
    'rows', v_rows,
    'units', v_units,
    'mapping_errors', v_map_err,
    'negative_qty_rows', (select count(*) from wms_opening_staging where batch_id = v_batch_id and source_quantity < 0),
    'target_warehouse', p_target_warehouse_code,
    'source_basis', p_source_basis,
    'posted', false
  );
end;
$$;

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
  v_mismatch bigint;
begin
  select id into v_wh from warehouses where code = 'UD_SHADOW';

  -- Postable rows only: mapped/approved, variant present, non-negative qty
  select coalesce(sum(coalesce(approved_quantity, source_quantity)),0)
  into v_src
  from wms_opening_staging
  where batch_id = p_batch_id
    and variant_id is not null
    and coalesce(approved_quantity, source_quantity) >= 0
    and status in ('APPROVED', 'READY_TO_POST', 'MAPPED');

  -- If batch already approved/posted, prefer APPROVED/READY only
  if exists (select 1 from wms_opening_batches where id = p_batch_id and status in ('APPROVED','SHADOW_POSTED','POSTED','READY_TO_POST')) then
    select coalesce(sum(coalesce(approved_quantity, source_quantity)),0)
    into v_src
    from wms_opening_staging
    where batch_id = p_batch_id
      and variant_id is not null
      and coalesce(approved_quantity, source_quantity) >= 0
      and status in ('APPROVED', 'READY_TO_POST');
  end if;

  select coalesce(sum(quantity_delta),0) into v_mov
  from inventory_movements
  where warehouse_id = v_wh and movement_type = 'OPENING'
    and metadata->>'opening_batch_id' = p_batch_id::text;

  select count(*) into v_mismatch
  from wms_opening_staging st
  where st.batch_id = p_batch_id
    and st.variant_id is not null
    and st.status in ('APPROVED', 'READY_TO_POST')
    and coalesce(st.approved_quantity, st.source_quantity) >= 0
    and coalesce(st.approved_quantity, st.source_quantity) is distinct from coalesce((
      select m.quantity_delta from inventory_movements m
      where m.warehouse_id = v_wh and m.variant_id = st.variant_id
        and m.movement_type = 'OPENING'
        and m.metadata->>'opening_batch_id' = p_batch_id::text
      limit 1
    ), -1);

  return jsonb_build_object(
    'ok', v_src = v_mov and v_mismatch = 0,
    'source_candidate_qty', v_src,
    'opening_ledger_qty', v_mov,
    'shadow_balance_qty', (select coalesce(sum(on_hand),0) from inventory_balances where warehouse_id = v_wh),
    'row_mismatches', v_mismatch,
    'note', 'Balance may diverge after rehearsal movements; integrity gate is SOURCE_POSTABLE = OPENING_LEDGER',
    'rule', 'SOURCE_POSTABLE (>=0) = OPENING LEDGER; excluded negatives require review'
  );
end;
$$;

-- Selftest approve only non-negative mapped rows
create or replace function public.rpc_phase5g_wms_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean := true;
  v_sub boolean;
  v_tmp jsonb;
  v_batch_id uuid;
  v_batch_code text;
  v_prod_block jsonb;
  v_wh uuid;
begin
  v_sub := coalesce((select value from site_settings where key='wms_enabled'),'false') = 'false'
    and coalesce((select value from site_settings where key='wms_opening_post_authorized'),'false') = 'false'
    and coalesce((select value from site_settings where key='pilot_send_authorized'),'') = 'false'
    and coalesce((select value from site_settings where key='commercial_access_mode'),'') = 'catalogue_open'
    and coalesce((select value from site_settings where key='compliance_enforcement_mode'),'observe') = 'observe';
  v_cases := v_cases || jsonb_build_object('A_locked_gates', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_inventory_baseline();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and (v_tmp->'metrics'->>'inventory_items_snapshots')::bigint >= 13000;
  v_cases := v_cases || jsonb_build_object('B_inventory_baseline', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_rebuild_identity_reviews();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and (v_tmp->>'missing_sku')::int = 279
    and (v_tmp->>'duplicate_sku_groups')::int = 40;
  v_cases := v_cases || jsonb_build_object('C_identity_reviews', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_open_order_stock_exposure();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean;
  v_cases := v_cases || jsonb_build_object('D_open_order_exposure', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_batch_code := 'P5G-SHADOW-' || to_char(now(), 'YYYYMMDDHH24MISS');
  v_tmp := public.rpc_phase5g_build_opening_staging(v_batch_code, 'SHOPIFY_ON_HAND', 'UD_SHADOW');
  v_sub := coalesce(v_tmp->>'ok','false')::boolean and (v_tmp->>'rows')::int > 10000;
  v_batch_id := (v_tmp->>'batch_id')::uuid;
  v_cases := v_cases || jsonb_build_object('E_staging_build', jsonb_build_object('ok', v_sub, 'rows', v_tmp->'rows', 'negatives', v_tmp->'negative_qty_rows'));
  v_ok := v_ok and v_sub;

  update wms_opening_staging
  set status = 'APPROVED', approved_quantity = source_quantity
  where batch_id = v_batch_id
    and variant_id is not null
    and source_quantity >= 0
    and status in ('MAPPED','APPROVED');
  update wms_opening_batches set status = 'APPROVED', approved_rows = (
    select count(*) from wms_opening_staging where batch_id = v_batch_id and status = 'APPROVED'
  ), approved_at = now() where id = v_batch_id;

  update wms_opening_batches set target_warehouse_code = 'UD_WH_1' where id = v_batch_id;
  v_prod_block := public.rpc_phase5g_post_opening_batch(v_batch_id);
  v_sub := coalesce(v_prod_block->>'ok','true')::boolean = false
    and v_prod_block->>'error' = 'PRODUCTION_OPENING_BLOCKED';
  update wms_opening_batches set target_warehouse_code = 'UD_SHADOW', status = 'APPROVED' where id = v_batch_id;
  v_cases := v_cases || jsonb_build_object('F_production_post_blocked', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  select id into v_wh from warehouses where code = 'UD_SHADOW';
  delete from pack_lines where pack_id in (select p.id from packs p where p.warehouse_id = v_wh);
  delete from packs where warehouse_id = v_wh;
  delete from pick_lines where pick_id in (select p.id from picks p where p.warehouse_id = v_wh);
  delete from picks where warehouse_id = v_wh;
  delete from inventory_allocations where warehouse_id = v_wh;
  delete from inventory_movements where warehouse_id = v_wh;
  delete from inventory_balances where warehouse_id = v_wh;
  delete from stock_receipt_lines where receipt_id in (select r.id from stock_receipts r where r.warehouse_id = v_wh);
  delete from stock_receipts where warehouse_id = v_wh;

  v_tmp := public.rpc_phase5g_post_opening_batch(v_batch_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean and (v_tmp->>'posted_rows')::int > 10000;
  v_cases := v_cases || jsonb_build_object('G_shadow_post', jsonb_build_object('ok', v_sub, 'posted_rows', v_tmp->'posted_rows'));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_post_opening_batch(v_batch_id);
  v_sub := coalesce(v_tmp->>'ok','true')::boolean = false and v_tmp->>'error' = 'duplicate_batch';
  v_cases := v_cases || jsonb_build_object('H_duplicate_batch_blocked', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_shadow_reconcile(v_batch_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean;
  v_cases := v_cases || jsonb_build_object('I_shadow_reconcile', jsonb_build_object('ok', v_sub, 'detail', v_tmp));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_wms_rehearsal(v_batch_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean;
  v_cases := v_cases || jsonb_build_object('J_wms_rehearsal', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- Reconcile still holds on OPENING ledger after rehearsal
  v_tmp := public.rpc_phase5g_shadow_reconcile(v_batch_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean;
  v_cases := v_cases || jsonb_build_object('I2_reconcile_after_rehearsal', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_resolve_barcode_scan('');
  v_sub := v_tmp->>'action' = 'MANUAL_SKU_PICK_ONLY';
  v_cases := v_cases || jsonb_build_object('K_barcode_fallback', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_admin_cutover_control_centre();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and coalesce(v_tmp->'locked'->>'wms_enabled','true') = 'false'
    and exists (
      select 1 from jsonb_array_elements(v_tmp->'domains') d
      where d->>'domain' = 'INVENTORY/WMS'
        and d->>'status' in ('FOUNDATION_READY','OPENING_MAPPING_READY','SHADOW_RECONCILED','AWAITING_OPENING_APPROVAL','BLOCKED')
        and d->>'status' <> 'READY_TO_ACTIVATE'
    );
  v_cases := v_cases || jsonb_build_object('L_cutover_wms_status', jsonb_build_object('ok', v_sub, 'wms', v_tmp->'wms_readiness'));
  v_ok := v_ok and v_sub;

  begin
    v_tmp := public.rpc_phase5e_catalogue_reconciliation();
    v_sub := coalesce(v_tmp->>'catalogue_readiness','') = 'READY';
  exception when others then v_sub := false;
  end;
  v_cases := v_cases || jsonb_build_object('M_catalogue_ready', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  begin
    v_tmp := public.finance_cutover_readiness_status();
    v_sub := coalesce(v_tmp->>'status','') <> 'READY';
  exception when others then v_sub := true;
  end;
  v_cases := v_cases || jsonb_build_object('N_finance_not_silently_ready', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_sub := to_regprocedure('public.rpc_phase5g_shadow_opening_reversal(uuid)') is not null;
  v_cases := v_cases || jsonb_build_object('O_rollback_mechanism_present', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  return jsonb_build_object(
    'ok', v_ok,
    'pass', (select count(*) from jsonb_each(v_cases) e where (e.value->>'ok')::boolean),
    'total', (select count(*) from jsonb_each(v_cases)),
    'cases', v_cases,
    'batch_id', v_batch_id,
    'note', 'Shadow retained; wms_enabled=false; no UD_WH_1 post'
  );
end;
$$;

revoke all on function public.rpc_phase5g_wms_selftest() from public, anon;
grant execute on function public.rpc_phase5g_wms_selftest() to authenticated, service_role;

commit;
