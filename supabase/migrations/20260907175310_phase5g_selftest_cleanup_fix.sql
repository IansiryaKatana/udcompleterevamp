-- Phase 5G selftest fix — qualify ids in shadow cleanup

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
    and (v_tmp->'metrics'->>'inventory_items_snapshots')::bigint >= 13000
    and (v_tmp->'metrics'->>'variants')::bigint >= 12000;
  v_cases := v_cases || jsonb_build_object('B_inventory_baseline', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_rebuild_identity_reviews();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and (v_tmp->>'missing_sku')::int = 279
    and (v_tmp->>'duplicate_sku_groups')::int = 40;
  v_cases := v_cases || jsonb_build_object('C_identity_reviews', jsonb_build_object('ok', v_sub, 'detail', v_tmp));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5g_open_order_stock_exposure();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean;
  v_cases := v_cases || jsonb_build_object('D_open_order_exposure', jsonb_build_object('ok', v_sub, 'orders', v_tmp->'orders_requiring_stock'));
  v_ok := v_ok and v_sub;

  v_batch_code := 'P5G-SHADOW-' || to_char(now(), 'YYYYMMDDHH24MISS');
  v_tmp := public.rpc_phase5g_build_opening_staging(v_batch_code, 'SHOPIFY_ON_HAND', 'UD_SHADOW');
  v_sub := coalesce(v_tmp->>'ok','false')::boolean and (v_tmp->>'rows')::int > 10000;
  v_batch_id := (v_tmp->>'batch_id')::uuid;
  v_cases := v_cases || jsonb_build_object('E_staging_build', jsonb_build_object('ok', v_sub, 'rows', v_tmp->'rows'));
  v_ok := v_ok and v_sub;

  update wms_opening_staging
  set status = 'APPROVED', approved_quantity = source_quantity
  where batch_id = v_batch_id and variant_id is not null and status in ('MAPPED','REVIEW_REQUIRED','APPROVED');
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
  exception when others then
    v_sub := false;
  end;
  v_cases := v_cases || jsonb_build_object('M_catalogue_ready', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  begin
    v_tmp := public.finance_cutover_readiness_status();
    v_sub := coalesce(v_tmp->>'status','') <> 'READY';
  exception when others then
    v_sub := true;
  end;
  v_cases := v_cases || jsonb_build_object('N_finance_not_silently_ready', jsonb_build_object('ok', v_sub, 'status', v_tmp->>'status'));
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
    'note', 'Shadow stock retained; wms_enabled=false; no UD_WH_1 post'
  );
end;
$$;

revoke all on function public.rpc_phase5g_wms_selftest() from public, anon;
grant execute on function public.rpc_phase5g_wms_selftest() to authenticated, service_role;
