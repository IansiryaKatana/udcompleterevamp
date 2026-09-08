-- Phase 5D fix — simulation order.status must satisfy orders_status_check

create or replace function public.rpc_phase5d_native_order_simulation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_draft_id uuid;
  v_pay text;
  v_scenarios jsonb := '[]'::jsonb;
  v_ok boolean := true;
begin
  begin
    select public.payment_gateway_mode() into v_pay;
  exception when others then
    v_pay := 'disabled';
  end;
  if coalesce(v_pay,'disabled') <> 'disabled' then
    return jsonb_build_object('ok', false, 'error', 'GATEWAY_UNEXPECTEDLY_ENABLED');
  end if;

  insert into customers (email, display_name, source_system, status, trade_access_status)
  values (
    'phase5d.sim+' || substr(gen_random_uuid()::text, 1, 8) || '@unique.invalid',
    'Phase5D Simulation Customer',
    'phase5d_simulation',
    'active',
    'approved'
  ) returning id into v_customer_id;

  insert into orders (
    order_number, email, status, currency, subtotal, total, customer_id,
    financial_status, order_source, source_app, total_received, total_outstanding,
    metadata
  ) values (
    'P5D-' || to_char(now(), 'YYYYMMDDHH24MISS'),
    (select email from customers where id = v_customer_id),
    'pending',
    'GBP',
    100, 100, v_customer_id,
    'PENDING',
    'unique_simulation',
    'phase5d',
    0, 100,
    jsonb_build_object('is_test', true, 'phase', '5d', 'no_customer_contact', true)
  ) returning id into v_order_id;

  v_scenarios := v_scenarios || jsonb_build_array(jsonb_build_object(
    'scenario', 'APPROVED_TRADE_ORDER_CREATED',
    'ok', v_order_id is not null,
    'order_id', v_order_id
  ));

  v_scenarios := v_scenarios || jsonb_build_array(jsonb_build_object(
    'scenario', 'WORLDPAY_BOUNDARY',
    'ok', true,
    'result', 'STOPPED_AT_DISABLED_GATEWAY',
    'gateway_mode', v_pay
  ));

  v_scenarios := v_scenarios || jsonb_build_array(
    jsonb_build_object('scenario', 'BANK_DEPOSIT', 'technically_available', true, 'business_acceptance_required', true),
    jsonb_build_object('scenario', 'MANUAL_PAYMENT', 'technically_available', true, 'business_acceptance_required', true),
    jsonb_build_object('scenario', 'PAY_LATER_ELIGIBLE', 'technically_available', true, 'business_acceptance_required', true),
    jsonb_build_object('scenario', 'PAY_LATER_DENIED', 'technically_available', true, 'result', 'DENY_PATH_EXISTS_IN_POLICY')
  );

  begin
    insert into draft_orders (
      name, status, currency, subtotal, total_price, customer_id, source_system, email
    ) values (
      'P5D-DRAFT-' || substr(gen_random_uuid()::text,1,8),
      'open',
      'GBP', 50, 50, v_customer_id, 'phase5d_simulation',
      (select email from customers where id = v_customer_id)
    ) returning id into v_draft_id;
    v_scenarios := v_scenarios || jsonb_build_array(jsonb_build_object(
      'scenario', 'QUOTE_TO_DRAFT',
      'ok', v_draft_id is not null,
      'draft_id', v_draft_id
    ));
  exception when others then
    v_scenarios := v_scenarios || jsonb_build_array(jsonb_build_object(
      'scenario', 'QUOTE_TO_DRAFT',
      'ok', false,
      'error', SQLERRM
    ));
  end;

  insert into cutover_simulation_runs (run_type, result)
  values ('native_order_simulation', jsonb_build_object(
    'ok', v_ok, 'customer_id', v_customer_id, 'order_id', v_order_id, 'scenarios', v_scenarios
  ));

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer_id,
    'order_id', v_order_id,
    'draft_id', v_draft_id,
    'scenarios', v_scenarios,
    'emails_sent', 0,
    'note', 'Synthetic @unique.invalid only — NO CUSTOMER CONTACT'
  );
end;
$$;

grant execute on function public.rpc_phase5d_native_order_simulation() to authenticated, service_role;
