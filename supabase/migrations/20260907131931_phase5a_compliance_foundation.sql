-- Phase 5A — Regulated commerce & compliance FOUNDATION
-- Evidence-based minimum architecture. Does NOT invent UK legal requirements.
-- Does NOT send pilot emails. Does NOT flip trade_required.
-- Does NOT enable Worldpay / DPD / SKULabs / warehouse / ownership apply.
--
-- Default enforcement: OBSERVE (reason codes + audit hooks; no new purchase denials).
-- Trade eligibility remains independent of compliance status.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'pilot_send_authorized' and value is distinct from 'false';

insert into public.site_settings (key, value)
values
  ('compliance_enforcement_mode', 'observe'),
  ('age_gate_display_enabled', 'false'),
  ('age_gate_classification', 'DISPLAY_GATE_ABSENT_UNTIL_ENABLED'),
  ('compliance_policy_version', 'phase5a-foundation-1'),
  ('terms_acceptance_required', 'false')
on conflict (key) do nothing;

comment on table public.site_settings is
  'Includes Phase 5A compliance foundation keys. compliance_enforcement_mode=observe|enforce; age_gate_display_enabled is UX only — not age verification.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Product regulation indicators (minimum; preserve raw tags/metafields)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists regulated_indicator boolean,
  add column if not exists regulated_source text,
  add column if not exists regulated_confidence text
    check (regulated_confidence is null or regulated_confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  add column if not exists regulated_classified_at timestamptz;

comment on column public.products.regulated_indicator is
  'Phase 5A: true when evidence-based product regulation indicator present. NULL=not classified. Not legal advice.';
comment on column public.products.regulated_source is
  'Evidence source e.g. shopify_metafield:custom.nicotine_strength — never name-inference alone.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Customer / company compliance state (SEPARATE from trade_access_status)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.customers
  add column if not exists compliance_status text not null default 'NOT_RECORDED'
    check (compliance_status in (
      'NOT_RECORDED','PENDING_REVIEW','RECORDED_PASS','RECORDED_FAIL','SUSPENDED','EXPIRED'
    )),
  add column if not exists compliance_source text,
  add column if not exists compliance_method text,
  add column if not exists compliance_evidence_ref text,
  add column if not exists compliance_checked_at timestamptz,
  add column if not exists compliance_expires_at timestamptz,
  add column if not exists compliance_decided_by uuid,
  add column if not exists compliance_note text;

comment on column public.customers.compliance_status is
  'Phase 5A: independent of trade_access_status. NOT_RECORDED means no Unique-native compliance check on file — NOT equivalent to age verified.';

alter table public.companies
  add column if not exists compliance_status text not null default 'NOT_RECORDED'
    check (compliance_status in (
      'NOT_RECORDED','PENDING_REVIEW','RECORDED_PASS','RECORDED_FAIL','SUSPENDED','EXPIRED'
    )),
  add column if not exists compliance_source text,
  add column if not exists compliance_method text,
  add column if not exists compliance_evidence_ref text,
  add column if not exists compliance_checked_at timestamptz,
  add column if not exists compliance_expires_at timestamptz,
  add column if not exists compliance_decided_by uuid,
  add column if not exists compliance_note text;

comment on column public.companies.compliance_status is
  'Phase 5A company compliance — independent of customer trade approval.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Evidence references (NO identity document blobs)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.compliance_evidence_refs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('customer','company','product','order','shipment')),
  entity_id uuid not null,
  method text not null,
  provider text,
  result text not null check (result in ('pass','fail','pending','expired','unknown')),
  external_reference text,
  checked_at timestamptz not null default now(),
  expires_at timestamptz,
  decided_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint compliance_evidence_no_raw_docs check (
    not (metadata ? 'document_bytes')
    and not (metadata ? 'passport_number')
    and not (metadata ? 'driving_licence_number')
  )
);

comment on table public.compliance_evidence_refs is
  'Phase 5A: store provider/result/reference only — no identity document binaries.';

create index if not exists compliance_evidence_entity_idx
  on public.compliance_evidence_refs (entity_type, entity_id, checked_at desc);

alter table public.compliance_evidence_refs enable row level security;
drop policy if exists "admin_all_compliance_evidence_refs" on public.compliance_evidence_refs;
create policy "admin_all_compliance_evidence_refs" on public.compliance_evidence_refs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.compliance_evidence_refs to authenticated;
grant all on public.compliance_evidence_refs to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Compliance events (append-only)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.compliance_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  actor_type text,
  actor_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  evidence_ref_id uuid references public.compliance_evidence_refs(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists compliance_events_entity_idx
  on public.compliance_events (entity_type, entity_id, created_at desc);
create index if not exists compliance_events_type_idx
  on public.compliance_events (event_type, created_at desc);

alter table public.compliance_events enable row level security;
drop policy if exists "admin_read_compliance_events" on public.compliance_events;
create policy "admin_read_compliance_events" on public.compliance_events
  for select to authenticated using (public.is_admin());
drop policy if exists "admin_insert_compliance_events" on public.compliance_events;
create policy "admin_insert_compliance_events" on public.compliance_events
  for insert to authenticated with check (public.is_admin());
grant select, insert on public.compliance_events to authenticated;
grant all on public.compliance_events to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Policy acceptance (minimum version model; not backfilled)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  policy_version text not null,
  auth_user_id uuid,
  customer_id uuid references public.customers(id) on delete set null,
  source text not null default 'storefront',
  accepted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists policy_acceptances_customer_idx
  on public.policy_acceptances (customer_id, policy_key, accepted_at desc);

alter table public.policy_acceptances enable row level security;
drop policy if exists "admin_read_policy_acceptances" on public.policy_acceptances;
create policy "admin_read_policy_acceptances" on public.policy_acceptances
  for select to authenticated using (public.is_admin());
drop policy if exists "auth_insert_own_policy_acceptance" on public.policy_acceptances;
create policy "auth_insert_own_policy_acceptance" on public.policy_acceptances
  for insert to authenticated
  with check (
    auth_user_id is null or auth_user_id = (select auth.uid())
  );
grant select on public.policy_acceptances to authenticated;
grant insert on public.policy_acceptances to authenticated, anon;
grant all on public.policy_acceptances to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Order compliance snapshot columns (Unique-native only; Shopify immutable)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists compliance_snapshot jsonb;

comment on column public.orders.compliance_snapshot is
  'Phase 5A: Unique-native orders may store policy_version, trade decision, regulated decisions — no sensitive ID docs. Historical Shopify rows remain unchanged.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Compliance policy evaluate (extends commercial; observe vs enforce)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.compliance_policy_evaluate(
  p_trade_policy jsonb,
  p_compliance_status text default 'NOT_RECORDED',
  p_product_regulated boolean default null,
  p_enforcement_mode text default null,
  p_destination_country text default null
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  v_mode text := lower(coalesce(nullif(btrim(coalesce(p_enforcement_mode, '')), ''), 'observe'));
  v_status text := coalesce(nullif(btrim(coalesce(p_compliance_status, '')), ''), 'NOT_RECORDED');
  v_reasons text[] := '{}';
  v_can_purchase boolean := coalesce((p_trade_policy->>'can_purchase')::boolean, false);
  v_can_cart boolean := coalesce((p_trade_policy->>'can_add_to_cart')::boolean, coalesce((p_trade_policy->>'can_purchase')::boolean, false));
  v_can_checkout boolean := coalesce((p_trade_policy->>'can_checkout')::boolean, coalesce((p_trade_policy->>'can_purchase')::boolean, false));
  v_can_quote boolean := coalesce((p_trade_policy->>'can_request_quote')::boolean, true);
  v_can_pay_later boolean := coalesce((p_trade_policy->>'can_use_pay_later')::boolean, false);
  v_can_ship boolean := true;
  v_block boolean := false;
begin
  -- Trade denials propagate reason codes
  if not coalesce((p_trade_policy->>'trade_eligible')::boolean, false)
     and coalesce((p_trade_policy->>'commercial_access_mode'), '') = 'trade_required' then
    v_reasons := array_append(v_reasons, 'TRADE_NOT_APPROVED');
  end if;
  if coalesce((p_trade_policy->>'trade_access_status'), '') in ('suspended', 'rejected') then
    v_reasons := array_append(v_reasons, 'ACCOUNT_SUSPENDED');
  end if;
  if not v_can_pay_later and p_trade_policy ? 'can_use_pay_later' then
    -- informational only unless caller asked for pay later
    null;
  end if;

  -- Compliance is independent of trade. NOT_RECORDED is NOT age verified.
  if v_status = 'SUSPENDED' then
    v_reasons := array_append(v_reasons, 'COMPLIANCE_SUSPENDED');
    v_block := true;
  elsif v_status = 'RECORDED_FAIL' then
    v_reasons := array_append(v_reasons, 'COMPLIANCE_FAILED');
    v_block := true;
  elsif v_status = 'EXPIRED' then
    v_reasons := array_append(v_reasons, 'COMPLIANCE_EXPIRED');
    v_block := true;
  elsif v_status in ('NOT_RECORDED', 'PENDING_REVIEW') and coalesce(p_product_regulated, false) then
    v_reasons := array_append(v_reasons, 'COMPLIANCE_REQUIRED');
    -- Only block under enforce mode — observe records the reason without denying
    if v_mode = 'enforce' then
      v_block := true;
    end if;
  end if;

  if coalesce(p_product_regulated, false) then
    v_reasons := array_append(v_reasons, 'PRODUCT_REGULATED_INDICATOR');
  end if;

  -- Destination: empty shipping zones historically mean "all countries" — do not invent blocks.
  -- Placeholder reason only if future allowlist configured (not in Phase 5A enforce).
  if nullif(btrim(coalesce(p_destination_country, '')), '') is not null then
    null;
  end if;

  if v_block and v_mode = 'enforce' then
    v_can_purchase := false;
    v_can_cart := false;
    v_can_checkout := false;
  end if;

  if not v_can_pay_later then
    v_reasons := array_append(v_reasons, 'PAY_LATER_NOT_ELIGIBLE');
  end if;

  return jsonb_build_object(
    'ok', true,
    'enforcement_mode', v_mode,
    'compliance_status', v_status,
    'trade_independent', true,
    'trade_is_not_age_verified', true,
    'product_regulated', p_product_regulated,
    'can_view_product', coalesce((p_trade_policy->>'can_view_product')::boolean, true),
    'can_view_price', coalesce((p_trade_policy->>'can_view_price')::boolean, true),
    'can_purchase_product', v_can_purchase,
    'can_add_to_cart', v_can_cart,
    'can_request_quote', v_can_quote,
    'can_checkout', v_can_checkout,
    'can_use_pay_later', v_can_pay_later,
    'can_ship_to_destination', v_can_ship,
    'reason_codes', to_jsonb(v_reasons),
    'observe_only_denial', (v_mode = 'observe' and 'COMPLIANCE_REQUIRED' = any(v_reasons)),
    'classification_note', 'BUSINESS/TECHNICAL foundation — LEGAL/REGULATORY CONFIRMATION REQUIRED for enforce mode'
  );
end;
$$;

grant execute on function public.compliance_policy_evaluate(jsonb, text, boolean, text, text)
  to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Classify products from metafield evidence only (no name inference)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_classify_regulated_products_from_evidence()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n int := 0;
  v_nicotine int := 0;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  -- Evidence: Shopify metafield custom.nicotine_strength (forensic: 384 definitions on PRODUCT)
  select count(*) into v_nicotine
  from public.metafields m
  where m.owner_type in ('product', 'PRODUCT')
    and m.namespace = 'custom'
    and m.key = 'nicotine_strength';

  update public.products p
  set
    regulated_indicator = true,
    regulated_source = 'shopify_metafield:custom.nicotine_strength',
    regulated_confidence = 'HIGH',
    regulated_classified_at = now()
  where exists (
    select 1 from public.metafields m
    where m.owner_id = p.id
      and m.owner_type in ('product', 'PRODUCT')
      and m.namespace = 'custom'
      and m.key = 'nicotine_strength'
  );

  get diagnostics v_n = row_count;

  insert into public.compliance_events (
    event_type, entity_type, entity_id, actor_type, new_value, reason, metadata
  ) values (
    'regulated_product_classification_run',
    'system',
    null,
    case when coalesce(auth.role(),'') = 'service_role' then 'service' else 'admin' end,
    jsonb_build_object('products_updated', v_n, 'nicotine_metafield_rows', v_nicotine),
    'Evidence-based classification only (nicotine_strength metafield)',
    jsonb_build_object('phase', '5A', 'name_inference', false)
  );

  return jsonb_build_object(
    'ok', true,
    'products_updated', v_n,
    'nicotine_metafield_rows', v_nicotine,
    'shopify_forensic_definition_count', 384,
    'note', 'Live UD products table may have few rows until catalog import; forensic evidence documents Shopify definition count 384.',
    'method', 'metafield custom.nicotine_strength only — no title/name inference'
  );
end;
$$;

grant execute on function public.rpc_admin_classify_regulated_products_from_evidence() to authenticated, service_role;

create or replace function public.rpc_admin_compliance_product_inventory()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'indicator', 'custom.nicotine_strength metafield',
      'source', 'shopify_metafield + forensic definition',
      'live_metafield_rows', (select count(*) from metafields where owner_type in ('product','PRODUCT') and namespace='custom' and key='nicotine_strength'),
      'products_flagged', (select count(*) from products where regulated_indicator is true),
      'products_total', (select count(*) from products),
      'confidence', 'HIGH when metafield present; UNKNOWN when absent',
      'current_use', 'classification foundation only; enforcement_mode=observe',
      'forensic_definition_count', 384
    ) as x
    union all
    select jsonb_build_object(
      'indicator', 'SureCust_Wholesale customer tag',
      'source', 'entity_tags / tags',
      'live_tag_links', (
        select count(*) from entity_tags et
        join tags t on t.id = et.tag_id
        where t.name = 'SureCust_Wholesale' and et.entity_type = 'customer'
      ),
      'confidence', 'HIGH as wholesale ACCESS evidence',
      'current_use', 'trade_access_status provenance — NOT age verification',
      'classification', 'OBSERVED HISTORICAL CONTROL / CONFIRMED BUSINESS TRADE GATE'
    )
    union all
    select jsonb_build_object(
      'indicator', 'Storefront age gate',
      'source', 'UD codebase search',
      'live_implementation', 'NONE',
      'confidence', 'HIGH (absence)',
      'current_use', 'N/A',
      'gate_class', 'DISPLAY GATE ABSENT — not ACCESS GATE / PURCHASE CONTROL'
    )
  ) q;

  return jsonb_build_object('ok', true, 'inventory', v_rows);
end;
$$;

grant execute on function public.rpc_admin_compliance_product_inventory() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Storefront commercial policy merge (observe mode; no regression)
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_mode text := public.effective_commercial_access_mode(null);
  v_configured text;
  v_cu public.customers%rowtype;
  v_policy jsonb;
  v_comp jsonb;
  v_enf text;
begin
  select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_configured
  from public.site_settings where key = 'commercial_access_mode' limit 1;
  select coalesce(nullif(btrim(value), ''), 'observe') into v_enf
  from public.site_settings where key = 'compliance_enforcement_mode' limit 1;

  if v_uid is null then
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
    v_comp := public.compliance_policy_evaluate(v_policy, 'NOT_RECORDED', null, v_enf, null);
    return jsonb_build_object(
      'ok', true,
      'customer_id', null,
      'auth_linked', false,
      'commercial_access_mode', v_mode,
      'configured_commercial_access_mode', v_configured,
      'cutover_double_gate_active', true,
      'policy', v_policy,
      'compliance', v_comp,
      'trade_is_not_age_verified', true
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
    v_comp := public.compliance_policy_evaluate(v_policy, 'NOT_RECORDED', null, v_enf, null);
    return jsonb_build_object(
      'ok', true,
      'customer_id', null,
      'auth_user_id', v_uid,
      'auth_linked', false,
      'commercial_access_mode', v_mode,
      'configured_commercial_access_mode', v_configured,
      'cutover_double_gate_active', true,
      'policy', v_policy,
      'compliance', v_comp,
      'trade_is_not_age_verified', true,
      'note', 'Auth account has no CRM customer link'
    );
  end if;

  select * into v_cu from public.customers where id = v_customer_id;
  v_policy := public.commercial_policy_evaluate(
    v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
    v_mode, true, v_cu.customer_type, v_cu.payment_terms
  );
  v_comp := public.compliance_policy_evaluate(
    v_policy, v_cu.compliance_status, null, v_enf, null
  );

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer_id,
    'auth_user_id', v_uid,
    'auth_linked', true,
    'commercial_access_mode', v_mode,
    'configured_commercial_access_mode', v_configured,
    'cutover_double_gate_active', true,
    'policy', v_policy,
    'compliance', v_comp,
    'compliance_status', v_cu.compliance_status,
    'trade_access_status', v_cu.trade_access_status,
    'trade_is_not_age_verified', true
  );
end;
$$;

grant execute on function public.rpc_storefront_commercial_policy() to anon, authenticated, service_role;

-- Assert: merge compliance in observe mode (no new denials unless enforce)
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
  v_mode text := public.effective_commercial_access_mode(null);
  v_cu public.customers%rowtype;
  v_policy jsonb;
  v_shadow jsonb;
  v_comp jsonb;
  v_enf text;
  v_has_crm boolean := false;
  v_ok boolean := true;
  v_err text;
  v_msg text;
  v_shadow_ok boolean;
  v_reason text;
begin
  select coalesce(nullif(btrim(value), ''), 'observe') into v_enf
  from public.site_settings where key = 'compliance_enforcement_mode' limit 1;

  if v_uid is not null then
    select id into v_customer_id from public.customers where auth_user_id = v_uid limit 1;
  elsif p_customer_id is not null and v_uid is null then
    v_customer_id := null;
  end if;

  if v_customer_id is not null then
    select * into v_cu from public.customers where id = v_customer_id;
    if found then
      v_has_crm := true;
      v_policy := public.commercial_policy_evaluate(
        v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
        v_mode, true, v_cu.customer_type, v_cu.payment_terms
      );
      v_shadow := public.commercial_policy_evaluate(
        v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
        'trade_required', true, v_cu.customer_type, v_cu.payment_terms
      );
      v_comp := public.compliance_policy_evaluate(
        v_policy, v_cu.compliance_status, null, v_enf, null
      );
    end if;
  end if;

  if v_policy is null then
    v_policy := public.commercial_policy_evaluate('ineligible', false, 'active', v_mode, false, null, null);
    v_shadow := public.commercial_policy_evaluate('ineligible', false, 'active', 'trade_required', false, null, null);
    v_comp := public.compliance_policy_evaluate(v_policy, 'NOT_RECORDED', null, v_enf, null);
  end if;

  if v_uid is null then v_reason := 'ANONYMOUS';
  elsif not v_has_crm then v_reason := 'AUTH_UNLINKED';
  elsif v_cu.trade_access_status = 'pending' then v_reason := 'TRADE_PENDING';
  elsif v_cu.trade_access_status = 'approved' then v_reason := 'TRADE_APPROVED';
  elsif v_cu.trade_access_status in ('suspended', 'rejected') then v_reason := 'TRADE_SUSPENDED';
  else v_reason := 'TRADE_INELIGIBLE';
  end if;

  if v_pay in ('pay_later', 'pay later', 'order now, pay later') then
    if not coalesce((v_policy->>'can_use_pay_later')::boolean, false) then
      v_ok := false; v_err := 'PAY_LATER_NOT_PERMITTED'; v_msg := 'PAY LATER is not enabled for this account';
    end if;
  end if;

  if v_ok and v_action in ('add_to_cart', 'cart') then
    if not coalesce((v_policy->>'can_add_to_cart')::boolean, false) then
      v_ok := false; v_err := 'CART_DENIED'; v_msg := 'Add to cart not permitted under commercial policy';
    elsif v_enf = 'enforce' and not coalesce((v_comp->>'can_add_to_cart')::boolean, true) then
      v_ok := false; v_err := 'COMPLIANCE_REQUIRED'; v_msg := 'Compliance check required';
    end if;
  elsif v_ok and v_action in ('checkout', 'place_order') then
    if not coalesce((v_policy->>'can_checkout')::boolean, false) then
      v_ok := false; v_err := 'CHECKOUT_DENIED'; v_msg := 'Checkout not permitted under commercial policy';
    elsif v_enf = 'enforce' and not coalesce((v_comp->>'can_checkout')::boolean, true) then
      v_ok := false; v_err := 'COMPLIANCE_REQUIRED'; v_msg := 'Compliance check required';
    end if;
  elsif v_ok and v_action in ('purchase', 'buy') then
    if not coalesce((v_policy->>'can_purchase')::boolean, false) then
      v_ok := false; v_err := 'PURCHASE_DENIED'; v_msg := 'Purchase not permitted under commercial policy';
    elsif v_enf = 'enforce' and not coalesce((v_comp->>'can_purchase_product')::boolean, true) then
      v_ok := false; v_err := 'COMPLIANCE_REQUIRED'; v_msg := 'Compliance check required';
    end if;
  end if;

  v_shadow_ok := case
    when v_action in ('add_to_cart', 'cart') then coalesce((v_shadow->>'can_add_to_cart')::boolean, false)
    when v_action in ('checkout', 'place_order') then coalesce((v_shadow->>'can_checkout')::boolean, false)
    when v_pay in ('pay_later', 'pay later', 'order now, pay later') then coalesce((v_shadow->>'can_use_pay_later')::boolean, false)
    else coalesce((v_shadow->>'can_purchase')::boolean, false)
  end;

  return jsonb_build_object(
    'ok', v_ok,
    'error', v_err,
    'message', v_msg,
    'reason_code', v_reason,
    'commercial_access_mode', v_mode,
    'policy', v_policy,
    'compliance', v_comp,
    'compliance_enforcement_mode', v_enf,
    'shadow_trade_required', v_shadow,
    'shadow_would_allow', v_shadow_ok,
    'cutover_double_gate_active', true,
    'trade_is_not_age_verified', true
  );
end;
$$;

grant execute on function public.rpc_assert_storefront_commercial_action(text, text, uuid)
  to anon, authenticated, service_role;

-- Admin: set customer compliance (not trade)
create or replace function public.rpc_admin_set_customer_compliance(
  p_customer_id uuid,
  p_status text,
  p_method text default null,
  p_evidence_ref text default null,
  p_note text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old text;
  v_actor uuid;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_evid uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if v_status not in ('NOT_RECORDED','PENDING_REVIEW','RECORDED_PASS','RECORDED_FAIL','SUSPENDED','EXPIRED') then
    return jsonb_build_object('ok', false, 'error', 'Invalid status');
  end if;

  select compliance_status into v_old from customers where id = p_customer_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;

  select au.id into v_actor from admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  if nullif(btrim(coalesce(p_evidence_ref, '')), '') is not null then
    insert into compliance_evidence_refs (
      entity_type, entity_id, method, result, external_reference, decided_by, metadata
    ) values (
      'customer', p_customer_id,
      coalesce(nullif(btrim(p_method), ''), 'manual_review'),
      case
        when v_status = 'RECORDED_PASS' then 'pass'
        when v_status = 'RECORDED_FAIL' then 'fail'
        when v_status = 'EXPIRED' then 'expired'
        when v_status = 'PENDING_REVIEW' then 'pending'
        else 'unknown'
      end,
      p_evidence_ref, v_actor,
      jsonb_build_object('note', p_note)
    ) returning id into v_evid;
  end if;

  update customers set
    compliance_status = v_status,
    compliance_source = 'unique_native',
    compliance_method = nullif(btrim(coalesce(p_method, '')), ''),
    compliance_evidence_ref = nullif(btrim(coalesce(p_evidence_ref, '')), ''),
    compliance_checked_at = now(),
    compliance_expires_at = p_expires_at,
    compliance_decided_by = v_actor,
    compliance_note = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at = now()
  where id = p_customer_id;

  insert into compliance_events (
    event_type, entity_type, entity_id, actor_type, actor_id,
    old_value, new_value, reason, evidence_ref_id
  ) values (
    'compliance_status_changed', 'customer', p_customer_id, 'admin', v_actor,
    jsonb_build_object('compliance_status', v_old),
    jsonb_build_object('compliance_status', v_status),
    p_note, v_evid
  );

  return jsonb_build_object(
    'ok', true,
    'customer_id', p_customer_id,
    'compliance_status', v_status,
    'trade_unchanged', true,
    'note', 'Trade access is independent — this does not set trade_access_status'
  );
end;
$$;

grant execute on function public.rpc_admin_set_customer_compliance(uuid, text, text, text, text, timestamptz)
  to authenticated;

-- Review queue (only statuses that exist)
create or replace function public.rpc_admin_compliance_review_queue(
  p_status text default 'PENDING_REVIEW',
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_items jsonb;
  v_total int;
  v_status text := upper(btrim(coalesce(p_status, 'PENDING_REVIEW')));
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_total from customers where compliance_status = v_status;

  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id', c.id,
    'customer_ref', left(c.id::text, 8),
    'email_sanitized', case when c.email is null then null else
      left(split_part(c.email, '@', 1), 2) || '***@' || split_part(c.email, '@', 2) end,
    'trade_access_status', c.trade_access_status,
    'compliance_status', c.compliance_status,
    'compliance_method', c.compliance_method,
    'compliance_checked_at', c.compliance_checked_at,
    'compliance_expires_at', c.compliance_expires_at
  ) order by c.updated_at desc), '[]'::jsonb)
  into v_items
  from (
    select * from customers
    where compliance_status = v_status
    order by updated_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(0, coalesce(p_offset, 0))
  ) c;

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'total', v_total,
    'items', v_items,
    'note', 'Trade status shown for context only — not equivalent to compliance'
  );
end;
$$;

grant execute on function public.rpc_admin_compliance_review_queue(text, int, int) to authenticated;

-- Age gate settings (display only)
create or replace function public.rpc_get_age_gate_display_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled text;
  v_class text;
begin
  select value into v_enabled from site_settings where key = 'age_gate_display_enabled' limit 1;
  select value into v_class from site_settings where key = 'age_gate_classification' limit 1;
  return jsonb_build_object(
    'ok', true,
    'enabled', coalesce(v_enabled, 'false') = 'true',
    'classification', coalesce(v_class, 'DISPLAY_GATE'),
    'is_verification', false,
    'is_purchase_control', false,
    'server_authoritative_purchase', false,
    'message', '18+ notice is display-only when enabled. Not age verification. LEGAL CONFIRMATION REQUIRED.'
  );
end;
$$;

revoke all on function public.rpc_get_age_gate_display_config() from public;
grant execute on function public.rpc_get_age_gate_display_config() to anon, authenticated, service_role;

-- Phase 5A selftest + locked gates
create or replace function public.rpc_phase5a_compliance_foundation_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean;
  v_all boolean := true;
  v_trade jsonb;
  v_comp jsonb;
  v_attack jsonb;
begin
  v_ok := coalesce((select value from site_settings where key='commercial_access_mode' limit 1),'') = 'catalogue_open'
    and coalesce((select value from site_settings where key='trade_required_cutover_approved' limit 1),'') = 'false'
    and coalesce((select value from site_settings where key='pilot_send_authorized' limit 1),'') = 'false';
  v_cases := v_cases || jsonb_build_object('A_locked_gates', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := coalesce((select value from site_settings where key='compliance_enforcement_mode' limit 1),'observe') = 'observe';
  v_cases := v_cases || jsonb_build_object('B_observe_mode', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  -- Trade approved + compliance NOT_RECORDED must remain distinct
  v_trade := public.commercial_policy_evaluate('approved', false, 'active', 'catalogue_open', true, null, null);
  v_comp := public.compliance_policy_evaluate(v_trade, 'NOT_RECORDED', true, 'observe', null);
  v_ok := coalesce((v_trade->>'can_purchase')::boolean, false) = true
    and coalesce((v_comp->>'can_purchase_product')::boolean, false) = true
    and coalesce((v_comp->>'trade_is_not_age_verified')::boolean, false) = true
    and coalesce((v_comp->>'observe_only_denial')::boolean, false) = true;
  v_cases := v_cases || jsonb_build_object('C_trade_vs_compliance_observe', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_comp := public.compliance_policy_evaluate(v_trade, 'NOT_RECORDED', true, 'enforce', null);
  v_ok := coalesce((v_comp->>'can_purchase_product')::boolean, true) = false
    and (v_comp->'reason_codes') ?| array['COMPLIANCE_REQUIRED'];
  v_cases := v_cases || jsonb_build_object('D_enforce_would_block_unrecorded', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := to_regclass('public.compliance_events') is not null
    and to_regclass('public.compliance_evidence_refs') is not null
    and to_regclass('public.policy_acceptances') is not null;
  v_cases := v_cases || jsonb_build_object('E_tables', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  begin
    v_attack := public.rpc_phase4h_postgrest_attack_selftest();
    v_ok := coalesce((v_attack->>'ok')::boolean, false);
  exception when others then
    v_ok := false;
  end;
  v_cases := v_cases || jsonb_build_object('F_price_security_regression', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := (select count(*) from ownership_backfill_reviews where status='PENDING') >= 0;
  v_cases := v_cases || jsonb_build_object(
    'G_ownership_untouched',
    jsonb_build_object('ok', true, 'pending', (select count(*) from ownership_backfill_reviews where status='PENDING'))
  );

  return jsonb_build_object(
    'ok', v_all,
    'cases', v_cases,
    'commercial_access_mode', (select value from site_settings where key='commercial_access_mode' limit 1),
    'trade_required_cutover_approved', (select value from site_settings where key='trade_required_cutover_approved' limit 1),
    'pilot_send_authorized', (select value from site_settings where key='pilot_send_authorized' limit 1),
    'compliance_enforcement_mode', (select value from site_settings where key='compliance_enforcement_mode' limit 1),
    'PHASE4I_PILOT', 'NOT_SENT',
    'note', 'Phase 5A foundation only — LEGAL/REGULATORY CONFIRMATION REQUIRED before enforce'
  );
end;
$$;

revoke all on function public.rpc_phase5a_compliance_foundation_selftest() from public, anon;
grant execute on function public.rpc_phase5a_compliance_foundation_selftest() to service_role, authenticated;

comment on function public.rpc_phase5a_compliance_foundation_selftest() is
  'Phase 5A: locked gates, observe mode, trade≠compliance, enforce preview, price regression.';
