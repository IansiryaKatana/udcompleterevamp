-- Phase 3C — DPD product confirmation gate (STOP if unconfirmed)
-- Exhaustive project evidence re-check: no DPD credentials, no official API
-- family confirmation, no business documentation in-repo.
-- DO NOT set carrier_mode=test|live. DO NOT invent endpoints/service codes.
-- DO NOT activate carrier_service_mappings. DO NOT backfill shipment_events.
-- DO NOT touch inventory / payment_gateway / Worldpay / historical Shopify txs.

begin;

update public.carrier_gateway_config
set
  carrier_mode = 'disabled',
  product_status = 'unconfirmed',
  product_key = coalesce(nullif(btrim(product_key), ''), 'dpd_uk_unconfirmed'),
  phase_3b_live_blocked = true,
  test_credentials_present = false,
  notes = 'Phase 3C gate: DPD PRODUCT/API STILL UNCONFIRMED. '
    || 'Evidence remains Shopify→WSA→UK tracking hosts only. '
    || 'No TEST/LIVE credentials in env, private_settings, or Supabase secrets. '
    || 'No official service codes. carrier_mode forced disabled. Live blocked.',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'phase_3c', jsonb_build_object(
      'status', 'stopped_unconfirmed',
      'checked_at', now(),
      'env_dpd_keys', 'absent',
      'private_settings_dpd_keys', 'absent',
      'supabase_secrets_dpd', 'absent',
      'business_docs_in_repo', 'absent',
      'wsa_shopify_footprint', 'confirmed',
      'tracking_hosts', jsonb_build_array('www.dpdlocal.co.uk', 'www.dpd.co.uk'),
      'api_family', 'unconfirmed',
      'test_auth_attempted', false,
      'test_shipment_attempted', false,
      'service_mappings_activated', false,
      'shipment_events_backfill_executed', false
    )
  ),
  updated_at = now()
where key = 'default';

-- Ensure suggested mappings stay inactive with null codes
update public.carrier_service_mappings
set is_active = false,
    carrier_service_code = null
where carrier_provider = 'dpd';

create or replace function public.rpc_phase3c_dpd_gate_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '[]'::jsonb;
  v_ok boolean;
  v_detail text;
  v_mode text;
  v_confirmed boolean;
  v_creds boolean;
  v_live_blocked boolean;
  v_active_maps int;
  v_coded_maps int;
  v_pay text;
  v_preview jsonb;
  v_all_ok boolean;
  v_gate jsonb;
begin
  begin
    v_mode := public.carrier_gateway_mode();
    v_ok := v_mode = 'disabled';
    v_cases := v_cases || jsonb_build_object('A_carrier_mode_disabled', jsonb_build_object('ok', v_ok, 'detail', v_mode));
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_carrier_mode_disabled', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_confirmed := public.carrier_product_confirmed();
    select test_credentials_present, phase_3b_live_blocked
    into v_creds, v_live_blocked
    from public.carrier_gateway_config where key = 'default';
    v_ok := v_confirmed = false and coalesce(v_creds, true) = false and coalesce(v_live_blocked, false) = true;
    v_detail := format('confirmed=%s creds=%s live_blocked=%s', v_confirmed, v_creds, v_live_blocked);
    v_cases := v_cases || jsonb_build_object('B_product_unconfirmed_no_creds', jsonb_build_object('ok', v_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_product_unconfirmed_no_creds', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_gate := public.carrier_shipment_actions_permitted();
    v_ok := coalesce((v_gate->>'allowed')::boolean, true) = false;
    v_cases := v_cases || jsonb_build_object('C_shipments_not_permitted', jsonb_build_object('ok', v_ok, 'detail', v_gate->>'error'));
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_shipments_not_permitted', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    select count(*) filter (where is_active), count(*) filter (where carrier_service_code is not null)
    into v_active_maps, v_coded_maps
    from public.carrier_service_mappings where carrier_provider = 'dpd';
    v_ok := coalesce(v_active_maps, -1) = 0 and coalesce(v_coded_maps, -1) = 0;
    v_cases := v_cases || jsonb_build_object('D_mappings_inactive', jsonb_build_object('ok', v_ok, 'detail', format('active=%s coded=%s', v_active_maps, v_coded_maps)));
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_mappings_inactive', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_pay := public.payment_gateway_mode();
    v_ok := v_pay = 'disabled';
    v_cases := v_cases || jsonb_build_object('E_payment_gateway_untouched', jsonb_build_object('ok', v_ok, 'detail', v_pay));
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_payment_gateway_untouched', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  begin
    v_preview := public.rpc_phase3b_shipment_event_backfill_preview();
    v_ok := coalesce(v_preview->>'ok', 'false') = 'true'
      and coalesce((v_preview->>'backfill_executed')::boolean, true) = false
      and coalesce((v_preview->>'proposed_tracking_added')::bigint, 0) > 0;
    v_cases := v_cases || jsonb_build_object('F_backfill_still_preview_only', jsonb_build_object(
      'ok', v_ok,
      'detail', format('executed=%s tracking=%s delivered=%s',
        v_preview->>'backfill_executed',
        v_preview->>'proposed_tracking_added',
        v_preview->>'proposed_delivered')
    ));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_backfill_still_preview_only', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  select bool_and(coalesce((e.v->>'ok')::boolean, false))
  into v_all_ok
  from (
    select (jsonb_each(elem)).value as v
    from jsonb_array_elements(v_cases) elem
  ) e;

  return jsonb_build_object(
    'ok', coalesce(v_all_ok, false),
    'phase', '3c',
    'dpd_product_api', 'UNCONFIRMED',
    'carrier_mode', public.carrier_gateway_mode(),
    'live_dpd', false,
    'test_client_implemented', false,
    'cases', v_cases,
    'required_from_business', jsonb_build_array(
      'Exact DPD UK / DPD Local product name from account manager or WSA settings export',
      'Official API family documentation matching that account',
      'TEST base URL from official docs (not guessed)',
      'TEST username/password or token (server-only)',
      'Account/merchant identifiers (entity, account number, depot, etc. as required by that API)',
      'Official service-code catalogue available on the Unique contract',
      'Label format confirmation',
      'Tracking delivery model (poll vs webhook)',
      'Weight policy / minimums for consignments',
      'Written approval to set carrier_mode=test (still never live in 3C)'
    )
  );
end;
$$;

revoke all on function public.rpc_phase3c_dpd_gate_selftest() from public;
grant execute on function public.rpc_phase3c_dpd_gate_selftest() to service_role;

comment on function public.rpc_phase3c_dpd_gate_selftest() is
  'Phase 3C gate selftest: product remains UNCONFIRMED; carrier_mode disabled; no live DPD; mappings inactive; backfill preview only.';

commit;
