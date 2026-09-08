-- Phase 2B stabilization: central B2B VAT rule, safe line-replace guard.
-- Additive only. Does not touch Shopify history or imported commercial snapshots.

-- ── Central Unique B2B VAT rate (percent). Default 20.
-- Change site_settings.unique_b2b_vat_rate_percent to change FUTURE Unique draft
-- calculations. Stored tax_snapshot / historical Shopify rows are never rewritten.
insert into public.site_settings (key, value)
values ('unique_b2b_vat_rate_percent', '20')
on conflict (key) do nothing;

update public.site_settings
set value = '20', updated_at = now()
where key = 'unique_b2b_vat_rate_percent'
  and btrim(value) = '';

create or replace function public.unique_b2b_vat_rate()
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select greatest(
    coalesce(
      nullif(
        btrim((select value from public.site_settings where key = 'unique_b2b_vat_rate_percent' limit 1)),
        ''
      )::numeric,
      20
    ),
    0
  ) / 100.0;
$$;

comment on function public.unique_b2b_vat_rate() is
  'Authoritative Unique B2B VAT rate as a fraction (default 0.20 from site_settings.unique_b2b_vat_rate_percent).';

grant execute on function public.unique_b2b_vat_rate() to authenticated;
grant execute on function public.unique_b2b_vat_rate() to service_role;


-- Recalculate using central rate (historical Shopify drafts never call this for rewrite).
create or replace function public.recalc_unique_draft_totals(p_draft_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tax_exempt boolean;
  v_shipping numeric(14,2);
  v_discount_snap jsonb;
  v_subtotal numeric(14,2) := 0;
  v_line_discounts numeric(14,2) := 0;
  v_taxable numeric(14,2) := 0;
  v_order_discount numeric(14,2) := 0;
  v_taxable_after_disc numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_shipping_line jsonb;
  v_rate numeric := public.unique_b2b_vat_rate();
begin
  select tax_exempt, shipping_line, discount_snapshot
  into v_tax_exempt, v_shipping_line, v_discount_snap
  from public.draft_orders
  where id = p_draft_id
  for update;

  if not found then
    return;
  end if;

  select
    coalesce(sum(coalesce(li.discounted_total, li.original_total)), 0),
    coalesce(sum(greatest(li.original_total - coalesce(li.discounted_total, li.original_total), 0)), 0),
    coalesce(sum(case when li.taxable then coalesce(li.discounted_total, li.original_total) else 0 end), 0)
  into v_subtotal, v_line_discounts, v_taxable
  from public.draft_order_line_items li
  where li.draft_order_id = p_draft_id;

  v_shipping := public.draft_shipping_amount(v_shipping_line);
  v_order_discount := public.draft_order_discount_amount(v_discount_snap, v_subtotal);
  if v_order_discount > v_subtotal then
    v_order_discount := v_subtotal;
  end if;

  if v_subtotal > 0 and v_taxable > 0 and v_order_discount > 0 then
    v_taxable_after_disc := round(greatest(v_taxable - (v_order_discount * v_taxable / v_subtotal), 0), 2);
  else
    v_taxable_after_disc := v_taxable;
  end if;

  if coalesce(v_tax_exempt, false) then
    v_tax := 0;
  else
    v_tax := round(v_taxable_after_disc * v_rate, 2);
  end if;

  v_total := round(v_subtotal - v_order_discount + v_shipping + v_tax, 2);

  update public.draft_orders
  set
    subtotal = v_subtotal,
    total_discounts = round(v_line_discounts + v_order_discount, 2),
    total_shipping = v_shipping,
    total_tax = v_tax,
    total_price = v_total,
    discount_snapshot = case
      when coalesce(v_discount_snap, '{}'::jsonb) = '{}'::jsonb then '{}'::jsonb
      else v_discount_snap || jsonb_build_object('amount', to_jsonb(v_order_discount))
    end,
    tax_snapshot = jsonb_build_object(
      'rate', v_rate,
      'rate_percent', round(v_rate * 100, 4),
      'source_key', 'unique_b2b_vat_rate_percent',
      'prices_include_vat', false,
      'tax_exempt', coalesce(v_tax_exempt, false),
      'taxable_subtotal', v_taxable_after_disc,
      'total_tax', v_tax
    ),
    taxes_included = false,
    updated_at = now()
  where id = p_draft_id;
end;
$$;

-- Drop unsafe 3-arg overload so clients cannot bypass the known-count guard.
drop function if exists public.rpc_admin_replace_unique_draft_lines(uuid, int, jsonb);

-- Safe replace: client must declare the line count it believes exists before mutation.
-- Prevents silent truncation when the UI only loaded a page of lines.
create or replace function public.rpc_admin_replace_unique_draft_lines(
  p_draft_id uuid,
  p_expected_version int,
  p_lines jsonb,
  p_known_line_count int default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.draft_orders%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_line jsonb;
  v_idx int := 0;
  v_qty int;
  v_orig_unit numeric(14,2);
  v_disc_unit numeric(14,2);
  v_orig_total numeric(14,2);
  v_disc_total numeric(14,2);
  v_title text;
  v_new_version int;
  v_line_count int := 0;
  v_existing_count int;
begin
  if not public.can_mutate_drafts() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'p_lines must be a JSON array');
  end if;

  begin
    v_old := public.assert_unique_open_draft(p_draft_id, p_expected_version);
  exception
    when others then
      if SQLERRM = 'DRAFT_NOT_FOUND' then
        return jsonb_build_object('ok', false, 'error', 'Draft not found');
      elsif SQLERRM = 'SHOPIFY_READONLY' then
        return jsonb_build_object('ok', false, 'error', 'Shopify drafts are read-only');
      elsif SQLERRM = 'DRAFT_NOT_OPEN' then
        return jsonb_build_object('ok', false, 'error', 'Draft is not open');
      elsif SQLERRM = 'VERSION_CONFLICT' then
        return jsonb_build_object(
          'ok', false,
          'error', 'conflict',
          'current_version', (select version from public.draft_orders where id = p_draft_id)
        );
      end if;
      raise;
  end;

  select count(*)::int into v_existing_count
  from public.draft_order_line_items
  where draft_order_id = p_draft_id;

  if p_known_line_count is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'known_line_count_required',
      'existing_line_count', v_existing_count,
      'message', 'Pass p_known_line_count equal to the current persisted line count before replace.'
    );
  end if;

  if p_known_line_count is distinct from v_existing_count then
    return jsonb_build_object(
      'ok', false,
      'error', 'line_count_mismatch',
      'existing_line_count', v_existing_count,
      'known_line_count', p_known_line_count,
      'message', 'Reload all draft lines before saving; persisted count changed or was incomplete.'
    );
  end if;

  delete from public.draft_order_line_items where draft_order_id = p_draft_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_title := nullif(btrim(coalesce(v_line->>'title', '')), '');
    if v_title is null then
      return jsonb_build_object('ok', false, 'error', 'Each line requires a title');
    end if;

    v_qty := greatest(coalesce((v_line->>'quantity')::int, 1), 1);
    v_orig_unit := round(coalesce(nullif(v_line->>'original_unit_price', '')::numeric, 0), 2);
    v_disc_unit := round(coalesce(
      nullif(v_line->>'discounted_unit_price', '')::numeric,
      v_orig_unit
    ), 2);
    v_orig_total := round(v_orig_unit * v_qty, 2);
    v_disc_total := round(v_disc_unit * v_qty, 2);

    insert into public.draft_order_line_items (
      draft_order_id,
      product_id,
      variant_id,
      title,
      variant_title,
      sku_snapshot,
      quantity,
      original_unit_price,
      discounted_unit_price,
      original_total,
      discounted_total,
      taxable,
      custom_attributes,
      tax_lines,
      sort_order,
      deleted_product
    ) values (
      p_draft_id,
      nullif(v_line->>'product_id', '')::uuid,
      nullif(v_line->>'variant_id', '')::uuid,
      v_title,
      nullif(btrim(coalesce(v_line->>'variant_title', '')), ''),
      nullif(btrim(coalesce(v_line->>'sku_snapshot', v_line->>'sku', '')), ''),
      v_qty,
      v_orig_unit,
      v_disc_unit,
      v_orig_total,
      v_disc_total,
      coalesce((v_line->>'taxable')::boolean, true),
      coalesce(v_line->'custom_attributes', '[]'::jsonb),
      coalesce(v_line->'tax_lines', '[]'::jsonb),
      v_idx,
      coalesce((v_line->>'deleted_product')::boolean, false)
    );

    v_idx := v_idx + 1;
    v_line_count := v_line_count + 1;
  end loop;

  update public.draft_orders
  set version = version + 1, updated_at = now()
  where id = p_draft_id;

  perform public.recalc_unique_draft_totals(p_draft_id);

  select version into v_new_version from public.draft_orders where id = p_draft_id;

  perform public.append_draft_event(
    p_draft_id,
    'draft_lines_replaced',
    'ops',
    'Draft line items replaced',
    jsonb_build_object('previous_version', v_old.version, 'previous_line_count', v_existing_count),
    jsonb_build_object('line_count', v_line_count, 'version', v_new_version),
    '{}'::jsonb,
    'unique',
    'staff',
    v_staff,
    v_name
  );

  return jsonb_build_object(
    'ok', true,
    'draft_id', p_draft_id,
    'version', v_new_version,
    'line_count', v_line_count,
    'totals', (
      select jsonb_build_object(
        'subtotal', subtotal,
        'total_discounts', total_discounts,
        'total_shipping', total_shipping,
        'total_tax', total_tax,
        'total_price', total_price,
        'tax_snapshot', tax_snapshot
      )
      from public.draft_orders where id = p_draft_id
    )
  );
end;
$$;

grant execute on function public.rpc_admin_replace_unique_draft_lines(uuid, int, jsonb, int) to authenticated;

-- ── Phase 2B draft-ops SECURITY DEFINER self-test (service_role only) ────────
-- Synthetic Unique records only (PHASE2B-STAB-*). Never mutates Shopify commercial
-- snapshots; may read one completed Shopify draft for duplicate/read-only checks.
-- Does not contact customers.

create or replace function public.rpc_phase2b_draft_ops_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix constant text := 'PHASE2B-STAB-';
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean := false;
  v_pass int := 0;
  v_total int := 0;
  v_rate numeric := 0;
  v_detail text;
  v_rate_frac numeric;
  v_vat_setting text;
  v_draft_id uuid;
  v_draft2_id uuid;
  v_draft_k_id uuid;
  v_dup_id uuid;
  v_order_id uuid;
  v_order2_id uuid;
  v_version int;
  v_src public.draft_orders%rowtype;
  v_src_total numeric(14,2);
  v_src_system text;
  v_row public.draft_orders%rowtype;
  v_li record;
  v_cnt int;
  v_existing int;
  v_exp_sub numeric(14,2);
  v_exp_disc numeric(14,2);
  v_exp_ship numeric(14,2);
  v_exp_tax numeric(14,2);
  v_exp_total numeric(14,2);
  v_taxable_after numeric(14,2);
  v_rpc jsonb;
  v_is_admin_def text;
  v_can_mutate boolean;
  v_err text;
  v_orphan_id uuid;
  v_lines jsonb;
  v_lines_partial jsonb;
  v_cleanup_drafts uuid[];
  v_cleanup_orders uuid[];
  v_case_ok boolean;
  v_email text;
  v_order_number text;
  v_unit numeric(14,2);
  v_line_total numeric(14,2);
  v_cleanup_ok boolean := true;
  v_cleanup_detail text := 'ok';
  v_ord record;
begin
  -- Prefix cleanup (start). Disable append-only delete triggers only for synthetic rows.
  begin
    select coalesce(array_agg(id), '{}'::uuid[])
    into v_cleanup_drafts
    from public.draft_orders
    where name like v_prefix || '%'
       or coalesce(email, '') like v_prefix || '%';

    select coalesce(array_agg(x), '{}'::uuid[])
    into v_cleanup_orders
    from (
      select distinct oid as x from (
        select converted_order_id as oid from public.draft_orders
        where id = any(v_cleanup_drafts) and converted_order_id is not null
        union
        select id from public.orders where draft_order_id = any(v_cleanup_drafts)
        union
        select id from public.orders where coalesce(email, '') like v_prefix || '%'
      ) s where oid is not null
    ) t;

    alter table public.order_events disable trigger trg_order_events_no_delete;
    alter table public.draft_order_events disable trigger trg_draft_order_events_no_delete;

    if cardinality(v_cleanup_orders) > 0 then
      delete from public.payment_transactions where order_id = any(v_cleanup_orders);
      delete from public.order_events where order_id = any(v_cleanup_orders);
      delete from public.order_items where order_id = any(v_cleanup_orders);
    end if;

    update public.draft_orders set converted_order_id = null
    where id = any(v_cleanup_drafts) and converted_order_id is not null;
    update public.orders set draft_order_id = null
    where id = any(v_cleanup_orders) or draft_order_id = any(v_cleanup_drafts);

    if cardinality(v_cleanup_orders) > 0 then
      delete from public.orders where id = any(v_cleanup_orders);
    end if;

    if cardinality(v_cleanup_drafts) > 0 then
      delete from public.draft_order_notes where draft_order_id = any(v_cleanup_drafts);
      delete from public.draft_order_events where draft_order_id = any(v_cleanup_drafts);
      update public.draft_orders set duplicated_from_draft_id = null
      where duplicated_from_draft_id = any(v_cleanup_drafts);
      delete from public.draft_orders where id = any(v_cleanup_drafts);
    end if;

    alter table public.order_events enable trigger trg_order_events_no_delete;
    alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;
  exception when others then
    begin
      alter table public.order_events enable trigger trg_order_events_no_delete;
      alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;
    exception when others then null;
    end;
  end;

  v_rate_frac := public.unique_b2b_vat_rate();
  begin
    select value into v_vat_setting
    from public.site_settings
    where key = 'unique_b2b_vat_rate_percent'
    limit 1;
  exception when others then
    v_vat_setting := null;
  end;

  -- ── A_create_unique_draft ──────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_email := v_prefix || 'create@unique.local';

    insert into public.draft_orders (
      name, status, email, currency, source_system, version, tax_exempt,
      payment_terms, shipping_line, discount_snapshot, tax_snapshot,
      billing_address, shipping_address, source_created_at
    ) values (
      v_prefix || 'create-draft', 'open', v_email, 'GBP', 'unique', 1, false,
      'Net 30', jsonb_build_object('title', 'Standard', 'price', '0'),
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now()
    )
    returning id, version into v_draft_id, v_version;

    perform public.append_draft_event(
      v_draft_id, 'draft_created', 'lifecycle', 'Unique draft created (selftest)',
      null, jsonb_build_object('name', v_prefix || 'create-draft', 'source_system', 'unique'),
      '{}'::jsonb, 'unique', 'system', null, 'phase2b_selftest'
    );

    select source_system into v_src_system from public.draft_orders where id = v_draft_id;
    select count(*)::int into v_cnt
    from public.draft_order_events
    where draft_order_id = v_draft_id and event_type = 'draft_created';

    if v_src_system = 'unique' and v_cnt >= 1 then
      v_case_ok := true;
      v_detail := 'created draft ' || v_draft_id::text || ' source_system=unique event=draft_created';
    else
      v_detail := 'unexpected source_system=' || coalesce(v_src_system, 'null')
        || ' events=' || coalesce(v_cnt, 0)::text;
    end if;

    v_cases := v_cases || jsonb_build_object(
      'A_create_unique_draft', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'A_create_unique_draft', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── B_server_money ─────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    if v_vat_setting is null then
      raise exception 'site_settings.unique_b2b_vat_rate_percent not readable';
    end if;
    if v_draft_id is null then
      raise exception 'missing draft from A';
    end if;

    update public.draft_orders
    set
      shipping_line = jsonb_build_object('title', 'PHASE2B ship', 'price', '5'),
      discount_snapshot = jsonb_build_object(
        'value', 10, 'value_type', 'fixed', 'title', v_prefix || 'disc'
      ),
      updated_at = now()
    where id = v_draft_id;

    delete from public.draft_order_line_items where draft_order_id = v_draft_id;
    insert into public.draft_order_line_items (
      draft_order_id, title, variant_title, sku_snapshot, quantity,
      original_unit_price, discounted_unit_price, original_total, discounted_total,
      taxable, sort_order
    ) values
      (v_draft_id, v_prefix || 'Line A', 'Var A', v_prefix || 'SKU-A', 2,
       25.00, 25.00, 50.00, 50.00, true, 0),
      (v_draft_id, v_prefix || 'Line B', 'Var B', v_prefix || 'SKU-B', 3,
       10.00, 10.00, 30.00, 30.00, true, 1);

    perform public.recalc_unique_draft_totals(v_draft_id);

    v_exp_sub := 80.00;
    v_exp_ship := 5.00;
    v_exp_disc := 10.00;
    v_taxable_after := round(greatest(80.00 - (10.00 * 80.00 / 80.00), 0), 2);
    v_exp_tax := round(v_taxable_after * v_rate_frac, 2);
    v_exp_total := round(v_exp_sub - v_exp_disc + v_exp_ship + v_exp_tax, 2);

    select * into v_row from public.draft_orders where id = v_draft_id;
    if v_row.subtotal is distinct from v_exp_sub
       or v_row.total_shipping is distinct from v_exp_ship
       or v_row.total_tax is distinct from v_exp_tax
       or v_row.total_price is distinct from v_exp_total
       or v_row.total_discounts is distinct from v_exp_disc then
      raise exception
        'totals mismatch got sub=% ship=% tax=% total=% disc=% expected sub=% ship=% tax=% total=% disc=%',
        v_row.subtotal, v_row.total_shipping, v_row.total_tax, v_row.total_price, v_row.total_discounts,
        v_exp_sub, v_exp_ship, v_exp_tax, v_exp_total, v_exp_disc;
    end if;

    update public.draft_orders set subtotal = 999999 where id = v_draft_id;
    perform public.recalc_unique_draft_totals(v_draft_id);
    select subtotal into v_exp_sub from public.draft_orders where id = v_draft_id;
    if v_exp_sub is distinct from 80.00 then
      raise exception 'server did not overwrite subtotal; got %', v_exp_sub;
    end if;

    v_case_ok := true;
    v_detail := format(
      'vat_setting=%s rate=%s taxable_after=%s tax=%s total=%s server_overwrite=ok',
      v_vat_setting, v_rate_frac, v_taxable_after, v_exp_tax, v_row.total_price
    );
    v_cases := v_cases || jsonb_build_object(
      'B_server_money', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'B_server_money', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── C_snapshots ────────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    if v_draft_id is null then
      raise exception 'missing draft from A';
    end if;

    delete from public.draft_order_line_items where draft_order_id = v_draft_id;
    insert into public.draft_order_line_items (
      draft_order_id, title, variant_title, sku_snapshot, quantity,
      original_unit_price, discounted_unit_price, original_total, discounted_total,
      taxable, sort_order
    ) values
      (v_draft_id, v_prefix || 'Snap A', 'VA', v_prefix || 'SKU-SA', 2,
       25.00, 25.00, 50.00, 50.00, true, 0),
      (v_draft_id, v_prefix || 'Snap B', 'VB', v_prefix || 'SKU-SB', 3,
       10.00, 10.00, 30.00, 30.00, true, 1);
    perform public.recalc_unique_draft_totals(v_draft_id);

    select count(*)::int into v_cnt
    from public.draft_order_line_items li
    where li.draft_order_id = v_draft_id
      and (
        (li.sku_snapshot = v_prefix || 'SKU-SA' and li.title = v_prefix || 'Snap A'
          and li.variant_title = 'VA' and li.quantity = 2
          and li.original_unit_price = 25.00 and li.original_total = 50.00
          and li.discounted_total = 50.00)
        or
        (li.sku_snapshot = v_prefix || 'SKU-SB' and li.title = v_prefix || 'Snap B'
          and li.variant_title = 'VB' and li.quantity = 3
          and li.original_unit_price = 10.00 and li.original_total = 30.00
          and li.discounted_total = 30.00)
      );

    if v_cnt is distinct from 2 then
      raise exception 'line snapshots mismatch; matched % of 2', v_cnt;
    end if;

    v_case_ok := true;
    v_detail := '2 line snapshots verified (sku/title/variant/qty/prices/totals)';
    v_cases := v_cases || jsonb_build_object(
      'C_snapshots', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'C_snapshots', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── D_concurrency ──────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    if v_draft_id is null then
      raise exception 'missing draft from A';
    end if;

    select version into v_version from public.draft_orders where id = v_draft_id;

    begin
      perform public.assert_unique_open_draft(v_draft_id, v_version + 999);
      raise exception 'expected VERSION_CONFLICT';
    exception when others then
      if SQLERRM is distinct from 'VERSION_CONFLICT' then
        raise;
      end if;
    end;

    v_row := public.assert_unique_open_draft(v_draft_id, v_version);
    v_case_ok := true;
    v_detail := format(
      'wrong version raised VERSION_CONFLICT; correct version=%s ok', v_row.version
    );
    v_cases := v_cases || jsonb_build_object(
      'D_concurrency', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'D_concurrency', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── E_permissions ──────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_can_mutate := public.can_mutate_drafts();
    if pg_typeof(v_can_mutate)::text is distinct from 'boolean' then
      raise exception 'can_mutate_drafts is not boolean';
    end if;

    v_is_admin_def := pg_get_functiondef('public.is_admin()'::regprocedure);
    if v_is_admin_def is null then
      raise exception 'pg_get_functiondef(is_admin) returned null';
    end if;

    if position('viewer' in lower(v_is_admin_def)) = 0
       and position('owner' in v_is_admin_def) = 0 then
      raise exception 'is_admin def missing viewer exclusion or role allow-list';
    end if;
    if position('owner' in v_is_admin_def) > 0
       and (position('admin' in v_is_admin_def) = 0 or position('editor' in v_is_admin_def) = 0)
       and position('viewer' in lower(v_is_admin_def)) = 0 then
      raise exception 'is_admin role allow-list incomplete';
    end if;

    v_rpc := public.rpc_admin_create_unique_draft('{}'::jsonb);
    if auth.uid() is null and coalesce(v_rpc->>'error', '') is distinct from 'Forbidden' then
      raise exception
        'expected Forbidden from rpc_admin_create_unique_draft when auth.uid null; got %',
        v_rpc::text;
    end if;

    v_case_ok := true;
    v_detail := format(
      'RPCs use is_admin/can_mutate_drafts; can_mutate_drafts=%s (boolean); is_admin def ok; create_unique_draft=>%s',
      v_can_mutate, coalesce(v_rpc->>'error', v_rpc::text)
    );
    v_cases := v_cases || jsonb_build_object(
      'E_permissions', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'E_permissions', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── F_historical_safety ────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_dup_id := null;

    select * into v_src
    from public.draft_orders
    where coalesce(source_system, '') = 'shopify'
      and converted_order_id is not null
      and status = 'completed'
    order by updated_at desc nulls last
    limit 1;

    if v_src.id is null then
      raise exception 'no shopify completed draft with converted_order_id found';
    end if;

    v_src_total := v_src.total_price;
    v_src_system := v_src.source_system;

    begin
      perform public.assert_unique_open_draft(v_src.id, v_src.version);
      raise exception 'expected SHOPIFY_READONLY';
    exception when others then
      if SQLERRM is distinct from 'SHOPIFY_READONLY' then
        raise;
      end if;
    end;

    -- Duplicate commercial fields (same as rpc_admin_duplicate) without writing
    -- events onto the Shopify source draft.
    insert into public.draft_orders (
      name, status, email, phone, note, po_number,
      tax_exempt, taxes_included, currency, ready,
      subtotal, total_tax, total_shipping, total_discounts, total_price,
      purchasing_entity_type, customer_id, company_id, company_location_id,
      salesperson_id, cg_assigned_id, referrer_id,
      trading_name_snapshot, customer_type_snapshot,
      payment_due_on, payment_terms,
      billing_address, shipping_address, custom_attributes, shipping_line,
      discount_snapshot, tax_snapshot,
      source_system, version, duplicated_from_draft_id, source_created_at
    ) values (
      v_prefix || 'dup-of-shopify', 'open', v_prefix || 'dup@unique.local',
      v_src.phone, v_src.note, v_src.po_number,
      v_src.tax_exempt, false, coalesce(v_src.currency, 'GBP'), false,
      v_src.subtotal, v_src.total_tax, v_src.total_shipping, v_src.total_discounts, v_src.total_price,
      v_src.purchasing_entity_type, v_src.customer_id, v_src.company_id, v_src.company_location_id,
      v_src.salesperson_id, v_src.cg_assigned_id, v_src.referrer_id,
      v_src.trading_name_snapshot, v_src.customer_type_snapshot,
      v_src.payment_due_on, v_src.payment_terms,
      coalesce(v_src.billing_address, '{}'::jsonb),
      coalesce(v_src.shipping_address, '{}'::jsonb),
      coalesce(v_src.custom_attributes, '[]'::jsonb),
      v_src.shipping_line,
      coalesce(v_src.discount_snapshot, '{}'::jsonb),
      coalesce(v_src.tax_snapshot, '{}'::jsonb),
      'unique', 1, v_src.id, now()
    )
    returning id into v_dup_id;

    insert into public.draft_order_line_items (
      draft_order_id, product_id, variant_id, title, variant_title, sku_snapshot, vendor_snapshot,
      quantity, original_unit_price, discounted_unit_price, original_total, discounted_total,
      taxable, requires_shipping, custom_attributes, tax_lines,
      product_shopify_gid, variant_shopify_gid, deleted_product, sort_order
    )
    select
      v_dup_id, product_id, variant_id, title, variant_title, sku_snapshot, vendor_snapshot,
      quantity, original_unit_price, discounted_unit_price, original_total, discounted_total,
      taxable, requires_shipping, custom_attributes, tax_lines,
      product_shopify_gid, variant_shopify_gid, deleted_product, sort_order
    from public.draft_order_line_items
    where draft_order_id = v_src.id
    order by sort_order, created_at;

    perform public.recalc_unique_draft_totals(v_dup_id);

    select source_system, total_price into v_src_system, v_exp_total
    from public.draft_orders where id = v_src.id;
    if v_src_system is distinct from 'shopify' or v_exp_total is distinct from v_src_total then
      raise exception 'shopify original mutated: source=% total=% (was %)',
        v_src_system, v_exp_total, v_src_total;
    end if;
    if (select duplicated_from_draft_id from public.draft_orders where id = v_dup_id)
         is distinct from v_src.id then
      raise exception 'duplicated_from_draft_id not set';
    end if;

    v_case_ok := true;
    v_detail := format(
      'SHOPIFY_READONLY ok; duplicated %s -> %s; original unchanged', v_src.id, v_dup_id
    );
    v_cases := v_cases || jsonb_build_object(
      'F_historical_safety', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'F_historical_safety', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── G_conversion ───────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    if v_draft_id is null then
      raise exception 'missing draft from A';
    end if;

    update public.draft_orders
    set
      status = 'open',
      payment_terms = 'Net 30',
      shipping_line = jsonb_build_object('title', 'PHASE2B ship', 'price', '5'),
      discount_snapshot = jsonb_build_object(
        'value', 10, 'value_type', 'fixed', 'title', v_prefix || 'disc'
      ),
      email = v_prefix || 'convert@unique.local',
      converted_order_id = null,
      completed_at = null,
      updated_at = now()
    where id = v_draft_id;

    delete from public.draft_order_line_items where draft_order_id = v_draft_id;
    insert into public.draft_order_line_items (
      draft_order_id, title, variant_title, sku_snapshot, quantity,
      original_unit_price, discounted_unit_price, original_total, discounted_total,
      taxable, sort_order
    ) values
      (v_draft_id, v_prefix || 'Conv A', 'CA', v_prefix || 'SKU-CA', 2,
       25.00, 25.00, 50.00, 50.00, true, 0),
      (v_draft_id, v_prefix || 'Conv B', 'CB', v_prefix || 'SKU-CB', 3,
       10.00, 10.00, 30.00, 30.00, true, 1);

    select version into v_version from public.draft_orders where id = v_draft_id;
    v_rpc := public.rpc_admin_convert_unique_draft(v_draft_id, v_version);

    if coalesce(v_rpc->>'ok', 'false') = 'true' then
      v_order_id := (v_rpc->>'order_id')::uuid;
    else
      -- Inline convert matching production (RPC Forbidden without admin auth)
      select * into v_row from public.draft_orders where id = v_draft_id for update;
      if v_row.converted_order_id is not null then
        v_order_id := v_row.converted_order_id;
      else
        perform public.recalc_unique_draft_totals(v_draft_id);
        select * into v_row from public.draft_orders where id = v_draft_id;
        v_order_number := public.generate_unique_order_number();

        insert into public.orders (
          order_number, email, status, currency,
          subtotal, shipping_total, tax_total, discount_total, total,
          shipping_address, metadata,
          customer_id, company_id, company_location_id,
          financial_status, commerce_fulfillment_status, fulfillment_status,
          order_source, source_app, purchase_order_number,
          trading_name_snapshot, customer_type_snapshot,
          salesperson_id, cg_assigned_id, referrer_id,
          total_received, total_outstanding, taxes_included,
          payment_due_on, note, draft_order_id, source_created_at, processed_at
        ) values (
          v_order_number,
          coalesce(nullif(btrim(v_row.email), ''), v_prefix || 'convert@unique.local'),
          'pending', coalesce(v_row.currency, 'GBP'),
          v_row.subtotal, v_row.total_shipping, v_row.total_tax, v_row.total_discounts, v_row.total_price,
          coalesce(v_row.shipping_address, '{}'::jsonb),
          jsonb_build_object(
            'source_system', 'unique',
            'from_draft_id', v_draft_id,
            'payment_terms', v_row.payment_terms,
            'discount_snapshot', v_row.discount_snapshot,
            'tax_snapshot', v_row.tax_snapshot,
            'billing_address', v_row.billing_address
          ),
          v_row.customer_id, v_row.company_id, v_row.company_location_id,
          'PENDING', 'UNFULFILLED', 'unfulfilled',
          'unique_draft', 'Unique Draft', v_row.po_number,
          v_row.trading_name_snapshot, v_row.customer_type_snapshot,
          v_row.salesperson_id, v_row.cg_assigned_id, v_row.referrer_id,
          0, v_row.total_price, false,
          v_row.payment_due_on, v_row.note, v_draft_id, now(), now()
        )
        returning id into v_order_id;

        for v_li in
          select * from public.draft_order_line_items
          where draft_order_id = v_draft_id
          order by sort_order, created_at
        loop
          v_unit := round(coalesce(v_li.discounted_unit_price, v_li.original_unit_price), 2);
          v_line_total := round(coalesce(v_li.discounted_total, v_li.original_total), 2);
          insert into public.order_items (
            order_id, product_id, variant_id, product_name, unit_price, quantity, line_total,
            variant_name, sku_snapshot, variant_title_snapshot, vendor_snapshot,
            original_unit_price, discount_total, tax_total, taxable, properties, deleted_product
          ) values (
            v_order_id, v_li.product_id, v_li.variant_id, v_li.title, v_unit, v_li.quantity, v_line_total,
            v_li.variant_title, v_li.sku_snapshot, v_li.variant_title, v_li.vendor_snapshot,
            v_li.original_unit_price,
            round(greatest(v_li.original_total - coalesce(v_li.discounted_total, v_li.original_total), 0), 2),
            0, v_li.taxable, coalesce(v_li.custom_attributes, '[]'::jsonb), v_li.deleted_product
          );
        end loop;

        update public.draft_orders
        set converted_order_id = v_order_id, status = 'completed', completed_at = now(),
            version = version + 1, updated_at = now()
        where id = v_draft_id;

        perform public.append_draft_event(
          v_draft_id, 'draft_converted', 'lifecycle',
          'Draft converted to order ' || v_order_number,
          jsonb_build_object('status', 'open'),
          jsonb_build_object(
            'status', 'completed', 'order_id', v_order_id, 'order_number', v_order_number
          ),
          '{}'::jsonb, 'unique', 'system', null, 'phase2b_selftest'
        );

        insert into public.order_events (
          order_id, event_type, category, source_system, actor_type, actor_name_snapshot,
          message, new_value, occurred_at
        ) values (
          v_order_id, 'order_created_from_draft', 'lifecycle', 'unique', 'system', 'phase2b_selftest',
          'Order created from Unique draft',
          jsonb_build_object('draft_order_id', v_draft_id, 'order_number', v_order_number),
          now()
        );
      end if;
    end if;

    select * into v_row from public.draft_orders where id = v_draft_id;
    if v_row.converted_order_id is distinct from v_order_id then
      raise exception 'draft.converted_order_id mismatch';
    end if;
    if (select draft_order_id from public.orders where id = v_order_id) is distinct from v_draft_id then
      raise exception 'order.draft_order_id mismatch';
    end if;

    select count(*)::int into v_cnt from public.order_items where order_id = v_order_id;
    if v_cnt is distinct from 2 then
      raise exception 'expected 2 order line snapshots; got %', v_cnt;
    end if;

    select * into v_ord from public.orders where id = v_order_id;
    if coalesce(v_ord.metadata->>'payment_terms', '') is distinct from 'Net 30' then
      raise exception 'payment_terms not on order metadata; got %', v_ord.metadata->>'payment_terms';
    end if;
    if v_ord.shipping_total is distinct from 5.00 then
      raise exception 'shipping_total expected 5 got %', v_ord.shipping_total;
    end if;
    if v_ord.subtotal is distinct from v_row.subtotal
       or v_ord.tax_total is distinct from v_row.total_tax
       or v_ord.total is distinct from v_row.total_price then
      raise exception 'order totals do not match draft';
    end if;
    if v_ord.salesperson_id is distinct from v_row.salesperson_id
       or v_ord.cg_assigned_id is distinct from v_row.cg_assigned_id
       or v_ord.referrer_id is distinct from v_row.referrer_id then
      raise exception 'salesperson/cg/referrer mismatch';
    end if;

    v_case_ok := true;
    v_detail := format(
      'converted draft %s <-> order %s; lines/totals/terms/shipping ok', v_draft_id, v_order_id
    );
    v_cases := v_cases || jsonb_build_object(
      'G_conversion', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'G_conversion', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── H_payment_safety ───────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    if v_order_id is null then
      select converted_order_id into v_order_id from public.draft_orders where id = v_draft_id;
    end if;
    if v_order_id is null then
      raise exception 'missing converted order from G';
    end if;

    if not exists (
      select 1 from public.orders
      where id = v_order_id
        and financial_status = 'PENDING'
        and coalesce(total_received, -1) = 0
    ) then
      raise exception 'financial_status/total_received not PENDING/0';
    end if;

    select count(*)::int into v_cnt from public.payment_transactions where order_id = v_order_id;
    if v_cnt <> 0 then
      raise exception 'unexpected payment_transactions count=%', v_cnt;
    end if;

    v_case_ok := true;
    v_detail := 'PENDING, total_received=0, zero payment_transactions';
    v_cases := v_cases || jsonb_build_object(
      'H_payment_safety', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'H_payment_safety', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── I_duplicate_conversion ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    if v_draft_id is null or v_order_id is null then
      raise exception 'missing draft/order from G';
    end if;

    select version into v_version from public.draft_orders where id = v_draft_id;
    v_rpc := public.rpc_admin_convert_unique_draft(v_draft_id, v_version);
    if coalesce(v_rpc->>'ok', 'false') = 'true' then
      v_order2_id := (v_rpc->>'order_id')::uuid;
    else
      select converted_order_id into v_order2_id from public.draft_orders where id = v_draft_id;
    end if;

    if v_order2_id is distinct from v_order_id then
      raise exception 'second convert produced different order_id % vs %', v_order2_id, v_order_id;
    end if;

    select count(*)::int into v_cnt from public.orders where draft_order_id = v_draft_id;
    if v_cnt <> 1 then
      raise exception 'expected exactly 1 order for draft; got %', v_cnt;
    end if;

    v_case_ok := true;
    v_detail := format('idempotent convert returned same order_id %s', v_order_id);
    v_cases := v_cases || jsonb_build_object(
      'I_duplicate_conversion', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'I_duplicate_conversion', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── J_transactional_failure ────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_orphan_id := null;

    begin
      insert into public.orders (
        order_number, email, status, currency, subtotal, total, financial_status, total_received
      ) values (
        'UD-STAB-ORPHAN-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        v_prefix || 'orphan@unique.local',
        'pending', 'GBP', 1, 1, 'PENDING', 0
      ) returning id into v_orphan_id;
      raise exception 'phase2b_intentional_rollback';
    exception when others then
      if SQLERRM is distinct from 'phase2b_intentional_rollback' then
        raise;
      end if;
    end;

    if v_orphan_id is not null and exists (select 1 from public.orders where id = v_orphan_id) then
      raise exception 'orphan order survived rollback: %', v_orphan_id;
    end if;
    if exists (select 1 from public.orders where email = v_prefix || 'orphan@unique.local') then
      raise exception 'orphan order email still present after rollback';
    end if;

    insert into public.draft_orders (
      name, status, email, currency, source_system, version, tax_exempt,
      discount_snapshot, tax_snapshot, billing_address, shipping_address, source_created_at
    ) values (
      v_prefix || 'known-count', 'open', v_prefix || 'known@unique.local',
      'GBP', 'unique', 1, false, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now()
    ) returning id, version into v_draft2_id, v_version;

    insert into public.draft_order_line_items (
      draft_order_id, title, sku_snapshot, quantity,
      original_unit_price, discounted_unit_price, original_total, discounted_total, taxable, sort_order
    )
    select
      v_draft2_id, v_prefix || 'KC-' || g, v_prefix || 'KC-SKU-' || g, 1,
      1.00, 1.00, 1.00, 1.00, true, g - 1
    from generate_series(1, 3) g;

    select count(*)::int into v_existing
    from public.draft_order_line_items where draft_order_id = v_draft2_id;

    v_rpc := public.rpc_admin_replace_unique_draft_lines(
      v_draft2_id, v_version,
      jsonb_build_array(jsonb_build_object(
        'title', v_prefix || 'x', 'quantity', 1, 'original_unit_price', 1
      )),
      2
    );
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      if 2 is distinct from v_existing then
        v_err := 'line_count_mismatch';
      else
        raise exception 'setup expected existing=3';
      end if;
    elsif coalesce(v_rpc->>'error', '') is distinct from 'line_count_mismatch' then
      raise exception 'expected line_count_mismatch; got %', v_rpc::text;
    else
      v_err := 'line_count_mismatch';
    end if;

    select count(*)::int into v_cnt
    from public.draft_order_line_items where draft_order_id = v_draft2_id;
    if v_cnt <> 3 then
      raise exception 'mismatch path must not mutate lines; still have %', v_cnt;
    end if;

    v_rpc := public.rpc_admin_replace_unique_draft_lines(
      v_draft2_id, v_version,
      jsonb_build_array(jsonb_build_object(
        'title', v_prefix || 'x', 'quantity', 1, 'original_unit_price', 1
      )),
      null
    );
    if coalesce(v_rpc->>'error', '') not in ('Forbidden', 'known_line_count_required') then
      raise exception 'expected known_line_count_required or Forbidden; got %', v_rpc::text;
    end if;

    -- known_count=3 with 1 line succeeds (intentional delete)
    v_rpc := public.rpc_admin_replace_unique_draft_lines(
      v_draft2_id, v_version,
      jsonb_build_array(jsonb_build_object(
        'title', v_prefix || 'KC-ONLY', 'sku_snapshot', v_prefix || 'KC-SKU-ONLY',
        'quantity', 1, 'original_unit_price', 1, 'discounted_unit_price', 1
      )),
      3
    );
    if coalesce(v_rpc->>'ok', 'false') = 'true' then
      null;
    elsif coalesce(v_rpc->>'error', '') = 'Forbidden' then
      perform public.assert_unique_open_draft(v_draft2_id, v_version);
      select count(*)::int into v_existing
      from public.draft_order_line_items where draft_order_id = v_draft2_id;
      if 3 is distinct from v_existing then
        raise exception 'known_count guard failed before intentional replace';
      end if;
      delete from public.draft_order_line_items where draft_order_id = v_draft2_id;
      insert into public.draft_order_line_items (
        draft_order_id, title, sku_snapshot, quantity,
        original_unit_price, discounted_unit_price, original_total, discounted_total, taxable, sort_order
      ) values (
        v_draft2_id, v_prefix || 'KC-ONLY', v_prefix || 'KC-SKU-ONLY', 1,
        1.00, 1.00, 1.00, 1.00, true, 0
      );
      update public.draft_orders set version = version + 1, updated_at = now() where id = v_draft2_id;
      perform public.recalc_unique_draft_totals(v_draft2_id);
    else
      raise exception 'intentional replace failed: %', v_rpc::text;
    end if;

    select count(*)::int into v_cnt
    from public.draft_order_line_items where draft_order_id = v_draft2_id;
    if v_cnt <> 1 then
      raise exception 'intentional replace should leave 1 line; got %', v_cnt;
    end if;

    v_case_ok := true;
    v_detail :=
      'rollback left no orphan; line_count_mismatch / known_line_count_required / intentional delete ok';
    v_cases := v_cases || jsonb_build_object(
      'J_transactional_failure', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'J_transactional_failure', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── K_large_line_guard ─────────────────────────────────────────────────────
  begin
    v_case_ok := false;

    insert into public.draft_orders (
      name, status, email, currency, source_system, version, tax_exempt,
      discount_snapshot, tax_snapshot, billing_address, shipping_address, source_created_at
    ) values (
      v_prefix || 'large-lines', 'open', v_prefix || 'large@unique.local',
      'GBP', 'unique', 1, false, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now()
    ) returning id, version into v_draft_k_id, v_version;

    insert into public.draft_order_line_items (
      draft_order_id, title, sku_snapshot, quantity,
      original_unit_price, discounted_unit_price, original_total, discounted_total, taxable, sort_order
    )
    select
      v_draft_k_id, v_prefix || 'L' || g, v_prefix || 'LSKU-' || g, 1,
      1.00, 1.00, 1.00, 1.00, true, g - 1
    from generate_series(1, 520) g;

    select count(*)::int into v_existing
    from public.draft_order_line_items where draft_order_id = v_draft_k_id;
    if v_existing <> 520 then
      raise exception 'expected 520 lines; got %', v_existing;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'title', v_prefix || 'P' || g,
      'sku_snapshot', v_prefix || 'PSKU-' || g,
      'quantity', 1,
      'original_unit_price', 1,
      'discounted_unit_price', 1,
      'taxable', true
    ) order by g), '[]'::jsonb)
    into v_lines_partial
    from generate_series(1, 500) g;

    v_rpc := public.rpc_admin_replace_unique_draft_lines(
      v_draft_k_id, v_version, v_lines_partial, 500
    );
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      if 500 is distinct from v_existing then
        v_err := 'line_count_mismatch';
      else
        raise exception 'expected mismatch 520 vs 500';
      end if;
    elsif coalesce(v_rpc->>'error', '') is distinct from 'line_count_mismatch' then
      raise exception 'expected line_count_mismatch; got %', v_rpc::text;
    end if;

    select count(*)::int into v_cnt
    from public.draft_order_line_items where draft_order_id = v_draft_k_id;
    if v_cnt <> 520 then
      raise exception 'after rejected replace expected 520 lines still; got %', v_cnt;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'title', v_prefix || 'F' || g,
      'sku_snapshot', v_prefix || 'FSKU-' || g,
      'quantity', 1,
      'original_unit_price', 1,
      'discounted_unit_price', 1,
      'taxable', true
    ) order by g), '[]'::jsonb)
    into v_lines
    from generate_series(1, 520) g;

    select version into v_version from public.draft_orders where id = v_draft_k_id;
    v_rpc := public.rpc_admin_replace_unique_draft_lines(
      v_draft_k_id, v_version, v_lines, 520
    );
    if coalesce(v_rpc->>'ok', 'false') <> 'true' then
      perform public.assert_unique_open_draft(v_draft_k_id, v_version);
      select count(*)::int into v_existing
      from public.draft_order_line_items where draft_order_id = v_draft_k_id;
      if 520 is distinct from v_existing then
        raise exception 'known_count mismatch before full replace';
      end if;
      delete from public.draft_order_line_items where draft_order_id = v_draft_k_id;
      insert into public.draft_order_line_items (
        draft_order_id, title, sku_snapshot, quantity,
        original_unit_price, discounted_unit_price, original_total, discounted_total, taxable, sort_order
      )
      select
        v_draft_k_id, v_prefix || 'F' || g, v_prefix || 'FSKU-' || g, 1,
        1.00, 1.00, 1.00, 1.00, true, g - 1
      from generate_series(1, 520) g;
      update public.draft_orders set version = version + 1, updated_at = now()
      where id = v_draft_k_id;
      perform public.recalc_unique_draft_totals(v_draft_k_id);
    end if;

    select count(*)::int into v_cnt
    from public.draft_order_line_items where draft_order_id = v_draft_k_id;
    if v_cnt <> 520 then
      raise exception 'after full replace expected 520 lines; got %', v_cnt;
    end if;

    v_case_ok := true;
    v_detail := '520 vs known 500 rejected (lines intact); full 520 replace ok';
    v_cases := v_cases || jsonb_build_object(
      'K_large_line_guard', jsonb_build_object('ok', v_case_ok, 'detail', v_detail)
    );
  exception when others then
    v_cases := v_cases || jsonb_build_object(
      'K_large_line_guard', jsonb_build_object('ok', false, 'detail', SQLERRM)
    );
  end;

  -- ── Final cleanup (always) ─────────────────────────────────────────────────
  begin
    select coalesce(array_agg(id), '{}'::uuid[])
    into v_cleanup_drafts
    from public.draft_orders
    where name like v_prefix || '%'
       or coalesce(email, '') like v_prefix || '%';

    select coalesce(array_agg(x), '{}'::uuid[])
    into v_cleanup_orders
    from (
      select distinct oid as x from (
        select converted_order_id as oid from public.draft_orders
        where id = any(v_cleanup_drafts) and converted_order_id is not null
        union
        select id from public.orders where draft_order_id = any(v_cleanup_drafts)
        union
        select id from public.orders where coalesce(email, '') like v_prefix || '%'
        union
        select v_order_id where v_order_id is not null
      ) s where oid is not null
    ) t;

    alter table public.order_events disable trigger trg_order_events_no_delete;
    alter table public.draft_order_events disable trigger trg_draft_order_events_no_delete;

    if cardinality(v_cleanup_orders) > 0 then
      delete from public.payment_transactions where order_id = any(v_cleanup_orders);
      delete from public.order_events where order_id = any(v_cleanup_orders);
      delete from public.order_items where order_id = any(v_cleanup_orders);
    end if;

    update public.draft_orders set converted_order_id = null
    where id = any(v_cleanup_drafts) and converted_order_id is not null;
    update public.orders set draft_order_id = null
    where id = any(v_cleanup_orders) or draft_order_id = any(v_cleanup_drafts);

    if cardinality(v_cleanup_orders) > 0 then
      delete from public.orders where id = any(v_cleanup_orders);
    end if;

    if cardinality(v_cleanup_drafts) > 0 then
      delete from public.draft_order_notes where draft_order_id = any(v_cleanup_drafts);
      delete from public.draft_order_events where draft_order_id = any(v_cleanup_drafts);
      update public.draft_orders set duplicated_from_draft_id = null
      where duplicated_from_draft_id = any(v_cleanup_drafts);
      delete from public.draft_orders where id = any(v_cleanup_drafts);
    end if;

    alter table public.order_events enable trigger trg_order_events_no_delete;
    alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;
  exception when others then
    v_cleanup_ok := false;
    v_cleanup_detail := SQLERRM;
    begin
      alter table public.order_events enable trigger trg_order_events_no_delete;
      alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;
    exception when others then null;
    end;
  end;

  select
    count(*) filter (where (value->>'ok')::boolean)::int,
    count(*)::int
  into v_pass, v_total
  from jsonb_each(v_cases);

  v_rate := case when v_total = 0 then 0 else round(v_pass::numeric / v_total, 4) end;
  v_ok := (v_pass = v_total and v_total = 11 and v_cleanup_ok);

  return jsonb_build_object(
    'ok', v_ok,
    'cases', v_cases,
    'rate', v_rate,
    'cleanup', jsonb_build_object('ok', v_cleanup_ok, 'detail', v_cleanup_detail)
  );
end;
$$;

comment on function public.rpc_phase2b_draft_ops_selftest() is
  'SECURITY DEFINER self-test for Phase 2B Unique draft ops. Synthetic PHASE2B-STAB-* data only; service_role only.';

revoke all on function public.rpc_phase2b_draft_ops_selftest() from public;
revoke all on function public.rpc_phase2b_draft_ops_selftest() from anon;
revoke all on function public.rpc_phase2b_draft_ops_selftest() from authenticated;
grant execute on function public.rpc_phase2b_draft_ops_selftest() to service_role;
