-- Phase 5F selftest fix: orders.email NOT NULL
create or replace function public.rpc_phase5f_finance_selftest()
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
  v_order_id uuid;
  v_cust uuid;
  v_tol numeric;
  v_email text;
begin
  v_sub := coalesce((select value from site_settings where key='commercial_access_mode'),'') = 'catalogue_open'
    and coalesce((select value from site_settings where key='pilot_send_authorized'),'') = 'false'
    and coalesce((select value from site_settings where key='wms_enabled'),'false') = 'false'
    and coalesce((select value from site_settings where key='compliance_enforcement_mode'),'observe') = 'observe'
    and coalesce((select value from site_settings where key='trade_required_cutover_approved'),'false') = 'false';
  v_cases := v_cases || jsonb_build_object('A_locked_gates', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tol := public.finance_money_tolerance_gbp();
  v_sub := v_tol = 0.02 and public.finance_variance_materiality(0.01) = 'WITHIN_TOLERANCE'
    and public.finance_variance_materiality(1.00) = 'MATERIAL_VARIANCE';
  v_cases := v_cases || jsonb_build_object('B_tolerance', jsonb_build_object('ok', v_sub, 'tol', v_tol));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_phase5f_finance_baseline();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and (v_tmp->'exceptions'->>'OUTSTANDING_MISMATCH')::bigint >= 0;
  v_cases := v_cases || jsonb_build_object('C_baseline', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.payment_tx_semantic_classify('Bank Deposit', 'SALE', 'PENDING', null);
  v_sub := coalesce((v_tmp->>'affects_received')::boolean, true) = false
    and v_tmp->>'meaning' = 'PENDING_EXTERNAL_PAYMENT';
  v_cases := v_cases || jsonb_build_object('D_bank_deposit_pending', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.payment_tx_semantic_classify('Worldpay eCommerce', 'SALE', 'SUCCESS', null);
  v_sub := coalesce((v_tmp->>'affects_received')::boolean, false) = true;
  v_cases := v_cases || jsonb_build_object('E_worldpay_success', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.payment_tx_semantic_classify('Pay Later', 'SALE', 'PENDING', null);
  v_sub := coalesce((v_tmp->>'affects_received')::boolean, true) = false;
  v_cases := v_cases || jsonb_build_object('F_pay_later_pending', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  select id into v_order_id from orders
  where round(coalesce(total_outstanding,0),2)
        is distinct from round(greatest(coalesce(total,0)-coalesce(total_received,0),0),2)
  limit 1;
  if v_order_id is not null then
    v_tmp := public.rpc_phase5f_reconcile_order_delta(v_order_id);
    v_sub := coalesce(v_tmp->>'ok','false')::boolean;
  else
    v_sub := true;
  end if;
  v_cases := v_cases || jsonb_build_object('G_delta_classify', jsonb_build_object('ok', v_sub, 'order_id', v_order_id));
  v_ok := v_ok and v_sub;

  select id, coalesce(email, 'phase5f-finance@unique.test') into v_cust, v_email
  from customers order by created_at desc nulls last limit 1;
  if v_cust is null then
    insert into customers (email, display_name, first_name, last_name, source_system, status, approval_status)
    values ('phase5f-finance@unique.test', 'P5F Finance', 'P5F', 'Finance', 'unique', 'active', 'approved')
    returning id into v_cust;
    v_email := 'phase5f-finance@unique.test';
  end if;

  insert into orders (
    order_number, email, customer_id, status, financial_status,
    total, total_received, total_outstanding, currency,
    order_source, money_ledger_mode, is_test, finance_environment,
    source_total, source_total_received, source_total_outstanding, source_financial_status
  ) values (
    'p5f-native-' || substr(gen_random_uuid()::text,1,8),
    v_email, v_cust, 'OPEN', 'PENDING',
    100.00, 0, 100.00, 'GBP',
    'unique_admin', 'unique_ledger', true, 'test',
    100.00, 0, 100.00, 'PENDING'
  ) returning id into v_order_id;

  v_tmp := public.finance_calculate_order_ledger(v_order_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and (v_tmp->'calculated'->>'outstanding')::numeric = 100
    and (v_tmp->'calculated'->>'received')::numeric = 0;

  insert into payment_transactions (
    order_id, gateway, kind, status, amount, currency, source_system, processed_at, is_test, test
  ) values (
    v_order_id, 'manual', 'SALE', 'SUCCESS', 100.00, 'GBP', 'unique', now(), true, true
  );
  update orders set total_received = 100, total_outstanding = 0, financial_status = 'PAID'
  where id = v_order_id;

  v_tmp := public.finance_calculate_order_ledger(v_order_id);
  v_sub := v_sub
    and (v_tmp->'calculated'->>'outstanding')::numeric = 0
    and (v_tmp->'calculated'->>'received')::numeric = 100
    and round(coalesce((select total_outstanding from orders where id = v_order_id), -1), 2) = 0;

  v_cases := v_cases || jsonb_build_object('H_unique_native_reconcile', jsonb_build_object('ok', v_sub, 'order_id', v_order_id));
  v_ok := v_ok and v_sub;

  v_tmp := public.finance_opening_position_for_order(v_order_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and v_tmp->>'opening_basis' = 'CALCULATED_OUTSTANDING';
  v_cases := v_cases || jsonb_build_object('I_opening_unique', jsonb_build_object('ok', v_sub, 'basis', v_tmp->>'opening_basis'));
  v_ok := v_ok and v_sub;

  v_tmp := public.finance_cutover_readiness_status();
  v_sub := v_tmp ? 'status' and (v_tmp->>'status') in ('READY','READY_WITH_ACCEPTED_VARIANCES','REVIEW_REQUIRED','BLOCKED');
  v_cases := v_cases || jsonb_build_object('J_finance_readiness', jsonb_build_object('ok', v_sub, 'status', v_tmp->>'status'));
  v_ok := v_ok and v_sub;

  v_tmp := public.rpc_admin_cutover_control_centre();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and exists (
      select 1 from jsonb_array_elements(v_tmp->'domains') d
      where d->>'domain' = 'FINANCE'
        and d->>'status' in ('READY','READY_WITH_ACCEPTED_VARIANCES','REVIEW_REQUIRED','BLOCKED')
        and (
          (v_tmp->'finance_readiness'->>'mismatch')::bigint = 0
          or d->>'status' <> 'READY'
        )
    );
  v_cases := v_cases || jsonb_build_object('K_cutover_finance_domain', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  begin
    v_tmp := public.rpc_phase5e_catalogue_reconciliation();
    v_sub := coalesce(v_tmp->>'catalogue_readiness','') = 'READY';
  exception when others then
    v_sub := false;
  end;
  v_cases := v_cases || jsonb_build_object('L_catalogue_ready', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  v_tmp := public.finance_document_balance_basis(v_order_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean and v_tmp ? 'balance_basis';
  v_cases := v_cases || jsonb_build_object('M_document_balance_basis', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  select id into v_order_id from orders where coalesce(total_outstanding,0) < 0 limit 1;
  if v_order_id is not null then
    v_tmp := public.finance_classify_order_reconciliation(v_order_id);
    v_sub := coalesce(v_tmp->>'ok','false')::boolean
      and v_tmp->>'classification' = 'SOURCE_INCONSISTENCY'
      and v_tmp->>'pattern_code' = 'NEG_OUT';
  else
    v_sub := true;
  end if;
  v_cases := v_cases || jsonb_build_object('N_negative_outstanding', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  delete from payment_transactions where order_id in (select id from orders where order_number like 'p5f-native-%');
  delete from finance_reconciliation_reviews where order_id in (select id from orders where order_number like 'p5f-native-%');
  delete from orders where order_number like 'p5f-native-%';
  delete from customers where email = 'phase5f-finance@unique.test';

  return jsonb_build_object(
    'ok', v_ok,
    'pass', (select count(*) from jsonb_each(v_cases) e where (e.value->>'ok')::boolean),
    'total', (select count(*) from jsonb_each(v_cases)),
    'cases', v_cases
  );
end;
$$;

revoke all on function public.rpc_phase5f_finance_selftest() from public, anon;
grant execute on function public.rpc_phase5f_finance_selftest() to authenticated, service_role;
