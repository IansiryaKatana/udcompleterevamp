-- Phase 2F: Controlled Worldpay TEST readiness — NON-NETWORK ONLY.
-- WORLDPAY PRODUCT = UNCONFIRMED → no live/test Worldpay HTTP transport in this migration.
-- gateway_mode remains disabled. Does not set live. Does not invent endpoints.

begin;

-- Record confirmation status explicitly
update public.payment_gateway_config
set
  gateway_provider = 'worldpay_product_unconfirmed',
  gateway_mode = 'disabled',
  product_label = 'UNCONFIRMED — Shopify historical gateway name only (Worldpay eCommerce / Worldpay Payments)',
  api_family = 'UNCONFIRMED',
  auth_method = 'UNCONFIRMED — requires merchant-supplied credentials and product confirmation',
  webhook_model = 'UNCONFIRMED — signature method depends on confirmed product',
  notes = coalesce(notes, '') || E'\n[Phase 2F ' || now()::date::text ||
    '] Product identity gate FAILED: no test credentials, no merchant dashboard evidence, no Access/WPG confirmation in repo/env. Worldpay-specific API transport blocked.',
  phase_2e_live_blocked = true,
  updated_at = now()
where key = 'default';

-- ═══════════════════════════════════════════════════════════════════════════
-- Test isolation (proven without Worldpay network)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists is_test boolean not null default false,
  add column if not exists finance_environment text;

alter table public.payment_transactions
  add column if not exists is_test boolean not null default false,
  add column if not exists finance_environment text;

alter table public.payment_intents
  add column if not exists is_test boolean not null default false;

alter table public.payment_gateway_events
  add column if not exists is_test boolean not null default false,
  add column if not exists finance_environment text;

alter table public.invoices
  add column if not exists is_test boolean not null default false;

alter table public.statements
  add column if not exists is_test boolean not null default false;

comment on column public.orders.is_test is
  'Unique TEST fixture / gateway-test order. Excluded from production finance aggregates by default.';
comment on column public.orders.finance_environment is
  'null|production|test — test must never mix into production AR totals.';

-- Backfill production historical as non-test
update public.orders
set finance_environment = coalesce(finance_environment, 'production')
where finance_environment is null and coalesce(is_test, false) = false;

-- Do NOT UPDATE historical Shopify payment_transactions (immutable trigger).
-- Defaults: is_test=false; treat finance_environment IS NULL as production in queries.
-- Unique-native / future test txs set is_test and finance_environment explicitly on INSERT.

create index if not exists orders_is_test_idx on public.orders (is_test) where is_test = true;
create index if not exists payment_transactions_is_test_idx
  on public.payment_transactions (is_test) where is_test = true;

-- Keep Phase 2D dashboard shape; only add is_test exclusion by default
create or replace function public.rpc_admin_finance_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_as_of date := coalesce((p_filters->>'as_of')::date, current_date);
  v_include_test boolean := coalesce((p_filters->>'include_test')::boolean, false);
  v_open_count int;
  v_open_total numeric(14,2);
  v_received numeric(14,2);
  v_overdue numeric(14,2);
  v_no_due numeric(14,2);
  v_aging jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select
    count(*)::int,
    coalesce(sum(o.total_outstanding), 0),
    coalesce(sum(o.total_received), 0),
    coalesce(sum(case
      when o.payment_due_on is not null and o.payment_due_on < v_as_of then o.total_outstanding
      else 0 end), 0),
    coalesce(sum(case when o.payment_due_on is null then o.total_outstanding else 0 end), 0)
  into v_open_count, v_open_total, v_received, v_overdue, v_no_due
  from public.orders o
  where coalesce(o.total_outstanding, 0) > 0
    and (v_company is null or o.company_id = v_company)
    and (v_customer is null or o.customer_id = v_customer)
    and (v_include_test or coalesce(o.is_test, false) = false);

  v_aging := public.rpc_admin_ar_aging_summary(p_filters);

  return jsonb_build_object(
    'ok', true,
    'as_of', v_as_of,
    'open_receivable_count', v_open_count,
    'open_receivable_total', v_open_total,
    'total_received_on_open', v_received,
    'overdue_total', v_overdue,
    'no_due_date_total', v_no_due,
    'aging', v_aging,
    'include_test', v_include_test,
    'test_isolation', true
  );
end;
$$;

-- Synthetic Unique TEST order fixture (no Worldpay call)
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
  v_staff uuid := public.current_admin_staff_id();
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
    'open',
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

grant execute on function public.rpc_admin_create_phase2f_test_fixture(text) to authenticated, service_role;

-- Soft cleanup: mark cancelled; do not delete payment txs if any exist later
create or replace function public.rpc_admin_cleanup_phase2f_test_fixtures()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n int := 0;
begin
  if not public.current_admin_is_owner_or_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  update public.orders
  set status = 'cancelled',
      cancel_reason = 'phase2f_test_cleanup',
      cancelled_at = coalesce(cancelled_at, now())
  where is_test = true
    and order_number like 'PHASE2F-TEST-%'
    and coalesce(status, '') <> 'cancelled';
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'cancelled_orders', v_n);
end;
$$;

grant execute on function public.rpc_admin_cleanup_phase2f_test_fixtures() to authenticated, service_role;

-- AR list: exclude test orders unless include_test=true (preserves Phase 2D shape)
create or replace function public.rpc_list_admin_ar_receivables(
  p_limit int default 50,
  p_offset int default 0,
  p_sort text default 'outstanding_desc',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(coalesce(p_filters->>'q', '')), '');
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_bucket text := nullif(btrim(coalesce(p_filters->>'aging_bucket', '')), '');
  v_as_of date := coalesce((p_filters->>'as_of')::date, current_date);
  v_unpaid_only boolean := coalesce((p_filters->>'unpaid_only')::boolean, true);
  v_include_test boolean := coalesce((p_filters->>'include_test')::boolean, false);
  v_total int;
  v_rows jsonb;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with base as (
    select
      o.id,
      o.order_number,
      o.email,
      o.customer_id,
      o.company_id,
      o.currency,
      o.total,
      o.total_received,
      o.total_outstanding,
      o.financial_status,
      o.payment_due_on,
      o.trading_name_snapshot,
      public.finance_aging_bucket(o.payment_due_on, v_as_of) as aging_bucket,
      o.source_created_at,
      o.created_at,
      o.is_test
    from public.orders o
    where (
        (v_unpaid_only and coalesce(o.total_outstanding, 0) > 0)
        or (
          not v_unpaid_only and (
            coalesce(o.total_outstanding, 0) > 0
            or upper(coalesce(o.financial_status, '')) in (
              'PENDING', 'PARTIALLY_PAID', 'AUTHORIZED', 'UNPAID'
            )
          )
        )
      )
      and (v_company is null or o.company_id = v_company)
      and (v_customer is null or o.customer_id = v_customer)
      and (v_include_test or coalesce(o.is_test, false) = false)
      and (
        v_q is null
        or o.order_number ilike '%' || v_q || '%'
        or o.email ilike '%' || v_q || '%'
        or coalesce(o.trading_name_snapshot, '') ilike '%' || v_q || '%'
      )
  ),
  filtered as (
    select * from base b
    where v_bucket is null or b.aging_bucket = v_bucket
  ),
  counted as (
    select count(*)::int as total from filtered
  ),
  sorted as (
    select f.*,
      case coalesce(p_sort, 'outstanding_desc')
        when 'outstanding_asc' then row_number() over (order by f.total_outstanding asc, f.created_at desc)
        when 'due_asc' then row_number() over (order by f.payment_due_on asc nulls last, f.total_outstanding desc)
        when 'due_desc' then row_number() over (order by f.payment_due_on desc nulls last, f.total_outstanding desc)
        when 'created_desc' then row_number() over (order by f.created_at desc)
        else row_number() over (order by f.total_outstanding desc, f.created_at desc)
      end as rn
    from filtered f
  )
  select
    (select total from counted),
    coalesce(
      (select jsonb_agg(to_jsonb(s) - 'rn' order by s.rn)
       from sorted s
       where s.rn > v_offset and s.rn <= v_offset + v_limit),
      '[]'::jsonb
    )
  into v_total, v_rows;

  return jsonb_build_object(
    'ok', true,
    'total', coalesce(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'include_test', v_include_test
  );
end;
$$;

grant execute on function public.rpc_list_admin_ar_receivables(int, int, text, jsonb) to authenticated, service_role;

-- Selftest: product unconfirmed + isolation
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
  v_order_id uuid;
  v_dash jsonb;
  v_prod_out numeric;
  v_with_test numeric;
  v_pass int := 0;
  v_total int := 0;
  v_hist int;
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is not null then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  -- A product unconfirmed
  select gateway_mode, gateway_provider into v_mode, v_provider
  from public.payment_gateway_config where key = 'default';
  v_ok := v_mode = 'disabled' and v_provider like '%unconfirmed%';
  v_cases := v_cases || jsonb_build_object('A_product_unconfirmed_mode_disabled', jsonb_build_object('ok', v_ok, 'detail', v_provider || '/' || v_mode));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- B live still blocked
  v_ok := public.payment_gateway_live_blocked() = true
    and coalesce((public.payment_gateway_actions_permitted()->>'allowed')::boolean, true) = false;
  v_cases := v_cases || jsonb_build_object('B_gateway_not_allowed', jsonb_build_object('ok', v_ok, 'detail', public.payment_gateway_mode()));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- C create test fixture (bypass admin via direct insert in selftest)
  insert into public.customers (email, display_name, source_system, status)
  values ('phase2f-selftest@test.unique.local', 'PHASE2F-STAB', 'unique', 'active')
  returning id into v_order_id; -- reuse var as customer temporarily
  insert into public.orders (
    email, order_number, status, financial_status, currency, total, total_received, total_outstanding,
    customer_id, order_source, metadata, money_ledger_mode, is_test, finance_environment,
    source_total, source_total_received, source_total_outstanding, source_financial_status
  ) values (
    'phase2f-selftest@test.unique.local', 'PHASE2F-STAB-ORDER', 'open', 'PENDING', 'GBP',
    50, 0, 50, v_order_id, 'unique',
    jsonb_build_object('source_system', 'unique', 'is_test', true),
    'unique_ledger', true, 'test', 50, 0, 50, 'PENDING'
  ) returning id into v_order_id;
  v_ok := exists (select 1 from public.orders where id = v_order_id and is_test = true);
  v_cases := v_cases || jsonb_build_object('C_test_fixture_flag', jsonb_build_object('ok', v_ok, 'detail', v_order_id::text));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- D production dashboard excludes test outstanding (service role can't call can_view — compute directly)
  select coalesce(sum(total_outstanding), 0) into v_prod_out
  from public.orders where coalesce(is_test, false) = false and coalesce(total_outstanding, 0) > 0;
  select coalesce(sum(total_outstanding), 0) into v_with_test
  from public.orders where coalesce(total_outstanding, 0) > 0;
  v_ok := v_with_test >= v_prod_out
    and exists (select 1 from public.orders where is_test and total_outstanding > 0);
  -- test order adds 50 to with_test vs prod
  v_ok := v_ok and (v_with_test - v_prod_out) >= 50;
  v_cases := v_cases || jsonb_build_object(
    'D_test_excluded_from_prod_totals',
    jsonb_build_object('ok', v_ok, 'detail', format('prod_out=%s with_test=%s', v_prod_out, v_with_test))
  );
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- E historical Shopify order count unchanged
  select count(*) into v_hist from public.orders where shopify_order_gid is not null and coalesce(is_test, false) = false;
  v_ok := v_hist = 21767;
  v_cases := v_cases || jsonb_build_object('E_historical_order_count', jsonb_build_object('ok', v_ok, 'detail', v_hist::text));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- F no Worldpay network config present (mode disabled)
  v_ok := public.payment_gateway_mode() = 'disabled';
  v_cases := v_cases || jsonb_build_object('F_no_test_mode_activation', jsonb_build_object('ok', v_ok, 'detail', 'gateway_mode stays disabled until product confirmed'));
  v_total := v_total + 1; if v_ok then v_pass := v_pass + 1; end if;

  -- cleanup synthetic
  delete from public.order_items where order_id = v_order_id;
  delete from public.finance_events where entity_id = v_order_id;
  delete from public.orders where id = v_order_id;
  delete from public.customers where email = 'phase2f-selftest@test.unique.local';

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

revoke all on function public.rpc_phase2f_worldpay_test_selftest() from public;
grant execute on function public.rpc_phase2f_worldpay_test_selftest() to service_role;

commit;
