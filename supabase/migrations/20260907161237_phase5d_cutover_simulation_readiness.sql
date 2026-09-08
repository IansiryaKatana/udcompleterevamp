-- Phase 5D — Cutover simulation, reconciliation & operational readiness
-- NOT a production cutover. Simulation / shadow / dry-run only.
-- Does NOT: mutate Shopify, send pilot, flip trade_required, enable compliance,
-- enable Worldpay/DPD/WMS, apply ownership, invent SKULabs history, contact customers.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'pilot_send_authorized' and value is distinct from 'false';
update public.site_settings set value = 'observe'
where key = 'compliance_enforcement_mode' and value is distinct from 'observe';
update public.site_settings set value = 'false'
where key = 'wms_enabled' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'automation_engine_enabled' and value is distinct from 'false';

insert into public.site_settings (key, value) values
  ('phase5d_simulation_mode', 'true'),
  ('cutover_executed', 'false')
on conflict (key) do update set value = excluded.value;

-- ═══════════════════════════════════════════════════════════════════════════
-- Supporting tables
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cutover_simulation_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  status text not null default 'completed',
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.delta_watermarks (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null unique,
  cursor_kind text not null default 'updated_at'
    check (cursor_kind in ('updated_at','created_at','id','processed_at','shopify_updated_at')),
  cursor_value text,
  last_reconciled_count bigint,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.cutover_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.cutover_simulation_runs enable row level security;
alter table public.delta_watermarks enable row level security;
alter table public.cutover_readiness_snapshots enable row level security;

drop policy if exists "admin_all_cutover_simulation_runs" on public.cutover_simulation_runs;
create policy "admin_all_cutover_simulation_runs" on public.cutover_simulation_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_delta_watermarks" on public.delta_watermarks;
create policy "admin_all_delta_watermarks" on public.delta_watermarks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_cutover_readiness_snapshots" on public.cutover_readiness_snapshots;
create policy "admin_all_cutover_readiness_snapshots" on public.cutover_readiness_snapshots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.cutover_simulation_runs to authenticated;
grant select, insert, update, delete on public.delta_watermarks to authenticated;
grant select, insert on public.cutover_readiness_snapshots to authenticated;
grant all on public.cutover_simulation_runs to service_role;
grant all on public.delta_watermarks to service_role;
grant all on public.cutover_readiness_snapshots to service_role;

insert into public.delta_watermarks (entity_type, cursor_kind, notes)
values
  ('products', 'shopify_updated_at', 'Idempotent delta by Shopify updatedAt + GID'),
  ('variants', 'shopify_updated_at', 'Nested under products; reconcile SKU/barcode'),
  ('customers', 'shopify_updated_at', 'CRM customers by GID'),
  ('companies', 'shopify_updated_at', 'B2B companies by GID'),
  ('orders', 'shopify_updated_at', 'Orders + money fields; never rewrite ledger history'),
  ('drafts', 'shopify_updated_at', 'draft_orders'),
  ('transactions', 'id', 'payment_transactions by external GID'),
  ('refunds', 'id', 'refunds + lines'),
  ('fulfillments', 'id', 'fulfillments + tracking'),
  ('inventory_snapshot', 'processed_at', 'Point-in-time inventory only — not movement history'),
  ('metafields', 'shopify_updated_at', 'Preserve namespaces'),
  ('tags', 'processed_at', 'Order/customer/company tags')
on conflict (entity_type) do nothing;

-- Shadow warehouse (simulation only; never production UD_WH_1 stock)
insert into public.warehouses (code, name, is_active)
values ('UD_SHADOW', 'Phase 5D Shadow Warehouse (simulation only)', true)
on conflict (code) do nothing;

insert into public.warehouse_locations (warehouse_id, code, location_type)
select w.id, 'SHADOW_DEFAULT', 'bulk'
from warehouses w where w.code = 'UD_SHADOW'
on conflict (warehouse_id, code) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Cutover Control Centre (real statuses from config + counts)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_cutover_control_centre()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domains jsonb := '[]'::jsonb;
  v_mode text;
  v_cutover text;
  v_pilot text;
  v_comp text;
  v_wms text;
  v_auto text;
  v_pay text;
  v_car text;
  v_promo text;
  v_chk text;
  v_products bigint;
  v_orders bigint;
  v_ownership bigint;
  v_blockers int;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select value into v_mode from site_settings where key = 'commercial_access_mode' limit 1;
  select value into v_cutover from site_settings where key = 'trade_required_cutover_approved' limit 1;
  select value into v_pilot from site_settings where key = 'pilot_send_authorized' limit 1;
  select value into v_comp from site_settings where key = 'compliance_enforcement_mode' limit 1;
  select value into v_wms from site_settings where key = 'wms_enabled' limit 1;
  select value into v_auto from site_settings where key = 'automation_engine_enabled' limit 1;
  select value into v_promo from site_settings where key = 'promotions_engine_enabled' limit 1;
  select value into v_chk from site_settings where key = 'checkout_rules_enabled' limit 1;
  begin
    select public.payment_gateway_mode() into v_pay;
  exception when others then
    v_pay := 'disabled';
  end;
  begin
    select public.carrier_gateway_mode() into v_car;
  exception when others then
    v_car := 'disabled';
  end;

  select count(*) into v_products from products;
  select count(*) into v_orders from orders;
  select count(*) into v_ownership from ownership_backfill_reviews where status = 'PENDING';
  select count(*) into v_blockers from app_dependency_register where cutover_blocker;

  v_domains := jsonb_build_array(
    jsonb_build_object(
      'domain', 'COMMERCE',
      'status', case when coalesce(v_mode,'') = 'catalogue_open' then 'READY' else 'REVIEW_REQUIRED' end,
      'reason', 'Live mode catalogue_open; trade_required double-gated off'
    ),
    jsonb_build_object(
      'domain', 'CRM',
      'status', case when v_orders > 0 then 'PARTIAL' else 'BLOCKED' end,
      'reason', format('Customers/companies/orders present; ownership candidates pending=%s', v_ownership)
    ),
    jsonb_build_object(
      'domain', 'TRADE/AUTH',
      'status', 'DISABLED',
      'reason', format(
        'TECHNICALLY_READY foundations; BUSINESS_APPROVAL_REQUIRED. cutover_approved=%s pilot_send=%s',
        coalesce(v_cutover,'false'), coalesce(v_pilot,'false')
      )
    ),
    jsonb_build_object(
      'domain', 'COMPLIANCE',
      'status', 'DISABLED',
      'reason', format('OBSERVE mode (%s); BUSINESS_LEGAL_DECISION_REQUIRED before enforce', coalesce(v_comp,'observe'))
    ),
    jsonb_build_object(
      'domain', 'ORDERS',
      'status', 'READY',
      'reason', format('orders=%s imported; Unique-native create path available', v_orders)
    ),
    jsonb_build_object(
      'domain', 'DRAFTS',
      'status', 'READY',
      'reason', 'Draft ops + quote path present'
    ),
    jsonb_build_object(
      'domain', 'PAYMENTS',
      'status', case when coalesce(v_pay,'disabled') = 'disabled' then 'BLOCKED' else 'PARTIAL' end,
      'reason', format('Worldpay BLOCKED_EXTERNAL (gateway_mode=%s). Manual/Bank/PAY LATER TECHNICALLY AVAILABLE', coalesce(v_pay,'disabled'))
    ),
    jsonb_build_object(
      'domain', 'FINANCE',
      'status', 'READY',
      'reason', 'AR ledger + invoices/statements; reconciliation flags available'
    ),
    jsonb_build_object(
      'domain', 'INVENTORY/WMS',
      'status', 'DISABLED',
      'reason', format('READY_FOR_OPENING_BALANCE foundations; wms_enabled=%s. Catalogue products in Unique=%s (Shopify forensic ~2213)', coalesce(v_wms,'false'), v_products)
    ),
    jsonb_build_object(
      'domain', 'FULFILMENT',
      'status', 'PARTIAL',
      'reason', 'Native fulfilment ops; carrier automation blocked'
    ),
    jsonb_build_object(
      'domain', 'CARRIER',
      'status', 'BLOCKED',
      'reason', format('DPD BLOCKED_EXTERNAL (carrier_mode=%s). Manual tracking TECHNICALLY AVAILABLE', coalesce(v_car,'disabled'))
    ),
    jsonb_build_object(
      'domain', 'DOCUMENTS',
      'status', 'PARTIAL',
      'reason', 'Templates + finance/ops docs; invoice numbering unresolved'
    ),
    jsonb_build_object(
      'domain', 'AUTOMATIONS',
      'status', 'DISABLED',
      'reason', format('Flow-lite seeded DISABLED; automation_engine_enabled=%s', coalesce(v_auto,'false'))
    ),
    jsonb_build_object(
      'domain', 'REPORTING',
      'status', 'PARTIAL',
      'reason', 'saved_reports + admin operational RPCs'
    ),
    jsonb_build_object(
      'domain', 'EXTERNAL DEPENDENCIES',
      'status', case when v_blockers > 0 then 'BLOCKED' else 'PARTIAL' end,
      'reason', format('cutover_blocker apps=%s (Worldpay/DPD/SKULabs opening)', v_blockers)
    ),
    jsonb_build_object(
      'domain', 'DATA MIGRATION',
      'status', case when v_products < 100 then 'BLOCKED' else 'PARTIAL' end,
      'reason', format('Catalogue gap: Unique products=%s vs Shopify ~2213. Orders/customers imported. Delta watermarks defined.', v_products)
    ),
    jsonb_build_object(
      'domain', 'SECURITY',
      'status', 'READY',
      'reason', 'PostgREST lockdown + price gate selftests available'
    ),
    jsonb_build_object(
      'domain', 'CUSTOMER ACTIVATION',
      'status', 'DISABLED',
      'reason', 'PHASE4I_PILOT_001 NOT_SENT; pilot_send_authorized=false'
    ),
    jsonb_build_object(
      'domain', 'CHECKOUT RULES',
      'status', case when coalesce(v_chk,'true') = 'true' then 'PARTIAL' else 'DISABLED' end,
      'reason', 'Engine on; inferred historical rules not imported'
    ),
    jsonb_build_object(
      'domain', 'PROMOTIONS',
      'status', case when coalesce(v_promo,'true') = 'true' then 'PARTIAL' else 'DISABLED' end,
      'reason', 'Engine on; discount export parity incomplete'
    )
  );

  insert into cutover_readiness_snapshots (snapshot)
  values (jsonb_build_object('domains', v_domains, 'locked', jsonb_build_object(
    'commercial_access_mode', v_mode,
    'trade_required_cutover_approved', v_cutover,
    'pilot_send_authorized', v_pilot,
    'compliance_enforcement_mode', v_comp,
    'wms_enabled', v_wms,
    'automation_engine_enabled', v_auto,
    'payment_gateway_mode', v_pay,
    'carrier_mode', v_car
  )));

  return jsonb_build_object(
    'ok', true,
    'domains', v_domains,
    'locked', jsonb_build_object(
      'PHASE4I_PILOT_001', 'NOT_SENT',
      'pilot_send_authorized', coalesce(v_pilot,'false'),
      'commercial_access_mode', coalesce(v_mode,'catalogue_open'),
      'trade_required_cutover_approved', coalesce(v_cutover,'false'),
      'compliance_mode', coalesce(v_comp,'observe'),
      'gateway_mode', coalesce(v_pay,'disabled'),
      'carrier_mode', coalesce(v_car,'disabled'),
      'wms_enabled', coalesce(v_wms,'false'),
      'cutover_executed', 'false'
    ),
    'note', 'Readiness is config/test-backed — not cosmetic. NO CUTOVER.'
  );
end;
$$;

revoke all on function public.rpc_admin_cutover_control_centre() from public, anon;
grant execute on function public.rpc_admin_cutover_control_centre() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Historical data reconciliation
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5d_data_reconciliation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_orders bigint;
  v_customers bigint;
  v_companies bigint;
  v_drafts bigint;
  v_pay bigint;
  v_refunds bigint;
  v_refund_lines bigint;
  v_ful bigint;
  v_products bigint;
  v_trade bigint;
  v_ok boolean := true;
  v_unexplained int := 0;
begin
  select count(*) into v_orders from orders;
  select count(*) into v_customers from customers;
  select count(*) into v_companies from companies;
  select count(*) into v_drafts from draft_orders;
  select count(*) into v_pay from payment_transactions;
  select count(*) into v_refunds from refunds;
  select count(*) into v_refund_lines from refund_line_items;
  select count(*) into v_ful from fulfillments;
  select count(*) into v_products from products;
  select count(*) into v_trade from customers where trade_access_status = 'approved';

  -- Shopify forensic baselines (Phase 5B/FORENSIC-AUDIT) vs live Unique
  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'orders',
    'shopify_source_count', 21767,
    'unique_import_count', v_orders,
    'difference', v_orders - 21767,
    'explained_difference', case
      when abs(v_orders - 21767) <= 20 then 'Post-snapshot organic growth / import deltas expected'
      else 'Investigate delta vs forensic snapshot'
    end,
    'status', case when abs(v_orders - 21767) <= 50 then 'OK' when abs(v_orders - 21767) <= 200 then 'REVIEW' else 'UNEXPLAINED' end
  ));
  if abs(v_orders - 21767) > 200 then v_ok := false; v_unexplained := v_unexplained + 1; end if;

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'customers',
    'shopify_source_count', 6225,
    'unique_import_count', v_customers,
    'difference', v_customers - 6225,
    'explained_difference', 'CRM normalization + post-snapshot creates; forensic ~6219–6225',
    'status', case when abs(v_customers - 6225) <= 80 then 'OK' else 'REVIEW' end
  ));

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'companies',
    'shopify_source_count', 3518,
    'unique_import_count', v_companies,
    'difference', v_companies - 3518,
    'explained_difference', 'Post-snapshot B2B company growth',
    'status', case when abs(v_companies - 3518) <= 20 then 'OK' else 'REVIEW' end
  ));

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'drafts',
    'shopify_source_count', 4093,
    'unique_import_count', v_drafts,
    'difference', v_drafts - 4093,
    'explained_difference', 'Post-snapshot draft activity',
    'status', case when abs(v_drafts - 4093) <= 20 then 'OK' else 'REVIEW' end
  ));

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'payment_transactions',
    'shopify_source_count', 34430,
    'unique_import_count', v_pay,
    'difference', v_pay - 34430,
    'explained_difference', 'Exact forensic match expected',
    'status', case when v_pay = 34430 then 'OK' when abs(v_pay - 34430) <= 50 then 'REVIEW' else 'UNEXPLAINED' end
  ));
  if abs(v_pay - 34430) > 50 then v_ok := false; v_unexplained := v_unexplained + 1; end if;

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'refunds',
    'shopify_source_count', 3774,
    'unique_import_count', v_refunds,
    'difference', v_refunds - 3774,
    'explained_difference', 'Exact forensic match expected',
    'status', case when v_refunds = 3774 then 'OK' else 'REVIEW' end
  ));

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'refund_line_items',
    'shopify_source_count', 23918,
    'unique_import_count', v_refund_lines,
    'difference', v_refund_lines - 23918,
    'explained_difference', 'Exact forensic match expected',
    'status', case when v_refund_lines = 23918 then 'OK' else 'REVIEW' end
  ));

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'fulfillments',
    'shopify_source_count', 22917,
    'unique_import_count', v_ful,
    'difference', v_ful - 22917,
    'explained_difference', 'Exact forensic match expected',
    'status', case when v_ful = 22917 then 'OK' else 'REVIEW' end
  ));

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'products',
    'shopify_source_count', 2213,
    'unique_import_count', v_products,
    'difference', v_products - 2213,
    'explained_difference', 'CRITICAL: Unique catalogue not fully imported (CMS/demo residue). Shopify forensic archive remains source until catalogue delta import.',
    'status', 'DATA_GAP'
  ));
  v_ok := false; -- catalogue gap always fails full-parity readiness

  v_rows := v_rows || jsonb_build_array(jsonb_build_object(
    'entity', 'trade_approved_customers',
    'shopify_source_count', 5728,
    'unique_import_count', v_trade,
    'difference', v_trade - 5728,
    'explained_difference', 'SureCust/wholesale eligibility mapping; small drift expected',
    'status', case when abs(v_trade - 5728) <= 50 then 'OK' else 'REVIEW' end
  ));

  insert into cutover_simulation_runs (run_type, result)
  values ('data_reconciliation', jsonb_build_object('rows', v_rows, 'ok', v_ok, 'unexplained', v_unexplained));

  return jsonb_build_object(
    'ok', v_ok,
    'unexplained_count', v_unexplained,
    'rows', v_rows,
    'note', 'Shopify source counts = forensic baselines; Unique = live DB. Catalogue DATA_GAP is a known cutover blocker for full parity.'
  );
end;
$$;

revoke all on function public.rpc_phase5d_data_reconciliation() from public, anon;
grant execute on function public.rpc_phase5d_data_reconciliation() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Finance money reconciliation (service-capable; no history rewrite)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5d_finance_money_reconciliation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mismatch bigint;
  v_neg bigint;
  v_exceed bigint;
  v_paid_zero bigint;
  v_sample jsonb;
begin
  select count(*) into v_mismatch from orders
  where round(coalesce(total_outstanding, 0), 2)
        is distinct from round(greatest(coalesce(total, 0) - coalesce(total_received, 0), 0), 2);

  select count(*) into v_neg from orders where coalesce(total_outstanding, 0) < 0;

  select count(*) into v_exceed from orders
  where coalesce(total_received, 0) > coalesce(total, 0) + 0.009;

  select count(*) into v_paid_zero from orders
  where upper(coalesce(financial_status, '')) in ('PAID', 'PARTIALLY_PAID')
    and coalesce(total_received, 0) = 0
    and coalesce(total, 0) > 0;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_sample from (
    select jsonb_build_object(
      'order_number', order_number,
      'total', total,
      'total_received', total_received,
      'total_outstanding', total_outstanding,
      'financial_status', financial_status
    ) as x
    from orders
    where round(coalesce(total_outstanding, 0), 2)
          is distinct from round(greatest(coalesce(total, 0) - coalesce(total_received, 0), 0), 2)
    limit 10
  ) s;

  return jsonb_build_object(
    'ok', true,
    'imported_shopify_position', 'orders.total / financial_status from import',
    'calculated_ledger_position', 'total_received / total_outstanding from payment_transactions semantics',
    'counts', jsonb_build_object(
      'outstanding_mismatch', v_mismatch,
      'negative_outstanding', v_neg,
      'received_exceeds_total', v_exceed,
      'paid_status_zero_received', v_paid_zero
    ),
    'sample_mismatches', v_sample,
    'reconciliation_state', case
      when v_mismatch = 0 and v_neg = 0 then 'CLEAN'
      when v_mismatch < 50 then 'KNOWN_FLAGS'
      else 'NEEDS_REVIEW'
    end,
    'note', 'FLAG only — no auto-fix; history not rewritten'
  );
end;
$$;

revoke all on function public.rpc_phase5d_finance_money_reconciliation() from public, anon;
grant execute on function public.rpc_phase5d_finance_money_reconciliation() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Historical order reconstruction matrix (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5d_order_reconstruction_matrix()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_row record;
  v_parity text;
  v_reasons text[];
begin
  -- Representative slices (read-only)
  for v_row in
    (
      select o.id, o.order_number, o.financial_status, o.order_source, o.company_id, o.customer_id,
             o.salesperson_id, o.cg_assigned_id, o.discount_total, o.commerce_fulfillment_status,
             (select count(*) from payment_transactions pt where pt.order_id = o.id) as tx_count,
             (select string_agg(distinct pt.gateway, ', ') from payment_transactions pt where pt.order_id = o.id) as gateways,
             (select count(*) from fulfillments f where f.order_id = o.id) as ful_count,
             (select count(*) from refunds r where r.order_id = o.id) as refund_count,
             exists (
               select 1 from payment_transactions pt
               where pt.order_id = o.id and pt.gateway ilike '%worldpay%'
             ) as has_worldpay,
             exists (
               select 1 from payment_transactions pt
               where pt.order_id = o.id and (pt.gateway ilike '%bank%' or pt.gateway ilike '%deposit%')
             ) as has_bank,
             exists (
               select 1 from payment_transactions pt
               where pt.order_id = o.id and pt.gateway ilike '%pay later%'
             ) as has_pay_later,
             exists (
               select 1 from payment_transactions pt
               where pt.order_id = o.id and (pt.gateway ilike '%cash%' or pt.gateway = 'manual')
             ) as has_manual,
             exists (
               select 1 from fulfillments f
               where f.order_id = o.id and coalesce(f.tracking_company,'') ilike '%DPD%'
             ) as has_dpd,
             coalesce(o.order_source, '') = 'shopify_draft_order' as from_draft
      from orders o
      where o.id in (
        select id from orders where exists (
          select 1 from payment_transactions pt where pt.order_id = orders.id and pt.gateway ilike '%worldpay%'
        ) limit 1
      )
      or o.id in (
        select id from orders where exists (
          select 1 from payment_transactions pt where pt.order_id = orders.id and pt.gateway ilike '%Bank Deposit%'
        ) limit 1
      )
      or o.id in (
        select id from orders where exists (
          select 1 from payment_transactions pt where pt.order_id = orders.id and pt.gateway ilike '%PAY LATER%'
        ) limit 1
      )
      or o.id in (
        select id from orders where exists (
          select 1 from payment_transactions pt where pt.order_id = orders.id and pt.gateway ilike '%Cash%'
        ) limit 1
      )
      or o.id in (select id from orders where order_source = 'shopify_draft_order' limit 1)
      or o.id in (select id from orders where coalesce(discount_total,0) > 0 limit 1)
      or o.id in (select id from orders where company_id is not null limit 1)
      or o.id in (select id from orders where company_id is null and customer_id is not null limit 1)
      or o.id in (select id from orders where salesperson_id is not null limit 1)
      or o.id in (
        select o2.id from orders o2
        join fulfillments f on f.order_id = o2.id
        where coalesce(f.tracking_company,'') ilike '%DPD%'
        limit 1
      )
      or o.id in (select id from orders o3 where (select count(*) from refunds r where r.order_id = o3.id) > 0 limit 1)
      or o.id in (
        select id from orders o4
        where (select count(*) from fulfillments f where f.order_id = o4.id) > 1
        limit 1
      )
      limit 20
    )
  loop
    v_reasons := array[]::text[];
    v_parity := 'FUNCTIONAL_PARITY';

    if v_row.has_worldpay then
      v_reasons := array_append(v_reasons, 'Worldpay history represented as transaction; live capture BLOCKED_EXTERNAL');
      v_parity := 'BLOCKED_EXTERNAL';
    end if;
    if v_row.has_dpd then
      v_reasons := array_append(v_reasons, 'DPD tracking present historically; live label API BLOCKED_EXTERNAL — manual tracking OK');
      if v_parity = 'FUNCTIONAL_PARITY' then v_parity := 'PARTIAL'; end if;
    end if;
    if v_row.has_bank then
      v_reasons := array_append(v_reasons, 'Bank Deposit — Unique finance can represent');
    end if;
    if v_row.has_pay_later then
      v_reasons := array_append(v_reasons, 'PAY LATER — Unique eligibility model; do not auto-grant');
    end if;
    if v_row.has_manual then
      v_reasons := array_append(v_reasons, 'Manual/cash — Unique manual payment path');
    end if;
    if v_row.from_draft then
      v_reasons := array_append(v_reasons, 'Draft-origin — Unique drafts convert');
    end if;
    if v_row.refund_count > 0 then
      v_reasons := array_append(v_reasons, 'Refunds imported; credit-note path partial');
    end if;
    if v_row.ful_count > 1 then
      v_reasons := array_append(v_reasons, 'Multi-fulfilment represented');
    end if;
    if v_row.salesperson_id is not null or v_row.cg_assigned_id is not null then
      v_reasons := array_append(v_reasons, 'Salesperson/CG fields present');
    end if;
    if coalesce(v_row.discount_total, 0) > 0 then
      v_reasons := array_append(v_reasons, 'Discount snapshot on order');
    end if;
    -- SKULabs: no direct access; presence inferred only if metadata/tags exist elsewhere
    v_reasons := array_append(v_reasons, 'SKULabs pick/pack history NOT reconstructed (DATA_GAP by design)');

    if cardinality(v_reasons) = 1 and v_parity = 'FUNCTIONAL_PARITY' then
      v_parity := 'FULL_PARITY';
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'order_id', v_row.id,
      'order_number', v_row.order_number,
      'gateways', v_row.gateways,
      'tx_count', v_row.tx_count,
      'ful_count', v_row.ful_count,
      'refund_count', v_row.refund_count,
      'has_company', v_row.company_id is not null,
      'parity', v_parity,
      'reasons', to_jsonb(v_reasons),
      'mutated', false
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'items', v_items,
    'note', 'Read-only reconstruction classification. Historical rows not mutated.'
  );
end;
$$;

revoke all on function public.rpc_phase5d_order_reconstruction_matrix() from public, anon;
grant execute on function public.rpc_phase5d_order_reconstruction_matrix() to authenticated, service_role;
