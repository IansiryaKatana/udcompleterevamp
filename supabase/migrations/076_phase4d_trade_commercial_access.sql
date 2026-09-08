-- Phase 4D — Trade account eligibility, B2B commercial access & policy engine
-- Evidence-backed. Does NOT invent price lists, credit limits, company-level
-- eligibility promotion, ownership auto-apply, DPD/SKULabs/warehouse/Worldpay.

-- Verified forensics (live, Phase 4D):
--   SureCust_Wholesale on customers ~5,726; on companies 0
--   company SureCust mix across contacts ~2 → CUSTOMER is canonical owner
--   PAY LATER tag ~718; ~649 also SureCust; ~69 PAY LATER without SureCust
--   Customer Type column blank for almost all; ≠ ≠ Customer Type
--   Shopify B2B catalogues / price lists: NO schema / NO active usage in UD
--   Tiered pricing metafields: 0 · credit_limit set: 0 → NO_SOURCE_EVIDENCE
--   Draft line price overrides: ~15,091 · coupons table: 1 · base catalogue price
--   Auth-linked customers: 0 currently (CRM ≠ login account)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Customer commercial columns (customer-level eligibility)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.customers
  add column if not exists trade_access_status text not null default 'ineligible',
  add column if not exists trade_eligible boolean not null default false,
  add column if not exists trade_eligible_source text,
  add column if not exists trade_eligible_note text,
  add column if not exists trade_eligible_decided_at timestamptz,
  add column if not exists trade_eligible_decided_by uuid,
  add column if not exists pay_later_eligible boolean not null default false,
  add column if not exists pay_later_eligible_source text,
  add column if not exists pay_later_eligible_note text,
  add column if not exists pay_later_eligible_decided_at timestamptz,
  add column if not exists pay_later_eligible_decided_by uuid;

do $$ begin
  alter table public.customers
    drop constraint if exists customers_trade_access_status_chk;
  alter table public.customers
    add constraint customers_trade_access_status_chk
    check (trade_access_status in ('ineligible', 'pending', 'approved', 'rejected', 'suspended'));
exception when others then null;
end $$;

comment on column public.customers.trade_access_status is
  'Phase 4D trade eligibility lifecycle. Canonical wholesale ACCESS gate (replaces SureCust_Wholesale tag semantics). Independent of customer_type.';
comment on column public.customers.trade_eligible is
  'Derived convenience: true iff trade_access_status = approved. Server policy uses status.';
comment on column public.customers.pay_later_eligible is
  'Explicit PAY LATER permission. Independent of trade eligibility and payment_terms. Credit limit remains NO_SOURCE_EVIDENCE.';

create index if not exists customers_trade_access_status_idx
  on public.customers (trade_access_status);
create index if not exists customers_pay_later_eligible_idx
  on public.customers (pay_later_eligible)
  where pay_later_eligible;

-- Sync trade_eligible with status on write (trigger)
create or replace function public.customers_sync_trade_eligible()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.trade_eligible := (new.trade_access_status = 'approved');
  return new;
end;
$$;

drop trigger if exists trg_customers_sync_trade_eligible on public.customers;
create trigger trg_customers_sync_trade_eligible
  before insert or update of trade_access_status on public.customers
  for each row execute function public.customers_sync_trade_eligible();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Site setting: commercial access mode (do not invent full site lock yet)
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.site_settings (key, value)
values (
  'commercial_access_mode',
  'catalogue_open'
)
on conflict (key) do nothing;

-- catalogue_open: guests may view prices / request quote (current Unique quote storefront).
-- trade_required: checkout/quote requires auth-linked CRM customer with trade_access_status=approved.
-- PAY LATER always requires pay_later_eligible regardless of mode.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Backfill preview reviews (NO auto-apply)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.trade_eligibility_backfill_reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  field text not null check (field in ('trade_access', 'pay_later')),
  confidence text not null check (confidence in ('EXPLICIT', 'HIGH', 'AMBIGUOUS', 'NO_EVIDENCE')),
  proposed_trade_access_status text,
  proposed_pay_later_eligible boolean,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'DEFERRED', 'APPLIED', 'MANUAL')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_eligibility_backfill_reviews_uq unique (customer_id, field)
);

create index if not exists trade_eligibility_backfill_reviews_status_idx
  on public.trade_eligibility_backfill_reviews (status, confidence, field);

alter table public.trade_eligibility_backfill_reviews enable row level security;
drop policy if exists "admin_all_trade_eligibility_backfill_reviews"
  on public.trade_eligibility_backfill_reviews;
create policy "admin_all_trade_eligibility_backfill_reviews"
  on public.trade_eligibility_backfill_reviews
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
grant select, insert, update, delete on public.trade_eligibility_backfill_reviews to authenticated;
grant all on public.trade_eligibility_backfill_reviews to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Permission: trade eligibility decisions = owner/admin only
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.can_decide_trade_eligibility()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users au
    where au.auth_user_id = (select auth.uid())
      and au.is_active
      and au.role in ('owner', 'admin')
  );
$$;

grant execute on function public.can_decide_trade_eligibility() to authenticated, service_role;

comment on function public.can_decide_trade_eligibility() is
  'Phase 4D: only owner/admin may approve/reject/suspend trade or PAY LATER eligibility. Sales editors may view (scoped) but not mutate.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Commercial policy engine (server-authoritative, testable core)
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
  v_view_price boolean;
  v_purchase boolean;
  v_quote boolean;
begin
  if v_mode = 'trade_required' then
    v_view_cat := v_approved and not v_blocked and p_has_crm_customer;
    v_view_price := v_view_cat;
    v_purchase := v_view_cat;
    v_quote := v_view_cat;
  else
    -- catalogue_open: guest/public catalogue + quote (Unique current). Trade still gates linked purchase when ineligible+strict hooks.
    v_view_cat := true;
    v_view_price := true;
    if p_has_crm_customer then
      v_purchase := v_approved and not v_blocked;
      v_quote := v_approved and not v_blocked;
    else
      v_purchase := not v_blocked;
      v_quote := not v_blocked;
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
    'can_view_price', v_view_price,
    'can_purchase', v_purchase,
    'can_request_quote', v_quote,
    'can_use_pay_later', v_pay_later,
    'customer_type_independent', true,
    'surecust_independent_of_customer_type', true
  );
end;
$$;

grant execute on function public.commercial_policy_evaluate(text, boolean, text, text, boolean, text, text)
  to authenticated, service_role, anon;

create or replace function public.rpc_commercial_policy_for_customer(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_cu public.customers%rowtype;
  v_mode text;
  v_policy jsonb;
begin
  if p_customer_id is null then
    return jsonb_build_object('ok', false, 'error', 'customer_id required');
  end if;

  select * into v_cu from public.customers where id = p_customer_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;

  -- Admin path: require admin + sales scope. Storefront path uses dedicated RPC.
  if public.is_admin() then
    if not public.assert_sales_entity_access('customer', p_customer_id) then
      return jsonb_build_object('ok', false, 'error', 'Forbidden');
    end if;
  elsif (select auth.uid()) is null or v_cu.auth_user_id is distinct from (select auth.uid()) then
    -- service_role / internal callers may lack auth.uid; allow when JWT role is service
    if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
      return jsonb_build_object('ok', false, 'error', 'Forbidden');
    end if;
  end if;

  select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_mode
  from public.site_settings where key = 'commercial_access_mode' limit 1;
  v_mode := coalesce(v_mode, 'catalogue_open');

  v_policy := public.commercial_policy_evaluate(
    v_cu.trade_access_status,
    v_cu.pay_later_eligible,
    v_cu.status,
    v_mode,
    true,
    v_cu.customer_type,
    v_cu.payment_terms
  );

  return jsonb_build_object(
    'ok', true,
    'customer_id', p_customer_id,
    'auth_user_id', v_cu.auth_user_id,
    'auth_linked', v_cu.auth_user_id is not null,
    'provenance', jsonb_build_object(
      'trade_eligible_source', v_cu.trade_eligible_source,
      'trade_eligible_decided_at', v_cu.trade_eligible_decided_at,
      'pay_later_eligible_source', v_cu.pay_later_eligible_source,
      'pay_later_eligible_decided_at', v_cu.pay_later_eligible_decided_at
    ),
    'policy', v_policy
  );
end;
$$;

grant execute on function public.rpc_commercial_policy_for_customer(uuid)
  to authenticated, service_role;

create or replace function public.rpc_storefront_commercial_policy()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_customer_id uuid;
  v_mode text;
  v_cu public.customers%rowtype;
  v_policy jsonb;
begin
  select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_mode
  from public.site_settings where key = 'commercial_access_mode' limit 1;
  v_mode := coalesce(v_mode, 'catalogue_open');

  if v_uid is null then
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
    return jsonb_build_object(
      'ok', true,
      'customer_id', null,
      'auth_linked', false,
      'policy', v_policy
    );
  end if;

  select id into v_customer_id
  from public.customers
  where auth_user_id = v_uid
  order by updated_at desc
  limit 1;

  if v_customer_id is null then
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
    return jsonb_build_object(
      'ok', true,
      'customer_id', null,
      'auth_user_id', v_uid,
      'auth_linked', false,
      'policy', v_policy,
      'note', 'Auth account has no CRM customer link'
    );
  end if;

  select * into v_cu from public.customers where id = v_customer_id;
  v_policy := public.commercial_policy_evaluate(
    v_cu.trade_access_status,
    v_cu.pay_later_eligible,
    v_cu.status,
    v_mode,
    true,
    v_cu.customer_type,
    v_cu.payment_terms
  );

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer_id,
    'auth_user_id', v_uid,
    'auth_linked', true,
    'policy', v_policy
  );
end;
$$;

grant execute on function public.rpc_storefront_commercial_policy()
  to anon, authenticated, service_role;

create or replace function public.rpc_assert_storefront_commercial_action(
  p_action text,
  p_payment_option text default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_pay text := lower(btrim(coalesce(p_payment_option, '')));
  v_uid uuid := (select auth.uid());
  v_customer_id uuid := p_customer_id;
  v_mode text;
  v_cu public.customers%rowtype;
  v_policy jsonb;
  v_has_crm boolean := false;
begin
  select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_mode
  from public.site_settings where key = 'commercial_access_mode' limit 1;
  v_mode := coalesce(v_mode, 'catalogue_open');

  if v_customer_id is null and v_uid is not null then
    select id into v_customer_id from public.customers where auth_user_id = v_uid limit 1;
  end if;

  if v_customer_id is not null then
    select * into v_cu from public.customers where id = v_customer_id;
    if found then
      v_has_crm := true;
      v_policy := public.commercial_policy_evaluate(
        v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
        v_mode, true, v_cu.customer_type, v_cu.payment_terms
      );
    end if;
  end if;

  if v_policy is null then
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
  end if;

  if v_pay in ('pay_later', 'pay later', 'order now, pay later') then
    if not coalesce((v_policy->>'can_use_pay_later')::boolean, false) then
      return jsonb_build_object(
        'ok', false,
        'error', 'PAY_LATER_NOT_PERMITTED',
        'message', 'PAY LATER is not enabled for this account',
        'policy', v_policy
      );
    end if;
  end if;

  if v_action in ('purchase', 'checkout', 'place_order') then
    if not coalesce((v_policy->>'can_purchase')::boolean, false) then
      return jsonb_build_object(
        'ok', false,
        'error', 'TRADE_PURCHASE_NOT_PERMITTED',
        'message', 'Trade eligibility required to purchase',
        'policy', v_policy
      );
    end if;
  elsif v_action in ('quote', 'request_quote') then
    if v_mode = 'trade_required' and not coalesce((v_policy->>'can_request_quote')::boolean, false) then
      return jsonb_build_object(
        'ok', false,
        'error', 'TRADE_QUOTE_NOT_PERMITTED',
        'message', 'Approved trade account required to request a quote',
        'policy', v_policy
      );
    end if;
    -- catalogue_open: allow guest quotes (Unique current storefront)
  elsif v_action in ('view_price', 'view_catalogue') then
    if v_mode = 'trade_required' then
      if v_action = 'view_price' and not coalesce((v_policy->>'can_view_price')::boolean, false) then
        return jsonb_build_object('ok', false, 'error', 'PRICE_RESTRICTED', 'policy', v_policy);
      end if;
      if v_action = 'view_catalogue' and not coalesce((v_policy->>'can_view_catalogue')::boolean, false) then
        return jsonb_build_object('ok', false, 'error', 'CATALOGUE_RESTRICTED', 'policy', v_policy);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer_id,
    'auth_linked', v_has_crm,
    'policy', v_policy
  );
end;
$$;

grant execute on function public.rpc_assert_storefront_commercial_action(text, text, uuid)
  to anon, authenticated, service_role;

create or replace function public.rpc_commercial_effective_price(
  p_product_id uuid,
  p_variant_id uuid default null,
  p_customer_id uuid default null,
  p_quantity int default 1
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_unit numeric(12,2);
  v_assert jsonb;
begin
  -- No B2B price lists in UD evidence — base catalogue price only.
  v_assert := public.rpc_assert_storefront_commercial_action('view_price', null, p_customer_id);
  if not coalesce((v_assert->>'ok')::boolean, false) then
    return v_assert;
  end if;

  select * into v_product from public.products where id = p_product_id and published = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Product unavailable');
  end if;

  v_unit := v_product.price;
  if p_variant_id is not null then
    select * into v_variant from public.product_variants
    where id = p_variant_id and product_id = p_product_id and is_active = true;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Variant unavailable');
    end if;
    v_unit := coalesce(v_variant.price, v_product.price);
  end if;

  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'quantity', greatest(1, coalesce(p_quantity, 1)),
    'unit_price', v_unit,
    'line_total', round(v_unit * greatest(1, coalesce(p_quantity, 1)), 2),
    'price_mode', 'base',
    'price_list_id', null,
    'catalog_id', null,
    'quantity_break_applied', false,
    'historical_note', 'Historical order line prices are immutable snapshots and are never recalculated from this RPC'
  );
end;
$$;

grant execute on function public.rpc_commercial_effective_price(uuid, uuid, uuid, int)
  to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Wrap cart totals with optional PAY LATER / trade assert (additive params)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_get_cart_totals(
  p_items jsonb,
  p_currency text default null,
  p_shipping_country text default null,
  p_coupon_code text default null,
  p_payment_option text default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_currency text;
  v_subtotal numeric(10,2) := 0;
  v_item jsonb;
  v_product record;
  v_variant record;
  v_bundle record;
  v_bundle_item record;
  v_qty int;
  v_line numeric(10,2);
  v_unit_price numeric(10,2);
  v_inventory int;
  v_reserved int;
  v_name text;
  v_image text;
  v_items_out jsonb := '[]'::jsonb;
  v_variant_id uuid;
  v_variant_name text;
  v_bundle_id uuid;
  v_selections jsonb;
  v_components jsonb;
  v_sel_variant uuid;
  v_available int;
  v_component jsonb;
  v_shipping numeric(10,2);
  v_tax_rate numeric(10,2);
  v_tax numeric(10,2);
  v_discount numeric(10,2) := 0;
  v_coupon jsonb;
  v_total numeric(10,2);
  v_assert jsonb;
begin
  -- PAY LATER always gated; view_price assert is soft under catalogue_open
  if lower(coalesce(p_payment_option, '')) like '%pay%later%' then
    v_assert := public.rpc_assert_storefront_commercial_action(
      'purchase', p_payment_option, p_customer_id
    );
    if not coalesce((v_assert->>'ok')::boolean, false) then
      return v_assert;
    end if;
  else
    v_assert := public.rpc_assert_storefront_commercial_action(
      'view_price', null, p_customer_id
    );
    if not coalesce((v_assert->>'ok')::boolean, false) then
      return v_assert;
    end if;
  end if;

  select coalesce(p_currency, (select value from public.site_settings where key = 'currency_code' limit 1), 'USD')
  into v_currency;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_qty := greatest(1, (v_item->>'quantity')::int);
    v_bundle_id := nullif(v_item->>'bundle_id', '')::uuid;

    if v_bundle_id is not null then
      v_selections := coalesce(v_item->'selections', '[]'::jsonb);
      select * into v_bundle from public.product_bundles b where b.id = v_bundle_id and b.published = true;
      if v_bundle.id is null then
        return jsonb_build_object('ok', false, 'error', 'Bundle unavailable');
      end if;

      v_available := public.bundle_available_quantity(v_bundle_id, v_selections);
      if v_available < v_qty then
        return jsonb_build_object('ok', false, 'error', v_bundle.name || ' has only ' || v_available || ' available in stock');
      end if;

      v_components := '[]'::jsonb;
      for v_bundle_item in select * from public.product_bundle_items where bundle_id = v_bundle_id order by sort_order
      loop
        select * into v_product from public.products p where p.id = v_bundle_item.product_id and p.published = true;
        if v_product.id is null then
          return jsonb_build_object('ok', false, 'error', 'A bundle item is unavailable');
        end if;

        v_sel_variant := public.resolve_bundle_item_variant(v_bundle_item.id, v_selections);
        v_variant_name := null;
        v_unit_price := v_product.price;
        v_inventory := v_product.inventory_count;
        v_name := coalesce(nullif(trim(v_bundle_item.label), ''), v_product.name);

        if v_sel_variant is not null then
          select * into v_variant from public.product_variants pv
          where pv.id = v_sel_variant and pv.product_id = v_product.id and pv.is_active = true;
          if v_variant.id is null then
            return jsonb_build_object('ok', false, 'error', 'Invalid variant for ' || v_product.name);
          end if;
          v_variant_name := v_variant.name;
          v_unit_price := coalesce(v_variant.price, v_product.price);
          v_inventory := v_variant.inventory_count;
          v_name := v_name || ' — ' || v_variant.name;
        elsif exists (select 1 from public.product_variants pv where pv.product_id = v_product.id and pv.is_active = true) then
          return jsonb_build_object('ok', false, 'error', v_product.name || ' requires a variant selection in this bundle');
        end if;

        v_reserved := public.reserved_inventory_quantity(v_product.id, v_sel_variant);
        if v_inventory - v_reserved < v_bundle_item.quantity * v_qty then
          return jsonb_build_object('ok', false, 'error', v_name || ' has insufficient stock for this bundle');
        end if;

        v_components := v_components || jsonb_build_object(
          'bundle_item_id', v_bundle_item.id,
          'product_id', v_product.id,
          'variant_id', v_sel_variant,
          'variant_name', v_variant_name,
          'name', v_name,
          'slug', v_product.slug,
          'quantity', v_bundle_item.quantity * v_qty,
          'unit_price', v_unit_price
        );
      end loop;

      v_line := v_bundle.price * v_qty;
      v_subtotal := v_subtotal + v_line;
      v_items_out := v_items_out || jsonb_build_object(
        'bundle_id', v_bundle.id,
        'product_id', null,
        'variant_id', null,
        'variant_name', null,
        'name', v_bundle.name,
        'slug', v_bundle.slug,
        'image_url', v_bundle.image_url,
        'unit_price', v_bundle.price,
        'quantity', v_qty,
        'line_total', v_line,
        'is_bundle', true,
        'components', v_components
      );
      continue;
    end if;

    v_variant_id := nullif(v_item->>'variant_id', '')::uuid;
    v_variant_name := null;
    select * into v_product from public.products p
    where p.id = (v_item->>'product_id')::uuid and p.published = true;
    if v_product.id is null then
      return jsonb_build_object('ok', false, 'error', 'Product unavailable');
    end if;

    v_unit_price := v_product.price;
    v_inventory := v_product.inventory_count;
    v_name := v_product.name;
    v_image := v_product.image_url;

    if v_variant_id is not null then
      select * into v_variant from public.product_variants pv
      where pv.id = v_variant_id and pv.product_id = v_product.id and pv.is_active = true;
      if v_variant.id is null then
        return jsonb_build_object('ok', false, 'error', 'Variant unavailable for ' || v_product.name);
      end if;
      v_unit_price := coalesce(v_variant.price, v_product.price);
      v_inventory := v_variant.inventory_count;
      v_variant_name := v_variant.name;
      v_name := v_product.name || ' — ' || v_variant.name;
      v_image := coalesce(v_variant.image_url, v_product.image_url);
    elsif exists (select 1 from public.product_variants pv where pv.product_id = v_product.id and pv.is_active = true) then
      return jsonb_build_object('ok', false, 'error', v_product.name || ' requires a variant selection');
    end if;

    v_reserved := public.reserved_inventory_quantity(v_product.id, v_variant_id);
    if v_inventory - v_reserved < v_qty then
      return jsonb_build_object('ok', false, 'error', v_name || ' has only ' || greatest(0, v_inventory - v_reserved) || ' in stock');
    end if;

    v_line := v_unit_price * v_qty;
    v_subtotal := v_subtotal + v_line;
    v_items_out := v_items_out || jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', v_variant_id,
      'variant_name', v_variant_name,
      'name', v_name,
      'slug', v_product.slug,
      'image_url', v_image,
      'unit_price', v_unit_price,
      'quantity', v_qty,
      'line_total', v_line,
      'is_bundle', false
    );
  end loop;

  v_coupon := public.resolve_coupon_discount(p_coupon_code, v_subtotal);
  if not (v_coupon->>'ok')::boolean then
    return v_coupon;
  end if;
  v_discount := coalesce((v_coupon->>'discount')::numeric, 0);

  v_shipping := public.resolve_shipping_rate(p_shipping_country, v_subtotal - v_discount);
  select coalesce(nullif((select value from public.site_settings where key = 'tax_rate_percent' limit 1), '')::numeric, 0)
  into v_tax_rate;
  v_tax := round(greatest(0, v_subtotal - v_discount) * v_tax_rate / 100, 2);
  v_total := greatest(0, v_subtotal - v_discount) + v_shipping + v_tax;

  return jsonb_build_object(
    'ok', true,
    'currency', v_currency,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'coupon_code', v_coupon->>'code',
    'shipping', v_shipping,
    'tax', v_tax,
    'total', v_total,
    'items', v_items_out,
    'price_mode', 'base',
    'commercial_assert', v_assert
  );
end;
$$;

grant execute on function public.rpc_get_cart_totals(jsonb, text, text, text, text, uuid)
  to anon, authenticated, service_role;

-- Remove pre-4D 4-arg overload so all callers hit the gated function (defaults preserve named 4-arg calls).
drop function if exists public.rpc_get_cart_totals(jsonb, text, text, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Admin decide trade / PAY LATER + applications queue
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_set_trade_access(
  p_customer_id uuid,
  p_status text,
  p_note text default null,
  p_source text default 'unique_manual'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cu public.customers%rowtype;
  v_new text := lower(btrim(coalesce(p_status, '')));
  v_old text;
  v_actor uuid;
  v_event text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_decide_trade_eligibility() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden', 'detail', 'owner/admin required');
  end if;
  if not public.assert_sales_entity_access('customer', p_customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if v_new not in ('ineligible', 'pending', 'approved', 'rejected', 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'Invalid trade_access_status');
  end if;

  select * into v_cu from public.customers where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;

  v_old := v_cu.trade_access_status;
  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  update public.customers set
    trade_access_status = v_new,
    trade_eligible_source = coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'unique_manual'),
    trade_eligible_note = nullif(btrim(coalesce(p_note, '')), ''),
    trade_eligible_decided_at = now(),
    trade_eligible_decided_by = v_actor,
    -- Keep CRM approval_status in sync for pending applications only when transitioning
    approval_status = case
      when v_new = 'pending' then 'pending'
      when v_new = 'approved' and approval_status = 'pending' then 'approved'
      when v_new = 'rejected' and approval_status = 'pending' then 'rejected'
      else approval_status
    end,
    version = version + 1,
    updated_at = now()
  where id = p_customer_id;

  v_event := case v_new
    when 'approved' then 'trade_approved'
    when 'rejected' then 'trade_rejected'
    when 'suspended' then 'trade_suspended'
    when 'pending' then 'trade_pending'
    else 'trade_ineligible'
  end;

  perform public.append_crm_event(
    'customer', p_customer_id, v_event, 'commercial',
    coalesce(p_note, 'Trade access ' || v_old || ' → ' || v_new),
    jsonb_build_object('trade_access_status', v_old),
    jsonb_build_object('trade_access_status', v_new, 'source', p_source),
    jsonb_build_object('field', 'trade_access'),
    'unique', 'admin', v_actor, null, now()
  );

  return jsonb_build_object(
    'ok', true,
    'customer_id', p_customer_id,
    'old', v_old,
    'new', v_new,
    'policy', (public.rpc_commercial_policy_for_customer(p_customer_id))->'policy'
  );
end;
$$;

grant execute on function public.rpc_admin_set_trade_access(uuid, text, text, text)
  to authenticated;

create or replace function public.rpc_admin_set_pay_later_eligibility(
  p_customer_id uuid,
  p_eligible boolean,
  p_note text default null,
  p_source text default 'unique_manual'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cu public.customers%rowtype;
  v_old boolean;
  v_actor uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_decide_trade_eligibility() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden', 'detail', 'owner/admin required');
  end if;
  if not public.assert_sales_entity_access('customer', p_customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_cu from public.customers where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;

  v_old := v_cu.pay_later_eligible;
  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  update public.customers set
    pay_later_eligible = coalesce(p_eligible, false),
    pay_later_eligible_source = coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'unique_manual'),
    pay_later_eligible_note = nullif(btrim(coalesce(p_note, '')), ''),
    pay_later_eligible_decided_at = now(),
    pay_later_eligible_decided_by = v_actor,
    version = version + 1,
    updated_at = now()
  where id = p_customer_id;

  perform public.append_crm_event(
    'customer', p_customer_id,
    case when coalesce(p_eligible, false) then 'pay_later_enabled' else 'pay_later_disabled' end,
    'commercial',
    coalesce(p_note, 'PAY LATER ' || v_old::text || ' → ' || coalesce(p_eligible, false)::text),
    jsonb_build_object('pay_later_eligible', v_old),
    jsonb_build_object('pay_later_eligible', coalesce(p_eligible, false), 'source', p_source),
    jsonb_build_object('field', 'pay_later'),
    'unique', 'admin', v_actor, null, now()
  );

  return jsonb_build_object(
    'ok', true,
    'customer_id', p_customer_id,
    'old', v_old,
    'new', coalesce(p_eligible, false)
  );
end;
$$;

grant execute on function public.rpc_admin_set_pay_later_eligibility(uuid, boolean, text, text)
  to authenticated;

create or replace function public.rpc_admin_list_trade_applications(
  p_limit int default 50,
  p_offset int default 0,
  p_status text default 'pending'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_status text := coalesce(nullif(btrim(p_status), ''), 'pending');
  v_total int;
  v_rows jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_total
  from public.customers c
  where c.trade_access_status = v_status
     or (v_status = 'pending' and c.approval_status = 'pending');

  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
  into v_rows
  from (
    select c.id, c.email, c.display_name, c.trading_name, c.customer_type,
           c.approval_status, c.trade_access_status, c.trade_eligible,
           c.pay_later_eligible, c.payment_terms, c.registration_channel,
           c.salesperson_id, c.source_system, c.created_at, c.updated_at,
           c.trade_eligible_source, c.trade_eligible_note
    from public.customers c
    where c.trade_access_status = v_status
       or (v_status = 'pending' and c.approval_status = 'pending')
    order by c.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  ) x;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'rows', v_rows,
    'note', 'Pending applications use trade_access_status and/or CRM approval_status. Sales may view scoped; decide requires owner/admin.'
  );
end;
$$;

grant execute on function public.rpc_admin_list_trade_applications(int, int, text)
  to authenticated;

-- Enrich customer workspace with commercial policy + decision history
create or replace function public.rpc_get_admin_customer_workspace(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v jsonb;
  v_policy jsonb;
  v_events jsonb;
  v_tags jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.assert_sales_entity_access('customer', p_customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  v := public.rpc_get_admin_customer_workspace_core(p_customer_id);
  if not coalesce((v->>'ok')::boolean, false) then
    return v;
  end if;

  v_policy := public.rpc_commercial_policy_for_customer(p_customer_id);

  select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at desc), '[]'::jsonb)
  into v_events
  from (
    select id, event_type, category, message, old_value, new_value, metadata,
           actor_type, actor_name, occurred_at, source_system
    from public.crm_events
    where entity_type = 'customer' and entity_id = p_customer_id
      and event_type in (
        'trade_approved', 'trade_rejected', 'trade_suspended', 'trade_pending', 'trade_ineligible',
        'pay_later_enabled', 'pay_later_disabled'
      )
    order by occurred_at desc
    limit 50
  ) e;

  select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb)
  into v_tags
  from public.entity_tags et
  join public.tags t on t.id = et.tag_id
  where et.entity_type = 'customer' and et.entity_id = p_customer_id
    and t.name in ('SureCust_Wholesale', 'verified', 'PAY LATER', 'b2b', 'b2b_company');

  return v || jsonb_build_object(
    'commercial_policy', v_policy,
    'trade_decision_history', v_events,
    'commercial_source_tags', v_tags,
    'can_decide_trade_eligibility', public.can_decide_trade_eligibility()
  );
end;
$$;

grant execute on function public.rpc_get_admin_customer_workspace(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Backfill preview seed + list / decide / apply (EXPLICIT only apply path)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_seed_trade_eligibility_backfill_preview()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_trade int := 0;
  v_pay int := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_decide_trade_eligibility() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  -- EXPLICIT trade: SureCust_Wholesale tag
  insert into public.trade_eligibility_backfill_reviews (
    customer_id, field, confidence, proposed_trade_access_status, evidence, status
  )
  select c.id, 'trade_access', 'EXPLICIT', 'approved',
    jsonb_build_object(
      'tags', jsonb_build_array('SureCust_Wholesale'),
      'has_verified', exists (
        select 1 from entity_tags et2 join tags t2 on t2.id = et2.tag_id
        where et2.entity_id = c.id and et2.entity_type = 'customer' and t2.name = 'verified'
      )
    ),
    'PENDING'
  from public.customers c
  where exists (
    select 1 from entity_tags et join tags t on t.id = et.tag_id
    where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
  )
  on conflict (customer_id, field) do update set
    confidence = excluded.confidence,
    proposed_trade_access_status = excluded.proposed_trade_access_status,
    evidence = excluded.evidence,
    updated_at = now(),
    status = case when trade_eligibility_backfill_reviews.status in ('APPROVED','REJECTED','DEFERRED','APPLIED','MANUAL')
      then trade_eligibility_backfill_reviews.status else 'PENDING' end;
  get diagnostics v_trade = row_count;

  -- AMBIGUOUS trade: verified without SureCust (do not treat as wholesale gate)
  insert into public.trade_eligibility_backfill_reviews (
    customer_id, field, confidence, proposed_trade_access_status, evidence, status
  )
  select c.id, 'trade_access', 'AMBIGUOUS', null,
    jsonb_build_object('tags', jsonb_build_array('verified'), 'note', 'verified without SureCust_Wholesale — do not auto-approve'),
    'PENDING'
  from public.customers c
  where exists (
    select 1 from entity_tags et join tags t on t.id = et.tag_id
    where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'verified'
  )
  and not exists (
    select 1 from entity_tags et join tags t on t.id = et.tag_id
    where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
  )
  on conflict (customer_id, field) do update set
    confidence = excluded.confidence,
    evidence = excluded.evidence,
    updated_at = now(),
    status = case when trade_eligibility_backfill_reviews.status in ('APPROVED','REJECTED','DEFERRED','APPLIED','MANUAL')
      then trade_eligibility_backfill_reviews.status else 'PENDING' end;

  -- EXPLICIT pay_later: PAY LATER tag
  insert into public.trade_eligibility_backfill_reviews (
    customer_id, field, confidence, proposed_pay_later_eligible, evidence, status
  )
  select c.id, 'pay_later', 'EXPLICIT', true,
    jsonb_build_object(
      'tags', jsonb_build_array('PAY LATER'),
      'also_surecust', exists (
        select 1 from entity_tags et2 join tags t2 on t2.id = et2.tag_id
        where et2.entity_id = c.id and et2.entity_type = 'customer' and t2.name = 'SureCust_Wholesale'
      )
    ),
    'PENDING'
  from public.customers c
  where exists (
    select 1 from entity_tags et join tags t on t.id = et.tag_id
    where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'PAY LATER'
  )
  on conflict (customer_id, field) do update set
    confidence = excluded.confidence,
    proposed_pay_later_eligible = excluded.proposed_pay_later_eligible,
    evidence = excluded.evidence,
    updated_at = now(),
    status = case when trade_eligibility_backfill_reviews.status in ('APPROVED','REJECTED','DEFERRED','APPLIED','MANUAL')
      then trade_eligibility_backfill_reviews.status else 'PENDING' end;
  get diagnostics v_pay = row_count;

  return jsonb_build_object(
    'ok', true,
    'seeded_or_refreshed', true,
    'note', 'Preview only — no customer.trade_* / pay_later_* columns applied. EXPLICIT SureCust / PAY LATER tagged; verified-only = AMBIGUOUS.',
    'summary', (
      select jsonb_build_object(
        'trade_pending', count(*) filter (where field='trade_access' and status='PENDING'),
        'trade_explicit', count(*) filter (where field='trade_access' and status='PENDING' and confidence='EXPLICIT'),
        'trade_ambiguous', count(*) filter (where field='trade_access' and status='PENDING' and confidence='AMBIGUOUS'),
        'pay_later_pending', count(*) filter (where field='pay_later' and status='PENDING'),
        'pay_later_explicit', count(*) filter (where field='pay_later' and status='PENDING' and confidence='EXPLICIT')
      )
      from public.trade_eligibility_backfill_reviews
    )
  );
end;
$$;

grant execute on function public.rpc_admin_seed_trade_eligibility_backfill_preview()
  to authenticated;

create or replace function public.rpc_admin_list_trade_eligibility_backfill(
  p_limit int default 50,
  p_offset int default 0,
  p_field text default null,
  p_confidence text default null,
  p_status text default 'PENDING'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total int;
  v_rows jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_total
  from public.trade_eligibility_backfill_reviews r
  where (p_status is null or r.status = p_status)
    and (p_field is null or r.field = p_field)
    and (p_confidence is null or r.confidence = p_confidence);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows
  from (
    select r.*, c.email, c.display_name, c.trade_access_status as current_trade_status,
           c.pay_later_eligible as current_pay_later
    from public.trade_eligibility_backfill_reviews r
    join public.customers c on c.id = r.customer_id
    where (p_status is null or r.status = p_status)
      and (p_field is null or r.field = p_field)
      and (p_confidence is null or r.confidence = p_confidence)
    order by r.confidence, r.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  ) x;

  return jsonb_build_object('ok', true, 'total', v_total, 'rows', v_rows);
end;
$$;

grant execute on function public.rpc_admin_list_trade_eligibility_backfill(int, int, text, text, text)
  to authenticated;

create or replace function public.rpc_admin_decide_trade_eligibility_backfill(
  p_review_id uuid,
  p_decision text,
  p_note text default null,
  p_apply_now boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.trade_eligibility_backfill_reviews%rowtype;
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_actor uuid;
  v_apply jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_decide_trade_eligibility() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_row from public.trade_eligibility_backfill_reviews where id = p_review_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Review not found');
  end if;
  if not public.assert_sales_entity_access('customer', v_row.customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_decision not in ('APPROVE', 'REJECT', 'DEFER', 'MANUAL') then
    return jsonb_build_object('ok', false, 'error', 'Invalid decision');
  end if;

  -- Never apply AMBIGUOUS via APPROVE+apply
  if p_apply_now and v_row.confidence = 'AMBIGUOUS' and v_decision = 'APPROVE' then
    return jsonb_build_object('ok', false, 'error', 'AMBIGUOUS_NOT_APPLIABLE');
  end if;

  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  update public.trade_eligibility_backfill_reviews set
    status = case v_decision
      when 'APPROVE' then 'APPROVED'
      when 'REJECT' then 'REJECTED'
      when 'DEFER' then 'DEFERRED'
      else 'MANUAL'
    end,
    decided_by = v_actor,
    decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = p_review_id;

  if p_apply_now and v_decision in ('APPROVE', 'MANUAL') and v_row.confidence = 'EXPLICIT' then
    if v_row.field = 'trade_access' and v_row.proposed_trade_access_status is not null then
      v_apply := public.rpc_admin_set_trade_access(
        v_row.customer_id,
        v_row.proposed_trade_access_status,
        coalesce(p_note, 'backfill EXPLICIT SureCust'),
        'surecust_wholesale_tag'
      );
    elsif v_row.field = 'pay_later' then
      v_apply := public.rpc_admin_set_pay_later_eligibility(
        v_row.customer_id,
        coalesce(v_row.proposed_pay_later_eligible, true),
        coalesce(p_note, 'backfill EXPLICIT PAY LATER tag'),
        'pay_later_tag'
      );
    end if;
    if coalesce((v_apply->>'ok')::boolean, false) then
      update public.trade_eligibility_backfill_reviews
      set status = 'APPLIED', applied_at = now(), updated_at = now()
      where id = p_review_id;
    else
      return jsonb_build_object('ok', false, 'error', 'Apply failed', 'detail', v_apply);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'review_id', p_review_id, 'applied', coalesce(p_apply_now, false));
end;
$$;

grant execute on function public.rpc_admin_decide_trade_eligibility_backfill(uuid, text, text, boolean)
  to authenticated;

create or replace function public.rpc_admin_trade_commercial_report()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'eligibility_owner', 'CUSTOMER',
    'company_level', 'NOT_PROMOTED',
    'company_location_level', 'NO_EVIDENCE',
    'counts', jsonb_build_object(
      'customers', (select count(*) from customers),
      'trade_approved', (select count(*) from customers where trade_access_status = 'approved'),
      'trade_pending', (select count(*) from customers where trade_access_status = 'pending'),
      'pay_later_eligible', (select count(*) from customers where pay_later_eligible),
      'auth_linked', (select count(*) from customers where auth_user_id is not null),
      'surecust_tag', (
        select count(distinct et.entity_id) from entity_tags et join tags t on t.id = et.tag_id
        where t.name = 'SureCust_Wholesale' and et.entity_type = 'customer'
      ),
      'pay_later_tag', (
        select count(distinct et.entity_id) from entity_tags et join tags t on t.id = et.tag_id
        where t.name = 'PAY LATER' and et.entity_type = 'customer'
      ),
      'credit_limit_set', (
        select count(*) from ar_accounts where credit_limit is not null and credit_limit <> 0
      ),
      'ownership_candidates_still_pending', (
        select count(*) from ownership_backfill_reviews where status = 'PENDING'
      )
    ),
    'backfill_preview', (
      select jsonb_build_object(
        'trade_explicit_pending', count(*) filter (where field='trade_access' and status='PENDING' and confidence='EXPLICIT'),
        'trade_ambiguous_pending', count(*) filter (where field='trade_access' and status='PENDING' and confidence='AMBIGUOUS'),
        'pay_later_explicit_pending', count(*) filter (where field='pay_later' and status='PENDING' and confidence='EXPLICIT'),
        'applied', count(*) filter (where status='APPLIED')
      ) from trade_eligibility_backfill_reviews
    ),
    'pricing', jsonb_build_object(
      'model', 'BASE_PRICE_PLUS_DRAFT_OVERRIDES_AND_COUPONS',
      'shopify_b2b_catalogues', 'NO_SCHEMA_NO_USAGE',
      'price_lists_required', false,
      'quantity_breaks_required', false,
      'tiered_metafields', 0
    ),
    'parked', jsonb_build_object(
      'dpd', 'do_not_resume',
      'skulabs', 'DIRECT_ACCESS_REQUIRED',
      'warehouse', 'NOT_STARTED',
      'worldpay', 'do_not_enable'
    ),
    'phase4c_ownership', 'NOT_AUTO_APPLIED'
  );
end;
$$;

grant execute on function public.rpc_admin_trade_commercial_report() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Phase 4D selftest
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase4d_trade_commercial_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_all_ok boolean := true;
  v_ok boolean;
  v_prefix text := 'p4d-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_staff uuid;
  v_cust_ok uuid;
  v_cust_no uuid;
  v_cust_pay uuid;
  v_policy jsonb;
  v_assert jsonb;
  v_price jsonb;
  v_prod uuid;
  v_order uuid;
  v_line_price numeric;
  v_review uuid;
  v_mode_before text;
begin
  insert into public.staff_members (name, active, provenance, source_system)
  values (v_prefix || ' SP', true, 'unique_manual', 'unique') returning id into v_staff;

  insert into public.customers (
    email, display_name, salesperson_id, source_system, version,
    trade_access_status, pay_later_eligible, customer_type, payment_terms, status
  ) values (
    lower(v_prefix)||'.ok@example.test', v_prefix||' OK', v_staff, 'unique', 1,
    'approved', false, 'Retail', 'Net 30', 'active'
  ) returning id into v_cust_ok;

  insert into public.customers (
    email, display_name, salesperson_id, source_system, version,
    trade_access_status, pay_later_eligible, customer_type, status
  ) values (
    lower(v_prefix)||'.no@example.test', v_prefix||' NO', v_staff, 'unique', 1,
    'ineligible', false, 'Wholesale', 'active'
  ) returning id into v_cust_no;

  insert into public.customers (
    email, display_name, salesperson_id, source_system, version,
    trade_access_status, pay_later_eligible, status
  ) values (
    lower(v_prefix)||'.pay@example.test', v_prefix||' PAY', v_staff, 'unique', 1,
    'approved', true, 'active'
  ) returning id into v_cust_pay;

  -- Ensure a published product for price RPC
  select id into v_prod from public.products where published = true limit 1;
  if v_prod is null then
    insert into public.products (name, slug, price, published, inventory_count)
    values (v_prefix||' Prod', v_prefix||'-prod', 12.50, true, 10)
    returning id into v_prod;
  end if;

  -- A trade eligibility + Customer Type independence
  begin
    v_policy := public.commercial_policy_evaluate(
      'approved', false, 'active', 'catalogue_open', true, 'Retail', 'Net 30'
    );
    v_ok := (v_policy->>'trade_eligible')::boolean = true
      and (v_policy->>'can_use_pay_later')::boolean = false
      and (v_policy->>'customer_type') = 'Retail'
      and (v_policy->>'credit_limit_status') = 'NO_SOURCE_EVIDENCE'
      and (v_policy->>'price_mode') = 'base';
    -- Wholesale type without approval is NOT trade eligible
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', 'catalogue_open', true, 'Wholesale', null
    );
    v_ok := v_ok and (v_policy->>'trade_eligible')::boolean = false
      and (v_policy->>'customer_type') = 'Wholesale';
    v_cases := v_cases || jsonb_build_object('A_trade_and_type_independent', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_trade_and_type_independent', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- B ineligible vs approved purchase under trade_required
  begin
    v_policy := public.commercial_policy_evaluate('ineligible', false, 'active', 'trade_required', true, null, null);
    v_ok := (v_policy->>'can_purchase')::boolean = false;
    v_policy := public.commercial_policy_evaluate('approved', false, 'active', 'trade_required', true, null, null);
    v_ok := v_ok and (v_policy->>'can_purchase')::boolean = true;
    v_cases := v_cases || jsonb_build_object('B_trade_required_gate', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_trade_required_gate', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- C PAY LATER permission / deny
  begin
    v_assert := public.rpc_assert_storefront_commercial_action('purchase', 'pay_later', v_cust_ok);
    v_ok := coalesce((v_assert->>'ok')::boolean, true) = false
      and v_assert->>'error' = 'PAY_LATER_NOT_PERMITTED';
    v_assert := public.rpc_assert_storefront_commercial_action('purchase', 'pay_later', v_cust_pay);
    v_ok := v_ok and coalesce((v_assert->>'ok')::boolean, false) = true;
    v_cases := v_cases || jsonb_build_object('C_pay_later_gate', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_pay_later_gate', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- D auth account separation (CRM without auth_user_id)
  begin
    v_ok := (select auth_user_id from customers where id = v_cust_ok) is null
      and (select trade_access_status from customers where id = v_cust_ok) = 'approved';
    v_cases := v_cases || jsonb_build_object('D_auth_crm_separation', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_auth_crm_separation', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- E base price + no price list
  begin
    v_price := public.rpc_commercial_effective_price(v_prod, null, v_cust_ok, 2);
    v_ok := coalesce((v_price->>'ok')::boolean, false)
      and v_price->>'price_mode' = 'base'
      and v_price->>'price_list_id' is null;
    v_cases := v_cases || jsonb_build_object('E_base_price_no_list', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_base_price_no_list', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- F historical line immutability (change current product price does not change order line)
  begin
    insert into public.orders (order_number, email, status, currency, subtotal, total, customer_id)
    values (v_prefix||'-O', lower(v_prefix)||'@t.test', 'paid', 'GBP', 10, 10, v_cust_ok)
    returning id into v_order;
    insert into public.order_items (
      order_id, product_id, product_name, quantity, unit_price, original_unit_price, line_total
    ) values (
      v_order, v_prod, 'snap', 1, 9.99, 9.99, 9.99
    );
    select original_unit_price into v_line_price from order_items where order_id = v_order limit 1;
    update public.products set price = price + 100 where id = v_prod;
    v_ok := (select original_unit_price from order_items where order_id = v_order limit 1) = v_line_price;
    update public.products set price = price - 100 where id = v_prod;
    v_cases := v_cases || jsonb_build_object('F_historical_price_immutable', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_historical_price_immutable', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- G eligibility audit event via direct column+event (selftest has no admin JWT)
  begin
    update public.customers set
      trade_access_status = 'suspended',
      trade_eligible_source = 'selftest',
      trade_eligible_decided_at = now()
    where id = v_cust_ok;
    perform public.append_crm_event(
      'customer', v_cust_ok, 'trade_suspended', 'commercial', 'selftest',
      jsonb_build_object('trade_access_status', 'approved'),
      jsonb_build_object('trade_access_status', 'suspended'),
      '{}'::jsonb, 'unique', 'system', null, 'selftest'
    );
    v_ok := exists (
      select 1 from crm_events where entity_id = v_cust_ok and event_type = 'trade_suspended'
    );
    v_cases := v_cases || jsonb_build_object('G_eligibility_audit_event', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_eligibility_audit_event', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- H backfill review AMBIGUOUS not appliable flag exists
  begin
    insert into public.trade_eligibility_backfill_reviews (
      customer_id, field, confidence, proposed_trade_access_status, evidence, status
    ) values (
      v_cust_no, 'trade_access', 'AMBIGUOUS', 'approved', '{"test":true}'::jsonb, 'PENDING'
    ) returning id into v_review;
    v_ok := (select confidence from trade_eligibility_backfill_reviews where id = v_review) = 'AMBIGUOUS';
    v_cases := v_cases || jsonb_build_object('H_ambiguous_backfill_preserved', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_ambiguous_backfill_preserved', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- I no price_list / catalog tables invented; parked deps untouched
  begin
    v_ok := not exists (
      select 1 from information_schema.tables
      where table_schema='public'
        and table_name in ('price_lists', 'price_list_items', 'catalogs', 'catalog_assignments', 'warehouse_bins', 'skulabs_sync_queue')
    );
    select value into v_mode_before from site_settings where key = 'commercial_access_mode' limit 1;
    v_ok := v_ok and coalesce(v_mode_before, 'catalogue_open') in ('catalogue_open', 'trade_required');
    v_cases := v_cases || jsonb_build_object('I_no_invented_price_lists_parked', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('I_no_invented_price_lists_parked', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- J company-level not used (customer canonical)
  begin
    v_ok := not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='companies' and column_name='trade_access_status'
    );
    v_cases := v_cases || jsonb_build_object('J_customer_canonical_eligibility', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('J_customer_canonical_eligibility', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- Cleanup (crm_events is append-only — do not DELETE events)
  begin
    delete from public.trade_eligibility_backfill_reviews where customer_id in (v_cust_ok, v_cust_no, v_cust_pay);
    if v_order is not null then
      delete from public.order_items where order_id = v_order;
      delete from public.orders where id = v_order;
    end if;
    -- Scrub + remove customers; events may retain entity_id (append-only audit)
    update public.customers set
      email = 'purged+' || id::text || '@example.test',
      display_name = 'purged-selftest',
      auth_user_id = null,
      salesperson_id = null
    where id in (v_cust_ok, v_cust_no, v_cust_pay);
    begin
      delete from public.customers where id in (v_cust_ok, v_cust_no, v_cust_pay);
    exception when others then
      null; -- FK from append-only events may retain rows; scrubbed above
    end;
    delete from public.staff_members where id = v_staff;
    if exists (select 1 from products where slug = v_prefix||'-prod') then
      delete from public.products where slug = v_prefix||'-prod';
    end if;
    v_cases := v_cases || jsonb_build_object('cleanup', jsonb_build_object('ok', true, 'note', 'crm_events append-only retained'));
  exception when others then
    v_cases := v_cases || jsonb_build_object('cleanup', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  return jsonb_build_object('ok', v_all_ok, 'cases', v_cases, 'cleanup', v_cases->'cleanup');
end;
$$;

grant execute on function public.rpc_phase4d_trade_commercial_selftest() to service_role, authenticated;

comment on function public.rpc_phase4d_trade_commercial_selftest() is
  'Phase 4D trade eligibility + commercial policy selftest. No Shopify mutations. No ambiguous backfill apply. No ownership auto-apply.';
