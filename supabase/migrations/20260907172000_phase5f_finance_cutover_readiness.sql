-- Phase 5F part 2 — cutover readiness, opening AR aggregate, AR balance basis, selftest

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- Opening AR aggregate + customer/company reconciliation preview
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5f_opening_ar_preview(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source numeric := 0;
  v_calc numeric := 0;
  v_opening numeric := 0;
  v_unready bigint := 0;
  v_high jsonb;
  v_orphans jsonb;
begin
  if auth.uid() is not null and not public.can_view_finance() and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select round(coalesce(sum(greatest(coalesce(source_total_outstanding, total_outstanding, 0), 0)), 0), 2)
  into v_source from orders;

  -- Approximate calculated open AR from review queue + consistent orders
  select round(coalesce(sum(coalesce(r.calculated_outstanding, 0)), 0), 2)
  into v_calc from finance_reconciliation_reviews r;

  select round(coalesce(sum(coalesce(r.opening_outstanding, 0)), 0), 2),
         count(*) filter (where r.review_status = 'UNREVIEWED' and r.severity in ('HIGH', 'CRITICAL'))
  into v_opening, v_unready
  from finance_reconciliation_reviews r;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_high from (
    select jsonb_build_object(
      'order_number', order_number,
      'abs_variance', abs_variance,
      'classification', classification,
      'severity', severity,
      'gateway_summary', gateway_summary,
      'opening_basis', opening_basis,
      'opening_outstanding', opening_outstanding,
      'reason', reason
    ) as x
    from finance_reconciliation_reviews
    order by abs_variance desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) s;

  select jsonb_build_object(
    'open_source_out_no_company', (select count(*) from orders where coalesce(total_outstanding,0) > 0.009 and company_id is null),
    'open_source_out_no_customer', (select count(*) from orders where coalesce(total_outstanding,0) > 0.009 and customer_id is null),
    'open_source_value_no_company', (
      select round(coalesce(sum(total_outstanding),0),2) from orders
      where coalesce(total_outstanding,0) > 0.009 and company_id is null
    )
  ) into v_orphans;

  return jsonb_build_object(
    'ok', true,
    'model', jsonb_build_object(
      'rule', 'reviewed > unique_ledger calculated > consistent source > closed-source (PAID/out≈0) without inflating AR > else review',
      'source_outstanding_sum', v_source,
      'mismatch_calculated_outstanding_sum', v_calc,
      'mismatch_opening_outstanding_sum', v_opening,
      'unreviewed_high_critical', v_unready
    ),
    'top_exceptions_sanitized', v_high,
    'crm_collection_risk', v_orphans,
    'xero_boundary', jsonb_build_object(
      'integrated', false,
      'unique_owns_operational_ar', true,
      'still_requires_business_confirmation', jsonb_build_array('GL','VAT posting','legal invoice sequence','credit-note sequence','statutory accounting')
    ),
    'invoice_numbering', jsonb_build_object(
      'prefix', 'UD-INV-TEST-',
      'production_enabled', false,
      'blocker_for_legal_invoicing', true
    ),
    'cutover_snapshot', jsonb_build_object(
      'table', 'finance_cutover_balance_snapshots',
      't0_executed', false,
      'note', 'Design only — do not populate until authorized cutover'
    )
  );
end;
$$;

revoke all on function public.rpc_phase5f_opening_ar_preview(int) from public, anon;
grant execute on function public.rpc_phase5f_opening_ar_preview(int) to authenticated, service_role;

-- Finance readiness evaluator
create or replace function public.finance_cutover_readiness_status()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_mismatch bigint;
  v_unreviewed_crit bigint;
  v_unreviewed_high bigint;
  v_accepted bigint;
  v_queue bigint;
  v_abs numeric;
  v_status text;
  v_reason text;
  v_inv_prod boolean;
begin
  select count(*) into v_mismatch from orders
  where round(coalesce(total_outstanding,0),2)
        is distinct from round(greatest(coalesce(total,0)-coalesce(total_received,0),0),2);

  select count(*) into v_queue from finance_reconciliation_reviews;
  select count(*) into v_unreviewed_crit from finance_reconciliation_reviews
    where review_status = 'UNREVIEWED' and severity = 'CRITICAL';
  select count(*) into v_unreviewed_high from finance_reconciliation_reviews
    where review_status = 'UNREVIEWED' and severity = 'HIGH';
  select count(*) into v_accepted from finance_reconciliation_reviews
    where review_status in ('EXPLAINED','ACCEPTED_SOURCE_VARIANCE','RESOLVED_BY_CODE_FIX');
  select round(coalesce(sum(abs_variance),0),2) into v_abs from finance_reconciliation_reviews
    where review_status = 'UNREVIEWED' and severity in ('HIGH','CRITICAL');

  select coalesce(is_production, false) into v_inv_prod
  from invoice_numbering_config where key = 'default' limit 1;

  if v_queue = 0 and v_mismatch > 0 then
    v_status := 'BLOCKED';
    v_reason := format('Mismatch=%s but review queue empty — run rpc_phase5f_rebuild_reconciliation_queue', v_mismatch);
  elsif v_unreviewed_crit > 0 or (v_unreviewed_high > 0 and v_abs >= 50000) then
    v_status := 'REVIEW_REQUIRED';
    v_reason := format(
      'Unreviewed CRITICAL=%s HIGH=%s material_abs=%s; opening AR not defensible yet',
      v_unreviewed_crit, v_unreviewed_high, v_abs
    );
  elsif v_mismatch > 0 and v_accepted >= v_queue and v_queue > 0 then
    v_status := 'READY_WITH_ACCEPTED_VARIANCES';
    v_reason := format('All %s queue rows reviewed/accepted; historical source variances contained', v_queue);
  elsif v_mismatch = 0 then
    v_status := 'READY';
    v_reason := 'No outstanding formula mismatches';
  else
    v_status := 'REVIEW_REQUIRED';
    v_reason := format('Queue=%s accepted=%s mismatch=%s — finance review incomplete', v_queue, v_accepted, v_mismatch);
  end if;

  return jsonb_build_object(
    'status', v_status,
    'reason', v_reason,
    'mismatch', v_mismatch,
    'queue', v_queue,
    'unreviewed_critical', v_unreviewed_crit,
    'unreviewed_high', v_unreviewed_high,
    'accepted', v_accepted,
    'unreviewed_high_critical_abs', v_abs,
    'invoice_numbering_production', coalesce(v_inv_prod, false),
    'manual_payment_ready', true,
    'xero_integrated', false
  );
end;
$$;

grant execute on function public.finance_cutover_readiness_status() to authenticated, service_role;

-- Update cutover control centre FINANCE domain from real conditions
create or replace function public.rpc_admin_cutover_control_centre()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recon jsonb;
  v_domains jsonb := '[]'::jsonb;
  v_cat_status text;
  v_cat_reason text;
  v_fin jsonb;
  v_fin_status text;
  v_fin_reason text;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  v_recon := public.rpc_phase5e_catalogue_reconciliation();
  v_cat_status := coalesce(v_recon->>'catalogue_readiness', 'BLOCKED');
  if v_cat_status = 'READY' then
    v_cat_reason := format('Shopify-sourced products=%s variants=%s (forensic 2213/12677)',
      v_recon->'products'->>'unique_shopify_sourced', v_recon->'variants'->>'unique_shopify_sourced');
  elsif v_cat_status = 'REVIEW_REQUIRED' then
    v_cat_reason := format('Partial catalogue import products=%s — continue delta',
      v_recon->'products'->>'unique_shopify_sourced');
  else
    v_cat_reason := format('Catalogue DATA_GAP products=%s vs 2213',
      coalesce(v_recon->'products'->>'unique_shopify_sourced', '0'));
  end if;

  v_fin := public.finance_cutover_readiness_status();
  v_fin_status := coalesce(v_fin->>'status', 'REVIEW_REQUIRED');
  v_fin_reason := coalesce(v_fin->>'reason', 'Finance readiness unevaluated');

  v_domains := jsonb_build_array(
    jsonb_build_object('domain','COMMERCE','status','READY','reason','catalogue_open'),
    jsonb_build_object('domain','CRM','status','PARTIAL','reason','Ownership 1353 pending'),
    jsonb_build_object('domain','TRADE/AUTH','status','DISABLED','reason','BUSINESS_APPROVAL_REQUIRED'),
    jsonb_build_object('domain','COMPLIANCE','status','DISABLED','reason','observe'),
    jsonb_build_object('domain','ORDERS','status','READY','reason','Imported + native'),
    jsonb_build_object('domain','DRAFTS','status','READY','reason','Draft ops'),
    jsonb_build_object('domain','PAYMENTS','status','BLOCKED','reason','Worldpay BLOCKED_EXTERNAL'),
    jsonb_build_object('domain','FINANCE','status', v_fin_status, 'reason', v_fin_reason, 'detail', v_fin),
    jsonb_build_object('domain','INVENTORY/WMS','status','DISABLED','reason','wms_enabled=false; snapshots only'),
    jsonb_build_object('domain','FULFILMENT','status','PARTIAL','reason','Native ops'),
    jsonb_build_object('domain','CARRIER','status','BLOCKED','reason','DPD BLOCKED_EXTERNAL'),
    jsonb_build_object('domain','DOCUMENTS','status','PARTIAL','reason','Templates partial; invoice prefix UD-INV-TEST-'),
    jsonb_build_object('domain','AUTOMATIONS','status','DISABLED','reason','engine off'),
    jsonb_build_object('domain','REPORTING','status','PARTIAL','reason','SOURCE/CALCULATED/REVIEWED balance bases available'),
    jsonb_build_object('domain','EXTERNAL DEPENDENCIES','status','BLOCKED','reason','Worldpay/DPD/WMS opening; Xero unresolved'),
    jsonb_build_object('domain','DATA MIGRATION','status', v_cat_status, 'reason', v_cat_reason),
    jsonb_build_object('domain','CATALOGUE','status', v_cat_status, 'reason', v_cat_reason,
      'products_source', 2213,
      'products_target', (v_recon->'products'->>'unique_shopify_sourced')::bigint,
      'variants_source', 12677,
      'variants_target', (v_recon->'variants'->>'unique_shopify_sourced')::bigint,
      'price_mismatches', (v_recon->>'price_product_vs_min_variant_mismatches')::bigint,
      'sku', v_recon->'sku_quality',
      'metafields', (v_recon->>'metafields')::bigint,
      'media', (v_recon->>'media')::bigint
    ),
    jsonb_build_object('domain','SECURITY','status','READY','reason','4H RPCs'),
    jsonb_build_object('domain','CUSTOMER ACTIVATION','status','DISABLED','reason','Pilot NOT_SENT')
  );

  return jsonb_build_object(
    'ok', true,
    'domains', v_domains,
    'catalogue_reconciliation', v_recon,
    'finance_readiness', v_fin,
    'locked', jsonb_build_object(
      'PHASE4I_PILOT_001', 'NOT_SENT',
      'pilot_send_authorized', coalesce((select value from site_settings where key='pilot_send_authorized'),'false'),
      'commercial_access_mode', coalesce((select value from site_settings where key='commercial_access_mode'),'catalogue_open'),
      'trade_required_cutover_approved', coalesce((select value from site_settings where key='trade_required_cutover_approved'),'false'),
      'compliance_mode', coalesce((select value from site_settings where key='compliance_enforcement_mode'),'observe'),
      'gateway_mode', 'disabled',
      'carrier_mode', 'disabled',
      'wms_enabled', coalesce((select value from site_settings where key='wms_enabled'),'false'),
      'cutover_executed', 'false'
    ),
    'note', 'Phase 5F finance-aware readiness — not a cutover'
  );
end;
$$;

revoke all on function public.rpc_admin_cutover_control_centre() from public, anon;
grant execute on function public.rpc_admin_cutover_control_centre() to authenticated, service_role;

-- Extend reconciliation flags RPC to include flags key AND items alias + paid_zero + severity
create or replace function public.rpc_admin_finance_reconciliation_flags(p_limit int default 50)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_flags jsonb := '[]'::jsonb;
  v_total bigint := 0;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_total from finance_reconciliation_reviews;

  if v_total > 0 then
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_flags from (
      select jsonb_build_object(
        'id', r.id,
        'flag', r.pattern_code,
        'flag_type', r.classification,
        'severity', r.severity,
        'order_id', r.order_id,
        'order_number', r.order_number,
        'message', r.reason,
        'detail', r.reason,
        'classification', r.classification,
        'review_status', r.review_status,
        'abs_variance', r.abs_variance,
        'gateway_summary', r.gateway_summary,
        'opening_basis', r.opening_basis,
        'detected_at', r.classified_at
      ) as f
      from finance_reconciliation_reviews r
      order by r.abs_variance desc
      limit v_limit
    ) s;
  else
    -- Fallback to legacy formula flags if queue not built
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_flags from (
      select jsonb_build_object(
        'flag', 'outstanding_mismatch',
        'flag_type', 'OUTSTANDING_MISMATCH',
        'severity', 'MEDIUM',
        'order_id', o.id,
        'order_number', o.order_number,
        'total', o.total,
        'total_received', o.total_received,
        'total_outstanding', o.total_outstanding,
        'message', 'Outstanding cache ≠ max(total−received,0)'
      ) as f
      from orders o
      where round(coalesce(o.total_outstanding, 0), 2)
            is distinct from round(greatest(coalesce(o.total, 0) - coalesce(o.total_received, 0), 0), 2)
      limit v_limit
    ) s;
    v_total := jsonb_array_length(v_flags);
  end if;

  return jsonb_build_object(
    'ok', true,
    'flags', coalesce(v_flags, '[]'::jsonb),
    'items', coalesce(v_flags, '[]'::jsonb),
    'total', v_total,
    'note', 'FLAG only — no auto-fix; source_* immutable'
  );
end;
$$;

grant execute on function public.rpc_admin_finance_reconciliation_flags(int) to authenticated, service_role;

-- Document / AR balance basis helper
create or replace function public.finance_document_balance_basis(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_open jsonb;
  v_recon text;
begin
  v_open := public.finance_opening_position_for_order(p_order_id);
  select reconciliation_status into v_recon from orders where id = p_order_id;
  return jsonb_build_object(
    'ok', coalesce((v_open->>'ok')::boolean, false),
    'balance_basis', v_open->>'opening_basis',
    'operational_outstanding', (v_open->>'opening_outstanding')::numeric,
    'source_outstanding', (v_open->>'source_outstanding')::numeric,
    'calculated_outstanding', (v_open->>'calculated_outstanding')::numeric,
    'reviewed_outstanding', v_open->'reviewed_outstanding',
    'authoritative', coalesce((v_open->>'ready_for_cutover_opening')::boolean, false),
    'reconciliation_status', v_recon,
    'display_rule', 'Do not present unresolved calculated balance as authoritative without reconciliation state'
  );
end;
$$;

grant execute on function public.finance_document_balance_basis(uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Selftest
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_before int;
  v_after int;
  v_tol numeric;
begin
  -- A locked gates
  v_sub := coalesce((select value from site_settings where key='commercial_access_mode'),'') = 'catalogue_open'
    and coalesce((select value from site_settings where key='pilot_send_authorized'),'') = 'false'
    and coalesce((select value from site_settings where key='wms_enabled'),'false') = 'false'
    and coalesce((select value from site_settings where key='compliance_enforcement_mode'),'observe') = 'observe'
    and coalesce((select value from site_settings where key='trade_required_cutover_approved'),'false') = 'false';
  v_cases := v_cases || jsonb_build_object('A_locked_gates', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- B tolerance
  v_tol := public.finance_money_tolerance_gbp();
  v_sub := v_tol = 0.02 and public.finance_variance_materiality(0.01) = 'WITHIN_TOLERANCE'
    and public.finance_variance_materiality(1.00) = 'MATERIAL_VARIANCE';
  v_cases := v_cases || jsonb_build_object('B_tolerance', jsonb_build_object('ok', v_sub, 'tol', v_tol));
  v_ok := v_ok and v_sub;

  -- C baseline shape
  v_tmp := public.rpc_phase5f_finance_baseline();
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and (v_tmp->'exceptions'->>'OUTSTANDING_MISMATCH')::bigint >= 0;
  v_cases := v_cases || jsonb_build_object('C_baseline', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- D semantics: Bank Deposit PENDING ≠ received
  v_tmp := public.payment_tx_semantic_classify('Bank Deposit', 'SALE', 'PENDING', null);
  v_sub := coalesce((v_tmp->>'affects_received')::boolean, true) = false
    and v_tmp->>'meaning' = 'PENDING_EXTERNAL_PAYMENT';
  v_cases := v_cases || jsonb_build_object('D_bank_deposit_pending', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- E Worldpay SUCCESS received
  v_tmp := public.payment_tx_semantic_classify('Worldpay eCommerce', 'SALE', 'SUCCESS', null);
  v_sub := coalesce((v_tmp->>'affects_received')::boolean, false) = true;
  v_cases := v_cases || jsonb_build_object('E_worldpay_success', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- F PAY LATER PENDING ≠ received
  v_tmp := public.payment_tx_semantic_classify('Pay Later', 'SALE', 'PENDING', null);
  v_sub := coalesce((v_tmp->>'affects_received')::boolean, true) = false;
  v_cases := v_cases || jsonb_build_object('F_pay_later_pending', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- G classify + delta on a known mismatch (if any)
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

  -- H new Unique-native order reconciles cleanly
  select id into v_cust from customers order by created_at desc nulls last limit 1;
  if v_cust is null then
    insert into customers (email, first_name, last_name)
    values ('phase5f-finance@unique.test', 'P5F', 'Finance')
    returning id into v_cust;
  end if;

  insert into orders (
    order_number, customer_id, status, financial_status,
    total, total_received, total_outstanding, currency,
    order_source, money_ledger_mode, is_test, finance_environment,
    source_total, source_total_received, source_total_outstanding, source_financial_status
  ) values (
    'p5f-native-' || substr(gen_random_uuid()::text,1,8),
    v_cust, 'OPEN', 'PENDING',
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

  -- I opening position
  v_tmp := public.finance_opening_position_for_order(v_order_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean
    and v_tmp->>'opening_basis' = 'CALCULATED_OUTSTANDING';
  v_cases := v_cases || jsonb_build_object('I_opening_unique', jsonb_build_object('ok', v_sub, 'basis', v_tmp->>'opening_basis'));
  v_ok := v_ok and v_sub;

  -- J finance readiness status exists
  v_tmp := public.finance_cutover_readiness_status();
  v_sub := v_tmp ? 'status' and (v_tmp->>'status') in ('READY','READY_WITH_ACCEPTED_VARIANCES','REVIEW_REQUIRED','BLOCKED');
  v_cases := v_cases || jsonb_build_object('J_finance_readiness', jsonb_build_object('ok', v_sub, 'status', v_tmp->>'status'));
  v_ok := v_ok and v_sub;

  -- K cutover centre finance not blindly READY when mismatches remain
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

  -- L catalogue still READY (light)
  begin
    v_tmp := public.rpc_phase5e_catalogue_reconciliation();
    v_sub := coalesce(v_tmp->>'catalogue_readiness','') = 'READY';
  exception when others then
    v_sub := false;
  end;
  v_cases := v_cases || jsonb_build_object('L_catalogue_ready', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- M document balance basis
  v_tmp := public.finance_document_balance_basis(v_order_id);
  v_sub := coalesce(v_tmp->>'ok','false')::boolean and v_tmp ? 'balance_basis';
  v_cases := v_cases || jsonb_build_object('M_document_balance_basis', jsonb_build_object('ok', v_sub));
  v_ok := v_ok and v_sub;

  -- N negative outstanding not clamped in evidence
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

  -- cleanup test artifacts
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

commit;
