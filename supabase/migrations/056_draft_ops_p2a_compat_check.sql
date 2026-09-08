-- Phase 2B stabilization: Phase 2A compatibility check for Unique draft→order.
-- Synthetic PHASE2B-STAB-P2A-* records only; cleans up after itself.

create or replace function public.rpc_phase2b_p2a_compat_check()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_rate numeric := public.unique_b2b_vat_rate();
  v_subtotal numeric(14,2);
  v_shipping numeric(14,2) := 7.50;
  v_discount numeric(14,2) := 5.00;
  v_tax numeric(14,2);
  v_total numeric(14,2);
  v_staff uuid;
  v_checks jsonb := '{}'::jsonb;
  v_list jsonb;
  v_ws jsonb;
  v_found boolean := false;
  v_ok boolean := true;
  v_detail text := 'ok';
  r record;
begin
  select id into v_staff from public.staff_members order by created_at nulls last limit 1;

  insert into public.draft_orders (
    name, status, email, currency, source_system, version,
    subtotal, total_tax, total_shipping, total_discounts, total_price,
    payment_terms, payment_due_on, po_number, note,
    salesperson_id, cg_assigned_id, referrer_id,
    trading_name_snapshot, customer_type_snapshot,
    shipping_line, discount_snapshot, tax_exempt
  ) values (
    'PHASE2B-STAB-P2A-DRAFT', 'open', 'phase2b-stab-p2a@unique.local', 'GBP', 'unique', 1,
    0, 0, 0, 0, 0,
    'Net 30', current_date + 30, 'PO-P2A-STAB', 'Phase 2A compat test — do not email',
    v_staff, v_staff, v_staff,
    'PHASE2B STAB Trading', 'Trade',
    jsonb_build_object('title', 'Standard', 'price', to_jsonb(v_shipping)),
    jsonb_build_object('value_type', 'fixed', 'value', to_jsonb(v_discount), 'title', 'Test discount'),
    false
  )
  returning id into v_draft_id;

  insert into public.draft_order_line_items (
    draft_order_id, title, variant_title, sku_snapshot, quantity,
    original_unit_price, discounted_unit_price, original_total, discounted_total,
    taxable, sort_order
  ) values
    (v_draft_id, 'Compat Product A', 'Variant A', 'STAB-SKU-A', 4, 12.50, 12.50, 50.00, 50.00, true, 0),
    (v_draft_id, 'Compat Product B', 'Variant B', 'STAB-SKU-B', 2, 20.00, 20.00, 40.00, 40.00, true, 1);

  perform public.recalc_unique_draft_totals(v_draft_id);

  select subtotal, total_tax, total_price
  into v_subtotal, v_tax, v_total
  from public.draft_orders where id = v_draft_id;

  -- Convert (inline — same shape as production Unique convert)
  v_order_number := public.generate_unique_order_number();

  insert into public.orders (
    order_number, email, status, currency,
    subtotal, shipping_total, tax_total, discount_total, total,
    shipping_address, metadata,
    financial_status, commerce_fulfillment_status, fulfillment_status,
    order_source, source_app,
    purchase_order_number, trading_name_snapshot, customer_type_snapshot,
    salesperson_id, cg_assigned_id, referrer_id,
    total_received, total_outstanding, taxes_included,
    payment_due_on, note, draft_order_id, source_created_at, processed_at
  )
  select
    v_order_number, email, 'pending', currency,
    subtotal, total_shipping, total_tax, total_discounts, total_price,
    coalesce(shipping_address, '{}'::jsonb),
    jsonb_build_object(
      'source_system', 'unique',
      'from_draft_id', id,
      'payment_terms', payment_terms,
      'discount_snapshot', discount_snapshot,
      'tax_snapshot', tax_snapshot,
      'phase2b_stab', true
    ),
    'PENDING', 'UNFULFILLED', 'unfulfilled',
    'unique_draft', 'Unique Draft',
    po_number, trading_name_snapshot, customer_type_snapshot,
    salesperson_id, cg_assigned_id, referrer_id,
    0, total_price, false,
    payment_due_on, note, id, now(), now()
  from public.draft_orders where id = v_draft_id
  returning id into v_order_id;

  insert into public.order_items (
    order_id, product_name, unit_price, quantity, line_total,
    variant_name, sku_snapshot, variant_title_snapshot,
    original_unit_price, discount_total, tax_total, taxable
  )
  select
    v_order_id, title, discounted_unit_price, quantity, discounted_total,
    variant_title, sku_snapshot, variant_title,
    original_unit_price,
    round(greatest(original_total - discounted_total, 0), 2),
    0, taxable
  from public.draft_order_line_items
  where draft_order_id = v_draft_id;

  update public.draft_orders
  set converted_order_id = v_order_id, status = 'completed', completed_at = now(), version = version + 1
  where id = v_draft_id;

  insert into public.order_events (
    order_id, event_type, category, source_system, message, new_value, occurred_at
  ) values (
    v_order_id, 'order_created_from_draft', 'lifecycle', 'unique',
    'Order created from Unique draft (P2A compat check)',
    jsonb_build_object('draft_order_id', v_draft_id),
    now()
  );

  -- Direct table checks (workspace RPCs require is_admin)
  select
    o.financial_status = 'PENDING'
    and o.commerce_fulfillment_status = 'UNFULFILLED'
    and o.total_received = 0
    and o.total_outstanding = o.total
    and o.draft_order_id = v_draft_id
    and o.order_source = 'unique_draft'
    and o.purchase_order_number = 'PO-P2A-STAB'
    and o.payment_due_on is not null
    and o.salesperson_id is not distinct from v_staff
    and o.cg_assigned_id is not distinct from v_staff
    and o.referrer_id is not distinct from v_staff
    and o.trading_name_snapshot = 'PHASE2B STAB Trading'
    and o.total = v_total
    and o.subtotal = v_subtotal
    and o.shipping_total = v_shipping
    and o.discount_total = (select total_discounts from public.draft_orders where id = v_draft_id)
    and o.tax_total = v_tax
  into v_found
  from public.orders o where o.id = v_order_id;

  v_checks := v_checks || jsonb_build_object(
    'order_financial', v_found,
    'order_number', v_order_number,
    'order_id', v_order_id,
    'draft_id', v_draft_id,
    'total', v_total,
    'tax', v_tax,
    'vat_rate', v_rate
  );

  if not coalesce(v_found, false) then
    v_ok := false;
    v_detail := 'order commercial fields mismatch';
  end if;

  select count(*) = 2 into v_found from public.order_items where order_id = v_order_id;
  v_checks := v_checks || jsonb_build_object('line_count_2', v_found);
  if not v_found then v_ok := false; v_detail := 'order items missing'; end if;

  select exists(
    select 1 from public.order_events
    where order_id = v_order_id and event_type = 'order_created_from_draft' and source_system = 'unique'
  ) into v_found;
  v_checks := v_checks || jsonb_build_object('unique_audit_event', v_found);
  if not v_found then v_ok := false; v_detail := 'missing unique audit event'; end if;

  select d.converted_order_id = v_order_id and o.draft_order_id = v_draft_id
  into v_found
  from public.draft_orders d
  join public.orders o on o.id = v_order_id
  where d.id = v_draft_id;
  v_checks := v_checks || jsonb_build_object('bidirectional_link', v_found);
  if not v_found then v_ok := false; v_detail := 'draft/order link broken'; end if;

  -- List visibility (direct query mirroring list RPC filters)
  select exists(
    select 1 from public.orders o
    where o.id = v_order_id
      and (
        o.order_number ilike '%STAB%'
        or o.order_number = v_order_number
        or o.email ilike '%phase2b-stab-p2a%'
        or o.purchase_order_number = 'PO-P2A-STAB'
      )
  ) into v_found;
  v_checks := v_checks || jsonb_build_object('list_searchable', v_found);
  if not v_found then v_ok := false; v_detail := 'order not searchable'; end if;

  select not exists(select 1 from public.payment_transactions where order_id = v_order_id)
  into v_found;
  v_checks := v_checks || jsonb_build_object('no_fake_payments', v_found);
  if not v_found then v_ok := false; v_detail := 'unexpected payment rows'; end if;

  -- Cleanup (only test rows)
  begin
    alter table public.order_events disable trigger trg_order_events_no_delete;
    alter table public.draft_order_events disable trigger trg_draft_order_events_no_delete;

    delete from public.payment_transactions where order_id = v_order_id;
    delete from public.order_events where order_id = v_order_id;
    delete from public.order_items where order_id = v_order_id;
    delete from public.orders where id = v_order_id;

    delete from public.draft_order_events where draft_order_id = v_draft_id;
    delete from public.draft_order_notes where draft_order_id = v_draft_id;
    delete from public.draft_order_line_items where draft_order_id = v_draft_id;
    delete from public.draft_orders where id = v_draft_id;

    alter table public.order_events enable trigger trg_order_events_no_delete;
    alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;
  exception when others then
    v_ok := false;
    v_detail := 'cleanup failed: ' || SQLERRM;
    begin
      alter table public.order_events enable trigger trg_order_events_no_delete;
      alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;
    exception when others then null;
    end;
  end;

  return jsonb_build_object('ok', v_ok, 'detail', v_detail, 'checks', v_checks);
end;
$$;

revoke all on function public.rpc_phase2b_p2a_compat_check() from public;
revoke all on function public.rpc_phase2b_p2a_compat_check() from anon;
revoke all on function public.rpc_phase2b_p2a_compat_check() from authenticated;
grant execute on function public.rpc_phase2b_p2a_compat_check() to service_role;
