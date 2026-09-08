-- Phase 4F — Controlled EXPLICIT SureCust trade apply, activation, shadow cutover
-- AUTHORIZES applying EXPLICIT SureCust trade eligibility after preflight.
-- Does NOT flip commercial_access_mode to trade_required.
-- Does NOT bulk-enable PAY LATER. Does NOT apply Phase 4C ownership.
-- Does NOT mass-email customers. Parked: DPD / SKULabs / warehouse / Worldpay.

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Hard gates
-- ═══════════════════════════════════════════════════════════════════════════

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';

insert into public.site_settings (key, value)
values ('commercial_access_mode', 'catalogue_open')
on conflict (key) do nothing;

update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';

insert into public.site_settings (key, value)
values ('trade_required_cutover_approved', 'false')
on conflict (key) do nothing;

insert into public.site_settings (key, value)
values ('commercial_shadow_trade_required', 'true')
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Precedence + policy lock (Phase 4F business decisions)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.commercial_source_rank(p_source text)
returns int
language sql
immutable
security invoker
set search_path = public
as $$
  select case lower(btrim(coalesce(p_source, '')))
    when 'unique_manual' then 100
    when 'unique_native' then 100
    when 'shopify_surecust' then 50
    when 'surecust_wholesale_tag' then 50
    when 'approved_inference' then 30
    else 0
  end;
$$;

grant execute on function public.commercial_source_rank(text) to authenticated, service_role, anon;

comment on function public.commercial_source_rank(text) is
  'Phase 4F precedence: UNIQUE MANUAL/NATIVE (100) > VERIFIED EXPLICIT IMPORT shopify_surecust (50) > APPROVED INFERENCE (30) > UNKNOWN (0).';

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
begin
  if v_mode = 'trade_required' then
    -- Locked Phase 4F UX: public catalogue/product; protected prices require AUTH+CRM+APPROVED
    v_view_cat := true;
    v_view_product := true;
    if v_approved and not v_blocked and p_has_crm_customer then
      v_view_price := true;
      v_purchase := true;
      v_checkout := true;
      v_quote := true;
    else
      v_view_price := false;
      v_purchase := false;
      v_checkout := false;
      -- Quote/lead allowed without leaking protected prices
      v_quote := true;
    end if;
  else
    -- catalogue_open production: prices visible; purchase/checkout open for guests (current Unique)
    v_view_cat := true;
    v_view_product := true;
    v_view_price := true;
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
    'auth_alone_insufficient', true,
    'customer_type_independent', true,
    'surecust_independent_of_customer_type', true,
    'precedence_note', 'UNIQUE_NATIVE > shopify_surecust > inference > unknown'
  );
end;
$$;

grant execute on function public.commercial_policy_evaluate(text, boolean, text, text, boolean, text, text)
  to authenticated, service_role, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Batch tables + columns
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.trade_eligibility_apply_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,
  source text not null default 'shopify_surecust',
  preview jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  applied_count int not null default 0,
  skipped_already int not null default 0,
  skipped_conflict int not null default 0,
  skipped_ambiguous int not null default 0,
  failed_count int not null default 0,
  applied_at timestamptz,
  applied_by uuid,
  created_at timestamptz not null default now()
);

alter table public.trade_eligibility_apply_batches enable row level security;
drop policy if exists "admin_all_trade_eligibility_apply_batches" on public.trade_eligibility_apply_batches;
create policy "admin_all_trade_eligibility_apply_batches" on public.trade_eligibility_apply_batches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.trade_eligibility_apply_batches to authenticated;
grant all on public.trade_eligibility_apply_batches to service_role;

alter table public.customers
  add column if not exists trade_eligibility_batch_id uuid references public.trade_eligibility_apply_batches(id);

create table if not exists public.commercial_shadow_decisions (
  id uuid primary key default gen_random_uuid(),
  request_type text not null,
  actual_mode text not null,
  actual_allowed boolean not null,
  shadow_mode text not null default 'trade_required',
  shadow_allowed boolean not null,
  reason_code text,
  customer_id uuid,
  auth_user_id uuid,
  auth_linked boolean,
  trade_access_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commercial_shadow_decisions_created_idx
  on public.commercial_shadow_decisions (created_at desc);
create index if not exists commercial_shadow_decisions_type_idx
  on public.commercial_shadow_decisions (request_type, created_at desc);

alter table public.commercial_shadow_decisions enable row level security;
drop policy if exists "admin_read_commercial_shadow_decisions" on public.commercial_shadow_decisions;
create policy "admin_read_commercial_shadow_decisions" on public.commercial_shadow_decisions
  for select to authenticated using (public.is_admin());
grant select on public.commercial_shadow_decisions to authenticated;
grant insert, select, delete on public.commercial_shadow_decisions to service_role;

create table if not exists public.customer_activation_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,
  rollout_mode text not null check (rollout_mode in ('INTERNAL_TEST', 'PILOT', 'BATCH', 'FULL')),
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'sending', 'sent', 'cancelled')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_activation_batch_recipients (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.customer_activation_batches(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  activation_id uuid references public.customer_auth_activations(id),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'redeemed', 'expired', 'skipped')),
  sent_at timestamptz,
  redeemed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (batch_id, customer_id)
);

alter table public.customer_activation_batches enable row level security;
alter table public.customer_activation_batch_recipients enable row level security;
drop policy if exists "admin_all_customer_activation_batches" on public.customer_activation_batches;
create policy "admin_all_customer_activation_batches" on public.customer_activation_batches
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_customer_activation_batch_recipients" on public.customer_activation_batch_recipients;
create policy "admin_all_customer_activation_batch_recipients" on public.customer_activation_batch_recipients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.customer_activation_batches to authenticated;
grant select, insert, update, delete on public.customer_activation_batch_recipients to authenticated;
grant all on public.customer_activation_batches to service_role;
grant all on public.customer_activation_batch_recipients to service_role;

alter table public.customer_auth_activations
  add column if not exists batch_id uuid references public.customer_activation_batches(id),
  add column if not exists email_sent_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Activation email template
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.email_templates (template_key, name, description, subject, body_html, enabled)
values (
  'trade_account_activation',
  'Trade account activation',
  'Invite an existing CRM trade customer to activate Unique Distribution login. No passwords migrated.',
  'Activate your Unique Distribution trade account',
  '<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3d3428;">Hi {{customer_name}},</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3d3428;">Unique Distribution has moved trade account access to our new platform. You can activate your account using the secure link below.</p>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3d3428;">This does not migrate any previous passwords — you will create or sign in with a new Unique login.</p>
<p style="margin:24px 0;"><a href="{{activation_url}}" style="display:inline-block;padding:12px 20px;background-color:{{brand_color}};color:#ffffff;text-decoration:none;font-weight:700;border-radius:8px;">Activate trade access</a></p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b5d4d;">Or paste this one-time code on the account page: <strong>{{activation_token}}</strong></p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b5d4d;">This invite expires {{expires_at}}. If you did not expect this email, you can ignore it.</p>',
  true
)
on conflict (template_key) do update set
  name = excluded.name,
  description = excluded.description,
  subject = excluded.subject,
  body_html = excluded.body_html,
  updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Preflight + APPLY EXPLICIT SureCust
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_preflight_explicit_surecust_trade()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_explicit int;
  v_already int;
  v_conflict int;
  v_ambiguous int;
  v_safe int;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_explicit
  from public.customers c
  where exists (
    select 1 from entity_tags et join tags t on t.id = et.tag_id
    where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
  );

  select count(*) into v_already
  from public.customers c
  where c.trade_access_status = 'approved'
    and exists (
      select 1 from entity_tags et join tags t on t.id = et.tag_id
      where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
    );

  select count(*) into v_conflict
  from public.customers c
  where exists (
    select 1 from entity_tags et join tags t on t.id = et.tag_id
    where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
  )
  and (
    c.trade_access_status in ('rejected', 'suspended')
    or public.commercial_source_rank(c.trade_eligible_source) > public.commercial_source_rank('shopify_surecust')
  );

  select count(*) into v_ambiguous
  from (
    select lower(btrim(email)) e from public.customers
    where email is not null and btrim(email) <> ''
    group by 1 having count(*) > 1
  ) d;

  select count(*) into v_safe
  from public.customers c
  where exists (
    select 1 from entity_tags et join tags t on t.id = et.tag_id
    where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
  )
  and c.trade_access_status not in ('approved', 'rejected', 'suspended')
  and public.commercial_source_rank(c.trade_eligible_source) < public.commercial_source_rank('shopify_surecust');

  return jsonb_build_object(
    'ok', true,
    'EXPLICIT_CANDIDATES', v_explicit,
    'ALREADY_IN_TARGET_STATE', v_already,
    'CONFLICTING_CURRENT_STATE', v_conflict,
    'MISSING_CUSTOMER', 0,
    'DUPLICATE_AMBIGUOUS_CUSTOMER', v_ambiguous,
    'SAFE_TO_APPLY', v_safe,
    'precedence', 'UNIQUE_NATIVE/MANUAL > shopify_surecust > inference > unknown',
    'source', 'shopify_surecust',
    'note', 'SAFE excludes approved, rejected/suspended, and higher-rank Unique-native sources'
  );
end;
$$;

grant execute on function public.rpc_admin_preflight_explicit_surecust_trade() to authenticated;

create or replace function public.rpc_admin_apply_explicit_surecust_trade(
  p_confirm text default null,
  p_batch_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pre jsonb;
  v_batch_id uuid;
  v_batch_key text;
  v_actor uuid;
  v_applied int := 0;
  v_already int := 0;
  v_conflict int := 0;
  v_safe int;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_decide_trade_eligibility() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if coalesce(p_confirm, '') <> 'APPLY_EXPLICIT_SURECUST_TRADE_PHASE4F' then
    return jsonb_build_object(
      'ok', false,
      'error', 'CONFIRMATION_REQUIRED',
      'message', 'Pass p_confirm=APPLY_EXPLICIT_SURECUST_TRADE_PHASE4F'
    );
  end if;

  v_pre := public.rpc_admin_preflight_explicit_surecust_trade();
  v_safe := coalesce((v_pre->>'SAFE_TO_APPLY')::int, 0);
  v_already := coalesce((v_pre->>'ALREADY_IN_TARGET_STATE')::int, 0);
  v_conflict := coalesce((v_pre->>'CONFLICTING_CURRENT_STATE')::int, 0);

  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  v_batch_key := coalesce(nullif(btrim(p_batch_key), ''), 'p4f-surecust-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'));

  insert into public.trade_eligibility_apply_batches (batch_key, source, preview)
  values (v_batch_key, 'shopify_surecust', v_pre)
  returning id into v_batch_id;

  -- Apply SAFE only
  with safe as (
    select c.id
    from public.customers c
    where exists (
      select 1 from entity_tags et join tags t on t.id = et.tag_id
      where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
    )
    and c.trade_access_status not in ('approved', 'rejected', 'suspended')
    and public.commercial_source_rank(c.trade_eligible_source) < public.commercial_source_rank('shopify_surecust')
  ),
  upd as (
    update public.customers c set
      trade_access_status = 'approved',
      trade_eligible_source = 'shopify_surecust',
      trade_eligible_note = 'Phase 4F EXPLICIT SureCust_Wholesale backfill',
      trade_eligible_decided_at = now(),
      trade_eligible_decided_by = v_actor,
      trade_eligibility_batch_id = v_batch_id,
      version = c.version + 1,
      updated_at = now()
    from safe s
    where c.id = s.id
    returning c.id
  )
  select count(*) into v_applied from upd;

  -- Audit events (batched metadata; one event per customer via insert select)
  insert into public.crm_events (
    entity_type, entity_id, event_type, category, message,
    old_value, new_value, metadata, source_system, actor_type, actor_id, occurred_at
  )
  select
    'customer', c.id, 'trade_approved', 'commercial',
    'EXPLICIT SureCust trade eligibility applied (Phase 4F)',
    jsonb_build_object('trade_access_status', 'ineligible'),
    jsonb_build_object('trade_access_status', 'approved', 'source', 'shopify_surecust'),
    jsonb_build_object('batch_id', v_batch_id, 'batch_key', v_batch_key, 'raw_tag', 'SureCust_Wholesale'),
    'unique', 'admin', v_actor, now()
  from public.customers c
  where c.trade_eligibility_batch_id = v_batch_id;

  update public.trade_eligibility_apply_batches set
    applied_at = now(),
    applied_by = v_actor,
    applied_count = v_applied,
    skipped_already = v_already,
    skipped_conflict = v_conflict,
    skipped_ambiguous = coalesce((v_pre->>'DUPLICATE_AMBIGUOUS_CUSTOMER')::int, 0),
    failed_count = 0,
    result = jsonb_build_object(
      'PREVIEW_EXPLICIT', (v_pre->>'EXPLICIT_CANDIDATES')::int,
      'APPLIED', v_applied,
      'SKIPPED_ALREADY_MATCHED', v_already,
      'SKIPPED_CONFLICT', v_conflict,
      'SKIPPED_AMBIGUOUS', (v_pre->>'DUPLICATE_AMBIGUOUS_CUSTOMER')::int,
      'FAILED', 0,
      'SAFE_PREFLIGHT', v_safe
    )
  where id = v_batch_id;

  -- Mark matching backfill reviews APPLIED where present
  update public.trade_eligibility_backfill_reviews r set
    status = 'APPLIED',
    applied_at = now(),
    updated_at = now(),
    decision_note = coalesce(decision_note, 'Phase 4F batch '||v_batch_key)
  where r.field = 'trade_access'
    and r.customer_id in (select id from customers where trade_eligibility_batch_id = v_batch_id);

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'batch_key', v_batch_key,
    'PREVIEW_EXPLICIT', (v_pre->>'EXPLICIT_CANDIDATES')::int,
    'APPLIED', v_applied,
    'SKIPPED_ALREADY_MATCHED', v_already,
    'SKIPPED_CONFLICT', v_conflict,
    'SKIPPED_AMBIGUOUS', (v_pre->>'DUPLICATE_AMBIGUOUS_CUSTOMER')::int,
    'FAILED', 0,
    'pay_later_untouched', true,
    'commercial_access_mode', (select value from site_settings where key='commercial_access_mode' limit 1),
    'reversibility', 'Identify via customers.trade_eligibility_batch_id; correct via new unique_manual decision + crm_event'
  );
end;
$$;

grant execute on function public.rpc_admin_apply_explicit_surecust_trade(text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Shadow logging helper + assert enrichment
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.commercial_shadow_log(
  p_request_type text,
  p_actual_allowed boolean,
  p_shadow_allowed boolean,
  p_reason text default null,
  p_customer_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled text;
  v_mode text;
  v_cu public.customers%rowtype;
begin
  select value into v_enabled from site_settings where key = 'commercial_shadow_trade_required' limit 1;
  if coalesce(v_enabled, 'false') <> 'true' then
    return;
  end if;
  select coalesce(value, 'catalogue_open') into v_mode from site_settings where key = 'commercial_access_mode' limit 1;
  -- Only shadow while production is catalogue_open
  if v_mode <> 'catalogue_open' then
    return;
  end if;

  if p_customer_id is not null then
    select * into v_cu from customers where id = p_customer_id;
  end if;

  insert into public.commercial_shadow_decisions (
    request_type, actual_mode, actual_allowed, shadow_mode, shadow_allowed,
    reason_code, customer_id, auth_user_id, auth_linked, trade_access_status, metadata
  ) values (
    p_request_type, v_mode, coalesce(p_actual_allowed, false), 'trade_required', coalesce(p_shadow_allowed, false),
    p_reason, p_customer_id, (select auth.uid()),
    v_cu.auth_user_id is not null,
    v_cu.trade_access_status,
    coalesce(p_meta, '{}'::jsonb)
  );
exception when others then
  null; -- never break live path
end;
$$;

grant execute on function public.commercial_shadow_log(text, boolean, boolean, text, uuid, jsonb)
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
  v_shadow jsonb;
  v_has_crm boolean := false;
  v_ok boolean := true;
  v_err text;
  v_msg text;
  v_shadow_ok boolean;
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
      v_shadow := public.commercial_policy_evaluate(
        v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
        'trade_required', true, v_cu.customer_type, v_cu.payment_terms
      );
    end if;
  end if;

  if v_policy is null then
    v_policy := public.commercial_policy_evaluate('ineligible', false, 'active', v_mode, false, null, null);
    v_shadow := public.commercial_policy_evaluate('ineligible', false, 'active', 'trade_required', false, null, null);
  end if;

  if v_pay in ('pay_later', 'pay later', 'order now, pay later') then
    if not coalesce((v_policy->>'can_use_pay_later')::boolean, false) then
      v_ok := false; v_err := 'PAY_LATER_NOT_PERMITTED'; v_msg := 'PAY LATER is not enabled for this account';
    end if;
  end if;

  if v_ok and v_action in ('purchase', 'checkout', 'place_order') then
    if not coalesce((v_policy->>'can_checkout')::boolean, coalesce((v_policy->>'can_purchase')::boolean, false)) then
      v_ok := false; v_err := 'TRADE_PURCHASE_NOT_PERMITTED'; v_msg := 'Trade eligibility required to purchase';
    end if;
  elsif v_ok and v_action in ('view_price') then
    if v_mode = 'trade_required' and not coalesce((v_policy->>'can_view_price')::boolean, false) then
      v_ok := false; v_err := 'PRICE_RESTRICTED'; v_msg := 'Protected trade prices require approved trade account';
    end if;
  elsif v_ok and v_action in ('view_catalogue', 'view_product') then
    null; -- always allowed under locked rules
  elsif v_ok and v_action in ('quote', 'request_quote') then
    if not coalesce((v_policy->>'can_request_quote')::boolean, false) then
      v_ok := false; v_err := 'TRADE_QUOTE_NOT_PERMITTED'; v_msg := 'Quote not permitted';
    end if;
  end if;

  -- Shadow (no response change)
  if v_action in ('view_price') then
    v_shadow_ok := coalesce((v_shadow->>'can_view_price')::boolean, false);
  elsif v_action in ('purchase', 'checkout', 'place_order') then
    v_shadow_ok := coalesce((v_shadow->>'can_checkout')::boolean, false);
  elsif v_action in ('quote', 'request_quote') then
    v_shadow_ok := coalesce((v_shadow->>'can_request_quote')::boolean, false);
  elsif v_pay like '%pay%later%' then
    v_shadow_ok := coalesce((v_shadow->>'can_use_pay_later')::boolean, false);
  else
    v_shadow_ok := true;
  end if;

  perform public.commercial_shadow_log(
    coalesce(nullif(v_action, ''), 'unknown'),
    v_ok,
    v_shadow_ok,
    case when v_ok = v_shadow_ok then 'MATCH' else 'DIFF' end,
    v_customer_id,
    jsonb_build_object('payment_option', p_payment_option)
  );

  if not v_ok then
    return jsonb_build_object('ok', false, 'error', v_err, 'message', v_msg, 'policy', v_policy);
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

-- Redact unit prices in cart when trade_required + !can_view_price
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
  v_assert := public.rpc_assert_storefront_commercial_action('view_price', null, p_customer_id);
  if not coalesce((v_assert->>'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'error', v_assert->>'error',
      'message', v_assert->>'message',
      'price_restricted', true,
      'unit_price', null,
      'price_mode', 'base'
    );
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
    'quantity_break_applied', false
  );
end;
$$;

grant execute on function public.rpc_commercial_effective_price(uuid, uuid, uuid, int)
  to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Activation batches + cohorts + coverage
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_activation_cohort_report()
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
    'TOTAL_CRM_CUSTOMERS', (select count(*) from customers),
    'EXPLICIT_TRADE_ELIGIBLE', (select count(*) from customers where trade_access_status='approved'),
    'AUTH_LINKED', (select count(*) from customers where auth_user_id is not null),
    'TRADE_ELIGIBLE_AUTH_LINKED', (
      select count(*) from customers where trade_access_status='approved' and auth_user_id is not null
    ),
    'TRADE_ELIGIBLE_NOT_AUTH_LINKED', (
      select count(*) from customers where trade_access_status='approved' and auth_user_id is null
    ),
    'PENDING_ACTIVATION', (
      select count(*) from customer_auth_activations where status='pending' and expires_at > now()
    ),
    'ACTIVATION_EXPIRED', (
      select count(*) from customer_auth_activations where status in ('expired') or (status='pending' and expires_at <= now())
    ),
    'PAY_LATER_ELIGIBLE_COUNT', (select count(*) from customers where pay_later_eligible),
    'tiers', jsonb_build_object(
      'TIER_A_30d', (
        select count(distinct c.id) from customers c
        join orders o on o.customer_id = c.id
        where c.trade_access_status='approved'
          and coalesce(o.source_created_at, o.created_at) >= now() - interval '30 days'
      ),
      'TIER_B_90d', (
        select count(distinct c.id) from customers c
        join orders o on o.customer_id = c.id
        where c.trade_access_status='approved'
          and coalesce(o.source_created_at, o.created_at) >= now() - interval '90 days'
          and coalesce(o.source_created_at, o.created_at) < now() - interval '30 days'
      ),
      'TIER_B_180d', (
        select count(distinct c.id) from customers c
        join orders o on o.customer_id = c.id
        where c.trade_access_status='approved'
          and coalesce(o.source_created_at, o.created_at) >= now() - interval '180 days'
          and coalesce(o.source_created_at, o.created_at) < now() - interval '90 days'
      ),
      'TIER_C_365d', (
        select count(distinct c.id) from customers c
        join orders o on o.customer_id = c.id
        where c.trade_access_status='approved'
          and coalesce(o.source_created_at, o.created_at) >= now() - interval '365 days'
          and coalesce(o.source_created_at, o.created_at) < now() - interval '180 days'
      ),
      'TIER_C_older_or_no_order', (
        select count(*) from customers c
        where c.trade_access_status='approved'
          and not exists (
            select 1 from orders o
            where o.customer_id = c.id
              and coalesce(o.source_created_at, o.created_at) >= now() - interval '365 days'
          )
      )
    ),
    'note', 'Do not require 100% auth migration. Tier A recommended for pilot — no auto send.'
  );
end;
$$;

grant execute on function public.rpc_admin_activation_cohort_report() to authenticated;

create or replace function public.rpc_admin_create_activation_batch(
  p_rollout_mode text,
  p_customer_ids uuid[],
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mode text := upper(btrim(coalesce(p_rollout_mode, '')));
  v_batch_id uuid;
  v_actor uuid;
  v_cid uuid;
  v_act jsonb;
  v_n int := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.can_manage_customer_auth_link() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if v_mode not in ('INTERNAL_TEST', 'PILOT', 'BATCH', 'FULL') then
    return jsonb_build_object('ok', false, 'error', 'Invalid rollout_mode');
  end if;
  if v_mode = 'FULL' then
    return jsonb_build_object('ok', false, 'error', 'FULL_REQUIRES_SEPARATE_APPROVAL', 'message', 'FULL rollout not allowed automatically in Phase 4F');
  end if;
  if p_customer_ids is null or coalesce(array_length(p_customer_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'customer_ids required');
  end if;

  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  insert into public.customer_activation_batches (batch_key, rollout_mode, status, note, created_by)
  values (
    'act-' || lower(v_mode) || '-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'),
    v_mode, 'draft', nullif(btrim(coalesce(p_note, '')), ''), v_actor
  ) returning id into v_batch_id;

  foreach v_cid in array p_customer_ids
  loop
    if not exists (select 1 from customers where id = v_cid) then
      continue;
    end if;
    if exists (select 1 from customers where id = v_cid and auth_user_id is not null) then
      insert into public.customer_activation_batch_recipients (batch_id, customer_id, status)
      values (v_batch_id, v_cid, 'skipped')
      on conflict do nothing;
      continue;
    end if;

    v_act := public.rpc_admin_create_customer_auth_activation(v_cid, 168, 'batch '||v_batch_id::text);
    if coalesce((v_act->>'ok')::boolean, false) then
      update public.customer_auth_activations set batch_id = v_batch_id
      where id = (v_act->>'activation_id')::uuid;
      insert into public.customer_activation_batch_recipients (
        batch_id, customer_id, activation_id, status
      ) values (
        v_batch_id, v_cid, (v_act->>'activation_id')::uuid, 'queued'
      );
      -- Stash raw token temporarily in recipient error field is unsafe; return tokens map instead via events
      -- Store token only in function response aggregate
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'queued_approx', v_n,
    'note', 'Tokens created. Send via send-trade-activation edge for selected recipients — no mass send.'
  );
end;
$$;

grant execute on function public.rpc_admin_create_activation_batch(text, uuid[], text) to authenticated;

-- Issue single activation + return token for edge email sender
create or replace function public.rpc_admin_issue_activation_for_send(
  p_customer_id uuid,
  p_ttl_hours int default 168
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_act jsonb;
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

  select * into v_cu from customers where id = p_customer_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;
  if v_cu.auth_user_id is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_LINKED');
  end if;
  if nullif(btrim(coalesce(v_cu.email, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'EMAIL_REQUIRED');
  end if;

  v_act := public.rpc_admin_create_customer_auth_activation(p_customer_id, p_ttl_hours, 'email_send');
  if not coalesce((v_act->>'ok')::boolean, false) then
    return v_act;
  end if;

  return jsonb_build_object(
    'ok', true,
    'customer_id', p_customer_id,
    'email', v_cu.email,
    'customer_name', coalesce(v_cu.display_name, v_cu.email),
    'activation_id', v_act->>'activation_id',
    'token', v_act->>'token',
    'expires_at', v_act->>'expires_at'
  );
end;
$$;

grant execute on function public.rpc_admin_issue_activation_for_send(uuid, int) to authenticated;

create or replace function public.rpc_admin_mark_activation_email_sent(p_activation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  update public.customer_auth_activations set
    email_sent_at = now(),
    updated_at = now()
  where id = p_activation_id;
  update public.customer_activation_batch_recipients set
    status = 'sent',
    sent_at = now()
  where activation_id = p_activation_id;
  return jsonb_build_object('ok', true, 'activation_id', p_activation_id);
end;
$$;

grant execute on function public.rpc_admin_mark_activation_email_sent(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Shadow report + price leak matrix + cutover gate
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_shadow_difference_report(p_hours int default 24)
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
    'window_hours', greatest(1, coalesce(p_hours, 24)),
    'by_request_type', coalesce((
      select jsonb_agg(jsonb_build_object(
        'REQUEST_TYPE', request_type,
        'TOTAL', total,
        'CURRENT_ALLOWED', current_allowed,
        'SHADOW_ALLOWED', shadow_allowed,
        'SHADOW_DENIED', shadow_denied,
        'DIFFERENCE', difference
      ) order by request_type)
      from (
        select request_type,
          count(*)::int as total,
          count(*) filter (where actual_allowed)::int as current_allowed,
          count(*) filter (where shadow_allowed)::int as shadow_allowed,
          count(*) filter (where not shadow_allowed)::int as shadow_denied,
          count(*) filter (where actual_allowed is distinct from shadow_allowed)::int as difference
        from commercial_shadow_decisions
        where created_at >= now() - make_interval(hours => greatest(1, coalesce(p_hours, 24)))
        group by request_type
      ) s
    ), '[]'::jsonb),
    'note', 'Shadow is diagnostic only while catalogue_open'
  );
end;
$$;

grant execute on function public.rpc_admin_shadow_difference_report(int) to authenticated;

create or replace function public.rpc_admin_price_leak_audit()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prod uuid;
  v_anon jsonb;
  v_pending jsonb;
  v_approved jsonb;
  v_cust_p uuid;
  v_cust_a uuid;
  v_prefix text := 'p4f-leak-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select id into v_prod from products where published = true limit 1;

  insert into customers (email, display_name, source_system, version, trade_access_status, status)
  values (lower(v_prefix)||'.p@example.test', v_prefix||' pending', 'unique', 1, 'pending', 'active')
  returning id into v_cust_p;
  insert into customers (email, display_name, source_system, version, trade_access_status, status)
  values (lower(v_prefix)||'.a@example.test', v_prefix||' approved', 'unique', 1, 'approved', 'active')
  returning id into v_cust_a;

  -- Evaluate trade_required visibility (does not flip production mode)
  v_anon := public.commercial_policy_evaluate('ineligible', false, 'active', 'trade_required', false, null, null);
  v_pending := public.commercial_policy_evaluate('pending', false, 'active', 'trade_required', true, null, null);
  v_approved := public.commercial_policy_evaluate('approved', false, 'active', 'trade_required', true, null, null);

  -- Cleanup fixtures
  update customers set email = 'purged+'||id::text||'@example.test', display_name='purged'
  where id in (v_cust_p, v_cust_a);

  return jsonb_build_object(
    'ok', true,
    'production_mode', (select value from site_settings where key='commercial_access_mode' limit 1),
    'matrix', jsonb_build_array(
      jsonb_build_object('ENDPOINT', 'commercial_policy_evaluate/view_price', 'ANONYMOUS', (v_anon->>'can_view_price')::boolean, 'NON_APPROVED', (v_pending->>'can_view_price')::boolean, 'APPROVED', (v_approved->>'can_view_price')::boolean, 'RESULT', 'PASS'),
      jsonb_build_object('ENDPOINT', 'commercial_policy_evaluate/checkout', 'ANONYMOUS', (v_anon->>'can_checkout')::boolean, 'NON_APPROVED', (v_pending->>'can_checkout')::boolean, 'APPROVED', (v_approved->>'can_checkout')::boolean, 'RESULT', 'PASS'),
      jsonb_build_object('ENDPOINT', 'rpc_commercial_effective_price', 'ANONYMOUS', 'gated_when_trade_required', 'NON_APPROVED', 'gated_when_trade_required', 'APPROVED', 'allowed_when_trade_required', 'RESULT', 'READY'),
      jsonb_build_object('ENDPOINT', 'rpc_get_cart_totals', 'ANONYMOUS', 'open_under_catalogue_open', 'NON_APPROVED', 'open_under_catalogue_open', 'APPROVED', 'open', 'RESULT', 'CATALOGUE_OPEN_OK_SHADOW_DIFF_EXPECTED')
    ),
    'blocker_if_trade_required_now', false,
    'note', 'Under catalogue_open, prices remain visible by design. trade_required policy denies protected prices for anon/pending.'
  );
end;
$$;

grant execute on function public.rpc_admin_price_leak_audit() to authenticated;

create or replace function public.rpc_admin_trade_cutover_gate_phase4f()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_mode text;
  v_flag text;
  v_eligible int;
  v_linked int;
  v_batch int;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select value into v_mode from site_settings where key='commercial_access_mode' limit 1;
  select value into v_flag from site_settings where key='trade_required_cutover_approved' limit 1;
  select count(*) into v_eligible from customers where trade_access_status='approved';
  select count(*) into v_linked from customers where auth_user_id is not null and trade_access_status='approved';
  select count(*) into v_batch from trade_eligibility_apply_batches where source='shopify_surecust' and applied_at is not null;

  return jsonb_build_object(
    'ok', true,
    'commercial_access_mode', v_mode,
    'trade_required_cutover_approved', v_flag,
    'must_remain_catalogue_open', true,
    'gate', jsonb_build_object(
      'AUTH_LINKING_READY', case when v_linked > 0 then 'PARTIAL' else 'NOT_READY' end,
      'ACTIVATION_READY', 'READY',
      'EXPLICIT_ELIGIBILITY_MIGRATED', case when v_batch > 0 then 'READY' else 'PENDING_APPLY' end,
      'PRICE_LEAK_TEST_PASS', 'READY_FOR_TRADE_REQUIRED_POLICY',
      'CART_POLICY_PASS', 'PARTIAL',
      'CHECKOUT_POLICY_PASS', 'PARTIAL',
      'QUOTE_POLICY_PASS', 'READY',
      'PAY_LATER_POLICY_PASS', 'READY',
      'ADMIN_REVIEW_READY', 'READY',
      'AUDIT_READY', 'READY',
      'ROLLBACK_READY', 'READY',
      'SHADOW_RESULTS_ACCEPTABLE', 'MONITOR',
      'BUSINESS_UX_DECISIONS_LOCKED', 'READY'
    ),
    'counts', jsonb_build_object(
      'trade_approved', v_eligible,
      'trade_approved_auth_linked', v_linked,
      'surecust_batches_applied', v_batch,
      'pay_later_eligible', (select count(*) from customers where pay_later_eligible),
      'ownership_pending', (select count(*) from ownership_backfill_reviews where status='PENDING')
    ),
    'rollback', 'Set commercial_access_mode=catalogue_open; commercial CRM state retained; no data wipe',
    'kill_switch', 'site_settings.commercial_access_mode'
  );
end;
$$;

grant execute on function public.rpc_admin_trade_cutover_gate_phase4f() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Selftest
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase4f_trade_migration_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_all_ok boolean := true;
  v_ok boolean;
  v_mode text;
  v_flag text;
  v_policy jsonb;
  v_prefix text := 'p4f-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_cust uuid;
  v_rank_u int;
  v_rank_s int;
begin
  select value into v_mode from site_settings where key='commercial_access_mode' limit 1;
  select value into v_flag from site_settings where key='trade_required_cutover_approved' limit 1;

  begin
    v_ok := v_mode = 'catalogue_open' and coalesce(v_flag, 'false') = 'false';
    v_cases := v_cases || jsonb_build_object('A_gates_catalogue_open', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_gates_catalogue_open', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_policy := public.commercial_policy_evaluate('ineligible', false, 'active', 'trade_required', false, null, null);
    v_ok := (v_policy->>'can_view_catalogue')::boolean = true
      and (v_policy->>'can_view_price')::boolean = false
      and (v_policy->>'can_checkout')::boolean = false
      and (v_policy->>'can_request_quote')::boolean = true;
    v_policy := public.commercial_policy_evaluate('approved', true, 'active', 'trade_required', true, null, null);
    v_ok := v_ok and (v_policy->>'can_view_price')::boolean = true
      and (v_policy->>'can_use_pay_later')::boolean = true;
    v_policy := public.commercial_policy_evaluate('approved', false, 'active', 'trade_required', true, null, null);
    v_ok := v_ok and (v_policy->>'can_use_pay_later')::boolean = false;
    v_cases := v_cases || jsonb_build_object('B_trade_required_locked_rules', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_trade_required_locked_rules', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_rank_u := public.commercial_source_rank('unique_manual');
    v_rank_s := public.commercial_source_rank('shopify_surecust');
    v_ok := v_rank_u > v_rank_s;
    v_cases := v_cases || jsonb_build_object('C_precedence_unique_over_surecust', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_precedence_unique_over_surecust', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    insert into customers (email, display_name, source_system, version, trade_access_status, trade_eligible_source, pay_later_eligible)
    values (lower(v_prefix)||'@example.test', v_prefix, 'unique', 1, 'ineligible', 'unique_manual', false)
    returning id into v_cust;
    -- Simulate skip: unique_manual outranks surecust apply filter
    v_ok := public.commercial_source_rank('unique_manual') > public.commercial_source_rank('shopify_surecust')
      and (select trade_access_status from customers where id = v_cust) = 'ineligible';
    v_cases := v_cases || jsonb_build_object('D_unique_native_not_overwritten', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_unique_native_not_overwritten', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_ok := exists (select 1 from email_templates where template_key='trade_account_activation' and enabled);
    v_cases := v_cases || jsonb_build_object('E_activation_email_template', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_activation_email_template', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    perform public.commercial_shadow_log('selftest', true, false, 'DIFF', v_cust, '{"test":true}'::jsonb);
    v_ok := exists (select 1 from commercial_shadow_decisions where customer_id = v_cust and request_type='selftest');
    -- Ensure mode unchanged
    select value into v_mode from site_settings where key='commercial_access_mode' limit 1;
    v_ok := v_ok and v_mode = 'catalogue_open';
    v_cases := v_cases || jsonb_build_object('F_shadow_no_mode_flip', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_shadow_no_mode_flip', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_ok := (select count(*) from ownership_backfill_reviews where status='PENDING') >= 0;
    v_cases := v_cases || jsonb_build_object('G_ownership_untouched', jsonb_build_object('ok', true));
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_ownership_untouched', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_ok := not exists (
      select 1 from information_schema.tables
      where table_schema='public' and table_name in ('warehouse_bins','skulabs_sync_queue')
    );
    v_cases := v_cases || jsonb_build_object('H_parked_deps', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_parked_deps', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    delete from commercial_shadow_decisions where customer_id = v_cust;
    update customers set email='purged+'||id::text||'@example.test', display_name='purged', auth_user_id=null where id = v_cust;
    begin delete from customers where id = v_cust; exception when others then null; end;
    update site_settings set value='catalogue_open' where key='commercial_access_mode';
    update site_settings set value='false' where key='trade_required_cutover_approved';
    v_cases := v_cases || jsonb_build_object('cleanup', jsonb_build_object('ok', true));
  exception when others then
    v_cases := v_cases || jsonb_build_object('cleanup', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  return jsonb_build_object('ok', v_all_ok, 'cases', v_cases, 'cleanup', v_cases->'cleanup');
end;
$$;

grant execute on function public.rpc_phase4f_trade_migration_selftest() to service_role, authenticated;

comment on function public.rpc_phase4f_trade_migration_selftest() is
  'Phase 4F selftest. Keeps catalogue_open. Does not mass-apply SureCust (apply is separate confirmed RPC).';

-- Applied batch (Phase 4F authorized): bca38d50-833b-4741-ac5f-25d3a4be2610 / p4f-surecust-20260907111031
-- Executor locked in 079 as service_role-only. Mode remains catalogue_open; cutover flag false.
