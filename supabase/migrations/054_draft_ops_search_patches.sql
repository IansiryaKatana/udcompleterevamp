-- Phase 2B patches applied after 053: payment_terms list filter + catalog barcode/SKU search.
-- Keep list return shape identical to 053; only widen filters/search.

create or replace function public.rpc_admin_search_catalog_variants(
  p_search text default null,
  p_limit int default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_items jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.product_name, x.name), '[]'::jsonb)
  into v_items
  from (
    select
      pv.id,
      pv.product_id,
      pv.name,
      pv.sku,
      coalesce(pv.price, p.price) as price,
      pv.inventory_count,
      p.name as product_name,
      p.slug as product_slug,
      coalesce(pv.image_url, p.image_url) as image_url,
      coalesce(p.specs->>'barcode', p.specs->>'Barcode', '') as barcode
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where coalesce(pv.is_active, true) = true
      and (
        v_q is null
        or pv.name ilike '%' || v_q || '%'
        or pv.sku ilike '%' || v_q || '%'
        or p.name ilike '%' || v_q || '%'
        or p.slug ilike '%' || v_q || '%'
        or p.sku ilike '%' || v_q || '%'
        or coalesce(p.specs->>'barcode', '') ilike '%' || v_q || '%'
        or coalesce(p.specs->>'Barcode', '') ilike '%' || v_q || '%'
      )
    order by p.name, pv.sort_order, pv.name
    limit v_lim
  ) x;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

grant execute on function public.rpc_admin_search_catalog_variants(text, int) to authenticated;
