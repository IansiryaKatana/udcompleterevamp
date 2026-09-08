-- Fix Phase 2F selftest / fixture order.status to satisfy orders_status_check.

begin;

create or replace function public.rpc_admin_create_phase2f_test_fixture(
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cached jsonb;
  v_customer_id uuid;
  v_order_id uuid;
begin
  if not public.current_admin_is_owner_or_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    v_cached := public.finance_lookup_idempotency(p_idempotency_key);
    if v_cached is not null then
      return v_cached || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  insert into public.customers (
    email, display_name, first_name, last_name, source_system, status, approval_status
  ) values (
    'phase2f-test-' || substr(gen_random_uuid()::text, 1, 8) || '@test.unique.local',
    'PHASE2F-TEST Customer',
    'PHASE2F',
    'TEST',
    'unique',
    'active',
    'approved'
  )
  returning id into v_customer_id;

  insert into public.orders (
    email, order_number, status, financial_status, currency,
    subtotal, shipping_total, tax_total, discount_total, total,
    total_received, total_outstanding,
    customer_id, order_source, metadata,
    money_ledger_mode, is_test, finance_environment,
    source_total, source_total_received, source_total_outstanding, source_financial_status,
    source_created_at, processed_at
  ) values (
    'phase2f-test@test.unique.local',
    'PHASE2F-TEST-' || to_char(now(), 'YYYYMMDDHH24MISS'),
    'pending',
    'PENDING',
    'GBP',
    100.00, 10.00, 22.00, 0, 132.00,
    0, 132.00,
    v_customer_id,
    'unique',
    jsonb_build_object('source_system', 'unique', 'phase', '2f', 'is_test', true),
    'unique_ledger',
    true,
    'test',
    132.00, 0, 132.00, 'PENDING',
    now(), now()
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_name, sku_snapshot, quantity, unit_price, line_total, tax_total
  ) values (
    v_order_id, 'PHASE2F TEST SKU', 'PHASE2F-SKU-1', 1, 100.00, 100.00, 20.00
  );

  perform public.append_finance_event(
    'order', v_order_id, 'phase2f_test_fixture_created', 'system',
    'Synthetic Unique TEST order for Phase 2F (no Worldpay call)',
    null,
    jsonb_build_object('is_test', true, 'finance_environment', 'test'),
    '{}'::jsonb, 'unique'
  );

  v_cached := jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'customer_id', v_customer_id,
    'is_test', true,
    'finance_environment', 'test',
    'worldpay_product', 'UNCONFIRMED',
    'note', 'Fixture only — no Worldpay authorization performed'
  );

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    perform public.finance_store_idempotency(p_idempotency_key, 'phase2f_test_fixture', v_cached);
  end if;

  return v_cached;
end;
$$;

create or replace function public.rpc_phase2f_worldpay_test_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean;
  v_detail text;
  v_mode text;
  v_provider text;
  v_customer_id uuid;
  v_order_id uuid;
  v_prod_out numeric;
  v_with_test numeric;
  v_pass int := 0;
  v_total int := 0;
  v_hist int;
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is not null then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select gateway_mode, gateway_provider into v_mode, v_provider
  from public.payment_gateway_config where key = 'default';
  v_ok := v_mode = 'disabled' and v_provider like '%unconfirmed%';
  v_cases := v_cases || jsonb_build_object('A_product_unconfirmed_mode_disabled', jsonb_build_object('ok', v_ok, 'detail', v_provider || '/' || v_mode));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  v_ok := public.payment_gateway_live_blocked() = true
    and coalesce((public.payment_gateway_actions_permitted()->>'allowed')::boolean, true) = false;
  v_cases := v_cases || jsonb_build_object('B_gateway_not_allowed', jsonb_build_object('ok', v_ok, 'detail', public.payment_gateway_mode()));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  insert into public.customers (email, display_name, source_system, status)
  values ('phase2f-selftest@test.unique.local', 'PHASE2F-STAB', 'unique', 'active')
  returning id into v_customer_id;

  insert into public.orders (
    email, order_number, status, financial_status, currency, total, total_received, total_outstanding,
    customer_id, order_source, metadata, money_ledger_mode, is_test, finance_environment,
    source_total, source_total_received, source_total_outstanding, source_financial_status
  ) values (
    'phase2f-selftest@test.unique.local', 'PHASE2F-STAB-ORDER', 'pending', 'PENDING', 'GBP',
    50, 0, 50, v_customer_id, 'unique',
    jsonb_build_object('source_system', 'unique', 'is_test', true),
    'unique_ledger', true, 'test', 50, 0, 50, 'PENDING'
  ) returning id into v_order_id;

  v_ok := exists (select 1 from public.orders where id = v_order_id and is_test = true);
  v_cases := v_cases || jsonb_build_object('C_test_fixture_flag', jsonb_build_object('ok', v_ok, 'detail', v_order_id::text));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  select coalesce(sum(total_outstanding), 0) into v_prod_out
  from public.orders where coalesce(is_test, false) = false and coalesce(total_outstanding, 0) > 0;
  select coalesce(sum(total_outstanding), 0) into v_with_test
  from public.orders where coalesce(total_outstanding, 0) > 0;
  v_ok := (v_with_test - v_prod_out) >= 50;
  v_cases := v_cases || jsonb_build_object(
    'D_test_excluded_from_prod_totals',
    jsonb_build_object('ok', v_ok, 'detail', format('prod_out=%s with_test=%s', v_prod_out, v_with_test))
  );
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  select count(*) into v_hist from public.orders where shopify_order_gid is not null and coalesce(is_test, false) = false;
  v_ok := v_hist = 21767;
  v_cases := v_cases || jsonb_build_object('E_historical_order_count', jsonb_build_object('ok', v_ok, 'detail', v_hist::text));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  v_ok := public.payment_gateway_mode() = 'disabled';
  v_cases := v_cases || jsonb_build_object('F_no_test_mode_activation', jsonb_build_object('ok', v_ok, 'detail', 'gateway_mode stays disabled until product confirmed'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  delete from public.order_items where order_id = v_order_id;
  delete from public.finance_events where entity_id = v_order_id;
  delete from public.orders where id = v_order_id;
  delete from public.customers where id = v_customer_id;

  return jsonb_build_object(
    'ok', v_pass = v_total,
    'pass', v_pass,
    'total', v_total,
    'cases', v_cases,
    'worldpay_product', 'UNCONFIRMED',
    'cleanup', jsonb_build_object('ok', true)
  );
end;
$$;

-- Cleanup any orphaned failed selftest customers
delete from public.customers where email = 'phase2f-selftest@test.unique.local'
  and not exists (select 1 from public.orders o where o.customer_id = customers.id);

commit;
