-- Phase 2E part 2: payment semantics classifier, calculated ledger, RPCs, selftest.
-- PENDING ≠ RECEIVED universally. Evidence-based matrix only.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- Semantic classifier (gateway × kind × status)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.payment_tx_semantic_classify(
  p_gateway text,
  p_kind text,
  p_status text,
  p_source_system text default null
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  g text := lower(trim(coalesce(p_gateway, '')));
  k text := upper(trim(coalesce(p_kind, '')));
  s text := upper(trim(coalesce(p_status, '')));
  src text := lower(trim(coalesce(p_source_system, '')));
  meaning text := 'UNKNOWN';
  affects_received boolean := false;
  affects_outstanding boolean := false;
  affects_available_to_capture boolean := false;
  affects_refunded boolean := false;
  terminal_or_transient text := 'unknown';
  confidence text := 'low';
  evidence text := 'unclassified combination';
begin
  -- Unique-native manual posts
  if src = 'unique' and k in ('SALE', 'PAYMENT', 'CAPTURE') and s = 'SUCCESS' then
    return jsonb_build_object(
      'meaning', 'MANUAL_PAYMENT_RECORDED',
      'affects_received', true,
      'affects_outstanding', true,
      'affects_available_to_capture', false,
      'affects_refunded', false,
      'terminal_or_transient', 'terminal',
      'confidence', 'high',
      'evidence', 'Unique-native successful money post'
    );
  end if;
  if src = 'unique' and k in ('REFUND', 'REVERSAL') and s = 'SUCCESS' then
    return jsonb_build_object(
      'meaning', case when k = 'REVERSAL' then 'REVERSAL' else 'REFUNDED' end,
      'affects_received', false,
      'affects_outstanding', true,
      'affects_available_to_capture', false,
      'affects_refunded', true,
      'terminal_or_transient', 'terminal',
      'confidence', 'high',
      'evidence', 'Unique-native refund/reversal'
    );
  end if;

  -- Worldpay eCommerce / Worldpay Payments (Shopify historical: SALE-captured, not auth/capture)
  if g like '%worldpay%' then
    if k = 'SALE' and s = 'SUCCESS' then
      meaning := 'SETTLED_SALE'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'n=10173 Worldpay SALE SUCCESS historically';
    elsif k = 'SALE' and s in ('FAILURE', 'ERROR') then
      meaning := 'FAILED'; terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'Worldpay SALE FAILURE/ERROR — not cash';
    elsif k = 'REFUND' and s = 'SUCCESS' then
      meaning := 'REFUNDED'; affects_refunded := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'Worldpay REFUND SUCCESS';
    elsif k = 'REFUND' and s = 'PENDING' then
      meaning := 'REFUND_PENDING'; terminal_or_transient := 'transient'; confidence := 'medium';
      evidence := 'Rare Worldpay REFUND PENDING';
    elsif k = 'REFUND' and s = 'FAILURE' then
      meaning := 'FAILED'; terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'Worldpay REFUND FAILURE';
    elsif k = 'AUTHORIZATION' and s = 'SUCCESS' then
      meaning := 'AUTHORIZED'; affects_available_to_capture := true;
      terminal_or_transient := 'transient'; confidence := 'medium';
      evidence := 'Auth present in model; rare in UD Worldpay history';
    elsif k = 'CAPTURE' and s = 'SUCCESS' then
      meaning := 'CAPTURED'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'medium';
      evidence := 'Capture kind supported; sparse historically for Worldpay label';
    elsif k = 'VOID' and s = 'SUCCESS' then
      meaning := 'VOIDED'; terminal_or_transient := 'terminal'; confidence := 'medium';
      evidence := 'Void cancels auth/pending — not a refund';
    else
      meaning := 'UNKNOWN'; confidence := 'low';
      evidence := format('Unmapped Worldpay %s/%s', k, s);
    end if;

  -- Bank Deposit
  elsif g = 'bank deposit' then
    if k = 'SALE' and s = 'SUCCESS' then
      meaning := 'MANUAL_PAYMENT_RECORDED'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'n=9749 Bank Deposit SALE SUCCESS';
    elsif k = 'SALE' and s = 'PENDING' then
      meaning := 'PENDING_EXTERNAL_PAYMENT';
      affects_received := false; -- CRITICAL: not cash
      affects_outstanding := false;
      terminal_or_transient := 'transient'; confidence := 'high';
      evidence := 'n=6772 Bank Deposit PENDING — awaiting remittance, NOT received';
    elsif k = 'VOID' and s = 'SUCCESS' then
      meaning := 'VOIDED'; terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'Bank Deposit VOID cancels pending intent';
    elsif k = 'REFUND' and s = 'SUCCESS' then
      meaning := 'REFUNDED'; affects_refunded := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'Bank Deposit REFUND SUCCESS (rare)';
    else
      meaning := 'UNKNOWN'; confidence := 'low';
      evidence := format('Unmapped Bank Deposit %s/%s', k, s);
    end if;

  -- manual
  elsif g = 'manual' then
    if k = 'SALE' and s = 'SUCCESS' then
      meaning := 'MANUAL_PAYMENT_RECORDED'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'n=3049 manual SALE SUCCESS';
    elsif k = 'REFUND' and s = 'SUCCESS' then
      meaning := 'REFUNDED'; affects_refunded := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'manual REFUND SUCCESS';
    else
      meaning := 'UNKNOWN'; confidence := 'low';
      evidence := format('Unmapped manual %s/%s', k, s);
    end if;

  -- Pay By Cash
  elsif g = 'pay by cash' then
    if k = 'SALE' and s = 'SUCCESS' then
      meaning := 'MANUAL_PAYMENT_RECORDED'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'Pay By Cash SALE SUCCESS';
    elsif k = 'SALE' and s = 'PENDING' then
      meaning := 'PENDING_EXTERNAL_PAYMENT'; affects_received := false;
      terminal_or_transient := 'transient'; confidence := 'high';
      evidence := 'Pay By Cash PENDING is not cash received';
    elsif k = 'REFUND' and s = 'SUCCESS' then
      meaning := 'REFUNDED'; affects_refunded := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'Pay By Cash REFUND';
    else
      meaning := 'UNKNOWN'; confidence := 'low'; evidence := format('Unmapped cash %s/%s', k, s);
    end if;

  -- PAY LATER / Order Now, Pay Later — commitment ≠ payment
  elsif g in ('pay later', 'order now, pay later') then
    if k = 'SALE' and s = 'PENDING' then
      meaning := 'PENDING_EXTERNAL_PAYMENT'; affects_received := false;
      terminal_or_transient := 'transient'; confidence := 'high';
      evidence := 'PAY LATER PENDING is credit commitment, not received cash';
    elsif k = 'SALE' and s = 'SUCCESS' then
      meaning := 'SETTLED_SALE'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'medium';
      evidence := 'Rare PAY LATER SALE SUCCESS (n=10) — treated as settled when SUCCESS';
    elsif k = 'VOID' and s = 'SUCCESS' then
      meaning := 'VOIDED'; terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'PAY LATER VOID clears commitment';
    else
      meaning := 'UNKNOWN'; confidence := 'low'; evidence := format('Unmapped PAY LATER %s/%s', k, s);
    end if;

  -- shopify_store_credit
  elsif g = 'shopify_store_credit' then
    if k = 'AUTHORIZATION' and s = 'SUCCESS' then
      meaning := 'AUTHORIZED'; affects_available_to_capture := true;
      terminal_or_transient := 'transient'; confidence := 'high';
      evidence := 'store_credit AUTHORIZATION';
    elsif k = 'CAPTURE' and s = 'SUCCESS' then
      meaning := 'CAPTURED'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'store_credit CAPTURE';
    elsif k = 'SALE' and s = 'SUCCESS' then
      meaning := 'SETTLED_SALE'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'store_credit SALE';
    elsif k = 'REFUND' and s = 'SUCCESS' then
      meaning := 'REFUNDED'; affects_refunded := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'store_credit REFUND';
    else
      meaning := 'UNKNOWN'; confidence := 'low'; evidence := format('Unmapped store_credit %s/%s', k, s);
    end if;

  -- shopify_payments (rare in this store)
  elsif g = 'shopify_payments' then
    if k = 'SALE' and s = 'SUCCESS' then
      meaning := 'SETTLED_SALE'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'high';
      evidence := 'shopify_payments SALE SUCCESS (rare)';
    else
      meaning := 'UNKNOWN'; confidence := 'low'; evidence := format('Unmapped shopify_payments %s/%s', k, s);
    end if;

  else
    if k = 'SALE' and s = 'SUCCESS' then
      meaning := 'SETTLED_SALE'; affects_received := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'low';
      evidence := 'Generic SUCCESS SALE fallback — low confidence';
    elsif k = 'SALE' and s = 'PENDING' then
      meaning := 'PENDING_EXTERNAL_PAYMENT'; affects_received := false;
      terminal_or_transient := 'transient'; confidence := 'medium';
      evidence := 'Generic PENDING SALE — not received';
    elsif k = 'REFUND' and s = 'SUCCESS' then
      meaning := 'REFUNDED'; affects_refunded := true; affects_outstanding := true;
      terminal_or_transient := 'terminal'; confidence := 'medium';
      evidence := 'Generic REFUND SUCCESS';
    elsif k = 'VOID' and s = 'SUCCESS' then
      meaning := 'VOIDED'; terminal_or_transient := 'terminal'; confidence := 'medium';
      evidence := 'Generic VOID';
    else
      meaning := 'UNKNOWN'; confidence := 'low';
      evidence := format('Unmapped gateway=%s kind=%s status=%s', coalesce(p_gateway, ''), k, s);
    end if;
  end if;

  return jsonb_build_object(
    'meaning', meaning,
    'affects_received', affects_received,
    'affects_outstanding', affects_outstanding,
    'affects_available_to_capture', affects_available_to_capture,
    'affects_refunded', affects_refunded,
    'terminal_or_transient', terminal_or_transient,
    'confidence', confidence,
    'evidence', evidence,
    'gateway', p_gateway,
    'kind', k,
    'status', s
  );
end;
$$;

grant execute on function public.payment_tx_semantic_classify(text, text, text, text)
  to authenticated, service_role, anon;

-- Calculated ledger position from semantic rules (does NOT mutate rows)
create or replace function public.finance_calculate_order_ledger(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_received numeric(14,2) := 0;
  v_refunded numeric(14,2) := 0;
  v_pending_external numeric(14,2) := 0;
  v_authorized numeric(14,2) := 0;
  v_net numeric(14,2);
  v_outstanding numeric(14,2);
  v_status text;
  v_recon text;
  v_variance_received numeric(14,2);
  v_variance_outstanding numeric(14,2);
  r record;
  sem jsonb;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  for r in
    select gateway, kind, status, amount, source_system
    from public.payment_transactions
    where order_id = p_order_id
  loop
    sem := public.payment_tx_semantic_classify(r.gateway, r.kind, r.status, r.source_system);
    if coalesce((sem->>'affects_received')::boolean, false) then
      v_received := v_received + coalesce(r.amount, 0);
    end if;
    if coalesce((sem->>'affects_refunded')::boolean, false) then
      v_refunded := v_refunded + coalesce(r.amount, 0);
    end if;
    if sem->>'meaning' = 'PENDING_EXTERNAL_PAYMENT' then
      v_pending_external := v_pending_external + coalesce(r.amount, 0);
    end if;
    if coalesce((sem->>'affects_available_to_capture')::boolean, false) then
      v_authorized := v_authorized + coalesce(r.amount, 0);
    end if;
  end loop;

  v_net := greatest(v_received - v_refunded, 0);
  v_outstanding := greatest(coalesce(v_order.total, 0) - v_net, 0);
  v_status := public.finance_financial_status_from_amounts(
    coalesce(v_order.total, 0), v_net, v_outstanding
  );

  v_variance_received := round(coalesce(v_order.source_total_received, v_order.total_received, 0) - v_net, 2);
  v_variance_outstanding := round(
    coalesce(v_order.source_total_outstanding, v_order.total_outstanding, 0) - v_outstanding, 2
  );

  if abs(v_variance_received) < 0.02 and abs(v_variance_outstanding) < 0.02 then
    v_recon := 'MATCHED';
  elsif not exists (select 1 from public.payment_transactions where order_id = p_order_id)
        and coalesce(v_order.source_total_received, 0) > 0.01 then
    v_recon := 'INSUFFICIENT_EVIDENCE';
  else
    v_recon := 'MISMATCHED';
  end if;

  -- Preserve reviewed statuses if already set on order
  if v_order.reconciliation_status in ('REVIEWED_ACCEPTED', 'REVIEWED_CORRECTED_BY_UNIQUE_EVENT') then
    v_recon := v_order.reconciliation_status;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'money_ledger_mode', v_order.money_ledger_mode,
    'imported', jsonb_build_object(
      'total', v_order.source_total,
      'received', v_order.source_total_received,
      'outstanding', v_order.source_total_outstanding,
      'financial_status', v_order.source_financial_status
    ),
    'calculated', jsonb_build_object(
      'received', round(v_received, 2),
      'refunded', round(v_refunded, 2),
      'net_received', round(v_net, 2),
      'outstanding', round(v_outstanding, 2),
      'financial_status', v_status,
      'pending_external', round(v_pending_external, 2),
      'authorized_available', round(v_authorized, 2)
    ),
    'working_cache', jsonb_build_object(
      'total', v_order.total,
      'received', v_order.total_received,
      'outstanding', v_order.total_outstanding,
      'financial_status', v_order.financial_status
    ),
    'variance', jsonb_build_object(
      'received', v_variance_received,
      'outstanding', v_variance_outstanding
    ),
    'reconciliation_status', v_recon,
    'rule', 'PENDING_EXTERNAL_PAYMENT (e.g. Bank Deposit PENDING, PAY LATER PENDING) does NOT count as received'
  );
end;
$$;

grant execute on function public.finance_calculate_order_ledger(uuid) to authenticated, service_role;

-- Batch refresh reconciliation_status (label only — does not change money amounts)
create or replace function public.finance_refresh_reconciliation_status(p_limit int default 500)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  v_calc jsonb;
  v_n int := 0;
begin
  if not public.current_admin_is_owner_or_admin() then
    -- allow when called with service role (no auth.uid)
    if auth.uid() is not null then
      return jsonb_build_object('ok', false, 'error', 'Forbidden');
    end if;
  end if;

  for r in
    select id from public.orders
    where coalesce(reconciliation_status, '') not in ('REVIEWED_ACCEPTED', 'REVIEWED_CORRECTED_BY_UNIQUE_EVENT')
    order by created_at desc nulls last
    limit least(greatest(coalesce(p_limit, 500), 1), 5000)
  loop
    v_calc := public.finance_calculate_order_ledger(r.id);
    if coalesce(v_calc->>'ok', 'false') = 'true' then
      update public.orders
      set reconciliation_status = v_calc->>'reconciliation_status'
      where id = r.id
        and coalesce(reconciliation_status, '') not in ('REVIEWED_ACCEPTED', 'REVIEWED_CORRECTED_BY_UNIQUE_EVENT');
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_n);
end;
$$;

grant execute on function public.finance_refresh_reconciliation_status(int) to authenticated, service_role;

commit;
