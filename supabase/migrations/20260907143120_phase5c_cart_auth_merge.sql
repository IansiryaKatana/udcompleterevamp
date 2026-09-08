-- Phase 5C — persistent cart auth merge (Magefan parity gap)
-- Merges guest session cart into authenticated user cart; does not create a second cart system.

create or replace function public.rpc_merge_guest_cart_on_auth(p_session_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_guest_id uuid;
  v_guest_items jsonb;
  v_guest_email text;
  v_guest_coupon text;
  v_user_cart_id uuid;
  v_user_items jsonb;
  v_merged jsonb := '[]'::jsonb;
  v_guest_item jsonb;
  v_key text;
  v_existing_keys text[] := '{}';
  v_elem jsonb;
  v_qty numeric;
  v_new_qty numeric;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;
  if nullif(btrim(coalesce(p_session_id, '')), '') is null then
    return jsonb_build_object('ok', true, 'merged', false, 'reason', 'no_session');
  end if;

  select id, items, email, coupon_code
    into v_guest_id, v_guest_items, v_guest_email, v_guest_coupon
  from storefront_carts
  where session_id = p_session_id and user_id is null
  limit 1;

  if v_guest_id is null then
    return jsonb_build_object('ok', true, 'merged', false, 'reason', 'no_guest_cart');
  end if;

  select id, items into v_user_cart_id, v_user_items
  from storefront_carts
  where user_id = v_user
  limit 1;

  if v_user_cart_id is null then
    update storefront_carts
    set user_id = v_user, updated_at = now(), last_activity_at = now()
    where id = v_guest_id;
    return jsonb_build_object('ok', true, 'merged', true, 'mode', 'claim_guest', 'cart_id', v_guest_id);
  end if;

  v_merged := coalesce(v_user_items, '[]'::jsonb);

  for v_elem in select * from jsonb_array_elements(v_merged)
  loop
    v_existing_keys := array_append(
      v_existing_keys,
      coalesce(v_elem->>'sku', v_elem->>'variant_id', v_elem->>'product_id', '')
    );
  end loop;

  for v_guest_item in select * from jsonb_array_elements(coalesce(v_guest_items, '[]'::jsonb))
  loop
    v_key := coalesce(v_guest_item->>'sku', v_guest_item->>'variant_id', v_guest_item->>'product_id', '');
    v_qty := coalesce((v_guest_item->>'quantity')::numeric, (v_guest_item->>'qty')::numeric, 1);
    if v_key = '' or not (v_key = any (v_existing_keys)) then
      v_merged := v_merged || jsonb_build_array(v_guest_item);
      if v_key <> '' then
        v_existing_keys := array_append(v_existing_keys, v_key);
      end if;
    else
      select jsonb_agg(
        case
          when coalesce(e->>'sku', e->>'variant_id', e->>'product_id', '') = v_key then
            jsonb_set(
              e,
              '{quantity}',
              to_jsonb(
                coalesce((e->>'quantity')::numeric, (e->>'qty')::numeric, 0) + v_qty
              )
            )
          else e
        end
      )
      into v_merged
      from jsonb_array_elements(v_merged) e;
    end if;
  end loop;

  update storefront_carts set
    items = v_merged,
    session_id = coalesce(session_id, p_session_id),
    email = coalesce(email, v_guest_email),
    coupon_code = coalesce(coupon_code, v_guest_coupon),
    last_activity_at = now(),
    updated_at = now()
  where id = v_user_cart_id;

  delete from storefront_carts where id = v_guest_id;

  return jsonb_build_object('ok', true, 'merged', true, 'mode', 'merge_lines', 'cart_id', v_user_cart_id);
end;
$$;

revoke all on function public.rpc_merge_guest_cart_on_auth(text) from public;
grant execute on function public.rpc_merge_guest_cart_on_auth(text) to authenticated;

comment on function public.rpc_merge_guest_cart_on_auth(text) is
  'Phase 5C Magefan parity: merge guest session storefront_cart into authenticated user cart.';
