-- Verification for Phase 4 draft orders (manual run after migration).

do $$
declare
  v_staff uuid;
  v_customer uuid;
  v_company uuid;
  v_draft uuid;
  v_order uuid;
  v_line uuid;
begin
  insert into public.staff_members (name, email, staff_type)
  values ('Draft Verify Rep', 'draft-rep@example.com', 'sales')
  returning id into v_staff;

  insert into public.customers (email, display_name, source_system)
  values ('draft-verify@example.com', 'Draft Verify Buyer', 'verify')
  returning id into v_customer;

  insert into public.companies (name, trading_name, source_system, salesperson_id)
  values ('Draft Verify Co', 'Draft Trading', 'verify', v_staff)
  returning id into v_company;

  insert into public.draft_orders (
    name, status, email, currency, subtotal, total_tax, total_price,
    purchasing_entity_type, customer_id, company_id,
    salesperson_id, referrer_id, trading_name_snapshot, customer_type_snapshot,
    invoice_url, source_system, shopify_draft_gid
  ) values (
    '#D1001', 'open', 'draft-verify@example.com', 'GBP', 100.00, 20.00, 120.00,
    'PurchasingCompany', v_customer, v_company,
    v_staff, v_staff, 'Draft Trading', 'Wholesale',
    'https://example.com/invoice', 'verify', 'gid://shopify/DraftOrder/VERIFY'
  )
  returning id into v_draft;

  insert into public.draft_order_line_items (
    draft_order_id, product_id, title, sku_snapshot, quantity,
    original_unit_price, original_total, deleted_product
  ) values (
    v_draft, null, 'Deleted catalog item', 'DRAFT-SKU-1', 2,
    50.00, 100.00, true
  )
  returning id into v_line;

  -- Convert to live order (FromDraft path)
  insert into public.orders (
    order_number, email, status, currency, subtotal, total,
    customer_id, company_id, salesperson_id, referrer_id,
    order_source, source_app, financial_status, draft_order_id,
    trading_name_snapshot, payment_gateway_names
  ) values (
    'VERIFY-FROM-DRAFT-' || substr(gen_random_uuid()::text, 1, 8),
    'draft-verify@example.com',
    'pending',
    'GBP',
    100.00,
    120.00,
    v_customer,
    v_company,
    v_staff,
    v_staff,
    'shopify_draft_order',
    'Draft Orders',
    'PENDING',
    v_draft,
    'Draft Trading',
    array['Bank Deposit']
  )
  returning id into v_order;

  update public.draft_orders
  set status = 'completed',
      completed_at = now(),
      converted_order_id = v_order
  where id = v_draft;

  if not exists (
    select 1 from public.draft_orders
    where id = v_draft and converted_order_id = v_order and status = 'completed'
  ) then
    raise exception 'draft conversion link failed';
  end if;

  if not exists (
    select 1 from public.orders where id = v_order and draft_order_id = v_draft
  ) then
    raise exception 'order.draft_order_id link failed';
  end if;

  if not exists (
    select 1 from public.draft_order_line_items
    where id = v_line and deleted_product = true and product_id is null
  ) then
    raise exception 'draft line snapshot failed';
  end if;

  -- Cleanup
  update public.orders set draft_order_id = null, status = 'cancelled', note = 'phase4 verification artifact' where id = v_order;
  update public.draft_orders set converted_order_id = null where id = v_draft;
  delete from public.draft_order_line_items where draft_order_id = v_draft;
  delete from public.draft_orders where id = v_draft;
  delete from public.companies where id = v_company;
  delete from public.customers where id = v_customer;
  delete from public.staff_members where id = v_staff;

  raise notice 'Phase 4 draft orders verification passed (cancelled order % retained)', v_order;
end;
$$;
