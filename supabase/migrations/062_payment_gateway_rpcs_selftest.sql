-- Phase 2E part 3: finance boundary RPCs, gated gateway actions, webhook ingest, selftest.

begin;

-- Extend order finance panel with boundary
create or replace function public.rpc_get_admin_order_finance_panel(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order jsonb;
  v_payments jsonb;
  v_refunds jsonb;
  v_invoices jsonb;
  v_ledger jsonb;
  v_aging text;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select to_jsonb(o) into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_ledger := public.finance_calculate_order_ledger(p_order_id);

  select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
    'semantic', public.payment_tx_semantic_classify(t.gateway, t.kind, t.status, t.source_system)
  ) order by coalesce(t.processed_at, t.created_at) desc), '[]'::jsonb)
  into v_payments
  from public.payment_transactions t
  where t.order_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by coalesce(r.source_created_at, r.created_at) desc), '[]'::jsonb)
  into v_refunds
  from public.refunds r
  where r.order_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc), '[]'::jsonb)
  into v_invoices
  from public.invoices i
  where i.order_id = p_order_id;

  v_aging := public.finance_aging_bucket((v_order->>'payment_due_on')::date, current_date);

  return jsonb_build_object(
    'ok', true,
    'order', v_order,
    'payments', v_payments,
    'refunds', v_refunds,
    'invoices', v_invoices,
    'total_received', v_order->>'total_received',
    'outstanding', v_order->>'total_outstanding',
    'aging_bucket', v_aging,
    'ledger_boundary', v_ledger,
    'gateway_gate', public.payment_gateway_actions_permitted()
  );
end;
$$;

create or replace function public.rpc_get_admin_payment_transaction(p_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_tx public.payment_transactions%rowtype;
  v_order jsonb;
  v_related jsonb;
  v_sem jsonb;
  v_ledger jsonb;
  v_intent jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_tx from public.payment_transactions where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_sem := public.payment_tx_semantic_classify(v_tx.gateway, v_tx.kind, v_tx.status, v_tx.source_system);
  select to_jsonb(o) into v_order from public.orders o where o.id = v_tx.order_id;
  v_ledger := public.finance_calculate_order_ledger(v_tx.order_id);

  select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
    'semantic', public.payment_tx_semantic_classify(t.gateway, t.kind, t.status, t.source_system)
  ) order by coalesce(t.processed_at, t.created_at)), '[]'::jsonb)
  into v_related
  from public.payment_transactions t
  where t.order_id = v_tx.order_id
    and t.id <> v_tx.id;

  if v_tx.payment_intent_id is not null then
    select to_jsonb(i) into v_intent from public.payment_intents i where i.id = v_tx.payment_intent_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'payment', to_jsonb(v_tx) || jsonb_build_object('semantic', v_sem),
    'order', v_order,
    'related', v_related,
    'ledger_boundary', v_ledger,
    'payment_intent', v_intent,
    'gateway_gate', public.payment_gateway_actions_permitted(),
    'canonical_state', v_sem->>'meaning',
    'refundable_hint', case
      when coalesce((v_sem->>'affects_received')::boolean, false)
        then greatest(coalesce(v_tx.amount, 0), 0)
      else 0
    end
  );
end;
$$;

-- Gated gateway money actions — never execute live Worldpay in Phase 2E
create or replace function public.rpc_admin_gateway_capture(
  p_payment_id uuid,
  p_amount numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_gate jsonb;
begin
  if not public.can_finance_capture() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  v_gate := public.payment_gateway_actions_permitted();
  if not coalesce((v_gate->>'allowed')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_gate->>'error', 'gateway_disabled'),
      'gateway_gate', v_gate,
      'action', 'capture'
    );
  end if;
  -- Even in test mode, SQL layer does not call Worldpay — adapter must.
  return jsonb_build_object(
    'ok', false,
    'error', 'gateway_adapter_required',
    'message', 'Capture must run through PaymentService adapter; SQL refuses direct money movement',
    'gateway_gate', v_gate,
    'payment_id', p_payment_id,
    'amount', p_amount,
    'idempotency_key', p_idempotency_key
  );
end;
$$;

create or replace function public.rpc_admin_gateway_void(
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_gate jsonb;
begin
  if not public.can_finance_void() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  v_gate := public.payment_gateway_actions_permitted();
  if not coalesce((v_gate->>'allowed')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', coalesce(v_gate->>'error', 'gateway_disabled'), 'gateway_gate', v_gate, 'action', 'void');
  end if;
  return jsonb_build_object(
    'ok', false,
    'error', 'gateway_adapter_required',
    'message', 'Void must run through PaymentService adapter',
    'gateway_gate', v_gate,
    'payment_id', p_payment_id,
    'reason', p_reason,
    'idempotency_key', p_idempotency_key
  );
end;
$$;

create or replace function public.rpc_admin_gateway_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_gate jsonb;
begin
  if not public.can_finance_refund() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  v_gate := public.payment_gateway_actions_permitted();
  if not coalesce((v_gate->>'allowed')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', coalesce(v_gate->>'error', 'gateway_disabled'), 'gateway_gate', v_gate, 'action', 'refund');
  end if;
  return jsonb_build_object(
    'ok', false,
    'error', 'gateway_adapter_required',
    'message', 'Refund must run through PaymentService adapter; production refunds blocked in Phase 2E',
    'gateway_gate', v_gate,
    'payment_id', p_payment_id,
    'amount', p_amount,
    'reason', p_reason,
    'idempotency_key', p_idempotency_key
  );
end;
$$;

grant execute on function public.rpc_admin_gateway_capture(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.rpc_admin_gateway_void(uuid, text, text) to authenticated, service_role;
grant execute on function public.rpc_admin_gateway_refund(uuid, numeric, text, text) to authenticated, service_role;

-- Webhook ingest (service_role / edge function). Idempotent by gateway+external_event_id.
create or replace function public.rpc_ingest_payment_gateway_event(
  p_gateway text,
  p_external_event_id text,
  p_event_type text,
  p_payload_redacted jsonb,
  p_payload_hash text,
  p_signature_header text,
  p_signature_valid boolean,
  p_related_order_id uuid default null,
  p_related_payment_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_existing public.payment_gateway_events%rowtype;
begin
  -- Only service_role should call (edge function). Reject authenticated end-users.
  if auth.role() is distinct from 'service_role' and auth.uid() is not null then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if p_external_event_id is not null then
    select * into v_existing
    from public.payment_gateway_events
    where gateway = coalesce(nullif(trim(p_gateway), ''), 'worldpay')
      and external_event_id = p_external_event_id;
    if found then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'event_id', v_existing.id,
        'processing_status', v_existing.processing_status
      );
    end if;
  end if;

  insert into public.payment_gateway_events (
    gateway, external_event_id, event_type, payload_redacted, payload_hash,
    signature_header, signature_valid, related_order_id, related_payment_id,
    idempotency_key, processing_status
  ) values (
    coalesce(nullif(trim(p_gateway), ''), 'worldpay'),
    nullif(trim(p_external_event_id), ''),
    p_event_type,
    coalesce(p_payload_redacted, '{}'::jsonb),
    p_payload_hash,
    p_signature_header,
    p_signature_valid,
    p_related_order_id,
    p_related_payment_id,
    p_idempotency_key,
    case when p_signature_valid is false then 'failed' else 'received' end
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'event_id', v_id);
end;
$$;

revoke all on function public.rpc_ingest_payment_gateway_event(text, text, text, jsonb, text, text, boolean, uuid, uuid, text) from public;
grant execute on function public.rpc_ingest_payment_gateway_event(text, text, text, jsonb, text, text, boolean, uuid, uuid, text) to service_role;

create or replace function public.rpc_admin_payment_gateway_config()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_cfg public.payment_gateway_config%rowtype;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  select * into v_cfg from public.payment_gateway_config where key = 'default';
  return jsonb_build_object(
    'ok', true,
    'config', to_jsonb(v_cfg),
    'gate', public.payment_gateway_actions_permitted()
  );
end;
$$;

grant execute on function public.rpc_admin_payment_gateway_config() to authenticated, service_role;

-- Semantic matrix export for admin/docs
create or replace function public.rpc_admin_payment_semantic_matrix()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  c record;
  sem jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  for c in
    select coalesce(gateway, '(null)') as gateway,
           upper(kind) as kind,
           upper(status) as status,
           count(*)::int as n,
           sum(amount)::numeric(14,2) as amount_sum
    from public.payment_transactions
    group by 1, 2, 3
    order by count(*) desc
  loop
    sem := public.payment_tx_semantic_classify(c.gateway, c.kind, c.status, null);
    v_rows := v_rows || jsonb_build_array(
      sem || jsonb_build_object('observed_count', c.n, 'observed_amount_sum', c.amount_sum)
    );
  end loop;

  return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$$;

grant execute on function public.rpc_admin_payment_semantic_matrix() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Selftest
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase2e_payment_gateway_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean;
  v_detail text;
  v_sem jsonb;
  v_gate jsonb;
  v_ledger jsonb;
  v_order_id uuid;
  v_tx_id uuid;
  v_evt jsonb;
  v_pass int := 0;
  v_total int := 0;
  v_hist_orders int;
  v_hist_txs int;
  v_src_recv numeric;
  v_mode text;
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is not null then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  -- A pending bank deposit ≠ received
  begin
    v_sem := public.payment_tx_semantic_classify('Bank Deposit', 'SALE', 'PENDING', 'shopify');
    v_ok := (v_sem->>'meaning') = 'PENDING_EXTERNAL_PAYMENT'
      and (v_sem->>'affects_received')::boolean = false;
    v_detail := v_sem->>'evidence';
  exception when others then
    v_ok := false; v_detail := SQLERRM;
  end;
  v_cases := v_cases || jsonb_build_object('A_pending_not_received', jsonb_build_object('ok', v_ok, 'detail', v_detail));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- B worldpay success = received
  v_sem := public.payment_tx_semantic_classify('Worldpay eCommerce', 'SALE', 'SUCCESS', 'shopify');
  v_ok := (v_sem->>'affects_received')::boolean = true and (v_sem->>'meaning') = 'SETTLED_SALE';
  v_cases := v_cases || jsonb_build_object('B_worldpay_sale_success', jsonb_build_object('ok', v_ok, 'detail', v_sem->>'meaning'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- C PAY LATER pending not received
  v_sem := public.payment_tx_semantic_classify('PAY LATER', 'SALE', 'PENDING', 'shopify');
  v_ok := (v_sem->>'affects_received')::boolean = false;
  v_cases := v_cases || jsonb_build_object('C_pay_later_not_cash', jsonb_build_object('ok', v_ok, 'detail', v_sem->>'meaning'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- D gateway disabled
  v_gate := public.payment_gateway_actions_permitted();
  v_mode := public.payment_gateway_mode();
  v_ok := v_mode = 'disabled' and coalesce((v_gate->>'allowed')::boolean, true) = false;
  v_cases := v_cases || jsonb_build_object('D_gateway_mode_disabled', jsonb_build_object('ok', v_ok, 'detail', v_mode));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- E live blocked flag
  v_ok := public.payment_gateway_live_blocked() = true;
  v_cases := v_cases || jsonb_build_object('E_live_blocked_flag', jsonb_build_object('ok', v_ok, 'detail', 'phase_2e_live_blocked'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- F capture RPC forbidden/disabled without admin
  v_gate := public.rpc_admin_gateway_capture('00000000-0000-0000-0000-000000000001', 1, 'P2E-STAB');
  v_ok := coalesce(v_gate->>'ok', 'true') = 'false';
  v_cases := v_cases || jsonb_build_object('F_capture_gated', jsonb_build_object('ok', v_ok, 'detail', v_gate->>'error'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- G historical immutability counts
  select count(*) into v_hist_orders from public.orders;
  select count(*) into v_hist_txs from public.payment_transactions;
  v_ok := v_hist_orders = 21767 and v_hist_txs = 34430;
  v_cases := v_cases || jsonb_build_object(
    'G_historical_counts',
    jsonb_build_object('ok', v_ok, 'detail', format('orders=%s txs=%s', v_hist_orders, v_hist_txs))
  );
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- H source snapshot frozen present on shopify order
  select id, source_total_received into v_order_id, v_src_recv
  from public.orders
  where shopify_order_gid is not null and source_total_received is not null
  limit 1;
  v_ok := v_order_id is not null;
  begin
    update public.orders set source_total_received = source_total_received + 1 where id = v_order_id;
    v_ok := false;
    v_detail := 'source update unexpectedly allowed';
  exception when others then
    v_ok := true;
    v_detail := 'source immutable ok';
  end;
  v_cases := v_cases || jsonb_build_object('H_source_immutable', jsonb_build_object('ok', v_ok, 'detail', v_detail));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- I ledger calc returns boundary fields
  v_ledger := public.finance_calculate_order_ledger(v_order_id);
  v_ok := coalesce(v_ledger->>'ok', 'false') = 'true'
    and v_ledger ? 'imported'
    and v_ledger ? 'calculated'
    and v_ledger ? 'variance';
  v_cases := v_cases || jsonb_build_object('I_ledger_boundary_shape', jsonb_build_object('ok', v_ok, 'detail', v_ledger->>'reconciliation_status'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- J webhook ingest idempotent
  v_evt := public.rpc_ingest_payment_gateway_event(
    'worldpay', 'P2E-STAB-EVT-1', 'test.event',
    jsonb_build_object('safe', true), 'hash1', 'sig', true, null, null, 'P2E-STAB-EVT-1'
  );
  v_ok := coalesce(v_evt->>'ok', 'false') = 'true';
  v_evt := public.rpc_ingest_payment_gateway_event(
    'worldpay', 'P2E-STAB-EVT-1', 'test.event',
    jsonb_build_object('safe', true), 'hash1', 'sig', true, null, null, 'P2E-STAB-EVT-1'
  );
  v_ok := v_ok and coalesce((v_evt->>'duplicate')::boolean, false) = true;
  v_cases := v_cases || jsonb_build_object('J_webhook_idempotent', jsonb_build_object('ok', v_ok, 'detail', v_evt->>'processing_status'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- K void ≠ refund semantics
  v_sem := public.payment_tx_semantic_classify('Bank Deposit', 'VOID', 'SUCCESS', 'shopify');
  v_ok := (v_sem->>'meaning') = 'VOIDED' and (v_sem->>'affects_refunded')::boolean = false
    and (v_sem->>'affects_received')::boolean = false;
  v_cases := v_cases || jsonb_build_object('K_void_not_refund', jsonb_build_object('ok', v_ok, 'detail', v_sem->>'meaning'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- L manual unique success received
  v_sem := public.payment_tx_semantic_classify('Bank transfer', 'SALE', 'SUCCESS', 'unique');
  v_ok := (v_sem->>'meaning') = 'MANUAL_PAYMENT_RECORDED' and (v_sem->>'affects_received')::boolean = true;
  v_cases := v_cases || jsonb_build_object('L_unique_manual_received', jsonb_build_object('ok', v_ok, 'detail', v_sem->>'meaning'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- cleanup synthetic webhook event
  delete from public.payment_gateway_events where external_event_id = 'P2E-STAB-EVT-1';

  return jsonb_build_object(
    'ok', v_pass = v_total,
    'pass', v_pass,
    'total', v_total,
    'cases', v_cases,
    'cleanup', jsonb_build_object('ok', true)
  );
end;
$$;

revoke all on function public.rpc_phase2e_payment_gateway_selftest() from public;
grant execute on function public.rpc_phase2e_payment_gateway_selftest() to service_role;

commit;
