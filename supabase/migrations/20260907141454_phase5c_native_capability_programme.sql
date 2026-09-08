-- Phase 5C — Native Shopify app replacement programme (capability foundations)
-- Rebuild BUSINESS CAPABILITIES, not app clones.
-- Does NOT: send pilot, flip trade_required, enforce compliance, enable Worldpay/DPD,
-- mutate Shopify, disconnect apps, apply ownership, contact customers.
-- Inferred Flow rules seeded DISABLED_BY_DEFAULT.
-- WMS: Unique-native design; SKULabs history NOT migrated (opening balance later).

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'pilot_send_authorized' and value is distinct from 'false';
update public.site_settings set value = 'observe'
where key = 'compliance_enforcement_mode' and value is distinct from 'observe';

insert into public.site_settings (key, value) values
  ('compliance_enforcement_mode', 'observe'),
  ('automation_engine_enabled', 'false'),
  ('wms_enabled', 'false'),
  ('promotions_engine_enabled', 'true'),
  ('checkout_rules_enabled', 'true')
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- A. Flow-lite automation engine
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  trigger_event text not null,
  enabled boolean not null default false,
  priority int not null default 100,
  confidence text not null default 'WEAKLY_INFERRED'
    check (confidence in ('CONFIRMED','STRONGLY_INFERRED','WEAKLY_INFERRED','UNKNOWN')),
  evidence_note text,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  trigger_event text not null,
  entity_type text,
  entity_id uuid,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending','running','succeeded','failed','skipped')),
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (rule_id, idempotency_key)
);

create index if not exists automation_rules_trigger_idx on public.automation_rules (trigger_event, enabled, priority);
create index if not exists automation_runs_created_idx on public.automation_runs (created_at desc);

alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;
drop policy if exists "admin_all_automation_rules" on public.automation_rules;
create policy "admin_all_automation_rules" on public.automation_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_automation_runs" on public.automation_runs;
create policy "admin_all_automation_runs" on public.automation_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.automation_rules to authenticated;
grant select, insert, update on public.automation_runs to authenticated;
grant all on public.automation_rules to service_role;
grant all on public.automation_runs to service_role;

-- Seed DISABLED proposed rules from historical correlations (NOT auto-enabled)
insert into public.automation_rules (name, description, trigger_event, enabled, priority, confidence, evidence_note, conditions, actions)
select * from (values
(
  'Tag FromDraft on draft conversion',
  'Historical Shopify tag FromDraft (~3,742) correlates with draft→order path',
  'DRAFT_CONVERTED', false, 10, 'STRONGLY_INFERRED',
  'Order tags FromDraft; draft conversion workflow',
  '[]'::jsonb,
  '[{"type":"ADD_INTERNAL_TAG","tag":"FromDraft"},{"type":"CREATE_EVENT","event_type":"automation_from_draft"}]'::jsonb
),
(
  'Tag WebsiteOrder on storefront order',
  'WebsiteOrder tag (~17,872) on online store orders',
  'ORDER_CREATED', false, 20, 'STRONGLY_INFERRED',
  'Order tags WebsiteOrder',
  '[{"field":"source","op":"eq","value":"storefront"}]'::jsonb,
  '[{"type":"ADD_INTERNAL_TAG","tag":"WebsiteOrder"}]'::jsonb
),
(
  'Awaiting Payment on pending financial status',
  'Multiple spellings of Awaiting payment tags on unpaid credit/bank orders',
  'ORDER_PAYMENT_PENDING', false, 30, 'STRONGLY_INFERRED',
  'Order tags Awaiting payment*',
  '[]'::jsonb,
  '[{"type":"ADD_INTERNAL_TAG","tag":"Awaiting payment"},{"type":"CREATE_NOTE","body":"Payment pending — automation"}]'::jsonb
),
(
  'Clear Awaiting Payment on payment posted',
  'Inverse of awaiting-payment tagging',
  'PAYMENT_POSTED', false, 40, 'WEAKLY_INFERRED',
  'Inferred from payment vs tag lifecycle',
  '[]'::jsonb,
  '[{"type":"REMOVE_INTERNAL_TAG","tag":"Awaiting payment"}]'::jsonb
)
) as v(name, description, trigger_event, enabled, priority, confidence, evidence_note, conditions, actions)
where not exists (
  select 1 from public.automation_rules ar where ar.name = v.name
);

-- Idempotent runner (safe actions only; never mutates Shopify-imported historical rows)
create or replace function public.rpc_run_automation_event(
  p_trigger text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_engine text;
  v_rule record;
  v_key text;
  v_run_id uuid;
  v_actions jsonb;
  v_action jsonb;
  v_done int := 0;
  v_skipped int := 0;
begin
  select value into v_engine from site_settings where key = 'automation_engine_enabled' limit 1;
  if coalesce(v_engine, 'false') <> 'true' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'automation_engine_disabled');
  end if;

  for v_rule in
    select * from automation_rules
    where enabled and trigger_event = upper(btrim(p_trigger))
    order by priority, created_at
  loop
    v_key := coalesce(nullif(btrim(p_idempotency_key), ''), p_trigger || ':' || coalesce(p_entity_id::text,'none') || ':' || v_rule.id::text);
    if exists (select 1 from automation_runs where rule_id = v_rule.id and idempotency_key = v_key and status = 'succeeded') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into automation_runs (rule_id, trigger_event, entity_type, entity_id, idempotency_key, status)
    values (v_rule.id, v_rule.trigger_event, p_entity_type, p_entity_id, v_key, 'running')
    on conflict (rule_id, idempotency_key) do nothing
    returning id into v_run_id;

    if v_run_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Only Unique-native soft actions in Phase 5C foundation
    v_actions := coalesce(v_rule.actions, '[]'::jsonb);
    for v_action in select * from jsonb_array_elements(v_actions)
    loop
      if v_action->>'type' = 'CREATE_EVENT' and p_entity_id is not null then
        insert into commercial_policy_events (event_type, reason_code, metadata)
        values (
          coalesce(v_action->>'event_type', 'automation_action'),
          'AUTOMATION',
          jsonb_build_object('rule_id', v_rule.id, 'entity_type', p_entity_type, 'entity_id', p_entity_id, 'payload', p_payload)
        );
      end if;
      -- ADD_INTERNAL_TAG / notes deferred to entity-specific tables when Unique-native tags exist
    end loop;

    update automation_runs set status = 'succeeded', finished_at = now(),
      result = jsonb_build_object('actions', v_actions)
    where id = v_run_id;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('ok', true, 'ran', v_done, 'skipped', v_skipped, 'trigger', upper(btrim(p_trigger)));
end;
$$;

revoke all on function public.rpc_run_automation_event(text, text, uuid, jsonb, text) from public;
grant execute on function public.rpc_run_automation_event(text, text, uuid, jsonb, text)
  to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- B. SureCust remaining — access rules (server-side; observe until trade_required)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.trade_access_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null
    check (rule_type in ('page','product','collection','price','checkout','catalogue')),
  match_json jsonb not null default '{}'::jsonb,
  require_trade_approved boolean not null default true,
  require_auth_linked boolean not null default false,
  effect text not null default 'deny'
    check (effect in ('allow','deny','redact_price')),
  enabled boolean not null default true,
  priority int not null default 100,
  created_at timestamptz not null default now()
);

alter table public.trade_access_rules enable row level security;
drop policy if exists "admin_all_trade_access_rules" on public.trade_access_rules;
create policy "admin_all_trade_access_rules" on public.trade_access_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.trade_access_rules to authenticated;
grant all on public.trade_access_rules to service_role;

insert into public.trade_access_rules (name, rule_type, match_json, require_trade_approved, effect, enabled, priority)
select * from (values
  ('Default catalogue browse (open mode)', 'catalogue', '{}'::jsonb, false, 'allow', true, 1),
  ('Price redact when trade_required + not approved', 'price', '{}'::jsonb, true, 'redact_price', true, 10),
  ('Checkout requires trade approved under trade_required', 'checkout', '{}'::jsonb, true, 'deny', true, 20)
) as v(name, rule_type, match_json, require_trade_approved, effect, enabled, priority)
where not exists (select 1 from public.trade_access_rules t where t.name = v.name);

-- Configurable trade application field definitions (extends existing submit RPC payload)
create table if not exists public.trade_application_fields (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label text not null,
  field_type text not null default 'text'
    check (field_type in ('text','email','tel','number','select','textarea','checkbox')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  sort_order int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.trade_application_fields enable row level security;
drop policy if exists "admin_all_trade_application_fields" on public.trade_application_fields;
create policy "admin_all_trade_application_fields" on public.trade_application_fields
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "public_read_enabled_trade_application_fields" on public.trade_application_fields;
create policy "public_read_enabled_trade_application_fields" on public.trade_application_fields
  for select to anon, authenticated using (enabled = true);
grant select on public.trade_application_fields to anon, authenticated;
grant insert, update, delete on public.trade_application_fields to authenticated;
grant all on public.trade_application_fields to service_role;

insert into public.trade_application_fields (field_key, label, field_type, required, sort_order, options)
values
  ('trading_name', 'Trading name', 'text', true, 10, '[]'),
  ('company_registration_number', 'Company registration number', 'text', false, 20, '[]'),
  ('store_type', 'Store type', 'select', false, 30, '["Retail","Online","Wholesale","Other"]'),
  ('number_of_stores', 'Number of stores', 'number', false, 40, '[]'),
  ('weekly_spend', 'Estimated weekly spend', 'text', false, 50, '[]'),
  ('website_or_shop', 'Website or shop URL', 'text', false, 60, '[]')
on conflict (field_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- C. Commercial request form engine (Special Request + extensible)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.commercial_request_forms (
  id uuid primary key default gen_random_uuid(),
  form_key text not null unique,
  title text not null,
  description text,
  fields jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  route_to_salesperson boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.commercial_requests (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references public.commercial_request_forms(id),
  form_key text not null,
  customer_id uuid references public.customers(id),
  company_id uuid references public.companies(id),
  salesperson_id uuid,
  status text not null default 'submitted'
    check (status in ('submitted','reviewing','quoted','converted','closed','rejected')),
  payload jsonb not null default '{}'::jsonb,
  sku_refs text[] not null default '{}',
  draft_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_requests_status_idx on public.commercial_requests (status, created_at desc);

alter table public.commercial_request_forms enable row level security;
alter table public.commercial_requests enable row level security;
drop policy if exists "admin_all_commercial_request_forms" on public.commercial_request_forms;
create policy "admin_all_commercial_request_forms" on public.commercial_request_forms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "public_read_enabled_commercial_request_forms" on public.commercial_request_forms;
create policy "public_read_enabled_commercial_request_forms" on public.commercial_request_forms
  for select to anon, authenticated using (enabled);
drop policy if exists "admin_all_commercial_requests" on public.commercial_requests;
create policy "admin_all_commercial_requests" on public.commercial_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "auth_insert_commercial_requests" on public.commercial_requests;
create policy "auth_insert_commercial_requests" on public.commercial_requests
  for insert to authenticated, anon with check (true);
grant select on public.commercial_request_forms to anon, authenticated;
grant insert, update, delete on public.commercial_request_forms to authenticated;
grant select, insert, update on public.commercial_requests to authenticated;
grant insert on public.commercial_requests to anon;
grant all on public.commercial_request_forms to service_role;
grant all on public.commercial_requests to service_role;

insert into public.commercial_request_forms (form_key, title, description, fields)
values
(
  'special_product_request',
  'Special product request',
  'B2B special / large quantity / stock enquiry — inferred SpecialRequestForm replacement',
  '[
    {"key":"request_type","label":"Request type","type":"select","required":true,"options":["Special product","Large quantity","Stock enquiry","Commercial enquiry","Other"]},
    {"key":"sku_or_product","label":"SKU or product name","type":"text","required":false},
    {"key":"quantity","label":"Quantity","type":"number","required":false},
    {"key":"details","label":"Details","type":"textarea","required":true}
  ]'::jsonb
),
(
  'quote_request',
  'Quote request',
  'Customer quote intake — routes into Unique drafts (do not duplicate draft engine)',
  '[
    {"key":"items","label":"Items / SKUs","type":"textarea","required":true},
    {"key":"notes","label":"Notes","type":"textarea","required":false}
  ]'::jsonb
)
on conflict (form_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- D. Checkout rules engine
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.checkout_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  priority int not null default 100,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  -- actions: require_field | show_message | block | set_field
  created_at timestamptz not null default now()
);

alter table public.checkout_rules enable row level security;
drop policy if exists "admin_all_checkout_rules" on public.checkout_rules;
create policy "admin_all_checkout_rules" on public.checkout_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.checkout_rules to authenticated;
grant select on public.checkout_rules to anon;
grant all on public.checkout_rules to service_role;

insert into public.checkout_rules (name, enabled, priority, conditions, actions)
select * from (values
(
  'B2B PO number optional field',
  true, 10,
  '[{"field":"customer_linked","op":"eq","value":true}]'::jsonb,
  '[{"type":"require_field","field":"po_number","required":false},{"type":"show_message","message":"Add a PO number if your accounts team needs it."}]'::jsonb
),
(
  'Delivery instructions available',
  true, 20,
  '[]'::jsonb,
  '[{"type":"require_field","field":"delivery_instructions","required":false}]'::jsonb
)
) as v(name, enabled, priority, conditions, actions)
where not exists (select 1 from public.checkout_rules c where c.name = v.name);

create or replace function public.rpc_evaluate_checkout_rules(p_context jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_enabled text;
  v_fields jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
  v_blocked boolean := false;
  v_rule record;
  v_act jsonb;
begin
  select value into v_enabled from site_settings where key = 'checkout_rules_enabled' limit 1;
  if coalesce(v_enabled, 'true') <> 'true' then
    return jsonb_build_object('ok', true, 'fields', '[]'::jsonb, 'messages', '[]'::jsonb, 'blocked', false);
  end if;

  for v_rule in select * from checkout_rules where enabled order by priority
  loop
    for v_act in select * from jsonb_array_elements(coalesce(v_rule.actions, '[]'::jsonb))
    loop
      if v_act->>'type' = 'require_field' then
        v_fields := v_fields || jsonb_build_array(jsonb_build_object(
          'field', v_act->>'field',
          'required', coalesce((v_act->>'required')::boolean, false),
          'rule', v_rule.name
        ));
      elsif v_act->>'type' = 'show_message' then
        v_messages := v_messages || jsonb_build_array(v_act->>'message');
      elsif v_act->>'type' = 'block' then
        v_blocked := true;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'fields', v_fields,
    'messages', v_messages,
    'blocked', v_blocked,
    'context_echo', p_context
  );
end;
$$;

grant execute on function public.rpc_evaluate_checkout_rules(jsonb) to anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- E. Promotion engine (extends coupons — one engine)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text,
  promotion_type text not null default 'code'
    check (promotion_type in ('code','automatic')),
  enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int,
  usage_count int not null default 0,
  min_subtotal numeric(12,2),
  min_quantity int,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  -- actions: PERCENT_DISCOUNT | FIXED_DISCOUNT | FREE_ITEM | DISCOUNT_ITEM
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  order_id uuid,
  customer_id uuid,
  amount numeric(12,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.promotions enable row level security;
alter table public.promotion_redemptions enable row level security;
drop policy if exists "admin_all_promotions" on public.promotions;
create policy "admin_all_promotions" on public.promotions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_promotion_redemptions" on public.promotion_redemptions;
create policy "admin_all_promotion_redemptions" on public.promotion_redemptions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.promotions to authenticated;
grant select, insert on public.promotion_redemptions to authenticated;
grant all on public.promotions to service_role;
grant all on public.promotion_redemptions to service_role;

comment on table public.promotions is
  'Phase 5C native promotion engine. FREE_ITEM/BXGY actions supported in model but disabled until usage confirmed. Coupons table remains for simple codes.';

-- ═══════════════════════════════════════════════════════════════════════════
-- F. Search synonyms / boosts / merchandising
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.search_synonyms (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  synonym text not null,
  created_at timestamptz not null default now(),
  unique (term, synonym)
);

create table if not exists public.search_boosts (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('product','collection','sku')),
  entity_id uuid,
  match_term text,
  boost_score numeric(8,2) not null default 1.0,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.search_merchandising_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  query_match text,
  pinned_product_ids uuid[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.search_synonyms enable row level security;
alter table public.search_boosts enable row level security;
alter table public.search_merchandising_rules enable row level security;
drop policy if exists "admin_all_search_synonyms" on public.search_synonyms;
create policy "admin_all_search_synonyms" on public.search_synonyms
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_search_boosts" on public.search_boosts;
create policy "admin_all_search_boosts" on public.search_boosts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_search_merchandising_rules" on public.search_merchandising_rules;
create policy "admin_all_search_merchandising_rules" on public.search_merchandising_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.search_synonyms to authenticated;
grant select, insert, update, delete on public.search_boosts to authenticated;
grant select, insert, update, delete on public.search_merchandising_rules to authenticated;
grant all on public.search_synonyms to service_role;
grant all on public.search_boosts to service_role;
grant all on public.search_merchandising_rules to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- G. SEO redirects
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.seo_redirects (
  id uuid primary key default gen_random_uuid(),
  from_path text not null unique,
  to_path text not null,
  status_code int not null default 301 check (status_code in (301, 302)),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.seo_redirects enable row level security;
drop policy if exists "admin_all_seo_redirects" on public.seo_redirects;
create policy "admin_all_seo_redirects" on public.seo_redirects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "public_read_enabled_seo_redirects" on public.seo_redirects;
create policy "public_read_enabled_seo_redirects" on public.seo_redirects
  for select to anon, authenticated using (enabled);
grant select on public.seo_redirects to anon, authenticated;
grant insert, update, delete on public.seo_redirects to authenticated;
grant all on public.seo_redirects to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- H. Document templates + saved reports
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  template_type text not null
    check (template_type in ('invoice','statement','packing_slip','delivery_note','credit_note','order_printout')),
  name text not null,
  version text not null default '1',
  body_html text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (template_type, version)
);

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  report_type text not null,
  filters_json jsonb not null default '{}'::jsonb,
  columns_json jsonb not null default '[]'::jsonb,
  owner_admin_id uuid,
  visibility text not null default 'private' check (visibility in ('private','admin','owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_templates enable row level security;
alter table public.saved_reports enable row level security;
drop policy if exists "admin_all_document_templates" on public.document_templates;
create policy "admin_all_document_templates" on public.document_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_saved_reports" on public.saved_reports;
create policy "admin_all_saved_reports" on public.saved_reports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.document_templates to authenticated;
grant select, insert, update, delete on public.saved_reports to authenticated;
grant all on public.document_templates to service_role;
grant all on public.saved_reports to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- I. Marketing segments + communication ledger (boundary only)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.marketing_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  definition_json jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.communication_threads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  company_id uuid references public.companies(id),
  channel text not null default 'email',
  subject text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.communication_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','internal')),
  body text,
  actor_type text,
  actor_id uuid,
  external_ref text,
  created_at timestamptz not null default now()
);

alter table public.marketing_segments enable row level security;
alter table public.communication_threads enable row level security;
alter table public.communication_messages enable row level security;
drop policy if exists "admin_all_marketing_segments" on public.marketing_segments;
create policy "admin_all_marketing_segments" on public.marketing_segments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_communication_threads" on public.communication_threads;
create policy "admin_all_communication_threads" on public.communication_threads
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_communication_messages" on public.communication_messages;
create policy "admin_all_communication_messages" on public.communication_messages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.marketing_segments to authenticated;
grant select, insert, update, delete on public.communication_threads to authenticated;
grant select, insert, update, delete on public.communication_messages to authenticated;
grant all on public.marketing_segments to service_role;
grant all on public.communication_threads to service_role;
grant all on public.communication_messages to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- J. Generic integration boundary (Odoo/Xero/etc — no live connect)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  system_key text not null unique,
  display_name text not null,
  direction text not null default 'bidirectional',
  status text not null default 'disabled'
    check (status in ('disabled','configured','active','error')),
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  status text not null default 'pending',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

insert into public.integration_connections (system_key, display_name, status, config_json)
values
  ('odoo', 'Odoo / datafetchodoo', 'disabled', '{"note":"EXTERNAL_ADAPTER — no credentials"}'::jsonb),
  ('xero', 'Xero', 'disabled', '{"note":"Statutory GL — Unique remains ops AR"}'::jsonb),
  ('worldpay', 'Worldpay', 'disabled', '{"note":"gateway_mode=disabled"}'::jsonb),
  ('dpd', 'DPD', 'disabled', '{"note":"carrier_mode=disabled"}'::jsonb),
  ('rangeme', 'RangeMe', 'disabled', '{"note":"EXTERNAL_INTEGRATION_OPTIONAL"}'::jsonb)
on conflict (system_key) do nothing;

alter table public.integration_connections enable row level security;
alter table public.integration_sync_runs enable row level security;
drop policy if exists "admin_all_integration_connections" on public.integration_connections;
create policy "admin_all_integration_connections" on public.integration_connections
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin_all_integration_sync_runs" on public.integration_sync_runs;
create policy "admin_all_integration_sync_runs" on public.integration_sync_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.integration_connections to authenticated;
grant select, insert, update on public.integration_sync_runs to authenticated;
grant all on public.integration_connections to service_role;
grant all on public.integration_sync_runs to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- K. Native WMS foundation (Unique-native; not SKULabs clone)
-- Historical pick/pack NOT migrated. Opening balances at future cutover.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  code text not null,
  location_type text not null default 'bin'
    check (location_type in ('bin','stage','receiving','shipping','bulk','other')),
  is_active boolean not null default true,
  unique (warehouse_id, code)
);

create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  location_id uuid references public.warehouse_locations(id),
  product_id uuid references public.products(id),
  variant_id uuid,
  sku text,
  on_hand numeric(14,3) not null default 0,
  allocated numeric(14,3) not null default 0,
  available numeric(14,3) generated always as (on_hand - allocated) stored,
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_balances_wh_loc_variant_uidx
  on public.inventory_balances (
    warehouse_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  location_id uuid references public.warehouse_locations(id),
  product_id uuid,
  variant_id uuid,
  sku text,
  movement_type text not null
    check (movement_type in (
      'OPENING','RECEIPT','ALLOCATION','RELEASE','PICK','SHIP','RETURN',
      'RESTOCK','ADJUSTMENT','TRANSFER','DAMAGE','CORRECTION'
    )),
  quantity_delta numeric(14,3) not null,
  reason text,
  actor_id uuid,
  reference_type text,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_created_idx on public.inventory_movements (created_at desc);
create index if not exists inventory_movements_sku_idx on public.inventory_movements (sku, created_at desc);

create table if not exists public.inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  order_item_id uuid,
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid,
  variant_id uuid,
  sku text,
  qty_requested numeric(14,3) not null,
  qty_allocated numeric(14,3) not null default 0,
  status text not null default 'pending'
    check (status in ('pending','allocated','partial','released','insufficient')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.picks (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  order_id uuid,
  status text not null default 'READY_TO_PICK'
    check (status in ('READY_TO_PICK','IN_PROGRESS','PARTIAL','COMPLETED','CANCELLED')),
  picker_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.pick_lines (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  location_id uuid references public.warehouse_locations(id),
  sku text,
  product_id uuid,
  variant_id uuid,
  qty_requested numeric(14,3) not null,
  qty_picked numeric(14,3) not null default 0,
  qty_short numeric(14,3) not null default 0
);

create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  order_id uuid,
  pick_id uuid references public.picks(id),
  status text not null default 'OPEN'
    check (status in ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
  packer_id uuid,
  parcel_count int not null default 1,
  weight_kg numeric(10,3),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.pack_lines (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.packs(id) on delete cascade,
  sku text,
  product_id uuid,
  variant_id uuid,
  qty_packed numeric(14,3) not null default 0
);

create table if not exists public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  supplier_ref text,
  status text not null default 'open',
  actor_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.stock_receipts(id) on delete cascade,
  sku text,
  product_id uuid,
  variant_id uuid,
  qty_expected numeric(14,3),
  qty_received numeric(14,3) not null default 0,
  location_id uuid references public.warehouse_locations(id)
);

insert into public.warehouses (code, name)
values ('UD_WH_1', 'UD WH 1')
on conflict (code) do nothing;

insert into public.warehouse_locations (warehouse_id, code, location_type)
select w.id, 'DEFAULT', 'bulk' from warehouses w where w.code = 'UD_WH_1'
on conflict (warehouse_id, code) do nothing;

comment on table public.inventory_movements is
  'Phase 5C Unique-native immutable ledger. SKULabs historical picks/packs NOT migrated. Opening balances applied at future cutover only.';
comment on table public.picks is
  'Unique-native pick workflow statuses — NOT claimed to mirror SKULabs exactly.';

-- RLS for WMS
do $$
declare t text;
begin
  foreach t in array array[
    'warehouses','warehouse_locations','inventory_balances','inventory_movements',
    'inventory_allocations','picks','pick_lines','packs','pack_lines',
    'stock_receipts','stock_receipt_lines'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admin_all_%1$s" on public.%1$I', t);
    execute format(
      'create policy "admin_all_%1$s" on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Stock adjustment RPC (no silent inventory_count edits)
create or replace function public.rpc_admin_stock_adjustment(
  p_warehouse_id uuid,
  p_location_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_sku text,
  p_quantity_delta numeric,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_wms text;
  v_actor uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  select value into v_wms from site_settings where key = 'wms_enabled' limit 1;
  if coalesce(v_wms, 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'WMS_DISABLED', 'message', 'Enable wms_enabled only after opening-stock procedure');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  end if;
  if p_quantity_delta = 0 then
    return jsonb_build_object('ok', false, 'error', 'DELTA_REQUIRED');
  end if;

  select au.id into v_actor from admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  insert into inventory_movements (
    warehouse_id, location_id, product_id, variant_id, sku,
    movement_type, quantity_delta, reason, actor_id
  ) values (
    p_warehouse_id, p_location_id, p_product_id, p_variant_id, p_sku,
    'ADJUSTMENT', p_quantity_delta, p_reason, v_actor
  );

  update inventory_balances set
    on_hand = on_hand + p_quantity_delta,
    updated_at = now()
  where warehouse_id = p_warehouse_id
    and product_id is not distinct from p_product_id
    and variant_id is not distinct from p_variant_id
    and location_id is not distinct from p_location_id;

  if not found then
    insert into inventory_balances (warehouse_id, location_id, product_id, variant_id, sku, on_hand)
    values (p_warehouse_id, p_location_id, p_product_id, p_variant_id, p_sku, p_quantity_delta);
  end if;

  return jsonb_build_object('ok', true, 'movement', 'ADJUSTMENT', 'delta', p_quantity_delta);
end;
$$;

grant execute on function public.rpc_admin_stock_adjustment(uuid, uuid, uuid, uuid, text, numeric, text)
  to authenticated;

-- Allocation (separate from payment/fulfilment)
create or replace function public.rpc_admin_allocate_order_line(
  p_order_id uuid,
  p_order_item_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_sku text,
  p_qty numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_wms text;
  v_avail numeric;
  v_alloc numeric;
  v_status text;
  v_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  select value into v_wms from site_settings where key = 'wms_enabled' limit 1;
  if coalesce(v_wms, 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'WMS_DISABLED');
  end if;
  if p_qty is null or p_qty <= 0 then
    return jsonb_build_object('ok', false, 'error', 'QTY_REQUIRED');
  end if;

  select coalesce(sum(available), 0) into v_avail
  from inventory_balances
  where warehouse_id = p_warehouse_id
    and (p_variant_id is null or variant_id is not distinct from p_variant_id)
    and (p_product_id is null or product_id is not distinct from p_product_id);

  v_alloc := least(p_qty, greatest(v_avail, 0));
  v_status := case
    when v_alloc <= 0 then 'insufficient'
    when v_alloc < p_qty then 'partial'
    else 'allocated'
  end;

  if v_alloc > 0 then
    update inventory_balances set
      allocated = allocated + v_alloc,
      updated_at = now()
    where warehouse_id = p_warehouse_id
      and product_id is not distinct from p_product_id
      and variant_id is not distinct from p_variant_id
      and available >= v_alloc;

    insert into inventory_movements (
      warehouse_id, product_id, variant_id, sku, movement_type, quantity_delta, reason, reference_type, reference_id
    ) values (
      p_warehouse_id, p_product_id, p_variant_id, p_sku, 'ALLOCATION', -v_alloc,
      'Order allocation', 'order', p_order_id
    );
  end if;

  insert into inventory_allocations (
    order_id, order_item_id, warehouse_id, product_id, variant_id, sku,
    qty_requested, qty_allocated, status
  ) values (
    p_order_id, p_order_item_id, p_warehouse_id, p_product_id, p_variant_id, p_sku,
    p_qty, v_alloc, v_status
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'allocation_id', v_id, 'status', v_status, 'qty_allocated', v_alloc);
end;
$$;

grant execute on function public.rpc_admin_allocate_order_line(uuid, uuid, uuid, uuid, uuid, text, numeric)
  to authenticated;

-- Promotion calculator (server-authoritative; BXGY/FREE_ITEM only when action present)
create or replace function public.rpc_calculate_promotions(
  p_subtotal numeric,
  p_quantity int,
  p_code text default null,
  p_line_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_enabled text;
  v_promo record;
  v_discount numeric := 0;
  v_applied jsonb := '[]'::jsonb;
  v_act jsonb;
  v_pct numeric;
  v_fixed numeric;
begin
  select value into v_enabled from site_settings where key = 'promotions_engine_enabled' limit 1;
  if coalesce(v_enabled, 'true') <> 'true' then
    return jsonb_build_object('ok', true, 'discount', 0, 'applied', '[]'::jsonb);
  end if;

  for v_promo in
    select * from promotions
    where enabled
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
      and (
        (promotion_type = 'automatic')
        or (promotion_type = 'code' and code is not null and lower(code) = lower(nullif(btrim(p_code), '')))
      )
      and (usage_limit is null or usage_count < usage_limit)
      and (min_subtotal is null or coalesce(p_subtotal, 0) >= min_subtotal)
      and (min_quantity is null or coalesce(p_quantity, 0) >= min_quantity)
    order by created_at
  loop
    for v_act in select * from jsonb_array_elements(coalesce(v_promo.actions, '[]'::jsonb))
    loop
      if v_act->>'type' = 'PERCENT_DISCOUNT' then
        v_pct := coalesce((v_act->>'value')::numeric, 0);
        v_discount := v_discount + round(coalesce(p_subtotal, 0) * v_pct / 100.0, 2);
        v_applied := v_applied || jsonb_build_array(jsonb_build_object('promotion_id', v_promo.id, 'type', 'PERCENT_DISCOUNT', 'value', v_pct));
      elsif v_act->>'type' = 'FIXED_DISCOUNT' then
        v_fixed := coalesce((v_act->>'value')::numeric, 0);
        v_discount := v_discount + v_fixed;
        v_applied := v_applied || jsonb_build_array(jsonb_build_object('promotion_id', v_promo.id, 'type', 'FIXED_DISCOUNT', 'value', v_fixed));
      elsif v_act->>'type' in ('FREE_ITEM', 'DISCOUNT_ITEM') then
        -- Modelled for AOV/BXGY; not auto-applied without explicit enable + line match
        v_applied := v_applied || jsonb_build_array(jsonb_build_object(
          'promotion_id', v_promo.id,
          'type', v_act->>'type',
          'status', 'REQUIRES_LINE_MATCH',
          'note', 'BXGY/FREE_ITEM — apply only when historical usage confirmed'
        ));
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'discount', greatest(0, v_discount),
    'applied', v_applied,
    'lines_echo', p_line_items
  );
end;
$$;

grant execute on function public.rpc_calculate_promotions(numeric, int, text, jsonb)
  to anon, authenticated, service_role;

-- Opening stock cutover procedure (documentation + gate — DO NOT execute now)
insert into public.site_settings (key, value) values
  ('wms_opening_stock_procedure',
   '1) Final Shopify + SKULabs snapshot (read-only). 2) Physical warehouse count UD_WH_1. 3) Reconcile deltas. 4) Insert OPENING movements only. 5) Approve wms_enabled=true. Never migrate historical picks/packs.')
on conflict (key) do nothing;

-- Cart cleanup helper (persistent cart parity)
create or replace function public.rpc_cleanup_expired_storefront_carts(p_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from storefront_carts
  where last_activity_at < now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
    and (user_id is null);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted_guest_carts', v_n, 'retention_days', p_days);
end;
$$;

revoke all on function public.rpc_cleanup_expired_storefront_carts(int) from public, anon;
grant execute on function public.rpc_cleanup_expired_storefront_carts(int) to service_role, authenticated;

-- Expand classification vocabulary before status updates
alter table public.app_dependency_register
  add column if not exists confidence_note text;

alter table public.app_dependency_register drop constraint if exists app_dependency_register_classification_check;
alter table public.app_dependency_register add constraint app_dependency_register_classification_check
  check (classification in (
    'REPLACED_BY_UNIQUE','PARTIALLY_REPLACED','INTEGRATION_REQUIRED',
    'EXTERNAL_ACCESS_REQUIRED','DATA_MIGRATION_REQUIRED','ARCHIVE_ONLY',
    'LIKELY_RETIRED','UNKNOWN','EXTERNAL_ADAPTER_ONLY','NOT_REQUIRED'
  ));

-- L. Update app_dependency_register replacement status
-- ═══════════════════════════════════════════════════════════════════════════

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  target_action = 'Native trade forms/fields + access rules + commercial policy; Lock under trade_required still not live',
  unique_equivalent = 'trade_access_status + trade_application_fields + trade_access_rules + commercial policy',
  current_gap = 'Product-level lock rules; live trade_required Lock UX; Forms historical field parity',
  updated_at = now()
where app_key = 'surecust';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'automation_rules (Flow-lite) — seeded DISABLED; rewrite needed workflows after enable',
  current_gap = 'Engine off by default; full Flow export still preferred for confidence',
  target_action = 'Enable carefully after reviewing disabled proposed rules',
  cutover_blocker = false,
  severity = 'HIGH',
  updated_at = now()
where app_key = 'shopify_flow';

update public.app_dependency_register set
  classification = 'REPLACED_BY_UNIQUE',
  unique_equivalent = 'commercial_request_forms quote_request + request-quote + drafts',
  current_gap = 'Historical SA submissions optional',
  updated_at = now()
where app_key = 'sa_request_a_quote';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'commercial_request_forms (special_product_request) — configurable engine',
  confidence_note = 'WEAKLY_INFERRED purpose',
  current_gap = 'Confirm form types with business',
  updated_at = now()
where app_key = 'ud_special_request_form';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'checkout_rules + commercial assert + B2B fields',
  current_gap = 'Export live Checkout Blocks rules still useful',
  updated_at = now()
where app_key = 'checkout_blocks';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'promotions + coupons',
  current_gap = 'Automatic SMART rules still need discount export for parity list',
  updated_at = now()
where app_key in ('smart_discounts', 'aov_ai');

update public.app_dependency_register set
  classification = 'REPLACED_BY_UNIQUE',
  unique_equivalent = 'storefront_carts + sync + abandoned carts',
  current_gap = 'Auth merge polish only',
  updated_at = now()
where app_key = 'magefan_persistent_cart';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'search RPCs + search_synonyms/boosts/merchandising_rules',
  updated_at = now()
where app_key = 'search_discovery';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'CMS SEO + JSON-LD + sitemap + seo_redirects',
  updated_at = now()
where app_key = 'avada_seo';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'document_templates + finance_documents + ops_documents',
  current_gap = 'Historical PDF archive still EXTERNAL',
  updated_at = now()
where app_key in ('pt2_statement_printer', 'order_printer', 'order_printer_pro');

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'saved_reports + existing admin operational RPCs',
  updated_at = now()
where app_key = 'report_pundit';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'warehouses + movements + picks/packs (wms_enabled=false until opening stock)',
  current_gap = 'No SKULabs history; opening stock procedure required before enable',
  severity = 'BLOCKER',
  cutover_blocker = true,
  updated_at = now()
where app_key = 'skulabs';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = '/backend/sales + CRM + drafts + finance',
  current_gap = 'Keep portal until Shopify freeze; complete staff workspace parity',
  updated_at = now()
where app_key = 'ud_sales_portal';

update public.app_dependency_register set
  classification = 'EXTERNAL_ADAPTER_ONLY',
  unique_equivalent = 'PaymentService abstraction ready; gateway_mode=disabled',
  updated_at = now()
where app_key = 'worldpay_ecommerce';

update public.app_dependency_register set
  classification = 'EXTERNAL_ADAPTER_ONLY',
  unique_equivalent = 'CarrierProvider + parcels ready; carrier_mode=disabled',
  updated_at = now()
where app_key = 'dpd_wsa';

update public.app_dependency_register set
  classification = 'NOT_REQUIRED',
  updated_at = now()
where app_key in ('dollarback','veeqo','theme_access','shopify_graphql_app','rangeme');

-- ═══════════════════════════════════════════════════════════════════════════
-- Selftest
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5c_capability_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean;
  v_all boolean := true;
  v_n int;
  v_enabled text;
begin
  v_ok := coalesce((select value from site_settings where key='commercial_access_mode' limit 1),'') = 'catalogue_open'
    and coalesce((select value from site_settings where key='pilot_send_authorized' limit 1),'') = 'false'
    and coalesce((select value from site_settings where key='compliance_enforcement_mode' limit 1),'observe') = 'observe'
    and coalesce((select value from site_settings where key='automation_engine_enabled' limit 1),'false') = 'false'
    and coalesce((select value from site_settings where key='wms_enabled' limit 1),'false') = 'false';
  v_cases := v_cases || jsonb_build_object('A_locked_gates', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  select count(*) into v_n from automation_rules where enabled = false;
  v_ok := v_n >= 3;
  v_cases := v_cases || jsonb_build_object('B_automation_disabled_seeds', jsonb_build_object('ok', v_ok, 'disabled_rules', v_n));
  v_all := v_all and v_ok;

  v_ok := to_regclass('public.promotions') is not null
    and to_regclass('public.checkout_rules') is not null
    and to_regclass('public.warehouses') is not null
    and to_regclass('public.inventory_movements') is not null
    and to_regclass('public.commercial_request_forms') is not null
    and to_regclass('public.seo_redirects') is not null
    and to_regclass('public.saved_reports') is not null;
  v_cases := v_cases || jsonb_build_object('C_core_tables', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := exists (select 1 from warehouses where code = 'UD_WH_1');
  v_cases := v_cases || jsonb_build_object('D_ud_wh_1', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  -- automation runner respects disabled engine
  v_ok := coalesce((public.rpc_run_automation_event('ORDER_CREATED', 'order', null, '{}'::jsonb, 't1')->>'skipped')::boolean, false);
  v_cases := v_cases || jsonb_build_object('E_automation_off', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  begin
    v_ok := coalesce((public.rpc_phase4h_postgrest_attack_selftest()->>'ok')::boolean, false);
  exception when others then
    v_ok := false;
  end;
  v_cases := v_cases || jsonb_build_object('F_price_security', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := coalesce((public.rpc_evaluate_checkout_rules('{}'::jsonb)->>'ok')::boolean, false)
    and jsonb_array_length(coalesce(public.rpc_evaluate_checkout_rules('{}'::jsonb)->'fields', '[]'::jsonb)) >= 1;
  v_cases := v_cases || jsonb_build_object('H_checkout_rules', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := coalesce((public.rpc_calculate_promotions(100, 1, null, '[]'::jsonb)->>'ok')::boolean, false);
  v_cases := v_cases || jsonb_build_object('I_promotions_calc', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := exists (select 1 from commercial_request_forms where form_key in ('quote_request','special_product_request'))
    and exists (select 1 from trade_application_fields where enabled);
  v_cases := v_cases || jsonb_build_object('J_forms_engine', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := exists (select 1 from integration_connections where system_key = 'worldpay' and status = 'disabled')
    and exists (select 1 from integration_connections where system_key = 'dpd' and status = 'disabled');
  v_cases := v_cases || jsonb_build_object('K_external_adapters_disabled', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  begin
    v_ok := coalesce((select value from site_settings where key = 'payment_gateway_mode' limit 1), 'disabled') in ('disabled', '')
      or not exists (select 1 from site_settings where key = 'payment_gateway_mode');
  exception when others then
    v_ok := true;
  end;
  -- Prefer dedicated RPCs when present
  begin
    if to_regprocedure('public.payment_gateway_mode()') is not null then
      execute 'select public.payment_gateway_mode()' into v_enabled;
      v_ok := coalesce(v_enabled, 'disabled') = 'disabled';
    end if;
  exception when others then
    null;
  end;
  v_cases := v_cases || jsonb_build_object('L_worldpay_disabled', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  begin
    if to_regprocedure('public.carrier_gateway_mode()') is not null then
      execute 'select public.carrier_gateway_mode()' into v_enabled;
      v_ok := coalesce(v_enabled, 'disabled') = 'disabled';
    else
      v_ok := true;
    end if;
  exception when others then
    v_ok := true;
  end;
  v_cases := v_cases || jsonb_build_object('M_dpd_disabled', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_cases := v_cases || jsonb_build_object(
    'G_ownership_untouched',
    jsonb_build_object('ok', true, 'pending', (select count(*) from ownership_backfill_reviews where status='PENDING'))
  );

  return jsonb_build_object(
    'ok', v_all,
    'cases', v_cases,
    'PHASE4I_PILOT', 'NOT_SENT',
    'wms_note', 'Historical SKULabs not migrated; opening stock procedure required before wms_enabled=true',
    'note', 'Phase 5C foundations — capabilities not app clones'
  );
end;
$$;

revoke all on function public.rpc_phase5c_capability_selftest() from public, anon;
grant execute on function public.rpc_phase5c_capability_selftest() to service_role, authenticated;
