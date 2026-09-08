-- Phase 4G — Pilot activation hardening & storefront price-gate
-- Does NOT flip commercial_access_mode to trade_required.
-- Does NOT mass-email. Does NOT apply ownership / PAY LATER / parked systems.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';

update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';

insert into public.site_settings (key, value)
values ('commercial_observability_enabled', 'true')
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Protected price field set + visibility helper
-- ═══════════════════════════════════════════════════════════════════════════
-- Protected monetary fields (trade_required): price, compare_at_price, unit_price,
-- line_total, subtotal, discount, tax, shipping, total, effective/discounted prices.
-- Non-protected: inventory, name, slug, images, descriptions, badges.

create or replace function public.storefront_can_view_protected_price(p_force_mode text default null)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_mode text;
  v_uid uuid := (select auth.uid());
  v_cu public.customers%rowtype;
  v_policy jsonb;
begin
  select coalesce(nullif(btrim(p_force_mode), ''), nullif(btrim(value), ''), 'catalogue_open')
  into v_mode
  from public.site_settings where key = 'commercial_access_mode' limit 1;
  if nullif(btrim(p_force_mode), '') is not null then
    v_mode := lower(btrim(p_force_mode));
  else
    select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_mode
    from public.site_settings where key = 'commercial_access_mode' limit 1;
    v_mode := coalesce(v_mode, 'catalogue_open');
  end if;

  if v_uid is not null then
    select * into v_cu from public.customers where auth_user_id = v_uid limit 1;
  end if;

  if found and v_cu.id is not null then
    v_policy := public.commercial_policy_evaluate(
      v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
      v_mode, true, v_cu.customer_type, v_cu.payment_terms
    );
  else
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
  end if;

  return coalesce((v_policy->>'can_view_price')::boolean, false);
end;
$$;

grant execute on function public.storefront_can_view_protected_price(text) to anon, authenticated, service_role;

create or replace function public.redact_protected_price_fields(p_data jsonb, p_can_view boolean)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_keys text[] := array[
    'price','compare_at_price','unit_price','line_total','subtotal','discount',
    'tax','shipping','total','discounted_unit_price','original_unit_price','line_price'
  ];
  v_key text;
  v_out jsonb := p_data;
  v_item jsonb;
  v_arr jsonb;
  v_i int;
begin
  if p_data is null or p_can_view then
    return p_data;
  end if;

  if jsonb_typeof(p_data) = 'array' then
    v_arr := '[]'::jsonb;
    for v_i in 0 .. coalesce(jsonb_array_length(p_data), 0) - 1 loop
      v_arr := v_arr || jsonb_build_array(
        public.redact_protected_price_fields(p_data->v_i, false)
      );
    end loop;
    return v_arr;
  end if;

  if jsonb_typeof(p_data) <> 'object' then
    return p_data;
  end if;

  foreach v_key in array v_keys loop
    if v_out ? v_key then
      v_out := jsonb_set(v_out, array[v_key], 'null'::jsonb);
    end if;
  end loop;

  -- Nested product/variants/items/components
  if v_out ? 'product' then
    v_out := jsonb_set(v_out, '{product}', public.redact_protected_price_fields(v_out->'product', false));
  end if;
  if v_out ? 'variants' then
    v_out := jsonb_set(v_out, '{variants}', public.redact_protected_price_fields(v_out->'variants', false));
  end if;
  if v_out ? 'items' then
    v_out := jsonb_set(v_out, '{items}', public.redact_protected_price_fields(v_out->'items', false));
  end if;
  if v_out ? 'components' then
    v_out := jsonb_set(v_out, '{components}', public.redact_protected_price_fields(v_out->'components', false));
  end if;

  v_out := v_out || jsonb_build_object('price_restricted', true, 'price_visibility', 'redacted');
  return v_out;
end;
$$;

grant execute on function public.redact_protected_price_fields(jsonb, boolean)
  to anon, authenticated, service_role;

comment on function public.redact_protected_price_fields(jsonb, boolean) is
  'Phase 4G: nulls protected trade monetary fields. Does not CSS-hide — removes from payload.';

-- Observability (no sensitive prices/tokens)
create table if not exists public.commercial_policy_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  reason_code text,
  auth_linked boolean,
  trade_access_status text,
  request_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commercial_policy_events_created_idx
  on public.commercial_policy_events (created_at desc);
create index if not exists commercial_policy_events_type_idx
  on public.commercial_policy_events (event_type, created_at desc);

alter table public.commercial_policy_events enable row level security;
drop policy if exists "admin_read_commercial_policy_events" on public.commercial_policy_events;
create policy "admin_read_commercial_policy_events" on public.commercial_policy_events
  for select to authenticated using (public.is_admin());
grant select on public.commercial_policy_events to authenticated;
grant insert, select on public.commercial_policy_events to service_role;

create or replace function public.commercial_observe(
  p_event_type text,
  p_reason_code text default null,
  p_request_type text default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on text;
  v_uid uuid := (select auth.uid());
  v_cu public.customers%rowtype;
begin
  select value into v_on from site_settings where key = 'commercial_observability_enabled' limit 1;
  if coalesce(v_on, 'false') <> 'true' then
    return;
  end if;
  if v_uid is not null then
    select * into v_cu from customers where auth_user_id = v_uid limit 1;
  end if;
  insert into public.commercial_policy_events (
    event_type, reason_code, auth_linked, trade_access_status, request_type, metadata
  ) values (
    p_event_type, p_reason_code, v_cu.auth_user_id is not null, v_cu.trade_access_status,
    p_request_type, coalesce(p_meta, '{}'::jsonb)
  );
exception when others then
  null;
end;
$$;

grant execute on function public.commercial_observe(text, text, text, jsonb)
  to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Activation FIXES: supersede pending, revoked, lifecycle, create gates
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.activation_lifecycle_status(
  p_auth_user_id uuid,
  p_activation_status text,
  p_expires_at timestamptz,
  p_email_sent_at timestamptz,
  p_has_conflict boolean default false
)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when p_has_conflict then 'CONFLICT'
    when p_auth_user_id is not null then 'ACTIVATED'
    when p_activation_status = 'revoked' then 'INVALIDATED'
    when p_activation_status = 'expired'
      or (p_activation_status = 'pending' and p_expires_at is not null and p_expires_at <= now()) then 'EXPIRED'
    when p_activation_status = 'pending' and p_email_sent_at is not null then 'DELIVERED'
    when p_activation_status = 'pending' then 'INVITED'
    when p_activation_status = 'failed' then 'FAILED'
    else 'NOT_INVITED'
  end;
$$;

grant execute on function public.activation_lifecycle_status(uuid, text, timestamptz, timestamptz, boolean)
  to authenticated, service_role;

create or replace function public.rpc_admin_create_customer_auth_activation(
  p_customer_id uuid,
  p_ttl_hours int default 72,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_raw text;
  v_hash text;
  v_id uuid;
  v_actor uuid;
  v_cu public.customers%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_manage_customer_auth_link() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.assert_sales_entity_access('customer', p_customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_cu from public.customers where id = p_customer_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;
  if v_cu.auth_user_id is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_LINKED');
  end if;
  if v_cu.trade_access_status in ('rejected', 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'CUSTOMER_NOT_ELIGIBLE', 'message', 'Suspended/rejected cannot be invited');
  end if;

  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  -- FIX: supersede prior pending invites (single active token)
  update public.customer_auth_activations set
    status = 'revoked',
    updated_at = now(),
    note = coalesce(note, '') || case when note is null or note = '' then '' else '; ' end || 'superseded'
  where customer_id = p_customer_id and status = 'pending';

  v_raw := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');

  insert into public.customer_auth_activations (
    customer_id, token_hash, expires_at, created_by, note, status
  ) values (
    p_customer_id, v_hash, now() + make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 72), 336))),
    v_actor, nullif(btrim(coalesce(p_note, '')), ''), 'pending'
  ) returning id into v_id;

  perform public.append_crm_event(
    'customer', p_customer_id, 'application_reviewed', 'commercial',
    'Auth activation invitation created',
    null, jsonb_build_object('activation_id', v_id, 'lifecycle', 'INVITED'),
    jsonb_build_object('event_alias', 'activation_generated', 'batch', null),
    'unique', 'admin', v_actor, null, now()
  );

  return jsonb_build_object(
    'ok', true,
    'activation_id', v_id,
    'token', v_raw,
    'expires_at', (select expires_at from customer_auth_activations where id = v_id),
    'lifecycle', 'INVITED',
    'note', 'Deliver token out-of-band. Raw token never stored.'
  );
end;
$$;

grant execute on function public.rpc_admin_create_customer_auth_activation(uuid, int, text)
  to authenticated;

create or replace function public.rpc_admin_invalidate_activation(p_activation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.customer_auth_activations%rowtype;
  v_actor uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_manage_customer_auth_link() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_row from customer_auth_activations where id = p_activation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Not found');
  end if;
  if not public.assert_sales_entity_access('customer', v_row.customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  update public.customer_auth_activations set
    status = 'revoked',
    updated_at = now(),
    note = coalesce(note, '') || case when note is null or note = '' then '' else '; ' end || 'invalidated'
  where id = p_activation_id and status = 'pending';

  update public.customer_activation_batch_recipients set
    status = 'expired'
  where activation_id = p_activation_id and status in ('queued', 'sent');

  perform public.append_crm_event(
    'customer', v_row.customer_id, 'application_reviewed', 'commercial',
    'Auth activation invalidated',
    jsonb_build_object('activation_id', p_activation_id, 'status', v_row.status),
    jsonb_build_object('activation_id', p_activation_id, 'status', 'revoked', 'lifecycle', 'INVALIDATED'),
    jsonb_build_object('event_alias', 'activation_invalidated'),
    'unique', 'admin', v_actor, null, now()
  );

  return jsonb_build_object('ok', true, 'activation_id', p_activation_id, 'lifecycle', 'INVALIDATED');
end;
$$;

grant execute on function public.rpc_admin_invalidate_activation(uuid) to authenticated;

create or replace function public.rpc_admin_mark_activation_email_sent(p_activation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.customer_auth_activations%rowtype;
  v_actor uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_manage_customer_auth_link() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_row from customer_auth_activations where id = p_activation_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Not found');
  end if;
  if not public.assert_sales_entity_access('customer', v_row.customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  update public.customer_auth_activations set
    email_sent_at = now(),
    updated_at = now()
  where id = p_activation_id;

  update public.customer_activation_batch_recipients set
    status = 'sent',
    sent_at = now()
  where activation_id = p_activation_id;

  perform public.append_crm_event(
    'customer', v_row.customer_id, 'application_reviewed', 'commercial',
    'Activation email marked sent',
    null, jsonb_build_object('activation_id', p_activation_id, 'lifecycle', 'DELIVERED'),
    jsonb_build_object('event_alias', 'activation_sent'),
    'unique', 'admin', v_actor, null, now()
  );

  return jsonb_build_object('ok', true, 'activation_id', p_activation_id, 'lifecycle', 'DELIVERED');
end;
$$;

grant execute on function public.rpc_admin_mark_activation_email_sent(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Bind spoof harden + commercial policy can_add_to_cart
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.commercial_policy_evaluate(
  p_trade_access_status text,
  p_pay_later_eligible boolean,
  p_customer_status text,
  p_access_mode text,
  p_has_crm_customer boolean,
  p_customer_type text default null,
  p_payment_terms text default null
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_status text := coalesce(nullif(btrim(coalesce(p_trade_access_status, '')), ''), 'ineligible');
  v_mode text := coalesce(nullif(btrim(coalesce(p_access_mode, '')), ''), 'catalogue_open');
  v_approved boolean := (v_status = 'approved');
  v_blocked boolean := coalesce(p_customer_status, 'active') in ('blocked', 'inactive');
  v_pay_later boolean := coalesce(p_pay_later_eligible, false) and v_approved and not v_blocked;
  v_view_cat boolean;
  v_view_product boolean;
  v_view_price boolean;
  v_purchase boolean;
  v_checkout boolean;
  v_quote boolean;
  v_add_cart boolean;
begin
  if v_mode = 'trade_required' then
    v_view_cat := true;
    v_view_product := true;
    if v_approved and not v_blocked and p_has_crm_customer then
      v_view_price := true;
      v_purchase := true;
      v_checkout := true;
      v_quote := true;
      v_add_cart := true;
    else
      v_view_price := false;
      v_purchase := false;
      v_checkout := false;
      v_quote := true;
      -- Phase 4G: block add-to-cart for anon/non-approved (client cart embeds prices)
      v_add_cart := false;
    end if;
  else
    v_view_cat := true;
    v_view_product := true;
    v_view_price := true;
    v_add_cart := true;
    if p_has_crm_customer then
      v_purchase := v_approved and not v_blocked;
      v_checkout := v_purchase;
      v_quote := true;
    else
      v_purchase := not v_blocked;
      v_checkout := v_purchase;
      v_quote := true;
    end if;
  end if;

  return jsonb_build_object(
    'trade_access_status', v_status,
    'trade_eligible', v_approved and not v_blocked,
    'pay_later_eligible', v_pay_later,
    'customer_type', nullif(btrim(coalesce(p_customer_type, '')), ''),
    'payment_terms', nullif(btrim(coalesce(p_payment_terms, '')), ''),
    'credit_limit', null,
    'credit_limit_status', 'NO_SOURCE_EVIDENCE',
    'commercial_access_mode', v_mode,
    'price_mode', 'base',
    'price_list_id', null,
    'catalog_id', null,
    'can_view_catalogue', v_view_cat,
    'can_view_product', v_view_product,
    'can_view_price', v_view_price,
    'can_purchase', v_purchase,
    'can_checkout', v_checkout,
    'can_request_quote', v_quote,
    'can_use_pay_later', v_pay_later,
    'can_add_to_cart', v_add_cart,
    'auth_alone_insufficient', true,
    'customer_type_independent', true,
    'surecust_independent_of_customer_type', true,
    'precedence_note', 'UNIQUE_NATIVE > shopify_surecust > inference > unknown',
    'protected_price_fields', jsonb_build_array(
      'price','compare_at_price','unit_price','line_total','subtotal','discount','tax','shipping','total'
    )
  );
end;
$$;

grant execute on function public.commercial_policy_evaluate(text, boolean, text, text, boolean, text, text)
  to authenticated, service_role, anon;

-- Fix visibility helper FOUND handling
create or replace function public.storefront_can_view_protected_price(p_force_mode text default null)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_mode text;
  v_uid uuid := (select auth.uid());
  v_cu public.customers%rowtype;
  v_policy jsonb;
  v_has boolean := false;
begin
  if nullif(btrim(coalesce(p_force_mode, '')), '') is not null then
    v_mode := lower(btrim(p_force_mode));
  else
    select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_mode
    from public.site_settings where key = 'commercial_access_mode' limit 1;
    v_mode := coalesce(v_mode, 'catalogue_open');
  end if;

  if v_uid is not null then
    select * into v_cu from public.customers where auth_user_id = v_uid limit 1;
    v_has := found;
  end if;

  if v_has then
    v_policy := public.commercial_policy_evaluate(
      v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
      v_mode, true, v_cu.customer_type, v_cu.payment_terms
    );
  else
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
  end if;

  return coalesce((v_policy->>'can_view_price')::boolean, false);
end;
$$;
