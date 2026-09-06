-- Verification for Phase 3 fulfilment / delivery (manual run after migrations).

do $$
declare
  v_order uuid;
  v_item uuid;
  v_loc uuid;
  v_ful uuid;
  v_ev uuid;
begin
  select id into v_loc from public.inventory_locations where code = 'UD_WH_1' limit 1;
  if v_loc is null then
    raise exception 'UD_WH_1 location seed missing';
  end if;

  insert into public.orders (
    order_number, email, status, currency, subtotal, total,
    fulfillment_status, tracking_number, carrier, shipped_at,
    commerce_fulfillment_status, dpd_delivery_status
  ) values (
    'VERIFY-FUL-' || substr(gen_random_uuid()::text, 1, 8),
    'ful-verify@example.com',
    'paid',
    'GBP',
    50.00,
    60.00,
    'shipped',
    '1550TESTTRACK',
    'DPD',
    now(),
    'FULFILLED',
    'Delivered'
  )
  returning id into v_order;

  insert into public.order_items (order_id, product_name, unit_price, quantity, line_total, sku_snapshot)
  values (v_order, 'Fulfil Verify SKU', 50.00, 1, 50.00, 'FUL-SKU-1')
  returning id into v_item;

  insert into public.order_shipping_lines (order_id, title, code, original_price, currency, source_system)
  values (v_order, 'Standard Delivery', 'Standard Delivery', 0, 'GBP', 'verify');

  insert into public.fulfillments (
    order_id, inventory_location_id, status, display_status, service_name,
    tracking_company, tracking_number, tracking_url, tracking_info,
    carrier_status, source_system, external_gid
  ) values (
    v_order, v_loc, 'SUCCESS', 'FULFILLED', 'Manual',
    'DPD', '1550TESTTRACK', 'https://www.dpd.co.uk/',
    '[{"company":"DPD","number":"1550TESTTRACK"}]'::jsonb,
    'Delivered', 'verify', 'gid://shopify/Fulfillment/VERIFY'
  )
  returning id into v_ful;

  insert into public.fulfillment_line_items (
    fulfillment_id, order_item_id, quantity, sku_snapshot, name_snapshot
  ) values (v_ful, v_item, 1, 'FUL-SKU-1', 'Fulfil Verify SKU');

  update public.orders set primary_fulfillment_id = v_ful where id = v_order;

  insert into public.shipment_events (
    fulfillment_id, order_id, event_type, status, message, source_app, source_system, occurred_at
  ) values (
    v_ful, v_order, 'carrier_update', 'Delivered', 'DPD delivered', 'DPD Integration by WSA', 'verify', now()
  )
  returning id into v_ev;

  begin
    update public.shipment_events set message = 'mutated' where id = v_ev;
    raise exception 'shipment_events UPDATE should have been blocked';
  exception
    when others then
      if sqlerrm not like '%append-only%' then
        raise;
      end if;
  end;

  -- Cleanup mutable rows; cancel order (shipment_events RESTRICT deletes)
  delete from public.fulfillment_line_items where fulfillment_id = v_ful;
  update public.orders set primary_fulfillment_id = null where id = v_order;
  -- Cannot delete fulfillment while shipment_events reference it with cascade from fulfillment...
  -- events cascade from fulfillment_id ON DELETE CASCADE — but DELETE on events is blocked!
  -- So: cannot delete fulfillment if events exist. Leave cancelled order + fulfillment artifact.
  update public.orders
  set status = 'cancelled',
      note = 'phase3 verification artifact',
      fulfillment_status = 'unfulfilled'
  where id = v_order;

  raise notice 'Phase 3 fulfilment verification passed (order % / fulfillment % retained with append-only events)', v_order, v_ful;
end;
$$;
