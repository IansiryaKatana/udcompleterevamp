-- Verification for Phase 2 money / AR / refunds (manual run after migrations).
-- Does not import Shopify data. Does not deploy.

do $$
declare
  v_order uuid;
  v_item uuid;
  v_company uuid;
  v_customer uuid;
  v_ar uuid;
  v_tx uuid;
  v_refund uuid;
  v_cn uuid;
begin
  insert into public.companies (name, source_system)
  values ('AR Verify Co', 'verify')
  returning id into v_company;

  insert into public.customers (email, display_name, source_system)
  values ('ar-verify@example.com', 'AR Verify Person', 'verify')
  returning id into v_customer;

  insert into public.orders (
    order_number, email, status, currency, subtotal, total,
    company_id, customer_id, financial_status, total_outstanding, total_received,
    payment_gateway_names, payment_due_on
  ) values (
    'VERIFY-AR-' || substr(gen_random_uuid()::text, 1, 8),
    'ar-verify@example.com',
    'pending',
    'GBP',
    100.00,
    120.00,
    v_company,
    v_customer,
    'PENDING',
    120.00,
    0,
    array['Bank Deposit', 'PAY LATER'],
    current_date + 14
  )
  returning id into v_order;

  insert into public.order_items (order_id, product_name, unit_price, quantity, line_total, sku_snapshot)
  values (v_order, 'Verify Line', 100.00, 1, 100.00, 'AR-SKU-1')
  returning id into v_item;

  insert into public.order_tax_lines (order_id, order_item_id, title, rate, rate_percentage, price, currency)
  values (v_order, v_item, 'GB VAT', 0.2, 20, 20.00, 'GBP');

  insert into public.ar_accounts (company_id, customer_id, currency, current_balance, payment_terms_label)
  values (v_company, v_customer, 'GBP', 120.00, 'PAY LATER')
  returning id into v_ar;

  update public.orders set ar_account_id = v_ar where id = v_order;

  insert into public.ar_entries (
    ar_account_id, order_id, entry_type, amount, direction, due_on, memo, source_system
  ) values (
    v_ar, v_order, 'invoice_open', 120.00, 'debit', current_date + 14, 'Open receivable', 'verify'
  );

  insert into public.payment_transactions (
    order_id, kind, status, gateway, amount, currency, processed_at, source_system
  ) values (
    v_order, 'SALE', 'SUCCESS', 'Bank Deposit', 50.00, 'GBP', now(), 'verify'
  )
  returning id into v_tx;

  insert into public.ar_entries (
    ar_account_id, order_id, payment_transaction_id, entry_type, amount, direction, memo, source_system
  ) values (
    v_ar, v_order, v_tx, 'payment_applied', 50.00, 'credit', 'Partial bank deposit', 'verify'
  );

  update public.orders
  set total_received = 50.00, total_outstanding = 70.00, financial_status = 'PARTIALLY_PAID'
  where id = v_order;

  update public.ar_accounts set current_balance = 70.00 where id = v_ar;

  insert into public.refunds (order_id, note, total_refunded, currency, source_system)
  values (v_order, 'Verify refund', 10.00, 'GBP', 'verify')
  returning id into v_refund;

  insert into public.refund_line_items (
    refund_id, order_item_id, quantity, restock_type, subtotal, total_tax, sku_snapshot, name_snapshot
  ) values (
    v_refund, v_item, 0, 'NO_RESTOCK', 8.33, 1.67, 'AR-SKU-1', 'Verify Line'
  );

  insert into public.credit_notes (
    order_id, company_id, customer_id, ar_account_id, refund_id, status, flag_value, amount, currency, source_system
  ) values (
    v_order, v_company, v_customer, v_ar, v_refund, 'issued', 'Yes', 10.00, 'GBP', 'verify'
  )
  returning id into v_cn;

  if (select total_outstanding from public.orders where id = v_order) <> 70.00 then
    raise exception 'outstanding verification failed';
  end if;

  if not exists (select 1 from public.payment_transactions where id = v_tx and gateway = 'Bank Deposit') then
    raise exception 'payment_transactions verification failed';
  end if;

  -- Cleanup (mutable money rows; leave cancelled order)
  delete from public.credit_notes where id = v_cn;
  delete from public.refund_line_items where refund_id = v_refund;
  delete from public.refunds where id = v_refund;
  delete from public.ar_entries where ar_account_id = v_ar;
  delete from public.payment_transactions where id = v_tx;
  delete from public.order_tax_lines where order_id = v_order;
  delete from public.order_items where order_id = v_order;
  update public.orders set ar_account_id = null, status = 'cancelled', note = 'phase2 verification artifact' where id = v_order;
  delete from public.ar_accounts where id = v_ar;
  delete from public.customers where id = v_customer;
  delete from public.companies where id = v_company;

  raise notice 'Phase 2 money/AR verification passed';
end;
$$;
