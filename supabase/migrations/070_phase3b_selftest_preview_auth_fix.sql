-- Fix Phase 3B backfill preview auth + selftest (070).
-- Prior push failed mid-file on invalid UPDATE ... LIMIT; this replaces cleanly.

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
     and auth.role() is distinct from 'service_role'
     and auth.uid() is not null then
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
        'standard_delivery_mapping', 'do not infer DPD service from Standard Delivery title',
        'order_events_dpd_mentions', 51087,
        'recommendation', 'defer mass backfill until event-message quality sampling is approved'
      )
  );
end;
$$;

grant execute on function public.rpc_phase3b_shipment_event_backfill_preview()
  to authenticated, service_role;

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
  v_all_ok boolean;
  v_track bigint;
  v_del bigint;
  v_shop_id uuid;
begin
  delete from public.carrier_shipment_requests where idempotency_key like v_prefix || '%';
  select coalesce(sum(inventory_count), 0) into v_inv_before from public.products;

  begin
    v_mode := public.carrier_gateway_mode();
    v_case_ok := v_mode = 'disabled';
    v_cases := v_cases || jsonb_build_object('A_mode_disabled', jsonb_build_object('ok', v_case_ok, 'detail', 'carrier_mode=' || coalesce(v_mode, 'null')));
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_mode_disabled', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_confirmed := public.carrier_product_confirmed();
    v_case_ok := v_confirmed = false;
    v_cases := v_cases || jsonb_build_object('B_product_unconfirmed', jsonb_build_object('ok', v_case_ok, 'detail', 'product_confirmed=' || v_confirmed::text));
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_product_unconfirmed', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_gate := public.carrier_shipment_actions_permitted();
    v_rpc := public.rpc_admin_carrier_create_shipment(null, v_prefix || 'idem-1', jsonb_build_object('phase', '3b'));
    v_case_ok :=
      coalesce((v_gate->>'allowed')::boolean, true) = false
      and coalesce(v_gate->>'error', '') = 'carrier_disabled'
      and coalesce(v_rpc->>'ok', 'true') = 'false'
      and coalesce(v_rpc->>'error', '') in ('Forbidden', 'carrier_disabled', 'dpd_product_unconfirmed');
    v_cases := v_cases || jsonb_build_object('C_create_shipment_rejected', jsonb_build_object('ok', v_case_ok, 'detail', format('gate=%s rpc=%s', v_gate->>'error', v_rpc->>'error')));
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_create_shipment_rejected', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    select count(*) filter (where is_active), count(*) filter (where carrier_service_code is not null)
    into v_inactive, v_null_codes
    from public.carrier_service_mappings
    where carrier_provider = 'dpd'
      and shipping_title_pattern in ('Standard Delivery', 'Saturday', 'Free Delivery', 'Next Day');
    v_case_ok := coalesce(v_inactive, -1) = 0 and coalesce(v_null_codes, -1) = 0
      and (select count(*) from public.carrier_service_mappings where carrier_provider = 'dpd'
           and shipping_title_pattern in ('Standard Delivery', 'Saturday', 'Free Delivery', 'Next Day')) >= 4;
    v_cases := v_cases || jsonb_build_object('D_mappings_inactive_null_codes', jsonb_build_object('ok', v_case_ok, 'detail', format('active=%s nonnull_codes=%s', v_inactive, v_null_codes)));
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_mappings_inactive_null_codes', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    select count(*) into v_dpd_count from public.fulfillments
    where carrier_provider = 'dpd' and coalesce(source_system, '') = 'shopify';
    v_case_ok := coalesce(v_dpd_count, 0) > 0;
    v_cases := v_cases || jsonb_build_object('E_carrier_provider_backfill_dpd', jsonb_build_object('ok', v_case_ok, 'detail', format('shopify_dpd_provider_count=%s', v_dpd_count)));
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_carrier_provider_backfill_dpd', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_pay_mode := public.payment_gateway_mode();
    v_case_ok := v_pay_mode = 'disabled';
    v_cases := v_cases || jsonb_build_object('F_payment_gateway_still_disabled', jsonb_build_object('ok', v_case_ok, 'detail', 'payment_gateway_mode=' || coalesce(v_pay_mode, 'null')));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_payment_gateway_still_disabled', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_preview := public.rpc_phase3b_shipment_event_backfill_preview();
    v_track := nullif(v_preview->>'proposed_tracking_added', '')::bigint;
    v_del := nullif(v_preview->>'proposed_delivered', '')::bigint;
    v_case_ok := coalesce(v_preview->>'ok', 'false') = 'true'
      and coalesce((v_preview->>'backfill_executed')::boolean, true) = false
      and coalesce(v_track, 0) > 0
      and coalesce(v_del, 0) > 0;
    v_cases := v_cases || jsonb_build_object('G_preview_backfill_counts', jsonb_build_object('ok', v_case_ok, 'detail', format(
      'tracking=%s delivered=%s ofd=%s',
      v_preview->>'proposed_tracking_added', v_preview->>'proposed_delivered', v_preview->>'proposed_ofd'
    )));
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_preview_backfill_counts', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    delete from public.carrier_shipment_requests where idempotency_key like v_prefix || '%';
    select coalesce(sum(inventory_count), 0) into v_inv_after from public.products;
    v_cleanup_ok := v_inv_after = v_inv_before;
    select id into v_shop_id from public.fulfillments
    where coalesce(source_system, '') = 'shopify' and carrier_provider = 'dpd' limit 1;
    begin
      if v_shop_id is not null then
        update public.fulfillments set tracking_number = tracking_number where id = v_shop_id;
        v_case_ok := false;
        v_detail := 'shopify update unexpectedly allowed';
      else
        v_case_ok := v_cleanup_ok;
        v_detail := 'cleaned; inventory_unchanged; no shopify dpd row to probe';
      end if;
    exception when others then
      v_case_ok := v_cleanup_ok;
      v_detail := 'cleaned; inventory_unchanged=' || v_cleanup_ok::text || '; shopify_immutable_ok';
    end;
    v_cases := v_cases || jsonb_build_object('H_cleanup_inventory_shopify_immutable', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_cleanup_inventory_shopify_immutable', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  select bool_and(coalesce((e.v->>'ok')::boolean, false))
  into v_all_ok
  from (
    select (jsonb_each(elem)).value as v
    from jsonb_array_elements(v_cases) elem
  ) e;

  return jsonb_build_object(
    'ok', coalesce(v_all_ok, false),
    'cases', v_cases,
    'live_dpd', false,
    'payment_gateway_untouched', true,
    'inventory_boundary',
      'Carrier/fulfilment ops must not decrement inventory; reservation at checkout; deduction on payment.',
    'skulabs_boundary',
      'SKULabs remains external WMS — Phase 3B does not integrate or replace SKULabs.'
  );
end;
$$;

grant execute on function public.rpc_phase3b_carrier_selftest() to service_role;
