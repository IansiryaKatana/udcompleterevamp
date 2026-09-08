-- Phase 2E repair: ensure payment detail RPC uses p_id (match Phase 2D),
-- document Unique-native ledger SoR, drop accidental overload if present.

begin;

drop function if exists public.rpc_get_admin_payment_transaction(p_payment_id uuid);

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

comment on function public.finance_calculate_order_ledger(uuid) is
  'Unique-native SoR rule: for money_ledger_mode=unique_ledger, operational cash = sum(txs where semantic.affects_received) minus affects_refunded; PENDING_EXTERNAL_PAYMENT never counts as received. For imported_snapshot, source_* remain immutable Shopify snapshots; calculated_* is interpretative only.';

grant execute on function public.rpc_get_admin_payment_transaction(uuid) to authenticated, service_role;

commit;
