-- Verification helpers for UD Commerce Foundation (slice 1).
-- Run manually against a migrated database (local or staging).
-- Does NOT import Shopify data. Does NOT deploy.

-- Expected: all return true / expected counts without error.

do $$
declare
  v_staff uuid;
  v_staff2 uuid;
  v_customer uuid;
  v_company uuid;
  v_loc1 uuid;
  v_loc2 uuid;
  v_contact uuid;
  v_tag1 uuid;
  v_tag2 uuid;
  v_order uuid;
  v_item uuid;
  v_event uuid;
  v_assign uuid;
  v_mf_count int;
begin
  -- Existing tables still present
  perform 1 from information_schema.tables where table_schema = 'public' and table_name = 'orders';
  perform 1 from information_schema.tables where table_schema = 'public' and table_name = 'order_items';
  perform 1 from information_schema.tables where table_schema = 'public' and table_name = 'products';
  perform 1 from information_schema.tables where table_schema = 'public' and table_name = 'admin_users';

  -- Legacy order insert still works (only required columns)
  insert into public.orders (order_number, email, status, currency, subtotal, total)
  values (
    'VERIFY-FOUNDATION-' || substr(gen_random_uuid()::text, 1, 8),
    'verify-foundation@example.com',
    'pending',
    'GBP',
    10.00,
    10.00
  )
  returning id into v_order;

  insert into public.order_items (
    order_id, product_id, product_name, unit_price, quantity, line_total,
    sku_snapshot, deleted_product, vendor_snapshot
  ) values (
    v_order,
    null,
    'Historical deleted product line',
    5.00,
    2,
    10.00,
    'SKU-DELETED-1',
    true,
    'Test Vendor'
  )
  returning id into v_item;

  if not exists (
    select 1 from public.order_items
    where id = v_item and product_id is null and deleted_product = true and sku_snapshot = 'SKU-DELETED-1'
  ) then
    raise exception 'order_items snapshot / deleted_product verification failed';
  end if;

  -- CRM customer without auth.users
  insert into public.customers (email, display_name, trading_name, registration_channel, customer_type, source_system)
  values ('zero-order@example.com', 'Zero Order Account', 'Corner Shop', 'Website Registration', 'Wholesale', 'shopify')
  returning id into v_customer;

  if (select auth_user_id from public.customers where id = v_customer) is not null then
    raise exception 'customer unexpectedly linked to auth';
  end if;

  -- Staff + assignment history
  insert into public.staff_members (name, email, staff_type)
  values ('Verify Sales A', 'sales-a@example.com', 'sales')
  returning id into v_staff;

  insert into public.staff_members (name, email, staff_type)
  values ('Verify Sales B', 'sales-b@example.com', 'sales')
  returning id into v_staff2;

  update public.customers set salesperson_id = v_staff where id = v_customer;

  insert into public.entity_assignments (entity_type, entity_id, assignment_type, staff_member_id, source, valid_from)
  values ('customer', v_customer, 'salesperson', v_staff, 'verify', now() - interval '30 days')
  returning id into v_assign;

  update public.entity_assignments
  set valid_to = now() - interval '1 day'
  where id = v_assign;

  insert into public.entity_assignments (entity_type, entity_id, assignment_type, staff_member_id, source, valid_from)
  values ('customer', v_customer, 'salesperson', v_staff2, 'verify', now() - interval '1 day');

  -- Company + multiple locations + contact
  insert into public.companies (name, trading_name, source_system, salesperson_id)
  values ('Verify Co Ltd', 'Verify Trading', 'shopify', v_staff)
  returning id into v_company;

  insert into public.company_locations (company_id, name, is_primary, city, country_code)
  values (v_company, 'HQ', true, 'London', 'GB')
  returning id into v_loc1;

  insert into public.company_locations (company_id, name, is_primary, city, country_code)
  values (v_company, 'Warehouse', false, 'Darwen', 'GB')
  returning id into v_loc2;

  insert into public.company_contacts (company_id, customer_id, is_primary, receives_orders, receives_invoices)
  values (v_company, v_customer, true, true, true)
  returning id into v_contact;

  update public.orders
  set customer_id = v_customer,
      company_id = v_company,
      salesperson_id = v_staff2,
      financial_status = 'PENDING',
      commerce_fulfillment_status = 'UNFULFILLED',
      order_source = 'web'
  where id = v_order;

  -- Tags: preserve raw spelling variants
  insert into public.tags (name, normalized_name)
  values ('Awaiting payment', 'awaiting payment')
  on conflict (name) do update set normalized_name = excluded.normalized_name
  returning id into v_tag1;

  insert into public.tags (name, normalized_name)
  values ('Awaiting Payment', 'awaiting payment')
  on conflict (name) do update set normalized_name = excluded.normalized_name
  returning id into v_tag2;

  insert into public.entity_tags (tag_id, entity_type, entity_id, raw_value, source_system)
  values
    (v_tag1, 'order', v_order, 'Awaiting payment', 'shopify'),
    (v_tag2, 'order', v_order, 'Awaiting Payment', 'shopify');

  -- Dynamic metafield keys (CSS Sales Team style)
  insert into public.metafields (owner_type, owner_id, namespace, key, value_type, value_text, source_system)
  values
    ('order', v_order, 'css_sales_team_order_tagging_details', 'dynamic_key_' || substr(gen_random_uuid()::text, 1, 8), 'single_line_text_field', 'ok', 'shopify'),
    ('order', v_order, 'custom', 'salesperson', 'single_line_text_field', 'Verify Sales B', 'shopify'),
    ('customer', v_customer, 'css_sales_team_tagging_details', 'another_dynamic_' || substr(gen_random_uuid()::text, 1, 8), 'json', null, 'shopify');

  update public.metafields
  set value_json = '{"x":1}'::jsonb
  where owner_id = v_customer and namespace = 'css_sales_team_tagging_details';

  select count(*) into v_mf_count from public.metafields where owner_id in (v_order, v_customer);
  if v_mf_count < 3 then
    raise exception 'metafield insert verification failed';
  end if;

  -- External identity
  insert into public.external_system_refs (
    entity_type, entity_id, system, external_gid, external_legacy_id, external_number, imported_at
  ) values (
    'order', v_order, 'shopify',
    'gid://shopify/Order/VERIFY', '999000111', 'UD-VERIFY-1', now()
  );

  -- Append event
  insert into public.order_events (
    order_id, event_type, category, source_system, source_app, message, occurred_at
  ) values (
    v_order, 'comment', 'comment', 'shopify', 'Shopify Web', 'Verification comment event', now()
  )
  returning id into v_event;

  insert into public.order_comments (
    order_id, author_staff_id, author_name_snapshot, body, source_system, occurred_at
  ) values (
    v_order, null, 'Unknown staff', 'Imported without read_users', 'shopify', now()
  );

  -- Append-only enforcement
  begin
    update public.order_events set message = 'mutated' where id = v_event;
    raise exception 'order_events UPDATE should have been blocked';
  exception
    when others then
      if sqlerrm not like '%append-only%' then
        raise;
      end if;
  end;

  begin
    delete from public.order_events where id = v_event;
    raise exception 'order_events DELETE should have been blocked';
  exception
    when others then
      if sqlerrm not like '%append-only%' then
        raise;
      end if;
  end;

  -- Cleanup verification rows (events cannot delete — leave orphaned verify order or cancel cleanup)
  -- Soft cleanup of mutable entities; leave append-only event row attached to verify order.
  delete from public.entity_tags where entity_id = v_order;
  delete from public.metafields where owner_id in (v_order, v_customer);
  delete from public.external_system_refs where entity_id = v_order;
  delete from public.order_comments where order_id = v_order;
  delete from public.order_items where order_id = v_order;
  -- Cannot delete order while events exist due to append-only + FK. Keep verify order as cancelled.
  update public.orders set status = 'cancelled', note = 'foundation verification artifact' where id = v_order;
  delete from public.company_contacts where id = v_contact;
  delete from public.company_locations where id in (v_loc1, v_loc2);
  delete from public.companies where id = v_company;
  delete from public.entity_assignments where entity_id = v_customer;
  delete from public.customers where id = v_customer;
  delete from public.staff_members where id in (v_staff, v_staff2);

  raise notice 'UD commerce foundation verification passed (order % retained with append-only events)', v_order;
end;
$$;
