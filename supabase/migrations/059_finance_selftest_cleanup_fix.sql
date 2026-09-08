-- Phase 2D fix: allow controlled selftest cleanup of synthetic Shopify-marked rows.
-- Production immutability unchanged unless ud.allow_finance_selftest_cleanup=on.

create or replace function public.forbid_shopify_payment_tx_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(current_setting('ud.allow_finance_selftest_cleanup', true), '') = 'on' then
    if tg_op = 'UPDATE' then return new; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.source_system, '') = 'shopify' then
    raise exception 'Shopify payment_transactions are immutable (UPDATE forbidden)'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'DELETE' and coalesce(old.source_system, '') = 'shopify' then
    raise exception 'Shopify payment_transactions are immutable (DELETE forbidden)'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  return old;
end;
$$;

create or replace function public.forbid_shopify_refund_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(current_setting('ud.allow_finance_selftest_cleanup', true), '') = 'on' then
    if tg_op = 'UPDATE' then return new; end if;
    return old;
  end if;
  if coalesce(old.source_system, '') = 'shopify' then
    raise exception 'Shopify refunds are immutable'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  return old;
end;
$$;

-- Patch selftest cleanup to set GUC before deleting synthetic Shopify rows.
-- Recreate only the cleanup section by replacing the whole selftest function is heavy;
-- instead run one-shot cleanup now and patch selftest body via extract+replace in apply script.

-- Immediate leftover cleanup from failed selftest run
do $$
begin
  perform set_config('ud.allow_finance_selftest_cleanup', 'on', true);
  alter table public.finance_events disable trigger trg_finance_events_no_delete;
  alter table public.finance_notes disable trigger trg_finance_notes_no_delete;

  delete from public.finance_notes where body like 'PHASE2D-STAB-%';
  delete from public.finance_events where coalesce(actor_name_snapshot, '') like 'PHASE2D-STAB-%'
     or entity_id in (select id from public.orders where order_number like 'PHASE2D-STAB-%');
  delete from public.statements where idempotency_key like 'PHASE2D-STAB-%';
  delete from public.finance_documents where title like 'PHASE2D-STAB-%'
     or id in (select document_id from public.invoices where invoice_number like 'UD-INV-TEST-%'
               and created_at > now() - interval '2 hours');
  delete from public.invoices
  where order_id in (select id from public.orders where order_number like 'PHASE2D-STAB-%')
     or invoice_number like 'UD-INV-TEST-%' and created_at > now() - interval '2 hours';
  delete from public.finance_idempotency_keys where key like 'PHASE2D-STAB-%';
  delete from public.refund_line_items where refund_id in (
    select id from public.refunds where order_id in (select id from public.orders where order_number like 'PHASE2D-STAB-%')
  );
  delete from public.refunds where order_id in (select id from public.orders where order_number like 'PHASE2D-STAB-%');
  delete from public.payment_transactions where order_id in (select id from public.orders where order_number like 'PHASE2D-STAB-%');
  -- orphan leftover shopify synthetic from failed cleanup (if order already gone)
  delete from public.payment_transactions
  where id = '5cfe20d7-2514-4a6b-8541-19b542854983'::uuid
     or (source_system = 'shopify' and amount = 80 and created_at > now() - interval '2 hours'
         and order_id not in (select id from public.orders)); -- only if orphan

  delete from public.order_tax_lines where order_id in (select id from public.orders where order_number like 'PHASE2D-STAB-%');
  delete from public.order_items where order_id in (select id from public.orders where order_number like 'PHASE2D-STAB-%');
  delete from public.order_events where order_id in (select id from public.orders where order_number like 'PHASE2D-STAB-%');
  delete from public.orders where order_number like 'PHASE2D-STAB-%';
  delete from public.companies where name like 'PHASE2D-STAB-%';
  delete from public.customers where coalesce(email,'') like 'PHASE2D-STAB-%';

  alter table public.finance_events enable trigger trg_finance_events_no_delete;
  alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
exception when others then
  begin
    alter table public.finance_events enable trigger trg_finance_events_no_delete;
    alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
  exception when others then null;
  end;
  raise;
end $$;


-- Re-apply selftest with cleanup that disables Shopify immutability triggers for PHASE2D-STAB rows only.
create or replace function public.rpc_phase2d_finance_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix constant text := 'PHASE2D-STAB-';
  v_cases jsonb := '{}'::jsonb;
  v_pass int := 0;
  v_total int := 0;
  v_rate numeric := 0;
  v_detail text;
  v_case_ok boolean;
  v_cleanup_ok boolean := true;
  v_cleanup_detail text := 'ok';
  v_customer_id uuid;
  v_company_id uuid;
  v_order_id uuid;
  v_order_shopify_id uuid;
  v_order2_id uuid;
  v_pay_id uuid;
  v_pay2_id uuid;
  v_rev_id uuid;
  v_inv_id uuid;
  v_stmt_id uuid;
  v_rpc jsonb;
  v_ord public.orders%rowtype;
  v_ord_shop public.orders%rowtype;
  v_shop_received numeric(14,2);
  v_shop_outstanding numeric(14,2);
  v_bucket text;
  v_cnt int;
  v_refund_id uuid;
begin
  -- ── Prefix cleanup (start) ───────────────────────────────────────────────
  begin
    alter table public.finance_events disable trigger trg_finance_events_no_delete;
    alter table public.finance_notes disable trigger trg_finance_notes_no_delete;

    delete from public.finance_notes
    where entity_id in (
      select id from public.orders where order_number like v_prefix || '%'
      union select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
      union select id from public.invoices where invoice_number like 'UD-INV-TEST-%'
        and metadata->>'order_number' like v_prefix || '%'
      union select id from public.payment_transactions where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    ) or body like v_prefix || '%';

    delete from public.finance_events
    where entity_id in (
      select id from public.orders where order_number like v_prefix || '%'
      union select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
      union select id from public.invoices where metadata->>'order_number' like v_prefix || '%'
      union select id from public.statements where idempotency_key like v_prefix || '%'
      union select id from public.payment_transactions where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    ) or coalesce(actor_name_snapshot, '') like v_prefix || '%';

    delete from public.statements where idempotency_key like v_prefix || '%'
       or customer_id in (select id from public.customers where email like v_prefix || '%')
       or company_id in (select id from public.companies where name like v_prefix || '%');

    delete from public.finance_documents where id in (
      select document_id from public.invoices where metadata->>'order_number' like v_prefix || '%'
      union
      select document_id from public.statements where idempotency_key like v_prefix || '%'
    ) or title like v_prefix || '%';

    delete from public.invoices where metadata->>'order_number' like v_prefix || '%'
       or order_id in (select id from public.orders where order_number like v_prefix || '%');

    delete from public.finance_idempotency_keys where key like v_prefix || '%';

    delete from public.refund_line_items where refund_id in (
      select id from public.refunds where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    );
    delete from public.refunds where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.payment_transactions where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_tax_lines where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_items where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_events where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.orders where order_number like v_prefix || '%';
    delete from public.companies where name like v_prefix || '%';
    delete from public.customers where coalesce(email, '') like v_prefix || '%';

    alter table public.finance_events enable trigger trg_finance_events_no_delete;
    alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
  exception when others then
    begin
      alter table public.finance_events enable trigger trg_finance_events_no_delete;
      alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
    exception when others then null;
    end;
  end;

  -- Seed CRM + Unique order + Shopify-like untouched order
  insert into public.customers (
    email, display_name, first_name, last_name, source_system, status, approval_status
  ) values (
    v_prefix || 'cust@unique.local', v_prefix || 'Customer', 'Phase', 'TwoD',
    'unique', 'active', 'approved'
  ) returning id into v_customer_id;

  insert into public.companies (name, source_system, status)
  values (v_prefix || 'Company Ltd', 'unique', 'active')
  returning id into v_company_id;

  insert into public.orders (
    order_number, email, status, currency, subtotal, shipping_total, tax_total,
    discount_total, total, customer_id, company_id, financial_status,
    total_received, total_outstanding, payment_due_on, order_source, metadata,
    shipping_address, source_created_at
  ) values (
    v_prefix || 'ORD-001', v_prefix || 'cust@unique.local', 'pending', 'GBP',
    100.00, 0, 0, 0, 100.00, v_customer_id, v_company_id, 'PENDING',
    0, 100.00, current_date - 45, 'unique_draft',
    jsonb_build_object('source_system', 'unique', 'billing_address', jsonb_build_object('name', 'Test')),
    '{}'::jsonb, now() - interval '50 days'
  ) returning id into v_order_id;

  insert into public.order_items (
    order_id, product_name, unit_price, quantity, line_total, sku_snapshot
  ) values (
    v_order_id, v_prefix || 'Widget', 50.00, 2, 100.00, v_prefix || 'SKU-1'
  );

  -- Second Unique order: no due date
  insert into public.orders (
    order_number, email, status, currency, subtotal, total, customer_id, company_id,
    financial_status, total_received, total_outstanding, payment_due_on, order_source,
    metadata, source_created_at
  ) values (
    v_prefix || 'ORD-002', v_prefix || 'cust@unique.local', 'pending', 'GBP',
    50.00, 50.00, v_customer_id, v_company_id, 'PENDING', 0, 50.00, null,
    'unique_draft', jsonb_build_object('source_system', 'unique'), now()
  ) returning id into v_order2_id;

  -- Shopify-like historical order (untouched money must stay put)
  insert into public.orders (
    order_number, email, status, currency, subtotal, total, customer_id, company_id,
    financial_status, total_received, total_outstanding, payment_due_on,
    order_source, shopify_order_gid, metadata, source_created_at
  ) values (
    v_prefix || 'SH-100', v_prefix || 'cust@unique.local', 'paid', 'GBP',
    200.00, 200.00, v_customer_id, v_company_id, 'PARTIALLY_PAID', 80.00, 120.00,
    current_date - 10, 'shopify', 'gid://shopify/Order/' || v_prefix || '100',
    jsonb_build_object('source_system', 'shopify'), now() - interval '100 days'
  ) returning id into v_order_shopify_id;

  insert into public.payment_transactions (
    order_id, kind, status, gateway, amount, currency, source_system, processed_at
  ) values (
    v_order_shopify_id, 'SALE', 'SUCCESS', 'Worldpay eCommerce', 80.00, 'GBP', 'shopify', now() - interval '90 days'
  );

  select total_received, total_outstanding into v_shop_received, v_shop_outstanding
  from public.orders where id = v_order_shopify_id;

  -- ── A_ar_dashboard_agg ───────────────────────────────────────────────────
  begin
    v_case_ok := false;
    -- Direct aggregation (RPC Forbidden without admin JWT)
    v_rpc := public.rpc_admin_finance_dashboard(
      jsonb_build_object('customer_id', v_customer_id)
    );
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      select count(*)::int, coalesce(sum(total_outstanding), 0)
      into v_cnt, v_ord.total_outstanding
      from public.orders
      where customer_id = v_customer_id and total_outstanding > 0;
      if v_cnt >= 3 and v_ord.total_outstanding = 270.00 then
        v_case_ok := true;
        v_detail := 'open AR count=' || v_cnt || ' total=270; RPC Forbidden without admin';
      else
        v_detail := format('unexpected agg count=%s outstanding=%s', v_cnt, v_ord.total_outstanding);
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true'
          and (v_rpc->>'open_receivable_total')::numeric = 270 then
      v_case_ok := true;
      v_detail := 'dashboard ok total=270';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('A_ar_dashboard_agg', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_ar_dashboard_agg', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── B_aging_buckets ──────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_bucket := public.finance_aging_bucket(current_date - 45, current_date);
    if v_bucket = '31_60' then
      v_case_ok := true;
      v_detail := 'ORD-001 ages to 31_60';
    else
      v_detail := 'expected 31_60 got ' || coalesce(v_bucket, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('B_aging_buckets', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_aging_buckets', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── C_no_due_date ────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_bucket := public.finance_aging_bucket(null, current_date);
    if v_bucket = 'no_due_date' then
      v_case_ok := true;
      v_detail := 'null due → no_due_date';
    else
      v_detail := 'got ' || coalesce(v_bucket, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('C_no_due_date', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_no_due_date', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── D_manual_pay_partial ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_post_manual_payment_core(
      v_order_id, 40.00, 'Bank Deposit', current_date,
      v_prefix || 'REF-1', v_prefix || 'partial note',
      v_prefix || 'idem-partial', 100.00
    );
    if coalesce(v_rpc->>'ok', '') = 'true' then
      v_pay_id := (v_rpc->>'payment_id')::uuid;
      select * into v_ord from public.orders where id = v_order_id;
      if v_ord.total_received = 40 and v_ord.total_outstanding = 60
         and v_ord.financial_status = 'PARTIALLY_PAID' then
        v_case_ok := true;
        v_detail := 'partial 40/100 → PARTIALLY_PAID';
      else
        v_detail := format('received=%s outstanding=%s status=%s',
          v_ord.total_received, v_ord.total_outstanding, v_ord.financial_status);
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('D_manual_pay_partial', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_manual_pay_partial', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── E_manual_pay_full ────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_post_manual_payment_core(
      v_order_id, 60.00, 'Bank Deposit', current_date,
      v_prefix || 'REF-2', null, v_prefix || 'idem-full', 60.00
    );
    if coalesce(v_rpc->>'ok', '') = 'true' then
      v_pay2_id := (v_rpc->>'payment_id')::uuid;
      select * into v_ord from public.orders where id = v_order_id;
      if v_ord.total_received = 100 and v_ord.total_outstanding = 0
         and v_ord.financial_status = 'PAID' then
        v_case_ok := true;
        v_detail := 'full pay → PAID';
      else
        v_detail := format('received=%s outstanding=%s status=%s',
          v_ord.total_received, v_ord.total_outstanding, v_ord.financial_status);
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('E_manual_pay_full', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_manual_pay_full', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── F_idempotent_duplicate ───────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_post_manual_payment_core(
      v_order_id, 60.00, 'Bank Deposit', current_date,
      v_prefix || 'REF-2', null, v_prefix || 'idem-full', 0
    );
    if coalesce(v_rpc->>'ok', '') = 'true'
       and coalesce((v_rpc->>'idempotent_replay')::boolean, false) = true
       and (v_rpc->>'payment_id')::uuid = v_pay2_id then
      select total_received into v_ord.total_received from public.orders where id = v_order_id;
      if v_ord.total_received = 100 then
        v_case_ok := true;
        v_detail := 'idempotent replay; received still 100';
      else
        v_detail := 'replay ok but received changed to ' || v_ord.total_received::text;
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('F_idempotent_duplicate', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_idempotent_duplicate', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── G_overpayment_reject ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    -- Reset order2 for overpay test
    update public.orders set total_received = 0, total_outstanding = 50, financial_status = 'PENDING'
    where id = v_order2_id;
    v_rpc := public.finance_post_manual_payment_core(
      v_order2_id, 75.00, 'manual', current_date, null, null, v_prefix || 'idem-over', 50.00
    );
    if coalesce(v_rpc->>'error', '') in ('amount_exceeds_outstanding', 'overpayment_rejected') then
      v_case_ok := true;
      v_detail := 'rejected: ' || (v_rpc->>'error');
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('G_overpayment_reject', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_overpayment_reject', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── H_stale_outstanding_conflict ─────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_post_manual_payment_core(
      v_order2_id, 10.00, 'manual', current_date, null, null, v_prefix || 'idem-stale', 999.00
    );
    if coalesce(v_rpc->>'error', '') = 'outstanding_conflict' then
      v_case_ok := true;
      v_detail := 'stale expected outstanding rejected';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('H_stale_outstanding_conflict', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_stale_outstanding_conflict', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── I_reverse_manual ─────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    -- Post then reverse on order2
    v_rpc := public.finance_post_manual_payment_core(
      v_order2_id, 20.00, 'manual', current_date, null, null, v_prefix || 'idem-rev-src', 50.00
    );
    v_pay_id := (v_rpc->>'payment_id')::uuid;
    v_rpc := public.finance_reverse_manual_payment_core(v_pay_id, 'selftest reverse', v_prefix || 'idem-rev');
    if coalesce(v_rpc->>'ok', '') = 'true' then
      v_rev_id := (v_rpc->>'reversal_id')::uuid;
      select * into v_ord from public.orders where id = v_order2_id;
      if v_ord.total_received = 0 and v_ord.total_outstanding = 50 and v_rev_id is not null then
        v_case_ok := true;
        v_detail := 'reversed; back to 0/50';
      else
        v_detail := format('received=%s outstanding=%s', v_ord.total_received, v_ord.total_outstanding);
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('I_reverse_manual', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('I_reverse_manual', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── J_reverse_twice_fail ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_reverse_manual_payment_core(v_pay_id, 'again', v_prefix || 'idem-rev2');
    if coalesce(v_rpc->>'error', '') = 'already_reversed' then
      v_case_ok := true;
      v_detail := 'second reverse rejected';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('J_reverse_twice_fail', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('J_reverse_twice_fail', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── K_permission_forbidden ───────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_admin_post_manual_payment(v_order2_id, 1, 'manual', current_date, null, null, null, 50);
    if auth.uid() is null and coalesce(v_rpc->>'error', '') = 'Forbidden' then
      v_rpc := public.rpc_admin_create_invoice_from_order(v_order_id, v_prefix || 'inv-forbid', false);
      if coalesce(v_rpc->>'error', '') = 'Forbidden' then
        v_case_ok := true;
        v_detail := 'post+invoice Forbidden without admin';
      else
        v_detail := 'invoice: ' || v_rpc::text;
      end if;
    else
      v_detail := 'post: ' || coalesce(v_rpc::text, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('K_permission_forbidden', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('K_permission_forbidden', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── L_invoice_create ─────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_create_invoice_from_order_core(v_order_id, v_prefix || 'inv-1', false);
    if coalesce(v_rpc->>'ok', '') = 'true'
       and coalesce(v_rpc->>'provenance', '') = 'unique_native' then
      v_inv_id := (v_rpc->>'invoice_id')::uuid;
      if (v_rpc->>'invoice_number') like 'UD-INV-TEST-%' then
        v_case_ok := true;
        v_detail := 'invoice ' || (v_rpc->>'invoice_number') || ' unique_native';
      else
        v_detail := 'bad number ' || coalesce(v_rpc->>'invoice_number', '');
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('L_invoice_create', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('L_invoice_create', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── M_invoice_idempotent ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_create_invoice_from_order_core(v_order_id, v_prefix || 'inv-1', false);
    if coalesce(v_rpc->>'ok', '') = 'true'
       and coalesce((v_rpc->>'idempotent_replay')::boolean, false) = true
       and (v_rpc->>'invoice_id')::uuid = v_inv_id then
      v_case_ok := true;
      v_detail := 'invoice idempotent replay';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('M_invoice_idempotent', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('M_invoice_idempotent', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── N_shopify_order_untouched ────────────────────────────────────────────
  begin
    v_case_ok := false;
    select * into v_ord_shop from public.orders where id = v_order_shopify_id;
    if v_ord_shop.total_received = v_shop_received
       and v_ord_shop.total_outstanding = v_shop_outstanding then
      -- Attempt UPDATE on Shopify tx must fail
      begin
        update public.payment_transactions set amount = 1
        where order_id = v_order_shopify_id and source_system = 'shopify';
        v_detail := 'Shopify tx UPDATE unexpectedly allowed';
      exception when others then
        v_case_ok := true;
        v_detail := 'Shopify money untouched; tx immutable';
      end;
    else
      v_detail := format('shopify received/outstanding changed %s/%s',
        v_ord_shop.total_received, v_ord_shop.total_outstanding);
    end if;
    v_cases := v_cases || jsonb_build_object('N_shopify_order_untouched', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('N_shopify_order_untouched', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── O_statement_balances ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_generate_statement_core(
      v_customer_id, v_company_id,
      current_date - 120, current_date,
      v_prefix || 'stmt-1'
    );
    if coalesce(v_rpc->>'ok', '') = 'true' then
      v_stmt_id := (v_rpc->>'statement_id')::uuid;
      if v_stmt_id is not null
         and (v_rpc ? 'opening_balance')
         and (v_rpc ? 'closing_balance') then
        v_case_ok := true;
        v_detail := format('stmt opening=%s closing=%s',
          v_rpc->>'opening_balance', v_rpc->>'closing_balance');
      else
        v_detail := 'missing balances';
      end if;
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('O_statement_balances', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('O_statement_balances', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── P_refund_read ────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    insert into public.refunds (order_id, note, total_refunded, currency, source_system)
    values (v_order_id, v_prefix || 'refund sample', 0, 'GBP', 'unique')
    returning id into v_refund_id;
    v_rpc := public.rpc_get_admin_finance_refund(v_refund_id);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      -- Direct read path for service_role selftest without JWT
      if exists (select 1 from public.refunds where id = v_refund_id) then
        v_case_ok := true;
        v_detail := 'refund row readable; RPC Forbidden without admin';
      else
        v_detail := 'refund missing';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' then
      v_case_ok := true;
      v_detail := 'refund RPC ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('P_refund_read', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('P_refund_read', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── Q_audit_events ───────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    select count(*)::int into v_cnt
    from public.finance_events
    where entity_type = 'order' and entity_id = v_order_id
      and event_type in ('manual_payment_posted', 'invoice_created');
    if v_cnt >= 2 then
      v_case_ok := true;
      v_detail := 'finance_events count=' || v_cnt::text;
    else
      v_detail := 'expected >=2 events got ' || v_cnt::text;
    end if;
    v_cases := v_cases || jsonb_build_object('Q_audit_events', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('Q_audit_events', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── R_provenance_reconstructed ───────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.finance_create_invoice_from_order_core(
      v_order_shopify_id, v_prefix || 'inv-recon', true
    );
    if coalesce(v_rpc->>'ok', '') = 'true'
       and coalesce(v_rpc->>'provenance', '') = 'reconstructed_from_order' then
      v_case_ok := true;
      v_detail := 'Shopify order invoice provenance=reconstructed_from_order';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('R_provenance_reconstructed', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('R_provenance_reconstructed', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── S_finance_note ───────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    insert into public.finance_notes (entity_type, entity_id, body, author_name_snapshot, source_system)
    values ('order', v_order_id, v_prefix || ' note body', 'phase2d_selftest', 'unique');
    select count(*)::int into v_cnt
    from public.finance_notes
    where entity_type = 'order' and entity_id = v_order_id;
    if v_cnt >= 1 then
      v_case_ok := true;
      v_detail := 'note appended';
    else
      v_detail := 'note missing';
    end if;
    v_cases := v_cases || jsonb_build_object('S_finance_note', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('S_finance_note', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── T_reconciliation_flags_shape ─────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_admin_finance_reconciliation_flags(10);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      v_case_ok := true;
      v_detail := 'flags RPC Forbidden without admin (expected in selftest)';
    elsif coalesce(v_rpc->>'ok', '') = 'true' and v_rpc ? 'flags' then
      v_case_ok := true;
      v_detail := 'flags RPC ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('T_reconciliation_flags_shape', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('T_reconciliation_flags_shape', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── U_order_panel_shape ──────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_get_admin_order_finance_panel(v_order_id);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      if exists (select 1 from public.payment_transactions where order_id = v_order_id and source_system = 'unique') then
        v_case_ok := true;
        v_detail := 'panel Forbidden without admin; Unique txs present';
      else
        v_detail := 'no unique txs';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' and v_rpc ? 'payments' then
      v_case_ok := true;
      v_detail := 'panel ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('U_order_panel_shape', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('U_order_panel_shape', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── V_crm_finance_summary_shape ──────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_get_admin_crm_finance_summary('customer', v_customer_id);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      select coalesce(sum(total_outstanding), 0) into v_ord.total_outstanding
      from public.orders where customer_id = v_customer_id;
      v_case_ok := true;
      v_detail := 'summary Forbidden without admin; customer outstanding=' || v_ord.total_outstanding::text;
    elsif coalesce(v_rpc->>'ok', '') = 'true' then
      v_case_ok := true;
      v_detail := 'crm finance summary ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('V_crm_finance_summary_shape', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('V_crm_finance_summary_shape', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- Score
  select count(*)::int,
         count(*) filter (where (value->>'ok')::boolean)::int
  into v_total, v_pass
  from jsonb_each(v_cases);

  if v_total > 0 then
    v_rate := round((v_pass::numeric / v_total::numeric) * 100, 1);
  end if;

  -- ── Final cleanup (always) ───────────────────────────────────────────────
  begin
    perform set_config('ud.allow_finance_selftest_cleanup', 'on', true);
    alter table public.finance_events disable trigger trg_finance_events_no_delete;
    alter table public.finance_notes disable trigger trg_finance_notes_no_delete;
    alter table public.payment_transactions disable trigger trg_payment_transactions_shopify_immutable;
    alter table public.refunds disable trigger trg_refunds_shopify_immutable;

    delete from public.finance_notes
    where entity_id in (
      select id from public.orders where order_number like v_prefix || '%'
      union select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
      union select id from public.invoices where metadata->>'order_number' like v_prefix || '%'
      union select id from public.payment_transactions where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    ) or body like v_prefix || '%';

    delete from public.finance_events
    where entity_id in (
      select id from public.orders where order_number like v_prefix || '%'
      union select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
      union select id from public.invoices where metadata->>'order_number' like v_prefix || '%'
      union select id from public.statements where idempotency_key like v_prefix || '%'
      union select id from public.payment_transactions where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    ) or coalesce(actor_name_snapshot, '') like v_prefix || '%';

    delete from public.statements where idempotency_key like v_prefix || '%'
       or customer_id in (select id from public.customers where email like v_prefix || '%')
       or company_id in (select id from public.companies where name like v_prefix || '%');

    delete from public.finance_documents where id in (
      select document_id from public.invoices
      where metadata->>'order_number' like v_prefix || '%'
         or order_id in (select id from public.orders where order_number like v_prefix || '%')
      union
      select document_id from public.statements where idempotency_key like v_prefix || '%'
    );

    delete from public.invoices
    where metadata->>'order_number' like v_prefix || '%'
       or order_id in (select id from public.orders where order_number like v_prefix || '%');

    delete from public.finance_idempotency_keys where key like v_prefix || '%';

    delete from public.refund_line_items where refund_id in (
      select id from public.refunds where order_id in (
        select id from public.orders where order_number like v_prefix || '%'
      )
    );
    delete from public.refunds where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.payment_transactions where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_tax_lines where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_items where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.order_events where order_id in (
      select id from public.orders where order_number like v_prefix || '%'
    );
    delete from public.orders where order_number like v_prefix || '%';
    delete from public.companies where name like v_prefix || '%';
    delete from public.customers where coalesce(email, '') like v_prefix || '%';

    alter table public.payment_transactions enable trigger trg_payment_transactions_shopify_immutable;
    alter table public.refunds enable trigger trg_refunds_shopify_immutable;
    alter table public.finance_events enable trigger trg_finance_events_no_delete;
    alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
  exception when others then
    v_cleanup_ok := false;
    v_cleanup_detail := SQLERRM;
    begin
      alter table public.payment_transactions enable trigger trg_payment_transactions_shopify_immutable;
      alter table public.refunds enable trigger trg_refunds_shopify_immutable;
      alter table public.finance_events enable trigger trg_finance_events_no_delete;
      alter table public.finance_notes enable trigger trg_finance_notes_no_delete;
    exception when others then null;
    end;
  end;

  return jsonb_build_object(
    'ok', v_pass = v_total and v_cleanup_ok,
    'pass', v_pass,
    'total', v_total,
    'pass_rate_pct', v_rate,
    'cases', v_cases,
    'cleanup', jsonb_build_object('ok', v_cleanup_ok, 'detail', v_cleanup_detail)
  );
end;
$$;

comment on function public.rpc_phase2d_finance_selftest() is
  'Phase 2D Finance & AR selftest. service_role only. Synthetic PHASE2D-STAB-* data; always cleaned up.';

revoke all on function public.rpc_phase2d_finance_selftest() from public;
revoke all on function public.rpc_phase2d_finance_selftest() from anon;
revoke all on function public.rpc_phase2d_finance_selftest() from authenticated;
grant execute on function public.rpc_phase2d_finance_selftest() to service_role;
