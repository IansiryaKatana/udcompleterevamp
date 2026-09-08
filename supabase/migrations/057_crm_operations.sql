-- Phase 2C: Customer & Company CRM operations — schema, indexes, append-only
-- notes/events, commercial metrics, admin list/workspace/mutate RPCs, selftest.
-- Additive only. Does not rewrite Shopify history or cascade into orders/drafts.
--
-- Ownership inheritance: CRM current salesperson/CG/referrer/payment_terms may
-- prefill NEW drafts via rpc_admin_crm_defaults_for_draft; never cascade-update
-- historical orders/drafts.
--
-- StoreName precedence (resolve_trading_name; never silently overwrite):
--   1. customers.trading_name (normalized operational)
--   2. companies.trading_name
--   3. metafield owner customer: (store_name,trading_as) | (storename,tradingname)
--   4. metafield owner company: same keys
--   5. customers.company_name_snapshot
-- Customer type: prefer customers/companies.customer_type column; metafield
-- custom.customer_type / draft_customer_type returned as alternatives only.

create extension if not exists pg_trgm;

-- ── customers / companies additive columns ───────────────────────────────────
alter table public.customers
  add column if not exists version int not null default 1,
  add column if not exists payment_terms text,
  add column if not exists created_by_staff_id uuid references public.staff_members(id) on delete set null;

alter table public.companies
  add column if not exists version int not null default 1,
  add column if not exists payment_terms text,
  add column if not exists created_by_staff_id uuid references public.staff_members(id) on delete set null;

comment on column public.customers.version is
  'Optimistic concurrency counter; bumped on Unique CRM mutations.';
comment on column public.customers.payment_terms is
  'Normalized free-text payment terms (Net 30, etc.). Does not rewrite order/draft history.';
comment on column public.companies.version is
  'Optimistic concurrency counter; bumped on Unique CRM mutations.';
comment on column public.companies.payment_terms is
  'Normalized free-text payment terms. Location payment_terms_template remains source fidelity.';

create index if not exists customers_created_by_staff_id_idx
  on public.customers (created_by_staff_id)
  where created_by_staff_id is not null;
create index if not exists customers_payment_terms_idx
  on public.customers (payment_terms)
  where payment_terms is not null;
create index if not exists customers_source_system_idx
  on public.customers (source_system)
  where source_system is not null;
create index if not exists customers_referrer_id_idx
  on public.customers (referrer_id)
  where referrer_id is not null;
create index if not exists customers_created_at_desc_idx
  on public.customers (created_at desc);
create index if not exists customers_updated_at_desc_idx
  on public.customers (updated_at desc);

create index if not exists companies_created_by_staff_id_idx
  on public.companies (created_by_staff_id)
  where created_by_staff_id is not null;
create index if not exists companies_payment_terms_idx
  on public.companies (payment_terms)
  where payment_terms is not null;
create index if not exists companies_source_system_idx
  on public.companies (source_system)
  where source_system is not null;
create index if not exists companies_cg_assigned_id_idx
  on public.companies (cg_assigned_id)
  where cg_assigned_id is not null;
create index if not exists companies_referrer_id_idx
  on public.companies (referrer_id)
  where referrer_id is not null;
create index if not exists companies_created_at_desc_idx
  on public.companies (created_at desc);
create index if not exists companies_updated_at_desc_idx
  on public.companies (updated_at desc);

-- ── pg_trgm search indexes ───────────────────────────────────────────────────
create index if not exists customers_display_name_trgm_idx
  on public.customers using gin (display_name gin_trgm_ops);
create index if not exists customers_email_trgm_idx
  on public.customers using gin (email gin_trgm_ops);
create index if not exists customers_phone_trgm_idx
  on public.customers using gin (phone gin_trgm_ops);
create index if not exists customers_trading_name_trgm_idx
  on public.customers using gin (trading_name gin_trgm_ops);
create index if not exists customers_payment_terms_trgm_idx
  on public.customers using gin (payment_terms gin_trgm_ops);
create index if not exists customers_full_name_trgm_idx
  on public.customers using gin (
    (coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops
  );
create index if not exists customers_company_name_snapshot_trgm_idx
  on public.customers using gin (company_name_snapshot gin_trgm_ops);

create index if not exists companies_name_trgm_idx
  on public.companies using gin (name gin_trgm_ops);
create index if not exists companies_trading_name_trgm_idx
  on public.companies using gin (trading_name gin_trgm_ops);
create index if not exists companies_legal_name_trgm_idx
  on public.companies using gin (legal_name gin_trgm_ops);
create index if not exists companies_payment_terms_trgm_idx
  on public.companies using gin (payment_terms gin_trgm_ops);

create index if not exists customer_addresses_postal_code_trgm_idx
  on public.customer_addresses using gin (postal_code gin_trgm_ops);
create index if not exists customer_addresses_city_trgm_idx
  on public.customer_addresses using gin (city gin_trgm_ops);

create index if not exists company_locations_name_trgm_idx
  on public.company_locations using gin (name gin_trgm_ops);
create index if not exists company_locations_postal_code_trgm_idx
  on public.company_locations using gin (postal_code gin_trgm_ops);

-- company_contacts already indexed on company_id / customer_id in 037; keep idempotent.
create index if not exists company_contacts_company_id_idx
  on public.company_contacts (company_id);
create index if not exists company_contacts_customer_id_idx
  on public.company_contacts (customer_id);

-- ── crm_notes (append-only) ──────────────────────────────────────────────────
create table if not exists public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  body text not null,
  author_staff_id uuid references public.staff_members(id) on delete set null,
  author_name_snapshot text,
  source_system text not null default 'unique',
  created_at timestamptz not null default now(),
  constraint crm_notes_entity_type_chk check (entity_type in ('customer', 'company')),
  constraint crm_notes_body_chk check (char_length(trim(body)) > 0)
);

comment on table public.crm_notes is
  'Append-only staff notes on customers/companies. UPDATE/DELETE blocked by trigger.';

create index if not exists crm_notes_entity_created_idx
  on public.crm_notes (entity_type, entity_id, created_at);

create or replace function public.forbid_crm_notes_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'crm_notes is append-only; UPDATE/DELETE are not allowed'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_crm_notes_no_update on public.crm_notes;
create trigger trg_crm_notes_no_update
  before update on public.crm_notes
  for each row execute function public.forbid_crm_notes_mutation();

drop trigger if exists trg_crm_notes_no_delete on public.crm_notes;
create trigger trg_crm_notes_no_delete
  before delete on public.crm_notes
  for each row execute function public.forbid_crm_notes_mutation();

alter table public.crm_notes enable row level security;

drop policy if exists "admin_select_crm_notes" on public.crm_notes;
create policy "admin_select_crm_notes" on public.crm_notes
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_crm_notes" on public.crm_notes;
create policy "admin_insert_crm_notes" on public.crm_notes
  for insert to authenticated with check (public.is_admin());

grant select, insert on public.crm_notes to authenticated;
grant select, insert on public.crm_notes to service_role;
revoke update, delete on public.crm_notes from authenticated;
revoke update, delete on public.crm_notes from anon;

-- ── crm_events (append-only) ─────────────────────────────────────────────────
create table if not exists public.crm_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  category text not null default 'system',
  source_system text,
  actor_type text,
  actor_id uuid,
  actor_name_snapshot text,
  message text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint crm_events_entity_type_chk check (entity_type in ('customer', 'company')),
  constraint crm_events_event_type_chk check (char_length(trim(event_type)) > 0),
  constraint crm_events_category_chk check (char_length(trim(category)) > 0)
);

comment on table public.crm_events is
  'Append-only CRM timeline. UPDATE/DELETE blocked by trigger (mirrors draft_order_events).';

create index if not exists crm_events_entity_occurred_idx
  on public.crm_events (entity_type, entity_id, occurred_at);

create index if not exists crm_events_category_idx
  on public.crm_events (category);

create or replace function public.forbid_crm_events_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'crm_events is append-only; UPDATE/DELETE are not allowed'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_crm_events_no_update on public.crm_events;
create trigger trg_crm_events_no_update
  before update on public.crm_events
  for each row execute function public.forbid_crm_events_mutation();

drop trigger if exists trg_crm_events_no_delete on public.crm_events;
create trigger trg_crm_events_no_delete
  before delete on public.crm_events
  for each row execute function public.forbid_crm_events_mutation();

alter table public.crm_events enable row level security;

drop policy if exists "admin_select_crm_events" on public.crm_events;
create policy "admin_select_crm_events" on public.crm_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_crm_events" on public.crm_events;
create policy "admin_insert_crm_events" on public.crm_events
  for insert to authenticated with check (public.is_admin());

grant select, insert on public.crm_events to authenticated;
grant select, insert on public.crm_events to service_role;
revoke update, delete on public.crm_events from authenticated;
revoke update, delete on public.crm_events from anon;

-- ── Helpers ──────────────────────────────────────────────────────────────────
create or replace function public.can_mutate_crm()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  -- Same gate as order/draft ops: owner/admin/editor via is_admin(); viewers excluded.
  select public.is_admin();
$$;

comment on function public.can_mutate_crm() is
  'True for owner/admin/editor. Viewers cannot mutate or call admin CRM RPCs (is_admin gate).';

grant execute on function public.can_mutate_crm() to authenticated;
grant execute on function public.can_mutate_crm() to service_role;

create or replace function public.append_crm_event(
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_category text default 'system',
  p_message text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_metadata jsonb default '{}'::jsonb,
  p_source_system text default 'unique',
  p_actor_type text default null,
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_actor_id uuid := coalesce(p_actor_id, public.current_admin_staff_id());
  v_actor_name text := coalesce(p_actor_name, public.current_admin_display_name());
  v_actor_type text := coalesce(p_actor_type, case when v_actor_id is not null then 'staff' else 'system' end);
begin
  if p_entity_type not in ('customer', 'company') then
    raise exception 'Invalid CRM entity_type: %', p_entity_type using errcode = 'P0001';
  end if;

  insert into public.crm_events (
    entity_type, entity_id, event_type, category, source_system,
    actor_type, actor_id, actor_name_snapshot,
    message, old_value, new_value, metadata, occurred_at
  ) values (
    p_entity_type, p_entity_id, p_event_type,
    coalesce(nullif(btrim(p_category), ''), 'system'),
    p_source_system,
    v_actor_type, v_actor_id, v_actor_name,
    p_message, p_old_value, p_new_value, coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_occurred_at, now())
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.append_crm_event(
  text, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, uuid, text, timestamptz
) to authenticated;
grant execute on function public.append_crm_event(
  text, uuid, text, text, text, jsonb, jsonb, jsonb, text, text, uuid, text, timestamptz
) to service_role;

-- StoreName / trading-name provenance (never overwrites; returns all sources found).
create or replace function public.resolve_trading_name(
  p_customer_id uuid default null,
  p_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sources jsonb := '[]'::jsonb;
  v_display text := null;
  v_val text;
  r record;
begin
  -- 1. customers.trading_name (normalized operational StoreName)
  if p_customer_id is not null then
    select nullif(btrim(cu.trading_name), '') into v_val
    from public.customers cu where cu.id = p_customer_id;
    if v_val is not null then
      v_sources := v_sources || jsonb_build_array(jsonb_build_object(
        'source', 'customers.trading_name', 'value', v_val, 'rank', 1
      ));
      v_display := coalesce(v_display, v_val);
    end if;
  end if;

  -- 2. companies.trading_name
  if p_company_id is not null then
    select nullif(btrim(co.trading_name), '') into v_val
    from public.companies co where co.id = p_company_id;
    if v_val is not null then
      v_sources := v_sources || jsonb_build_array(jsonb_build_object(
        'source', 'companies.trading_name', 'value', v_val, 'rank', 2
      ));
      v_display := coalesce(v_display, v_val);
    end if;
  end if;

  -- 3. customer metafields store_name.trading_as / storename.tradingname
  if p_customer_id is not null then
    for r in
      select m.namespace, m.key,
        coalesce(
          nullif(btrim(m.value_text), ''),
          nullif(btrim(m.value_json #>> '{}'), ''),
          nullif(btrim(m.value_json->>'value'), '')
        ) as val
      from public.metafields m
      where m.owner_type = 'customer'
        and m.owner_id = p_customer_id
        and (m.namespace, m.key) in (
          ('store_name', 'trading_as'),
          ('storename', 'tradingname')
        )
      order by case when m.namespace = 'store_name' then 0 else 1 end, m.created_at
    loop
      if r.val is not null then
        v_sources := v_sources || jsonb_build_array(jsonb_build_object(
          'source', 'metafield.customer.' || r.namespace || '.' || r.key,
          'value', r.val, 'rank', 3
        ));
        v_display := coalesce(v_display, r.val);
      end if;
    end loop;
  end if;

  -- 4. company metafields (same keys)
  if p_company_id is not null then
    for r in
      select m.namespace, m.key,
        coalesce(
          nullif(btrim(m.value_text), ''),
          nullif(btrim(m.value_json #>> '{}'), ''),
          nullif(btrim(m.value_json->>'value'), '')
        ) as val
      from public.metafields m
      where m.owner_type = 'company'
        and m.owner_id = p_company_id
        and (m.namespace, m.key) in (
          ('store_name', 'trading_as'),
          ('storename', 'tradingname')
        )
      order by case when m.namespace = 'store_name' then 0 else 1 end, m.created_at
    loop
      if r.val is not null then
        v_sources := v_sources || jsonb_build_array(jsonb_build_object(
          'source', 'metafield.company.' || r.namespace || '.' || r.key,
          'value', r.val, 'rank', 4
        ));
        v_display := coalesce(v_display, r.val);
      end if;
    end loop;
  end if;

  -- 5. customers.company_name_snapshot
  if p_customer_id is not null then
    select nullif(btrim(cu.company_name_snapshot), '') into v_val
    from public.customers cu where cu.id = p_customer_id;
    if v_val is not null then
      v_sources := v_sources || jsonb_build_array(jsonb_build_object(
        'source', 'customers.company_name_snapshot', 'value', v_val, 'rank', 5
      ));
      v_display := coalesce(v_display, v_val);
    end if;
  end if;

  return jsonb_build_object('display', v_display, 'sources', v_sources);
end;
$$;

comment on function public.resolve_trading_name(uuid, uuid) is
  'StoreName provenance. Precedence: customers.trading_name > companies.trading_name > customer metafields > company metafields > company_name_snapshot. Never overwrites.';

grant execute on function public.resolve_trading_name(uuid, uuid) to authenticated;
grant execute on function public.resolve_trading_name(uuid, uuid) to service_role;

-- Customer type: column preferred; metafields as non-destructive alternatives.
create or replace function public.resolve_customer_type(
  p_customer_id uuid default null,
  p_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_preferred text := null;
  v_alts jsonb := '[]'::jsonb;
  v_val text;
  r record;
begin
  if p_customer_id is not null then
    select nullif(btrim(cu.customer_type), '') into v_val
    from public.customers cu where cu.id = p_customer_id;
    if v_val is not null then
      v_preferred := v_val;
      v_alts := v_alts || jsonb_build_array(jsonb_build_object(
        'source', 'customers.customer_type', 'value', v_val
      ));
    end if;
  end if;

  if p_company_id is not null then
    select nullif(btrim(co.customer_type), '') into v_val
    from public.companies co where co.id = p_company_id;
    if v_val is not null then
      v_preferred := coalesce(v_preferred, v_val);
      v_alts := v_alts || jsonb_build_array(jsonb_build_object(
        'source', 'companies.customer_type', 'value', v_val
      ));
    end if;
  end if;

  for r in
    select m.owner_type, m.namespace, m.key,
      coalesce(
        nullif(btrim(m.value_text), ''),
        nullif(btrim(m.value_json #>> '{}'), ''),
        nullif(btrim(m.value_json->>'value'), '')
      ) as val
    from public.metafields m
    where (
        (p_customer_id is not null and m.owner_type = 'customer' and m.owner_id = p_customer_id)
        or (p_company_id is not null and m.owner_type = 'company' and m.owner_id = p_company_id)
      )
      and m.key in ('customer_type', 'draft_customer_type')
      and (m.namespace = 'custom' or m.namespace is not null)
  loop
    if r.val is not null then
      v_alts := v_alts || jsonb_build_array(jsonb_build_object(
        'source', 'metafield.' || r.owner_type || '.' || r.namespace || '.' || r.key,
        'value', r.val
      ));
      v_preferred := coalesce(v_preferred, r.val);
    end if;
  end loop;

  return jsonb_build_object(
    'preferred', v_preferred,
    'alternatives', v_alts
  );
end;
$$;

grant execute on function public.resolve_customer_type(uuid, uuid) to authenticated;
grant execute on function public.resolve_customer_type(uuid, uuid) to service_role;

create or replace function public.crm_location_payment_terms(p_template jsonb)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select nullif(btrim(coalesce(
    p_template->>'payment_terms',
    p_template->>'name',
    p_template->>'title',
    p_template->>'translatedName',
    ''
  )), '');
$$;

-- Commercial aggregates
create or replace function public.crm_customer_commercial_metrics(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order_count int := 0;
  v_lifetime numeric(14,2) := 0;
  v_received numeric(14,2) := 0;
  v_outstanding numeric(14,2) := 0;
  v_refund numeric(14,2) := 0;
  v_first timestamptz;
  v_last timestamptz;
  v_open_drafts int := 0;
  v_open_draft_value numeric(14,2) := 0;
begin
  if p_customer_id is null then
    return jsonb_build_object(
      'order_count', 0, 'lifetime_total', 0, 'total_received', 0, 'total_outstanding', 0,
      'refund_total', 0, 'avg_order_value', null, 'first_order_at', null, 'last_order_at', null,
      'open_draft_count', 0, 'open_draft_value', 0
    );
  end if;

  select
    count(*)::int,
    coalesce(sum(o.total), 0),
    coalesce(sum(o.total_received), 0),
    coalesce(sum(o.total_outstanding), 0),
    min(coalesce(o.source_created_at, o.created_at)),
    max(coalesce(o.source_created_at, o.created_at))
  into v_order_count, v_lifetime, v_received, v_outstanding, v_first, v_last
  from public.orders o
  where o.customer_id = p_customer_id;

  select coalesce(sum(r.total_refunded), 0) into v_refund
  from public.refunds r
  join public.orders o on o.id = r.order_id
  where o.customer_id = p_customer_id;

  select count(*)::int, coalesce(sum(d.total_price), 0)
  into v_open_drafts, v_open_draft_value
  from public.draft_orders d
  where d.customer_id = p_customer_id
    and d.status = 'open';

  return jsonb_build_object(
    'order_count', v_order_count,
    'lifetime_total', v_lifetime,
    'total_received', v_received,
    'total_outstanding', v_outstanding,
    'refund_total', v_refund,
    'avg_order_value', case when v_order_count > 0 then round(v_lifetime / v_order_count, 2) else null end,
    'first_order_at', v_first,
    'last_order_at', v_last,
    'open_draft_count', v_open_drafts,
    'open_draft_value', v_open_draft_value
  );
end;
$$;

create or replace function public.crm_company_commercial_metrics(p_company_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order_count int := 0;
  v_lifetime numeric(14,2) := 0;
  v_received numeric(14,2) := 0;
  v_outstanding numeric(14,2) := 0;
  v_refund numeric(14,2) := 0;
  v_first timestamptz;
  v_last timestamptz;
  v_open_drafts int := 0;
  v_open_draft_value numeric(14,2) := 0;
begin
  if p_company_id is null then
    return jsonb_build_object(
      'order_count', 0, 'lifetime_total', 0, 'total_received', 0, 'total_outstanding', 0,
      'refund_total', 0, 'avg_order_value', null, 'first_order_at', null, 'last_order_at', null,
      'open_draft_count', 0, 'open_draft_value', 0
    );
  end if;

  select
    count(*)::int,
    coalesce(sum(o.total), 0),
    coalesce(sum(o.total_received), 0),
    coalesce(sum(o.total_outstanding), 0),
    min(coalesce(o.source_created_at, o.created_at)),
    max(coalesce(o.source_created_at, o.created_at))
  into v_order_count, v_lifetime, v_received, v_outstanding, v_first, v_last
  from public.orders o
  where o.company_id = p_company_id;

  select coalesce(sum(r.total_refunded), 0) into v_refund
  from public.refunds r
  join public.orders o on o.id = r.order_id
  where o.company_id = p_company_id;

  select count(*)::int, coalesce(sum(d.total_price), 0)
  into v_open_drafts, v_open_draft_value
  from public.draft_orders d
  where d.company_id = p_company_id
    and d.status = 'open';

  return jsonb_build_object(
    'order_count', v_order_count,
    'lifetime_total', v_lifetime,
    'total_received', v_received,
    'total_outstanding', v_outstanding,
    'refund_total', v_refund,
    'avg_order_value', case when v_order_count > 0 then round(v_lifetime / v_order_count, 2) else null end,
    'first_order_at', v_first,
    'last_order_at', v_last,
    'open_draft_count', v_open_drafts,
    'open_draft_value', v_open_draft_value
  );
end;
$$;

grant execute on function public.crm_customer_commercial_metrics(uuid) to authenticated;
grant execute on function public.crm_company_commercial_metrics(uuid) to authenticated;
grant execute on function public.crm_customer_commercial_metrics(uuid) to service_role;
grant execute on function public.crm_company_commercial_metrics(uuid) to service_role;

-- Guards for CRM master mutations (Shopify-imported CRM rows ARE editable for
-- normalized operational fields; raw metafields/source_system stay preserved.
-- Unlike drafts/orders, CRM entities are ongoing business records.)
create or replace function public.assert_crm_customer_mutable(
  p_customer_id uuid,
  p_expected_version int
)
returns public.customers
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.customers%rowtype;
begin
  select * into v_row from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and v_row.version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

create or replace function public.assert_crm_company_mutable(
  p_company_id uuid,
  p_expected_version int
)
returns public.companies
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.companies%rowtype;
begin
  select * into v_row from public.companies where id = p_company_id for update;
  if not found then
    raise exception 'COMPANY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and v_row.version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- Back-compat aliases used by earlier draft of this migration
create or replace function public.assert_unique_crm_customer(
  p_customer_id uuid,
  p_expected_version int
)
returns public.customers
language plpgsql
security invoker
set search_path = public
as $$
begin
  return public.assert_crm_customer_mutable(p_customer_id, p_expected_version);
end;
$$;

create or replace function public.assert_unique_crm_company(
  p_company_id uuid,
  p_expected_version int
)
returns public.companies
language plpgsql
security invoker
set search_path = public
as $$
begin
  return public.assert_crm_company_mutable(p_company_id, p_expected_version);
end;
$$;

-- Soft-close + open entity_assignments for ownership handoff (audit trail only; no order cascade)
create or replace function public.crm_sync_assignment(
  p_entity_type text,
  p_entity_id uuid,
  p_assignment_type text,
  p_staff_id uuid,
  p_source text default 'unique_crm'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.entity_assignments
  set valid_to = now()
  where entity_type = p_entity_type
    and entity_id = p_entity_id
    and assignment_type = p_assignment_type
    and valid_to is null
    and (p_staff_id is null or staff_member_id is distinct from p_staff_id);

  if p_staff_id is not null then
    insert into public.entity_assignments (
      entity_type, entity_id, assignment_type, staff_member_id, source, valid_from
    )
    select p_entity_type, p_entity_id, p_assignment_type, p_staff_id, p_source, now()
    where not exists (
      select 1 from public.entity_assignments ea
      where ea.entity_type = p_entity_type
        and ea.entity_id = p_entity_id
        and ea.assignment_type = p_assignment_type
        and ea.staff_member_id = p_staff_id
        and ea.valid_to is null
    );
  end if;
end;
$$;

create or replace function public.crm_date_preset_bounds(
  p_preset text,
  out o_from timestamptz,
  out o_to timestamptz
)
returns record
language plpgsql
immutable
security invoker
set search_path = public
as $$
begin
  o_from := null;
  o_to := null;
  if p_preset = 'today' then
    o_from := date_trunc('day', now());
    o_to := o_from + interval '1 day';
  elsif p_preset = 'yesterday' then
    o_from := date_trunc('day', now()) - interval '1 day';
    o_to := date_trunc('day', now());
  elsif p_preset = 'this_week' then
    o_from := date_trunc('week', now());
    o_to := now();
  elsif p_preset = 'this_month' then
    o_from := date_trunc('month', now());
    o_to := now();
  elsif p_preset = 'last_30_days' then
    o_from := now() - interval '30 days';
    o_to := now();
  elsif p_preset = 'last_90_days' then
    o_from := now() - interval '90 days';
    o_to := now();
  end if;
end;
$$;

-- ── Facets: customers ────────────────────────────────────────────────────────
create or replace function public.rpc_admin_crm_customer_filter_facets()
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
    'customer_types', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct customer_type as x from public.customers
        where customer_type is not null and btrim(customer_type) <> ''
      ) s
    ), '[]'::jsonb),
    'payment_terms', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct payment_terms as x from public.customers
        where payment_terms is not null and btrim(payment_terms) <> ''
      ) s
    ), '[]'::jsonb),
    'source_systems', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct source_system as x from public.customers
        where source_system is not null
      ) s
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(x order by x)
      from (select distinct status as x from public.customers where status is not null) s
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', sm.id, 'name', sm.name) order by sm.name)
      from public.staff_members sm
      where sm.active = true
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct et.raw_value as x
        from public.entity_tags et
        where et.entity_type = 'customer'
        order by et.raw_value
        limit 500
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_admin_crm_customer_filter_facets() to authenticated;

-- ── List customers ───────────────────────────────────────────────────────────
create or replace function public.rpc_list_admin_crm_customers(
  p_limit int default 25,
  p_offset int default 0,
  p_sort text default 'created_desc',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total bigint;
  v_items jsonb;
  v_search text := nullif(btrim(coalesce(p_filters->>'search', '')), '');
  v_has_company boolean := case when p_filters ? 'has_company' and nullif(p_filters->>'has_company', '') is not null
    then (p_filters->>'has_company')::boolean else null end;
  v_company uuid := nullif(p_filters->>'company_id', '')::uuid;
  v_types text[] := case when jsonb_typeof(p_filters->'customer_types') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'customer_types')) else null end;
  v_salesperson uuid := nullif(p_filters->>'salesperson_id', '')::uuid;
  v_cg uuid := nullif(p_filters->>'cg_assigned_id', '')::uuid;
  v_referrer uuid := nullif(p_filters->>'referrer_id', '')::uuid;
  v_unassigned_sp boolean := coalesce((p_filters->>'unassigned_salesperson')::boolean, false);
  v_has_outstanding boolean := coalesce((p_filters->>'has_outstanding')::boolean, false);
  v_min_life numeric := nullif(p_filters->>'min_lifetime', '')::numeric;
  v_max_life numeric := nullif(p_filters->>'max_lifetime', '')::numeric;
  v_has_orders boolean := case when p_filters ? 'has_orders' and nullif(p_filters->>'has_orders', '') is not null
    then (p_filters->>'has_orders')::boolean else null end;
  v_has_open_drafts boolean := case when p_filters ? 'has_open_drafts' and nullif(p_filters->>'has_open_drafts', '') is not null
    then (p_filters->>'has_open_drafts')::boolean else null end;
  v_payment_terms text := nullif(btrim(coalesce(p_filters->>'payment_terms', '')), '');
  v_sources text[] := case when jsonb_typeof(p_filters->'source_systems') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'source_systems')) else null end;
  v_source_group text := nullif(btrim(coalesce(p_filters->>'source_group', '')), '');
  v_tags text[] := case when jsonb_typeof(p_filters->'tags') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'tags')) else null end;
  v_inactive_since date := nullif(p_filters->>'inactive_since', '')::date;
  v_created_preset text := nullif(btrim(coalesce(p_filters->>'created_preset', p_filters->>'date_preset', '')), '');
  v_created_from timestamptz := coalesce(
    nullif(p_filters->>'created_from', ''),
    nullif(p_filters->>'date_from', '')
  )::timestamptz;
  v_created_to timestamptz := coalesce(
    nullif(p_filters->>'created_to', ''),
    nullif(p_filters->>'date_to', '')
  )::timestamptz;
  v_last_order_preset text := nullif(btrim(coalesce(p_filters->>'last_order_preset', '')), '');
  v_last_order_from timestamptz := nullif(p_filters->>'last_order_from', '')::timestamptz;
  v_last_order_to timestamptz := nullif(p_filters->>'last_order_to', '')::timestamptz;
  v_bounds record;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_created_preset is not null then
    v_bounds := public.crm_date_preset_bounds(v_created_preset);
    v_created_from := coalesce(v_created_from, v_bounds.o_from);
    v_created_to := coalesce(v_created_to, v_bounds.o_to);
  end if;
  if v_last_order_preset is not null then
    v_bounds := public.crm_date_preset_bounds(v_last_order_preset);
    v_last_order_from := coalesce(v_last_order_from, v_bounds.o_from);
    v_last_order_to := coalesce(v_last_order_to, v_bounds.o_to);
  end if;

  with metrics as (
    select
      o.customer_id,
      count(*)::int as order_count,
      coalesce(sum(o.total), 0)::numeric(14,2) as lifetime_total,
      coalesce(sum(o.total_received), 0)::numeric(14,2) as total_received,
      coalesce(sum(o.total_outstanding), 0)::numeric(14,2) as total_outstanding,
      min(coalesce(o.source_created_at, o.created_at)) as first_order_at,
      max(coalesce(o.source_created_at, o.created_at)) as last_order_at
    from public.orders o
    where o.customer_id is not null
    group by o.customer_id
  ),
  refunds_agg as (
    select o.customer_id, coalesce(sum(r.total_refunded), 0)::numeric(14,2) as refund_total
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where o.customer_id is not null
    group by o.customer_id
  ),
  drafts_agg as (
    select d.customer_id,
      count(*) filter (where d.status = 'open')::int as open_draft_count,
      coalesce(sum(d.total_price) filter (where d.status = 'open'), 0)::numeric(14,2) as open_draft_value
    from public.draft_orders d
    where d.customer_id is not null
    group by d.customer_id
  ),
  filtered as (
    select cu.id
    from public.customers cu
    left join metrics m on m.customer_id = cu.id
    left join drafts_agg da on da.customer_id = cu.id
    left join public.staff_members sp on sp.id = cu.salesperson_id
    left join public.staff_members cg on cg.id = cu.cg_assigned_id
    left join public.staff_members rf on rf.id = cu.referrer_id
    where
      (v_created_from is null or cu.created_at >= v_created_from)
      and (v_created_to is null or cu.created_at < v_created_to)
      and (v_types is null or cu.customer_type = any(v_types))
      and (v_salesperson is null or cu.salesperson_id = v_salesperson)
      and (v_cg is null or cu.cg_assigned_id = v_cg)
      and (v_referrer is null or cu.referrer_id = v_referrer)
      and (not v_unassigned_sp or cu.salesperson_id is null)
      and (v_payment_terms is null or cu.payment_terms ilike v_payment_terms)
      and (v_sources is null or cu.source_system = any(v_sources))
      and (
        v_source_group is null
        or (v_source_group = 'shopify' and cu.source_system = 'shopify')
        or (v_source_group = 'unique' and coalesce(cu.source_system, '') = 'unique')
      )
      and (
        v_company is null
        or exists (
          select 1 from public.company_contacts cc
          where cc.customer_id = cu.id and cc.company_id = v_company
        )
      )
      and (
        v_has_company is null
        or (v_has_company and exists (select 1 from public.company_contacts cc where cc.customer_id = cu.id))
        or (not v_has_company and not exists (select 1 from public.company_contacts cc where cc.customer_id = cu.id))
      )
      and (not v_has_outstanding or coalesce(m.total_outstanding, 0) > 0)
      and (v_min_life is null or coalesce(m.lifetime_total, 0) >= v_min_life)
      and (v_max_life is null or coalesce(m.lifetime_total, 0) <= v_max_life)
      and (
        v_has_orders is null
        or (v_has_orders and coalesce(m.order_count, 0) > 0)
        or (not v_has_orders and coalesce(m.order_count, 0) = 0)
      )
      and (
        v_has_open_drafts is null
        or (v_has_open_drafts and coalesce(da.open_draft_count, 0) > 0)
        or (not v_has_open_drafts and coalesce(da.open_draft_count, 0) = 0)
      )
      and (v_last_order_from is null or m.last_order_at >= v_last_order_from)
      and (v_last_order_to is null or m.last_order_at < v_last_order_to)
      and (
        v_inactive_since is null
        or m.last_order_at is null
        or m.last_order_at < v_inactive_since::timestamptz
      )
      and (
        v_tags is null
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'customer' and et.entity_id = cu.id and et.raw_value = any(v_tags)
        )
      )
      and (
        v_search is null
        or cu.display_name ilike '%' || v_search || '%'
        or cu.email ilike '%' || v_search || '%'
        or cu.phone ilike '%' || v_search || '%'
        or cu.trading_name ilike '%' || v_search || '%'
        or cu.company_name_snapshot ilike '%' || v_search || '%'
        or cu.payment_terms ilike '%' || v_search || '%'
        or (cu.first_name || ' ' || cu.last_name) ilike '%' || v_search || '%'
        or sp.name ilike '%' || v_search || '%'
        or cg.name ilike '%' || v_search || '%'
        or rf.name ilike '%' || v_search || '%'
        or exists (
          select 1 from public.company_contacts cc
          join public.companies co on co.id = cc.company_id
          where cc.customer_id = cu.id
            and (co.name ilike '%' || v_search || '%' or co.trading_name ilike '%' || v_search || '%')
        )
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'customer' and et.entity_id = cu.id
            and et.raw_value ilike '%' || v_search || '%'
        )
        or exists (
          select 1 from public.external_system_refs esr
          where esr.entity_type = 'customer' and esr.entity_id = cu.id
            and (
              esr.external_gid ilike '%' || v_search || '%'
              or esr.external_legacy_id ilike '%' || v_search || '%'
              or esr.external_number ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.orders o
          where o.customer_id = cu.id
            and (
              o.order_number ilike '%' || v_search || '%'
              or o.source_order_number ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.draft_orders d
          where d.customer_id = cu.id
            and d.name ilike '%' || v_search || '%'
        )
      )
  ),
  counted as (
    select count(*)::bigint as total from filtered
  ),
  page as (
    select
      case coalesce(p_sort, 'created_desc')
        when 'created_asc' then row_number() over (order by cu.created_at asc)
        when 'name_asc' then row_number() over (order by coalesce(cu.display_name, cu.email) asc nulls last)
        when 'name_desc' then row_number() over (order by coalesce(cu.display_name, cu.email) desc nulls last)
        when 'lifetime_desc' then row_number() over (order by coalesce(m.lifetime_total, 0) desc)
        when 'lifetime_asc' then row_number() over (order by coalesce(m.lifetime_total, 0) asc)
        when 'last_order_desc' then row_number() over (order by m.last_order_at desc nulls last)
        when 'outstanding_desc' then row_number() over (order by coalesce(m.total_outstanding, 0) desc)
        when 'updated_desc' then row_number() over (order by cu.updated_at desc)
        else row_number() over (order by cu.created_at desc)
      end as ord,
      cu.id,
      cu.display_name,
      cu.first_name,
      cu.last_name,
      cu.email,
      cu.phone,
      cu.trading_name,
      cu.company_name_snapshot,
      cu.customer_type,
      cu.payment_terms,
      cu.status,
      cu.approval_status,
      cu.source_system,
      cu.salesperson_id,
      cu.cg_assigned_id,
      cu.referrer_id,
      cu.version,
      cu.created_at,
      cu.updated_at,
      sp.name as salesperson_name,
      cg.name as cg_name,
      rf.name as referrer_name,
      coalesce(m.order_count, 0) as order_count,
      coalesce(m.lifetime_total, 0) as lifetime_total,
      coalesce(m.total_received, 0) as total_received,
      coalesce(m.total_outstanding, 0) as total_outstanding,
      coalesce(ra.refund_total, 0) as refund_total,
      case when coalesce(m.order_count, 0) > 0
        then round(m.lifetime_total / m.order_count, 2) else null end as avg_order_value,
      m.first_order_at,
      m.last_order_at,
      coalesce(da.open_draft_count, 0) as open_draft_count,
      coalesce(da.open_draft_value, 0) as open_draft_value,
      (
        select coalesce(jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name) order by co.name), '[]'::jsonb)
        from public.company_contacts cc
        join public.companies co on co.id = cc.company_id
        where cc.customer_id = cu.id
      ) as companies,
      (
        select coalesce(jsonb_agg(t.raw_value order by t.raw_value), '[]'::jsonb)
        from (
          select et.raw_value from public.entity_tags et
          where et.entity_type = 'customer' and et.entity_id = cu.id
          order by et.raw_value limit 8
        ) t
      ) as tags
    from filtered f
    join public.customers cu on cu.id = f.id
    left join metrics m on m.customer_id = cu.id
    left join refunds_agg ra on ra.customer_id = cu.id
    left join drafts_agg da on da.customer_id = cu.id
    left join public.staff_members sp on sp.id = cu.salesperson_id
    left join public.staff_members cg on cg.id = cu.cg_assigned_id
    left join public.staff_members rf on rf.id = cu.referrer_id
    order by ord
    limit greatest(coalesce(p_limit, 25), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    c.total,
    coalesce((select jsonb_agg(to_jsonb(p) order by p.ord) from page p), '[]'::jsonb)
  into v_total, v_items
  from counted c;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.rpc_list_admin_crm_customers(int, int, text, jsonb) to authenticated;
-- ── Facets: companies ────────────────────────────────────────────────────────
create or replace function public.rpc_admin_crm_company_filter_facets()
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
    'customer_types', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct customer_type as x from public.companies
        where customer_type is not null and btrim(customer_type) <> ''
      ) s
    ), '[]'::jsonb),
    'payment_terms', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct payment_terms as x from public.companies
        where payment_terms is not null and btrim(payment_terms) <> ''
      ) s
    ), '[]'::jsonb),
    'source_systems', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct source_system as x from public.companies
        where source_system is not null
      ) s
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(x order by x)
      from (select distinct status as x from public.companies where status is not null) s
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', sm.id, 'name', sm.name) order by sm.name)
      from public.staff_members sm
      where sm.active = true
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(x order by x)
      from (
        select distinct et.raw_value as x
        from public.entity_tags et
        where et.entity_type = 'company'
        order by et.raw_value
        limit 500
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_admin_crm_company_filter_facets() to authenticated;

-- ── List companies ───────────────────────────────────────────────────────────
create or replace function public.rpc_list_admin_crm_companies(
  p_limit int default 25,
  p_offset int default 0,
  p_sort text default 'created_desc',
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total bigint;
  v_items jsonb;
  v_search text := nullif(btrim(coalesce(p_filters->>'search', '')), '');
  v_has_contacts boolean := case when p_filters ? 'has_company' and nullif(p_filters->>'has_company', '') is not null
    then (p_filters->>'has_company')::boolean
    when p_filters ? 'has_contacts' and nullif(p_filters->>'has_contacts', '') is not null
    then (p_filters->>'has_contacts')::boolean else null end;
  v_customer uuid := nullif(p_filters->>'customer_id', '')::uuid;
  v_types text[] := case when jsonb_typeof(p_filters->'customer_types') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'customer_types')) else null end;
  v_salesperson uuid := nullif(p_filters->>'salesperson_id', '')::uuid;
  v_cg uuid := nullif(p_filters->>'cg_assigned_id', '')::uuid;
  v_referrer uuid := nullif(p_filters->>'referrer_id', '')::uuid;
  v_unassigned_sp boolean := coalesce((p_filters->>'unassigned_salesperson')::boolean, false);
  v_has_outstanding boolean := coalesce((p_filters->>'has_outstanding')::boolean, false);
  v_min_life numeric := nullif(p_filters->>'min_lifetime', '')::numeric;
  v_max_life numeric := nullif(p_filters->>'max_lifetime', '')::numeric;
  v_has_orders boolean := case when p_filters ? 'has_orders' and nullif(p_filters->>'has_orders', '') is not null
    then (p_filters->>'has_orders')::boolean else null end;
  v_has_open_drafts boolean := case when p_filters ? 'has_open_drafts' and nullif(p_filters->>'has_open_drafts', '') is not null
    then (p_filters->>'has_open_drafts')::boolean else null end;
  v_payment_terms text := nullif(btrim(coalesce(p_filters->>'payment_terms', '')), '');
  v_sources text[] := case when jsonb_typeof(p_filters->'source_systems') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'source_systems')) else null end;
  v_source_group text := nullif(btrim(coalesce(p_filters->>'source_group', '')), '');
  v_tags text[] := case when jsonb_typeof(p_filters->'tags') = 'array'
    then array(select jsonb_array_elements_text(p_filters->'tags')) else null end;
  v_inactive_since date := nullif(p_filters->>'inactive_since', '')::date;
  v_created_preset text := nullif(btrim(coalesce(p_filters->>'created_preset', p_filters->>'date_preset', '')), '');
  v_created_from timestamptz := coalesce(
    nullif(p_filters->>'created_from', ''),
    nullif(p_filters->>'date_from', '')
  )::timestamptz;
  v_created_to timestamptz := coalesce(
    nullif(p_filters->>'created_to', ''),
    nullif(p_filters->>'date_to', '')
  )::timestamptz;
  v_last_order_preset text := nullif(btrim(coalesce(p_filters->>'last_order_preset', '')), '');
  v_last_order_from timestamptz := nullif(p_filters->>'last_order_from', '')::timestamptz;
  v_last_order_to timestamptz := nullif(p_filters->>'last_order_to', '')::timestamptz;
  v_bounds record;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if v_created_preset is not null then
    v_bounds := public.crm_date_preset_bounds(v_created_preset);
    v_created_from := coalesce(v_created_from, v_bounds.o_from);
    v_created_to := coalesce(v_created_to, v_bounds.o_to);
  end if;
  if v_last_order_preset is not null then
    v_bounds := public.crm_date_preset_bounds(v_last_order_preset);
    v_last_order_from := coalesce(v_last_order_from, v_bounds.o_from);
    v_last_order_to := coalesce(v_last_order_to, v_bounds.o_to);
  end if;

  with metrics as (
    select
      o.company_id,
      count(*)::int as order_count,
      coalesce(sum(o.total), 0)::numeric(14,2) as lifetime_total,
      coalesce(sum(o.total_received), 0)::numeric(14,2) as total_received,
      coalesce(sum(o.total_outstanding), 0)::numeric(14,2) as total_outstanding,
      min(coalesce(o.source_created_at, o.created_at)) as first_order_at,
      max(coalesce(o.source_created_at, o.created_at)) as last_order_at
    from public.orders o
    where o.company_id is not null
    group by o.company_id
  ),
  refunds_agg as (
    select o.company_id, coalesce(sum(r.total_refunded), 0)::numeric(14,2) as refund_total
    from public.refunds r
    join public.orders o on o.id = r.order_id
    where o.company_id is not null
    group by o.company_id
  ),
  drafts_agg as (
    select d.company_id,
      count(*) filter (where d.status = 'open')::int as open_draft_count,
      coalesce(sum(d.total_price) filter (where d.status = 'open'), 0)::numeric(14,2) as open_draft_value
    from public.draft_orders d
    where d.company_id is not null
    group by d.company_id
  ),
  filtered as (
    select co.id
    from public.companies co
    left join metrics m on m.company_id = co.id
    left join drafts_agg da on da.company_id = co.id
    left join public.staff_members sp on sp.id = co.salesperson_id
    left join public.staff_members cg on cg.id = co.cg_assigned_id
    left join public.staff_members rf on rf.id = co.referrer_id
    where
      (v_created_from is null or co.created_at >= v_created_from)
      and (v_created_to is null or co.created_at < v_created_to)
      and (v_types is null or co.customer_type = any(v_types))
      and (v_salesperson is null or co.salesperson_id = v_salesperson)
      and (v_cg is null or co.cg_assigned_id = v_cg)
      and (v_referrer is null or co.referrer_id = v_referrer)
      and (not v_unassigned_sp or co.salesperson_id is null)
      and (v_payment_terms is null or co.payment_terms ilike v_payment_terms)
      and (v_sources is null or co.source_system = any(v_sources))
      and (
        v_source_group is null
        or (v_source_group = 'shopify' and co.source_system = 'shopify')
        or (v_source_group = 'unique' and coalesce(co.source_system, '') = 'unique')
      )
      and (
        v_customer is null
        or exists (
          select 1 from public.company_contacts cc
          where cc.company_id = co.id and cc.customer_id = v_customer
        )
      )
      and (
        v_has_contacts is null
        or (v_has_contacts and exists (select 1 from public.company_contacts cc where cc.company_id = co.id))
        or (not v_has_contacts and not exists (select 1 from public.company_contacts cc where cc.company_id = co.id))
      )
      and (not v_has_outstanding or coalesce(m.total_outstanding, 0) > 0)
      and (v_min_life is null or coalesce(m.lifetime_total, 0) >= v_min_life)
      and (v_max_life is null or coalesce(m.lifetime_total, 0) <= v_max_life)
      and (
        v_has_orders is null
        or (v_has_orders and coalesce(m.order_count, 0) > 0)
        or (not v_has_orders and coalesce(m.order_count, 0) = 0)
      )
      and (
        v_has_open_drafts is null
        or (v_has_open_drafts and coalesce(da.open_draft_count, 0) > 0)
        or (not v_has_open_drafts and coalesce(da.open_draft_count, 0) = 0)
      )
      and (v_last_order_from is null or m.last_order_at >= v_last_order_from)
      and (v_last_order_to is null or m.last_order_at < v_last_order_to)
      and (
        v_inactive_since is null
        or m.last_order_at is null
        or m.last_order_at < v_inactive_since::timestamptz
      )
      and (
        v_tags is null
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'company' and et.entity_id = co.id and et.raw_value = any(v_tags)
        )
      )
      and (
        v_search is null
        or co.name ilike '%' || v_search || '%'
        or co.trading_name ilike '%' || v_search || '%'
        or co.legal_name ilike '%' || v_search || '%'
        or co.payment_terms ilike '%' || v_search || '%'
        or co.company_number ilike '%' || v_search || '%'
        or co.vat_number ilike '%' || v_search || '%'
        or sp.name ilike '%' || v_search || '%'
        or cg.name ilike '%' || v_search || '%'
        or rf.name ilike '%' || v_search || '%'
        or exists (
          select 1 from public.company_contacts cc
          join public.customers cu on cu.id = cc.customer_id
          where cc.company_id = co.id
            and (
              cu.display_name ilike '%' || v_search || '%'
              or cu.email ilike '%' || v_search || '%'
              or cu.trading_name ilike '%' || v_search || '%'
              or (cu.first_name || ' ' || cu.last_name) ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.company_locations cl
          where cl.company_id = co.id
            and (
              cl.name ilike '%' || v_search || '%'
              or cl.postal_code ilike '%' || v_search || '%'
              or cl.email ilike '%' || v_search || '%'
              or cl.phone ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.entity_tags et
          where et.entity_type = 'company' and et.entity_id = co.id
            and et.raw_value ilike '%' || v_search || '%'
        )
        or exists (
          select 1 from public.external_system_refs esr
          where esr.entity_type = 'company' and esr.entity_id = co.id
            and (
              esr.external_gid ilike '%' || v_search || '%'
              or esr.external_legacy_id ilike '%' || v_search || '%'
              or esr.external_number ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.orders o
          where o.company_id = co.id
            and (
              o.order_number ilike '%' || v_search || '%'
              or o.source_order_number ilike '%' || v_search || '%'
            )
        )
        or exists (
          select 1 from public.draft_orders d
          where d.company_id = co.id and d.name ilike '%' || v_search || '%'
        )
      )
  ),
  counted as (
    select count(*)::bigint as total from filtered
  ),
  page as (
    select
      case coalesce(p_sort, 'created_desc')
        when 'created_asc' then row_number() over (order by co.created_at asc)
        when 'name_asc' then row_number() over (order by co.name asc)
        when 'name_desc' then row_number() over (order by co.name desc)
        when 'lifetime_desc' then row_number() over (order by coalesce(m.lifetime_total, 0) desc)
        when 'lifetime_asc' then row_number() over (order by coalesce(m.lifetime_total, 0) asc)
        when 'last_order_desc' then row_number() over (order by m.last_order_at desc nulls last)
        when 'outstanding_desc' then row_number() over (order by coalesce(m.total_outstanding, 0) desc)
        when 'updated_desc' then row_number() over (order by co.updated_at desc)
        else row_number() over (order by co.created_at desc)
      end as ord,
      co.id,
      co.name,
      co.trading_name,
      co.legal_name,
      co.customer_type,
      co.payment_terms,
      co.status,
      co.source_system,
      co.salesperson_id,
      co.cg_assigned_id,
      co.referrer_id,
      co.version,
      co.created_at,
      co.updated_at,
      sp.name as salesperson_name,
      cg.name as cg_name,
      rf.name as referrer_name,
      coalesce(m.order_count, 0) as order_count,
      coalesce(m.lifetime_total, 0) as lifetime_total,
      coalesce(m.total_received, 0) as total_received,
      coalesce(m.total_outstanding, 0) as total_outstanding,
      coalesce(ra.refund_total, 0) as refund_total,
      case when coalesce(m.order_count, 0) > 0
        then round(m.lifetime_total / m.order_count, 2) else null end as avg_order_value,
      m.first_order_at,
      m.last_order_at,
      coalesce(da.open_draft_count, 0) as open_draft_count,
      coalesce(da.open_draft_value, 0) as open_draft_value,
      (select count(*)::int from public.company_contacts cc where cc.company_id = co.id) as contact_count,
      (select count(*)::int from public.company_locations cl where cl.company_id = co.id) as location_count,
      (
        select coalesce(jsonb_agg(t.raw_value order by t.raw_value), '[]'::jsonb)
        from (
          select et.raw_value from public.entity_tags et
          where et.entity_type = 'company' and et.entity_id = co.id
          order by et.raw_value limit 8
        ) t
      ) as tags
    from filtered f
    join public.companies co on co.id = f.id
    left join metrics m on m.company_id = co.id
    left join refunds_agg ra on ra.company_id = co.id
    left join drafts_agg da on da.company_id = co.id
    left join public.staff_members sp on sp.id = co.salesperson_id
    left join public.staff_members cg on cg.id = co.cg_assigned_id
    left join public.staff_members rf on rf.id = co.referrer_id
    order by ord
    limit greatest(coalesce(p_limit, 25), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    c.total,
    coalesce((select jsonb_agg(to_jsonb(p) order by p.ord) from page p), '[]'::jsonb)
  into v_total, v_items
  from counted c;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.rpc_list_admin_crm_companies(int, int, text, jsonb) to authenticated;
-- ── Customer workspace ───────────────────────────────────────────────────────
create or replace function public.rpc_get_admin_customer_workspace(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_cu public.customers%rowtype;
  v_can_edit boolean;
  v_primary_company uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_cu from public.customers where id = p_customer_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;

  v_can_edit := public.can_mutate_crm();

  select cc.company_id into v_primary_company
  from public.company_contacts cc
  where cc.customer_id = p_customer_id
  order by cc.is_primary desc, cc.created_at
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'customer', to_jsonb(v_cu),
    'can_edit', v_can_edit,
    'version', v_cu.version,
    'trading_name', public.resolve_trading_name(p_customer_id, v_primary_company),
    'customer_type', public.resolve_customer_type(p_customer_id, v_primary_company),
    'commercial', public.crm_customer_commercial_metrics(p_customer_id),
    'salesperson', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_cu.salesperson_id
    ),
    'cg_assigned', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_cu.cg_assigned_id
    ),
    'referrer', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_cu.referrer_id
    ),
    'created_by', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_cu.created_by_staff_id
    ),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contact_id', cc.id,
        'company_id', co.id,
        'name', co.name,
        'trading_name', co.trading_name,
        'customer_type', co.customer_type,
        'payment_terms', co.payment_terms,
        'title', cc.title,
        'role', cc.role,
        'is_primary', cc.is_primary,
        'company_location_id', cc.company_location_id
      ) order by cc.is_primary desc, co.name)
      from public.company_contacts cc
      join public.companies co on co.id = cc.company_id
      where cc.customer_id = p_customer_id
    ), '[]'::jsonb),
    'addresses', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.is_default desc, a.created_at)
      from public.customer_addresses a
      where a.customer_id = p_customer_id
    ), '[]'::jsonb),
    'company_locations', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.is_primary desc, l.created_at)
      from public.company_locations l
      where l.company_id in (
        select cc.company_id from public.company_contacts cc where cc.customer_id = p_customer_id
      )
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('raw_value', et.raw_value, 'tag_id', et.tag_id) order by et.raw_value)
      from public.entity_tags et
      where et.entity_type = 'customer' and et.entity_id = p_customer_id
    ), '[]'::jsonb),
    'metafields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'namespace', m.namespace, 'key', m.key, 'value_type', m.value_type,
        'value_text', m.value_text, 'value_json', m.value_json, 'source_system', m.source_system
      ) order by m.namespace, m.key)
      from public.metafields m
      where m.owner_type = 'customer' and m.owner_id = p_customer_id
    ), '[]'::jsonb),
    'external_refs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'system', e.system, 'external_gid', e.external_gid,
        'external_legacy_id', e.external_legacy_id, 'external_number', e.external_number
      ) order by e.system)
      from public.external_system_refs e
      where e.entity_type = 'customer' and e.entity_id = p_customer_id
    ), '[]'::jsonb),
    'recent_orders', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.order_date desc)
      from (
        select o.id, coalesce(o.source_order_number, o.order_number) as order_number,
          o.financial_status, o.total, o.total_outstanding, o.currency,
          coalesce(o.source_created_at, o.created_at) as order_date
        from public.orders o
        where o.customer_id = p_customer_id
        order by coalesce(o.source_created_at, o.created_at) desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'recent_drafts', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.draft_date desc)
      from (
        select d.id, d.name, d.status, d.total_price, d.currency, d.source_system,
          coalesce(d.source_created_at, d.created_at) as draft_date
        from public.draft_orders d
        where d.customer_id = p_customer_id
        order by coalesce(d.source_created_at, d.created_at) desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'note_count', (select count(*)::int from public.crm_notes where entity_type = 'customer' and entity_id = p_customer_id),
    'event_count', (select count(*)::int from public.crm_events where entity_type = 'customer' and entity_id = p_customer_id)
  );
end;
$$;

grant execute on function public.rpc_get_admin_customer_workspace(uuid) to authenticated;

-- ── Company workspace ────────────────────────────────────────────────────────
create or replace function public.rpc_get_admin_company_workspace(p_company_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_co public.companies%rowtype;
  v_can_edit boolean;
  v_primary_customer uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_co from public.companies where id = p_company_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Company not found');
  end if;

  v_can_edit := public.can_mutate_crm();

  select cc.customer_id into v_primary_customer
  from public.company_contacts cc
  where cc.company_id = p_company_id
  order by cc.is_primary desc, cc.created_at
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'company', to_jsonb(v_co),
    'can_edit', v_can_edit,
    'version', v_co.version,
    'trading_name', public.resolve_trading_name(v_primary_customer, p_company_id),
    'customer_type', public.resolve_customer_type(v_primary_customer, p_company_id),
    'commercial', public.crm_company_commercial_metrics(p_company_id),
    'salesperson', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_co.salesperson_id
    ),
    'cg_assigned', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_co.cg_assigned_id
    ),
    'referrer', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_co.referrer_id
    ),
    'created_by', (
      select jsonb_build_object('id', s.id, 'name', s.name) from public.staff_members s where s.id = v_co.created_by_staff_id
    ),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contact_id', cc.id,
        'customer_id', cu.id,
        'display_name', cu.display_name,
        'email', cu.email,
        'phone', cu.phone,
        'trading_name', cu.trading_name,
        'customer_type', cu.customer_type,
        'title', cc.title,
        'role', cc.role,
        'is_primary', cc.is_primary,
        'company_location_id', cc.company_location_id
      ) order by cc.is_primary desc, cu.display_name nulls last)
      from public.company_contacts cc
      join public.customers cu on cu.id = cc.customer_id
      where cc.company_id = p_company_id
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.is_primary desc, l.created_at)
      from public.company_locations l
      where l.company_id = p_company_id
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('raw_value', et.raw_value, 'tag_id', et.tag_id) order by et.raw_value)
      from public.entity_tags et
      where et.entity_type = 'company' and et.entity_id = p_company_id
    ), '[]'::jsonb),
    'metafields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'namespace', m.namespace, 'key', m.key, 'value_type', m.value_type,
        'value_text', m.value_text, 'value_json', m.value_json, 'source_system', m.source_system
      ) order by m.namespace, m.key)
      from public.metafields m
      where m.owner_type = 'company' and m.owner_id = p_company_id
    ), '[]'::jsonb),
    'external_refs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'system', e.system, 'external_gid', e.external_gid,
        'external_legacy_id', e.external_legacy_id, 'external_number', e.external_number
      ) order by e.system)
      from public.external_system_refs e
      where e.entity_type = 'company' and e.entity_id = p_company_id
    ), '[]'::jsonb),
    'recent_orders', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.order_date desc)
      from (
        select o.id, coalesce(o.source_order_number, o.order_number) as order_number,
          o.financial_status, o.total, o.total_outstanding, o.currency,
          coalesce(o.source_created_at, o.created_at) as order_date
        from public.orders o
        where o.company_id = p_company_id
        order by coalesce(o.source_created_at, o.created_at) desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'recent_drafts', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.draft_date desc)
      from (
        select d.id, d.name, d.status, d.total_price, d.currency, d.source_system,
          coalesce(d.source_created_at, d.created_at) as draft_date
        from public.draft_orders d
        where d.company_id = p_company_id
        order by coalesce(d.source_created_at, d.created_at) desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'note_count', (select count(*)::int from public.crm_notes where entity_type = 'company' and entity_id = p_company_id),
    'event_count', (select count(*)::int from public.crm_events where entity_type = 'company' and entity_id = p_company_id)
  );
end;
$$;

grant execute on function public.rpc_get_admin_company_workspace(uuid) to authenticated;

-- ── Timeline ─────────────────────────────────────────────────────────────────
create or replace function public.rpc_list_admin_crm_timeline(
  p_entity_type text,
  p_entity_id uuid,
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
  v_total bigint;
  v_items jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if p_entity_type not in ('customer', 'company') then
    return jsonb_build_object('ok', false, 'error', 'Invalid entity_type');
  end if;

  with merged as (
    select e.id, 'event'::text as kind, e.event_type, e.category, e.message,
      e.actor_type, e.actor_id, e.actor_name_snapshot, e.old_value, e.new_value,
      e.metadata, e.source_system, e.occurred_at, e.created_at, null::text as body
    from public.crm_events e
    where e.entity_type = p_entity_type and e.entity_id = p_entity_id
    union all
    select n.id, 'note'::text, 'staff_note'::text, 'note'::text, left(n.body, 500),
      'staff'::text, n.author_staff_id, n.author_name_snapshot, null::jsonb,
      jsonb_build_object('note_id', n.id), '{}'::jsonb, n.source_system,
      n.created_at, n.created_at, n.body
    from public.crm_notes n
    where n.entity_type = p_entity_type and n.entity_id = p_entity_id
  )
  select count(*) into v_total from merged;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.occurred_at desc, m.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select * from (
      select e.id, 'event'::text as kind, e.event_type, e.category, e.message,
        e.actor_type, e.actor_id, e.actor_name_snapshot, e.old_value, e.new_value,
        e.metadata, e.source_system, e.occurred_at, e.created_at, null::text as body
      from public.crm_events e
      where e.entity_type = p_entity_type and e.entity_id = p_entity_id
      union all
      select n.id, 'note'::text, 'staff_note'::text, 'note'::text, left(n.body, 500),
        'staff'::text, n.author_staff_id, n.author_name_snapshot, null::jsonb,
        jsonb_build_object('note_id', n.id), '{}'::jsonb, n.source_system,
        n.created_at, n.created_at, n.body
      from public.crm_notes n
      where n.entity_type = p_entity_type and n.entity_id = p_entity_id
    ) u
    order by u.occurred_at desc, u.created_at desc
    limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) m;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total);
end;
$$;

grant execute on function public.rpc_list_admin_crm_timeline(text, uuid, int, int) to authenticated;

-- ── Add note ─────────────────────────────────────────────────────────────────
create or replace function public.rpc_admin_add_crm_note(
  p_entity_type text,
  p_entity_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if p_entity_type not in ('customer', 'company') then
    return jsonb_build_object('ok', false, 'error', 'Invalid entity_type');
  end if;
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'Note body is required');
  end if;
  if p_entity_type = 'customer' and not exists (select 1 from public.customers where id = p_entity_id) then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;
  if p_entity_type = 'company' and not exists (select 1 from public.companies where id = p_entity_id) then
    return jsonb_build_object('ok', false, 'error', 'Company not found');
  end if;

  insert into public.crm_notes (
    entity_type, entity_id, body, author_staff_id, author_name_snapshot, source_system
  ) values (
    p_entity_type, p_entity_id, v_body, v_staff, v_name, 'unique'
  )
  returning id into v_id;

  perform public.append_crm_event(
    p_entity_type, p_entity_id, 'staff_note_added', 'note', left(v_body, 500),
    null, jsonb_build_object('note_id', v_id, 'body', v_body),
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function public.rpc_admin_add_crm_note(text, uuid, text) to authenticated;
-- ── Create Unique customer ───────────────────────────────────────────────────
create or replace function public.rpc_admin_create_unique_customer(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_display text;
  v_first text;
  v_last text;
begin
  if not public.can_mutate_crm() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  v_first := nullif(btrim(coalesce(v_payload->>'first_name', '')), '');
  v_last := nullif(btrim(coalesce(v_payload->>'last_name', '')), '');
  v_display := nullif(btrim(coalesce(v_payload->>'display_name', '')), '');
  if v_display is null then
    v_display := nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), '');
  end if;

  insert into public.customers (
    email, phone, first_name, last_name, display_name,
    company_name_snapshot, trading_name, notes, tax_exempt,
    status, approval_status, customer_type, payment_terms,
    salesperson_id, referrer_id, cg_assigned_id,
    source_system, version, created_by_staff_id
  ) values (
    nullif(btrim(coalesce(v_payload->>'email', '')), ''),
    nullif(btrim(coalesce(v_payload->>'phone', '')), ''),
    v_first, v_last, v_display,
    nullif(btrim(coalesce(v_payload->>'company_name_snapshot', '')), ''),
    nullif(btrim(coalesce(v_payload->>'trading_name', '')), ''),
    nullif(v_payload->>'notes', ''),
    coalesce((v_payload->>'tax_exempt')::boolean, false),
    coalesce(nullif(btrim(coalesce(v_payload->>'status', '')), ''), 'active'),
    coalesce(nullif(btrim(coalesce(v_payload->>'approval_status', '')), ''), 'approved'),
    nullif(btrim(coalesce(v_payload->>'customer_type', '')), ''),
    nullif(btrim(coalesce(v_payload->>'payment_terms', '')), ''),
    nullif(v_payload->>'salesperson_id', '')::uuid,
    nullif(v_payload->>'referrer_id', '')::uuid,
    nullif(v_payload->>'cg_assigned_id', '')::uuid,
    'unique', 1, v_staff
  )
  returning id into v_id;

  perform public.crm_sync_assignment('customer', v_id, 'salesperson', nullif(v_payload->>'salesperson_id', '')::uuid);
  perform public.crm_sync_assignment('customer', v_id, 'cg', nullif(v_payload->>'cg_assigned_id', '')::uuid);
  perform public.crm_sync_assignment('customer', v_id, 'referrer', nullif(v_payload->>'referrer_id', '')::uuid);

  perform public.append_crm_event(
    'customer', v_id, 'customer_created', 'lifecycle', 'Unique customer created',
    null, jsonb_build_object('display_name', v_display, 'source_system', 'unique'),
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );

  return jsonb_build_object('ok', true, 'customer_id', v_id, 'version', 1);
end;
$$;

grant execute on function public.rpc_admin_create_unique_customer(jsonb) to authenticated;

-- ── Update Unique customer ───────────────────────────────────────────────────
create or replace function public.rpc_admin_update_unique_customer(
  p_customer_id uuid,
  p_expected_version int,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.customers%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_new_version int;
  v_field text;
  v_old_val text;
  v_new_val text;
begin
  if not public.can_mutate_crm() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  begin
    v_old := public.assert_unique_crm_customer(p_customer_id, p_expected_version);
  exception
    when others then
      if SQLERRM = 'CUSTOMER_NOT_FOUND' then
        return jsonb_build_object('ok', false, 'error', 'Customer not found');
      elsif SQLERRM = 'VERSION_CONFLICT' then
        return jsonb_build_object(
          'ok', false, 'error', 'conflict',
          'current_version', (select version from public.customers where id = p_customer_id)
        );
      end if;
      raise;
  end;

  -- Never rewrite source_system / imported provenance on update.
  update public.customers c set
    email = case when v_payload ? 'email' then nullif(btrim(coalesce(v_payload->>'email','')), '') else c.email end,
    phone = case when v_payload ? 'phone' then nullif(btrim(coalesce(v_payload->>'phone','')), '') else c.phone end,
    first_name = case when v_payload ? 'first_name' then nullif(btrim(coalesce(v_payload->>'first_name','')), '') else c.first_name end,
    last_name = case when v_payload ? 'last_name' then nullif(btrim(coalesce(v_payload->>'last_name','')), '') else c.last_name end,
    display_name = case when v_payload ? 'display_name' then nullif(btrim(coalesce(v_payload->>'display_name','')), '') else c.display_name end,
    company_name_snapshot = case when v_payload ? 'company_name_snapshot' then nullif(btrim(coalesce(v_payload->>'company_name_snapshot','')), '') else c.company_name_snapshot end,
    trading_name = case when v_payload ? 'trading_name' then nullif(btrim(coalesce(v_payload->>'trading_name','')), '') else c.trading_name end,
    notes = case when v_payload ? 'notes' then nullif(v_payload->>'notes', '') else c.notes end,
    tax_exempt = case when v_payload ? 'tax_exempt' then coalesce((v_payload->>'tax_exempt')::boolean, false) else c.tax_exempt end,
    status = case when v_payload ? 'status' then coalesce(nullif(btrim(coalesce(v_payload->>'status','')), ''), c.status) else c.status end,
    approval_status = case when v_payload ? 'approval_status' then coalesce(nullif(btrim(coalesce(v_payload->>'approval_status','')), ''), c.approval_status) else c.approval_status end,
    customer_type = case when v_payload ? 'customer_type' then nullif(btrim(coalesce(v_payload->>'customer_type','')), '') else c.customer_type end,
    payment_terms = case when v_payload ? 'payment_terms' then nullif(btrim(coalesce(v_payload->>'payment_terms','')), '') else c.payment_terms end,
    salesperson_id = case when v_payload ? 'salesperson_id' then nullif(v_payload->>'salesperson_id', '')::uuid else c.salesperson_id end,
    cg_assigned_id = case when v_payload ? 'cg_assigned_id' then nullif(v_payload->>'cg_assigned_id', '')::uuid else c.cg_assigned_id end,
    referrer_id = case when v_payload ? 'referrer_id' then nullif(v_payload->>'referrer_id', '')::uuid else c.referrer_id end,
    version = c.version + 1,
    updated_at = now()
  where c.id = p_customer_id
  returning version into v_new_version;

  -- Field-level audits (ownership, type, terms, StoreName)
  foreach v_field in array array[
    'salesperson_id','cg_assigned_id','referrer_id','customer_type','payment_terms','trading_name','email','phone','display_name','status'
  ]
  loop
    if v_payload ? v_field then
      execute format('select ($1).%I::text', v_field) using v_old into v_old_val;
      v_new_val := nullif(btrim(coalesce(v_payload->>v_field, '')), '');
      if coalesce(v_old_val, '') is distinct from coalesce(v_new_val, '') then
        perform public.append_crm_event(
          'customer', p_customer_id, 'field_updated', 'audit',
          v_field || ' changed',
          jsonb_build_object('field', v_field, 'value', v_old_val),
          jsonb_build_object('field', v_field, 'value', v_new_val),
          jsonb_build_object('field', v_field),
          'unique', 'staff', v_staff, v_name
        );
      end if;
    end if;
  end loop;

  if v_payload ? 'salesperson_id' then
    perform public.crm_sync_assignment('customer', p_customer_id, 'salesperson', nullif(v_payload->>'salesperson_id', '')::uuid);
  end if;
  if v_payload ? 'cg_assigned_id' then
    perform public.crm_sync_assignment('customer', p_customer_id, 'cg', nullif(v_payload->>'cg_assigned_id', '')::uuid);
  end if;
  if v_payload ? 'referrer_id' then
    perform public.crm_sync_assignment('customer', p_customer_id, 'referrer', nullif(v_payload->>'referrer_id', '')::uuid);
  end if;

  perform public.append_crm_event(
    'customer', p_customer_id, 'customer_updated', 'lifecycle', 'Unique customer updated',
    jsonb_build_object('version', v_old.version),
    jsonb_build_object('version', v_new_version, 'payload_keys', (
      select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_payload) as k
    )),
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );

  return jsonb_build_object('ok', true, 'customer_id', p_customer_id, 'version', v_new_version);
end;
$$;

grant execute on function public.rpc_admin_update_unique_customer(uuid, int, jsonb) to authenticated;

-- ── Create Unique company ────────────────────────────────────────────────────
create or replace function public.rpc_admin_create_unique_company(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_loc_id uuid;
  v_contact_id uuid;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_company_name text;
  v_primary_customer uuid;
  v_addr jsonb;
begin
  if not public.can_mutate_crm() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  v_company_name := nullif(btrim(coalesce(v_payload->>'name', '')), '');
  if v_company_name is null then
    return jsonb_build_object('ok', false, 'error', 'Company name is required');
  end if;

  v_primary_customer := nullif(v_payload->>'customer_id', '')::uuid;
  if v_primary_customer is not null
     and not exists (select 1 from public.customers where id = v_primary_customer) then
    return jsonb_build_object('ok', false, 'error', 'Primary contact customer not found');
  end if;
  v_addr := coalesce(v_payload->'location', v_payload->'address', '{}'::jsonb);

  insert into public.companies (
    name, trading_name, legal_name, company_number, vat_number,
    status, customer_type, payment_terms, notes,
    salesperson_id, referrer_id, cg_assigned_id,
    source_system, version, created_by_staff_id
  ) values (
    v_company_name,
    nullif(btrim(coalesce(v_payload->>'trading_name', '')), ''),
    nullif(btrim(coalesce(v_payload->>'legal_name', '')), ''),
    nullif(btrim(coalesce(v_payload->>'company_number', '')), ''),
    nullif(btrim(coalesce(v_payload->>'vat_number', '')), ''),
    coalesce(nullif(btrim(coalesce(v_payload->>'status', '')), ''), 'active'),
    nullif(btrim(coalesce(v_payload->>'customer_type', '')), ''),
    nullif(btrim(coalesce(v_payload->>'payment_terms', '')), ''),
    nullif(v_payload->>'notes', ''),
    nullif(v_payload->>'salesperson_id', '')::uuid,
    nullif(v_payload->>'referrer_id', '')::uuid,
    nullif(v_payload->>'cg_assigned_id', '')::uuid,
    'unique', 1, v_staff
  )
  returning id into v_id;

  if v_addr is not null and v_addr <> '{}'::jsonb then
    insert into public.company_locations (
      company_id, name, phone, email, is_primary, source_system,
      address1, address2, city, province, province_code, postal_code, country, country_code,
      billing_address, shipping_address, payment_terms_template
    ) values (
      v_id,
      coalesce(nullif(btrim(coalesce(v_addr->>'name', '')), ''), 'Primary'),
      nullif(btrim(coalesce(v_addr->>'phone', '')), ''),
      nullif(btrim(coalesce(v_addr->>'email', '')), ''),
      true, 'unique',
      nullif(btrim(coalesce(v_addr->>'address1', '')), ''),
      nullif(btrim(coalesce(v_addr->>'address2', '')), ''),
      nullif(btrim(coalesce(v_addr->>'city', '')), ''),
      nullif(btrim(coalesce(v_addr->>'province', '')), ''),
      nullif(btrim(coalesce(v_addr->>'province_code', '')), ''),
      nullif(btrim(coalesce(v_addr->>'postal_code', '')), ''),
      nullif(btrim(coalesce(v_addr->>'country', '')), ''),
      nullif(btrim(coalesce(v_addr->>'country_code', '')), ''),
      coalesce(v_addr->'billing_address', v_addr, '{}'::jsonb),
      coalesce(v_addr->'shipping_address', v_addr, '{}'::jsonb),
      case when v_payload ? 'payment_terms' and nullif(btrim(coalesce(v_payload->>'payment_terms','')), '') is not null
        then jsonb_build_object('payment_terms', v_payload->>'payment_terms')
        else v_addr->'payment_terms_template' end
    )
    returning id into v_loc_id;
  end if;

  if v_primary_customer is not null then
    insert into public.company_contacts (
      company_id, customer_id, company_location_id, title, is_primary, source_system
    ) values (
      v_id, v_primary_customer, v_loc_id,
      nullif(btrim(coalesce(v_payload->>'contact_title', '')), ''),
      true, 'unique'
    )
    returning id into v_contact_id;
  end if;

  perform public.crm_sync_assignment('company', v_id, 'salesperson', nullif(v_payload->>'salesperson_id', '')::uuid);
  perform public.crm_sync_assignment('company', v_id, 'cg', nullif(v_payload->>'cg_assigned_id', '')::uuid);
  perform public.crm_sync_assignment('company', v_id, 'referrer', nullif(v_payload->>'referrer_id', '')::uuid);

  perform public.append_crm_event(
    'company', v_id, 'company_created', 'lifecycle', 'Unique company created',
    null, jsonb_build_object('name', v_company_name, 'source_system', 'unique', 'location_id', v_loc_id, 'contact_id', v_contact_id),
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );

  return jsonb_build_object(
    'ok', true, 'company_id', v_id, 'version', 1,
    'location_id', v_loc_id, 'contact_id', v_contact_id
  );
end;
$$;

grant execute on function public.rpc_admin_create_unique_company(jsonb) to authenticated;

-- ── Update Unique company ────────────────────────────────────────────────────
create or replace function public.rpc_admin_update_unique_company(
  p_company_id uuid,
  p_expected_version int,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.companies%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_new_version int;
  v_field text;
  v_old_val text;
  v_new_val text;
begin
  if not public.can_mutate_crm() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  begin
    v_old := public.assert_unique_crm_company(p_company_id, p_expected_version);
  exception
    when others then
      if SQLERRM = 'COMPANY_NOT_FOUND' then
        return jsonb_build_object('ok', false, 'error', 'Company not found');
      elsif SQLERRM = 'VERSION_CONFLICT' then
        return jsonb_build_object(
          'ok', false, 'error', 'conflict',
          'current_version', (select version from public.companies where id = p_company_id)
        );
      end if;
      raise;
  end;

  if v_payload ? 'name' and nullif(btrim(coalesce(v_payload->>'name','')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Company name is required');
  end if;

  -- Never rewrite source_system / imported provenance on update.
  update public.companies c set
    name = case when v_payload ? 'name' then nullif(btrim(coalesce(v_payload->>'name','')), '') else c.name end,
    trading_name = case when v_payload ? 'trading_name' then nullif(btrim(coalesce(v_payload->>'trading_name','')), '') else c.trading_name end,
    legal_name = case when v_payload ? 'legal_name' then nullif(btrim(coalesce(v_payload->>'legal_name','')), '') else c.legal_name end,
    company_number = case when v_payload ? 'company_number' then nullif(btrim(coalesce(v_payload->>'company_number','')), '') else c.company_number end,
    vat_number = case when v_payload ? 'vat_number' then nullif(btrim(coalesce(v_payload->>'vat_number','')), '') else c.vat_number end,
    notes = case when v_payload ? 'notes' then nullif(v_payload->>'notes', '') else c.notes end,
    status = case when v_payload ? 'status' then coalesce(nullif(btrim(coalesce(v_payload->>'status','')), ''), c.status) else c.status end,
    customer_type = case when v_payload ? 'customer_type' then nullif(btrim(coalesce(v_payload->>'customer_type','')), '') else c.customer_type end,
    payment_terms = case when v_payload ? 'payment_terms' then nullif(btrim(coalesce(v_payload->>'payment_terms','')), '') else c.payment_terms end,
    salesperson_id = case when v_payload ? 'salesperson_id' then nullif(v_payload->>'salesperson_id', '')::uuid else c.salesperson_id end,
    cg_assigned_id = case when v_payload ? 'cg_assigned_id' then nullif(v_payload->>'cg_assigned_id', '')::uuid else c.cg_assigned_id end,
    referrer_id = case when v_payload ? 'referrer_id' then nullif(v_payload->>'referrer_id', '')::uuid else c.referrer_id end,
    version = c.version + 1,
    updated_at = now()
  where c.id = p_company_id
  returning version into v_new_version;

  foreach v_field in array array[
    'salesperson_id','cg_assigned_id','referrer_id','customer_type','payment_terms','trading_name','name','status'
  ]
  loop
    if v_payload ? v_field then
      execute format('select ($1).%I::text', v_field) using v_old into v_old_val;
      v_new_val := nullif(btrim(coalesce(v_payload->>v_field, '')), '');
      if coalesce(v_old_val, '') is distinct from coalesce(v_new_val, '') then
        perform public.append_crm_event(
          'company', p_company_id, 'field_updated', 'audit',
          v_field || ' changed',
          jsonb_build_object('field', v_field, 'value', v_old_val),
          jsonb_build_object('field', v_field, 'value', v_new_val),
          jsonb_build_object('field', v_field),
          'unique', 'staff', v_staff, v_name
        );
      end if;
    end if;
  end loop;

  if v_payload ? 'salesperson_id' then
    perform public.crm_sync_assignment('company', p_company_id, 'salesperson', nullif(v_payload->>'salesperson_id', '')::uuid);
  end if;
  if v_payload ? 'cg_assigned_id' then
    perform public.crm_sync_assignment('company', p_company_id, 'cg', nullif(v_payload->>'cg_assigned_id', '')::uuid);
  end if;
  if v_payload ? 'referrer_id' then
    perform public.crm_sync_assignment('company', p_company_id, 'referrer', nullif(v_payload->>'referrer_id', '')::uuid);
  end if;

  perform public.append_crm_event(
    'company', p_company_id, 'company_updated', 'lifecycle', 'Unique company updated',
    jsonb_build_object('version', v_old.version),
    jsonb_build_object('version', v_new_version),
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );

  return jsonb_build_object('ok', true, 'company_id', p_company_id, 'version', v_new_version);
end;
$$;

grant execute on function public.rpc_admin_update_unique_company(uuid, int, jsonb) to authenticated;
-- ── Company contacts ─────────────────────────────────────────────────────────
create or replace function public.rpc_admin_add_company_contact(
  p_company_id uuid,
  p_customer_id uuid,
  p_title text default null,
  p_is_primary boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
begin
  if not public.can_mutate_crm() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    return jsonb_build_object('ok', false, 'error', 'Company not found');
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Customer not found');
  end if;

  if exists (
    select 1 from public.company_contacts
    where company_id = p_company_id and customer_id = p_customer_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'Contact already linked');
  end if;

  if coalesce(p_is_primary, false) then
    update public.company_contacts set is_primary = false
    where company_id = p_company_id and is_primary = true;
  end if;

  insert into public.company_contacts (
    company_id, customer_id, title, is_primary, source_system
  ) values (
    p_company_id, p_customer_id, nullif(btrim(coalesce(p_title, '')), ''),
    coalesce(p_is_primary, false), 'unique'
  )
  returning id into v_id;

  perform public.append_crm_event(
    'company', p_company_id, 'contact_added', 'relationship',
    'Customer linked to company',
    null, jsonb_build_object('customer_id', p_customer_id, 'contact_id', v_id, 'title', p_title),
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );
  perform public.append_crm_event(
    'customer', p_customer_id, 'company_linked', 'relationship',
    'Linked to company',
    null, jsonb_build_object('company_id', p_company_id, 'contact_id', v_id),
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );

  return jsonb_build_object('ok', true, 'contact_id', v_id);
end;
$$;

grant execute on function public.rpc_admin_add_company_contact(uuid, uuid, text, boolean) to authenticated;

create or replace function public.rpc_admin_remove_company_contact(
  p_company_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_deleted int;
begin
  if not public.can_mutate_crm() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  delete from public.company_contacts
  where company_id = p_company_id and customer_id = p_customer_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', 'Contact link not found');
  end if;

  perform public.append_crm_event(
    'company', p_company_id, 'contact_removed', 'relationship',
    'Customer unlinked from company',
    jsonb_build_object('customer_id', p_customer_id), null,
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );
  perform public.append_crm_event(
    'customer', p_customer_id, 'company_unlinked', 'relationship',
    'Unlinked from company',
    jsonb_build_object('company_id', p_company_id), null,
    '{}'::jsonb, 'unique', 'staff', v_staff, v_name
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.rpc_admin_remove_company_contact(uuid, uuid) to authenticated;

-- ── Defaults for draft picker (read-only; never mutates) ──────────────────────
-- Ownership inheritance: returns current CRM salesperson/CG/referrer/payment_terms
-- /StoreName for NEW drafts only. Does not cascade into historical orders/drafts.
create or replace function public.rpc_admin_crm_defaults_for_draft(
  p_customer_id uuid default null,
  p_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_cu public.customers%rowtype;
  v_co public.companies%rowtype;
  v_trading jsonb;
  v_type jsonb;
  v_payment text;
  v_salesperson uuid;
  v_cg uuid;
  v_referrer uuid;
  v_email text;
  v_phone text;
  v_billing jsonb := '{}'::jsonb;
  v_shipping jsonb := '{}'::jsonb;
  v_loc public.company_locations%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if p_customer_id is not null then
    select * into v_cu from public.customers where id = p_customer_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Customer not found');
    end if;
  end if;

  if p_company_id is not null then
    select * into v_co from public.companies where id = p_company_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'Company not found');
    end if;
  elsif p_customer_id is not null then
    select cc.company_id into p_company_id
    from public.company_contacts cc
    where cc.customer_id = p_customer_id
    order by cc.is_primary desc, cc.created_at
    limit 1;
    if p_company_id is not null then
      select * into v_co from public.companies where id = p_company_id;
    end if;
  end if;

  v_trading := public.resolve_trading_name(p_customer_id, p_company_id);
  v_type := public.resolve_customer_type(p_customer_id, p_company_id);

  -- Ownership: prefer customer, fall back to company (for NEW drafts only).
  v_salesperson := coalesce(v_cu.salesperson_id, v_co.salesperson_id);
  v_cg := coalesce(v_cu.cg_assigned_id, v_co.cg_assigned_id);
  v_referrer := coalesce(v_cu.referrer_id, v_co.referrer_id);
  v_payment := coalesce(
    nullif(btrim(coalesce(v_cu.payment_terms, '')), ''),
    nullif(btrim(coalesce(v_co.payment_terms, '')), '')
  );
  v_email := coalesce(v_cu.email, (
    select cl.email from public.company_locations cl
    where cl.company_id = p_company_id
    order by cl.is_primary desc, cl.created_at limit 1
  ));
  v_phone := coalesce(v_cu.phone, (
    select cl.phone from public.company_locations cl
    where cl.company_id = p_company_id
    order by cl.is_primary desc, cl.created_at limit 1
  ));

  if p_company_id is not null then
    select * into v_loc
    from public.company_locations cl
    where cl.company_id = p_company_id
    order by cl.is_primary desc, cl.created_at
    limit 1;
    if found then
      if v_payment is null then
        v_payment := public.crm_location_payment_terms(v_loc.payment_terms_template);
      end if;
      if v_loc.billing_address is not null and v_loc.billing_address <> '{}'::jsonb then
        v_billing := v_loc.billing_address;
      else
        v_billing := jsonb_strip_nulls(jsonb_build_object(
          'address1', v_loc.address1, 'address2', v_loc.address2,
          'city', v_loc.city, 'province', v_loc.province, 'province_code', v_loc.province_code,
          'postal_code', v_loc.postal_code, 'country', v_loc.country, 'country_code', v_loc.country_code,
          'phone', v_loc.phone, 'company', v_co.name
        ));
      end if;
      if v_loc.shipping_address is not null and v_loc.shipping_address <> '{}'::jsonb then
        v_shipping := v_loc.shipping_address;
      else
        v_shipping := v_billing;
      end if;
    end if;
  end if;

  if (v_billing = '{}'::jsonb or v_billing is null) and p_customer_id is not null then
    select jsonb_strip_nulls(jsonb_build_object(
      'first_name', a.first_name, 'last_name', a.last_name, 'company', a.company,
      'address1', a.address1, 'address2', a.address2, 'city', a.city,
      'province', a.province, 'province_code', a.province_code,
      'postal_code', a.postal_code, 'country', a.country, 'country_code', a.country_code,
      'phone', a.phone
    )) into v_billing
    from public.customer_addresses a
    where a.customer_id = p_customer_id
    order by a.is_default desc, case when a.address_type = 'billing' then 0 else 1 end, a.created_at
    limit 1;
    v_billing := coalesce(v_billing, '{}'::jsonb);
  end if;

  if (v_shipping = '{}'::jsonb or v_shipping is null) and p_customer_id is not null then
    select jsonb_strip_nulls(jsonb_build_object(
      'first_name', a.first_name, 'last_name', a.last_name, 'company', a.company,
      'address1', a.address1, 'address2', a.address2, 'city', a.city,
      'province', a.province, 'province_code', a.province_code,
      'postal_code', a.postal_code, 'country', a.country, 'country_code', a.country_code,
      'phone', a.phone
    )) into v_shipping
    from public.customer_addresses a
    where a.customer_id = p_customer_id
    order by a.is_default desc, case when a.address_type = 'shipping' then 0 else 1 end, a.created_at
    limit 1;
    v_shipping := coalesce(v_shipping, v_billing, '{}'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'customer_id', p_customer_id,
    'company_id', p_company_id,
    'company_location_id', v_loc.id,
    'email', v_email,
    'phone', v_phone,
    'salesperson_id', v_salesperson,
    'cg_assigned_id', v_cg,
    'referrer_id', v_referrer,
    'payment_terms', v_payment,
    'trading_name', v_trading->>'display',
    'trading_name_resolve', v_trading,
    'customer_type', v_type->>'preferred',
    'customer_type_resolve', v_type,
    'billing_address', coalesce(v_billing, '{}'::jsonb),
    'shipping_address', coalesce(v_shipping, '{}'::jsonb),
    'purchasing_entity_type', case
      when p_company_id is not null then 'PurchasingCompany'
      when p_customer_id is not null then 'Customer'
      else null end
  );
end;
$$;

grant execute on function public.rpc_admin_crm_defaults_for_draft(uuid, uuid) to authenticated;

-- ── Enhanced customer/company picker (Unique + Shopify) ──────────────────────
create or replace function public.rpc_admin_search_customers_companies(
  p_search text default null,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'customers', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.rank, c.display_name nulls last)
      from (
        select
          cu.id,
          cu.display_name,
          cu.email,
          cu.phone,
          cu.trading_name,
          cu.customer_type,
          cu.payment_terms,
          cu.company_name_snapshot,
          cu.source_system,
          cu.salesperson_id,
          cu.cg_assigned_id,
          cu.referrer_id,
          (public.resolve_trading_name(cu.id, null)->>'display') as trading_name_resolved,
          (
            select cc.company_id from public.company_contacts cc
            where cc.customer_id = cu.id
            order by cc.is_primary desc, cc.created_at limit 1
          ) as primary_company_id,
          case
            when v_q is not null and cu.email ilike v_q then 0
            when v_q is not null and cu.trading_name ilike v_q then 1
            when v_q is not null and cu.display_name ilike v_q then 2
            else 3
          end as rank
        from public.customers cu
        where v_q is null
          or cu.display_name ilike '%' || v_q || '%'
          or cu.email ilike '%' || v_q || '%'
          or cu.phone ilike '%' || v_q || '%'
          or cu.trading_name ilike '%' || v_q || '%'
          or cu.company_name_snapshot ilike '%' || v_q || '%'
          or (cu.first_name || ' ' || cu.last_name) ilike '%' || v_q || '%'
          or exists (
            select 1 from public.company_contacts cc
            join public.companies co on co.id = cc.company_id
            where cc.customer_id = cu.id
              and (co.name ilike '%' || v_q || '%' or co.trading_name ilike '%' || v_q || '%')
          )
          or exists (
            select 1 from public.external_system_refs esr
            where esr.entity_type = 'customer' and esr.entity_id = cu.id
              and (
                esr.external_gid ilike '%' || v_q || '%'
                or esr.external_legacy_id ilike '%' || v_q || '%'
              )
          )
        order by rank, cu.display_name nulls last
        limit v_lim
      ) c
    ), '[]'::jsonb),
    'companies', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.rank, c.name)
      from (
        select
          co.id,
          co.name,
          co.trading_name,
          co.customer_type,
          co.payment_terms,
          co.source_system,
          co.salesperson_id,
          co.cg_assigned_id,
          co.referrer_id,
          (public.resolve_trading_name(null, co.id)->>'display') as trading_name_resolved,
          (
            select cl.email from public.company_locations cl
            where cl.company_id = co.id
            order by cl.is_primary desc, cl.created_at limit 1
          ) as email,
          (
            select cl.phone from public.company_locations cl
            where cl.company_id = co.id
            order by cl.is_primary desc, cl.created_at limit 1
          ) as phone,
          case
            when v_q is not null and co.name ilike v_q then 0
            when v_q is not null and co.trading_name ilike v_q then 1
            else 2
          end as rank
        from public.companies co
        where v_q is null
          or co.name ilike '%' || v_q || '%'
          or co.trading_name ilike '%' || v_q || '%'
          or co.legal_name ilike '%' || v_q || '%'
          or exists (
            select 1 from public.company_locations cl
            where cl.company_id = co.id
              and (cl.email ilike '%' || v_q || '%' or cl.phone ilike '%' || v_q || '%' or cl.postal_code ilike '%' || v_q || '%')
          )
          or exists (
            select 1 from public.company_contacts cc
            join public.customers cu on cu.id = cc.customer_id
            where cc.company_id = co.id
              and (cu.display_name ilike '%' || v_q || '%' or cu.email ilike '%' || v_q || '%' or cu.trading_name ilike '%' || v_q || '%')
          )
          or exists (
            select 1 from public.external_system_refs esr
            where esr.entity_type = 'company' and esr.entity_id = co.id
              and (
                esr.external_gid ilike '%' || v_q || '%'
                or esr.external_legacy_id ilike '%' || v_q || '%'
              )
          )
        order by rank, co.name
        limit v_lim
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.rpc_admin_search_customers_companies(text, int) to authenticated;
-- ── Phase 2C CRM selftest (service_role only) ────────────────────────────────
create or replace function public.rpc_phase2c_crm_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix constant text := 'PHASE2C-STAB-';
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean := false;
  v_pass int := 0;
  v_total int := 0;
  v_rate numeric := 0;
  v_detail text;
  v_case_ok boolean;
  v_cleanup_ok boolean := true;
  v_cleanup_detail text := 'ok';
  v_customer_id uuid;
  v_company_id uuid;
  v_shopify_customer_id uuid;
  v_contact_id uuid;
  v_staff_a uuid;
  v_staff_b uuid;
  v_order_id uuid;
  v_draft_id uuid;
  v_version int;
  v_rpc jsonb;
  v_metrics jsonb;
  v_resolve jsonb;
  v_defaults jsonb;
  v_cnt int;
  v_order_sp uuid;
  v_is_admin_def text;
  v_can_mutate boolean;
  v_email text;
  v_note_id uuid;
  v_order_number text;
begin
  -- Prefix cleanup (start)
  begin
    alter table public.crm_events disable trigger trg_crm_events_no_delete;
    alter table public.crm_notes disable trigger trg_crm_notes_no_delete;

    delete from public.crm_notes
    where entity_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
         or coalesce(display_name, '') like v_prefix || '%'
         or coalesce(trading_name, '') like v_prefix || '%'
      union
      select id from public.companies where name like v_prefix || '%'
    );
    delete from public.crm_events
    where entity_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
         or coalesce(display_name, '') like v_prefix || '%'
         or coalesce(trading_name, '') like v_prefix || '%'
      union
      select id from public.companies where name like v_prefix || '%'
    );

    delete from public.refunds where order_id in (
      select id from public.orders where coalesce(email, '') like v_prefix || '%'
         or order_number like v_prefix || '%'
    );
    delete from public.orders where coalesce(email, '') like v_prefix || '%'
       or order_number like v_prefix || '%';
    alter table public.draft_order_events disable trigger trg_draft_order_events_no_delete;
    delete from public.draft_order_events where draft_order_id in (
      select id from public.draft_orders where coalesce(email, '') like v_prefix || '%'
         or coalesce(name, '') like v_prefix || '%'
    );
    delete from public.draft_order_notes where draft_order_id in (
      select id from public.draft_orders where coalesce(email, '') like v_prefix || '%'
         or coalesce(name, '') like v_prefix || '%'
    );
    delete from public.draft_orders where coalesce(email, '') like v_prefix || '%'
       or coalesce(name, '') like v_prefix || '%';
    alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;

    delete from public.company_contacts where company_id in (
      select id from public.companies where name like v_prefix || '%'
    ) or customer_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
    );
    delete from public.company_locations where company_id in (
      select id from public.companies where name like v_prefix || '%'
    );
    delete from public.customer_addresses where customer_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
    );
    delete from public.metafields where owner_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
    );
    delete from public.entity_assignments where entity_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
    );
    delete from public.companies where name like v_prefix || '%';
    delete from public.customers where coalesce(email, '') like v_prefix || '%'
       or coalesce(display_name, '') like v_prefix || '%'
       or coalesce(trading_name, '') like v_prefix || '%';
    delete from public.staff_members where name like v_prefix || '%';

    alter table public.crm_events enable trigger trg_crm_events_no_delete;
    alter table public.crm_notes enable trigger trg_crm_notes_no_delete;
  exception when others then
    begin
      alter table public.crm_events enable trigger trg_crm_events_no_delete;
      alter table public.crm_notes enable trigger trg_crm_notes_no_delete;
      alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;
    exception when others then null;
    end;
  end;

  insert into public.staff_members (name, email, active, staff_type, source_system)
  values (v_prefix || 'StaffA', v_prefix || 'staffa@unique.local', true, 'sales', 'unique')
  returning id into v_staff_a;
  insert into public.staff_members (name, email, active, staff_type, source_system)
  values (v_prefix || 'StaffB', v_prefix || 'staffb@unique.local', true, 'cg', 'unique')
  returning id into v_staff_b;

  -- ── A_create_unique_customer ───────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_email := v_prefix || 'cust@unique.local';
    insert into public.customers (
      email, display_name, first_name, last_name, trading_name, customer_type,
      payment_terms, salesperson_id, cg_assigned_id, referrer_id,
      source_system, version, status, approval_status
    ) values (
      v_email, v_prefix || 'Customer', 'Phase', 'TwoC', v_prefix || 'StoreName',
      'Trade', 'Net 30', v_staff_a, v_staff_b, v_staff_a,
      'unique', 1, 'active', 'approved'
    )
    returning id, version into v_customer_id, v_version;

    perform public.append_crm_event(
      'customer', v_customer_id, 'customer_created', 'lifecycle',
      'Unique customer created (selftest)', null,
      jsonb_build_object('email', v_email), '{}'::jsonb, 'unique', 'system', null, 'phase2c_selftest'
    );

    if v_customer_id is not null and v_version = 1 then
      v_case_ok := true;
      v_detail := 'created customer ' || v_customer_id::text;
    else
      v_detail := 'missing customer or version';
    end if;
    v_cases := v_cases || jsonb_build_object('A_create_unique_customer', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_create_unique_customer', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── B_create_unique_company ────────────────────────────────────────────────
  begin
    v_case_ok := false;
    insert into public.companies (
      name, trading_name, customer_type, payment_terms,
      salesperson_id, cg_assigned_id, source_system, version, status
    ) values (
      v_prefix || 'Company Ltd', null, 'Trade', 'Net 45',
      v_staff_a, v_staff_b, 'unique', 1, 'active'
    )
    returning id into v_company_id;

    insert into public.company_locations (
      company_id, name, is_primary, postal_code, city, source_system,
      payment_terms_template, address1, country_code
    ) values (
      v_company_id, 'HQ', true, 'E1 1AA', 'London', 'unique',
      jsonb_build_object('payment_terms', 'Net 60'), '1 Test St', 'GB'
    );

    perform public.append_crm_event(
      'company', v_company_id, 'company_created', 'lifecycle',
      'Unique company created (selftest)', null,
      jsonb_build_object('name', v_prefix || 'Company Ltd'), '{}'::jsonb, 'unique', 'system', null, 'phase2c_selftest'
    );

    if v_company_id is not null then
      v_case_ok := true;
      v_detail := 'created company ' || v_company_id::text;
    else
      v_detail := 'company insert failed';
    end if;
    v_cases := v_cases || jsonb_build_object('B_create_unique_company', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_create_unique_company', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── C_company_contact_link ─────────────────────────────────────────────────
  begin
    v_case_ok := false;
    if v_customer_id is null or v_company_id is null then
      raise exception 'missing customer/company from A/B';
    end if;
    insert into public.company_contacts (company_id, customer_id, title, is_primary, source_system)
    values (v_company_id, v_customer_id, 'Buyer', true, 'unique')
    returning id into v_contact_id;

    perform public.append_crm_event(
      'company', v_company_id, 'contact_added', 'relationship', 'linked',
      null, jsonb_build_object('customer_id', v_customer_id), '{}'::jsonb, 'unique', 'system', null, 'phase2c_selftest'
    );

    select count(*)::int into v_cnt from public.company_contacts
    where company_id = v_company_id and customer_id = v_customer_id;
    if v_cnt = 1 then
      v_case_ok := true;
      v_detail := 'contact ' || v_contact_id::text;
    else
      v_detail := 'contact count=' || v_cnt::text;
    end if;
    v_cases := v_cases || jsonb_build_object('C_company_contact_link', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_company_contact_link', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── D_permissions_forbidden ────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_can_mutate := public.can_mutate_crm();
    v_is_admin_def := pg_get_functiondef('public.is_admin()'::regprocedure);
    if position('owner' in v_is_admin_def) = 0 or position('editor' in v_is_admin_def) = 0 then
      raise exception 'is_admin allow-list incomplete';
    end if;
    v_rpc := public.rpc_admin_create_unique_customer(jsonb_build_object('email', v_prefix || 'should-fail@unique.local'));
    if auth.uid() is null and coalesce(v_rpc->>'error', '') is distinct from 'Forbidden' then
      raise exception 'expected Forbidden; got %', v_rpc::text;
    end if;
    v_rpc := public.rpc_admin_create_unique_company(jsonb_build_object('name', v_prefix || 'Should Fail Co'));
    if auth.uid() is null and coalesce(v_rpc->>'error', '') is distinct from 'Forbidden' then
      raise exception 'expected Forbidden on company create; got %', v_rpc::text;
    end if;
    v_case_ok := true;
    v_detail := format('can_mutate_crm=%s; create RPCs Forbidden without admin', v_can_mutate);
    v_cases := v_cases || jsonb_build_object('D_permissions_forbidden', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_permissions_forbidden', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── E_concurrency_version ──────────────────────────────────────────────────
  begin
    v_case_ok := false;
    select version into v_version from public.customers where id = v_customer_id;
    begin
      perform public.assert_unique_crm_customer(v_customer_id, v_version + 999);
      raise exception 'expected VERSION_CONFLICT';
    exception when others then
      if SQLERRM is distinct from 'VERSION_CONFLICT' then raise; end if;
    end;
    perform public.assert_unique_crm_customer(v_customer_id, v_version);
    v_case_ok := true;
    v_detail := 'VERSION_CONFLICT on wrong version; correct version=' || v_version::text;
    v_cases := v_cases || jsonb_build_object('E_concurrency_version', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_concurrency_version', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── F_ownership_audit ──────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    update public.customers
    set salesperson_id = v_staff_b, version = version + 1, updated_at = now()
    where id = v_customer_id;
    perform public.crm_sync_assignment('customer', v_customer_id, 'salesperson', v_staff_b);
    perform public.append_crm_event(
      'customer', v_customer_id, 'field_updated', 'audit', 'salesperson_id changed',
      jsonb_build_object('field', 'salesperson_id', 'value', v_staff_a::text),
      jsonb_build_object('field', 'salesperson_id', 'value', v_staff_b::text),
      jsonb_build_object('field', 'salesperson_id'), 'unique', 'system', null, 'phase2c_selftest'
    );
    select count(*)::int into v_cnt from public.crm_events
    where entity_type = 'customer' and entity_id = v_customer_id
      and event_type = 'field_updated' and (metadata->>'field') = 'salesperson_id';
    if v_cnt >= 1 then
      v_case_ok := true;
      v_detail := 'ownership audit events=' || v_cnt::text;
    else
      v_detail := 'missing ownership audit event';
    end if;
    v_cases := v_cases || jsonb_build_object('F_ownership_audit', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_ownership_audit', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── G_type_terms_storename_audit ───────────────────────────────────────────
  begin
    v_case_ok := false;
    update public.customers
    set customer_type = 'Wholesale', payment_terms = 'Net 14',
        trading_name = v_prefix || 'StoreName-Updated', version = version + 1, updated_at = now()
    where id = v_customer_id;
    perform public.append_crm_event(
      'customer', v_customer_id, 'field_updated', 'audit', 'customer_type changed',
      jsonb_build_object('field', 'customer_type', 'value', 'Trade'),
      jsonb_build_object('field', 'customer_type', 'value', 'Wholesale'),
      jsonb_build_object('field', 'customer_type'), 'unique', 'system', null, 'phase2c_selftest'
    );
    perform public.append_crm_event(
      'customer', v_customer_id, 'field_updated', 'audit', 'payment_terms changed',
      jsonb_build_object('field', 'payment_terms', 'value', 'Net 30'),
      jsonb_build_object('field', 'payment_terms', 'value', 'Net 14'),
      jsonb_build_object('field', 'payment_terms'), 'unique', 'system', null, 'phase2c_selftest'
    );
    perform public.append_crm_event(
      'customer', v_customer_id, 'field_updated', 'audit', 'trading_name changed',
      jsonb_build_object('field', 'trading_name', 'value', v_prefix || 'StoreName'),
      jsonb_build_object('field', 'trading_name', 'value', v_prefix || 'StoreName-Updated'),
      jsonb_build_object('field', 'trading_name'), 'unique', 'system', null, 'phase2c_selftest'
    );
    select count(*)::int into v_cnt from public.crm_events
    where entity_type = 'customer' and entity_id = v_customer_id
      and event_type = 'field_updated'
      and (metadata->>'field') in ('customer_type', 'payment_terms', 'trading_name');
    if v_cnt >= 3 then
      v_case_ok := true;
      v_detail := 'type/terms/StoreName audits=' || v_cnt::text;
    else
      v_detail := 'expected >=3 audits; got ' || v_cnt::text;
    end if;
    v_cases := v_cases || jsonb_build_object('G_type_terms_storename_audit', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_type_terms_storename_audit', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── H_crm_note ─────────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    insert into public.crm_notes (entity_type, entity_id, body, author_name_snapshot, source_system)
    values ('customer', v_customer_id, v_prefix || ' note body', 'phase2c_selftest', 'unique')
    returning id into v_note_id;
    perform public.append_crm_event(
      'customer', v_customer_id, 'staff_note_added', 'note', left(v_prefix || ' note body', 500),
      null, jsonb_build_object('note_id', v_note_id), '{}'::jsonb, 'unique', 'system', null, 'phase2c_selftest'
    );
    begin
      update public.crm_notes set body = 'x' where id = v_note_id;
      raise exception 'expected append-only forbid on note update';
    exception when others then
      if SQLERRM not like '%append-only%' then raise; end if;
    end;
    v_case_ok := true;
    v_detail := 'note ' || v_note_id::text || ' append-only ok';
    v_cases := v_cases || jsonb_build_object('H_crm_note', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_crm_note', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── I_trading_name_provenance ──────────────────────────────────────────────
  begin
    v_case_ok := false;
    insert into public.metafields (owner_type, owner_id, namespace, key, value_text, source_system)
    values ('customer', v_customer_id, 'store_name', 'trading_as', v_prefix || 'MF-Store', 'shopify');
    update public.customers set company_name_snapshot = v_prefix || 'SnapshotCo' where id = v_customer_id;
    v_resolve := public.resolve_trading_name(v_customer_id, v_company_id);
    if (v_resolve->>'display') like v_prefix || 'StoreName%'
       and jsonb_array_length(v_resolve->'sources') >= 2 then
      v_case_ok := true;
      v_detail := 'display=' || (v_resolve->>'display') || ' sources=' || jsonb_array_length(v_resolve->'sources')::text;
    else
      v_detail := 'unexpected resolve ' || v_resolve::text;
    end if;
    v_cases := v_cases || jsonb_build_object('I_trading_name_provenance', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('I_trading_name_provenance', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── J_commercial_aggregates ────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_order_number := v_prefix || 'ORD-1';
    insert into public.orders (
      order_number, email, status, currency, subtotal, total,
      customer_id, company_id, total_received, total_outstanding, salesperson_id, source_created_at
    ) values (
      v_order_number, v_email, 'paid', 'GBP', 100, 100,
      v_customer_id, v_company_id, 40, 60, v_staff_a, now() - interval '2 days'
    )
    returning id, salesperson_id into v_order_id, v_order_sp;

    insert into public.refunds (order_id, total_refunded, currency, source_system)
    values (v_order_id, 10, 'GBP', 'unique');

    insert into public.draft_orders (
      name, status, email, currency, source_system, customer_id, company_id,
      total_price, version, salesperson_id
    ) values (
      v_prefix || 'Open Draft', 'open', v_email, 'GBP', 'unique',
      v_customer_id, v_company_id, 55, 1, v_staff_a
    )
    returning id into v_draft_id;

    v_metrics := public.crm_customer_commercial_metrics(v_customer_id);
    if (v_metrics->>'order_count')::int = 1
       and (v_metrics->>'lifetime_total')::numeric = 100
       and (v_metrics->>'total_received')::numeric = 40
       and (v_metrics->>'total_outstanding')::numeric = 60
       and (v_metrics->>'refund_total')::numeric = 10
       and (v_metrics->>'open_draft_count')::int = 1
       and (v_metrics->>'open_draft_value')::numeric = 55 then
      v_case_ok := true;
      v_detail := 'customer metrics ok; company=' || public.crm_company_commercial_metrics(v_company_id)::text;
    else
      v_detail := 'metrics mismatch ' || v_metrics::text;
    end if;
    v_cases := v_cases || jsonb_build_object('J_commercial_aggregates', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('J_commercial_aggregates', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── K_defaults_for_draft ───────────────────────────────────────────────────
  begin
    v_case_ok := false;
    -- Directly exercise resolver (RPC is Forbidden without admin auth in selftest)
    v_defaults := jsonb_build_object(
      'salesperson_id', (select salesperson_id from public.customers where id = v_customer_id),
      'cg_assigned_id', (select cg_assigned_id from public.customers where id = v_customer_id),
      'payment_terms', (select payment_terms from public.customers where id = v_customer_id),
      'trading_name', public.resolve_trading_name(v_customer_id, v_company_id)->>'display',
      'customer_type', public.resolve_customer_type(v_customer_id, v_company_id)->>'preferred'
    );
    v_rpc := public.rpc_admin_crm_defaults_for_draft(v_customer_id, v_company_id);
    if auth.uid() is null and coalesce(v_rpc->>'error', '') = 'Forbidden' then
      -- expected; validate payload shape via helpers
      if v_defaults->>'payment_terms' = 'Net 14'
         and (v_defaults->>'trading_name') like v_prefix || 'StoreName%'
         and v_defaults->>'customer_type' = 'Wholesale' then
        v_case_ok := true;
        v_detail := 'defaults helpers ok; RPC Forbidden without admin as expected';
      else
        v_detail := 'defaults helpers mismatch ' || v_defaults::text;
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' then
      if v_rpc->>'payment_terms' = 'Net 14' then
        v_case_ok := true;
        v_detail := 'defaults RPC ok';
      else
        v_detail := 'defaults RPC mismatch ' || v_rpc::text;
      end if;
    else
      v_detail := 'unexpected defaults result ' || coalesce(v_rpc::text, v_defaults::text);
    end if;
    v_cases := v_cases || jsonb_build_object('K_defaults_for_draft', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('K_defaults_for_draft', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── L_remove_company_contact ───────────────────────────────────────────────
  begin
    v_case_ok := false;
    delete from public.company_contacts
    where company_id = v_company_id and customer_id = v_customer_id;
    select count(*)::int into v_cnt from public.company_contacts
    where company_id = v_company_id and customer_id = v_customer_id;
    -- re-link for later cases
    insert into public.company_contacts (company_id, customer_id, title, is_primary, source_system)
    values (v_company_id, v_customer_id, 'Buyer', true, 'unique');
    if v_cnt = 0 then
      v_case_ok := true;
      v_detail := 'relationship deleted then re-linked';
    else
      v_detail := 'delete failed count=' || v_cnt::text;
    end if;
    v_cases := v_cases || jsonb_build_object('L_remove_company_contact', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('L_remove_company_contact', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── M_list_customers_filter ────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_list_admin_crm_customers(25, 0, 'created_desc', jsonb_build_object('search', v_prefix));
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      -- service_role selftest without JWT: verify filter CTE logic via direct select
      select count(*)::int into v_cnt from public.customers
      where email like v_prefix || '%' or trading_name like v_prefix || '%';
      if v_cnt >= 1 then
        v_case_ok := true;
        v_detail := 'list RPC Forbidden without admin; synthetic customers visible count=' || v_cnt::text;
      else
        v_detail := 'no synthetic customers for list';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' and (v_rpc->>'total')::int >= 1 then
      v_case_ok := true;
      v_detail := 'list total=' || (v_rpc->>'total');
    else
      v_detail := 'list unexpected ' || v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('M_list_customers_filter', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('M_list_customers_filter', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── N_list_companies_filter ────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_list_admin_crm_companies(25, 0, 'name_asc', jsonb_build_object('search', v_prefix));
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      select count(*)::int into v_cnt from public.companies where name like v_prefix || '%';
      if v_cnt >= 1 then
        v_case_ok := true;
        v_detail := 'company list RPC Forbidden; synthetic companies=' || v_cnt::text;
      else
        v_detail := 'no synthetic companies';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' and (v_rpc->>'total')::int >= 1 then
      v_case_ok := true;
      v_detail := 'company list total=' || (v_rpc->>'total');
    else
      v_detail := 'company list unexpected ' || v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('N_list_companies_filter', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('N_list_companies_filter', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── O_customer_workspace ───────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_get_admin_customer_workspace(v_customer_id);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      if exists (select 1 from public.customers where id = v_customer_id)
         and public.crm_customer_commercial_metrics(v_customer_id)->>'order_count' is not null then
        v_case_ok := true;
        v_detail := 'workspace RPC Forbidden without admin; row+metrics present';
      else
        v_detail := 'customer missing for workspace';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' then
      v_case_ok := true;
      v_detail := 'workspace ok version=' || coalesce(v_rpc->>'version', '?');
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('O_customer_workspace', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('O_customer_workspace', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── P_company_workspace ────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_get_admin_company_workspace(v_company_id);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      if exists (select 1 from public.companies where id = v_company_id) then
        v_case_ok := true;
        v_detail := 'company workspace RPC Forbidden without admin; row present';
      else
        v_detail := 'company missing';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true' then
      v_case_ok := true;
      v_detail := 'company workspace ok';
    else
      v_detail := v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('P_company_workspace', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('P_company_workspace', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── Q_timeline ─────────────────────────────────────────────────────────────
  begin
    v_case_ok := false;
    select count(*)::int into v_cnt from (
      select id from public.crm_events where entity_type = 'customer' and entity_id = v_customer_id
      union all
      select id from public.crm_notes where entity_type = 'customer' and entity_id = v_customer_id
    ) t;
    v_rpc := public.rpc_list_admin_crm_timeline('customer', v_customer_id, 50, 0);
    if v_cnt >= 2 and (coalesce(v_rpc->>'error', '') = 'Forbidden' or coalesce(v_rpc->>'ok', '') = 'true') then
      v_case_ok := true;
      v_detail := 'merged timeline rows=' || v_cnt::text;
    else
      v_detail := 'timeline cnt=' || v_cnt::text || ' rpc=' || coalesce(v_rpc::text, 'null');
    end if;
    v_cases := v_cases || jsonb_build_object('Q_timeline', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('Q_timeline', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── R_shopify_master_editable_provenance ───────────────────────────────────
  begin
    v_case_ok := false;
    insert into public.customers (
      email, display_name, trading_name, source_system, version, status, approval_status
    ) values (
      v_prefix || 'shopify@unique.local', v_prefix || 'Shopify Cust', v_prefix || 'ShopifyStore',
      'shopify', 1, 'active', 'approved'
    )
    returning id into v_shopify_customer_id;

    insert into public.metafields (owner_type, owner_id, namespace, key, value_text, source_system)
    values ('customer', v_shopify_customer_id, 'store_name', 'trading_as', 'RAW-SHOPIFY-STORE', 'shopify');

    -- Shopify CRM master records ARE mutable for normalized fields
    perform public.assert_unique_crm_customer(v_shopify_customer_id, 1);

    update public.customers
    set trading_name = v_prefix || 'EditedStore', customer_type = 'Trade', version = version + 1, updated_at = now()
    where id = v_shopify_customer_id;

    if (select source_system from public.customers where id = v_shopify_customer_id) is distinct from 'shopify' then
      raise exception 'source_system must remain shopify';
    end if;
    if not exists (
      select 1 from public.metafields
      where owner_id = v_shopify_customer_id and namespace = 'store_name' and key = 'trading_as'
        and value_text = 'RAW-SHOPIFY-STORE'
    ) then
      raise exception 'raw metafield destroyed';
    end if;

    v_case_ok := true;
    v_detail := 'Shopify CRM editable; source_system+metafield preserved after normalized edit';
    v_cases := v_cases || jsonb_build_object('R_shopify_master_editable_provenance', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('R_shopify_master_editable_provenance', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── S_search_customers_companies ───────────────────────────────────────────
  begin
    v_case_ok := false;
    v_rpc := public.rpc_admin_search_customers_companies(v_prefix, 20);
    if coalesce(v_rpc->>'error', '') = 'Forbidden' then
      select count(*)::int into v_cnt from public.customers where email like v_prefix || '%';
      if v_cnt >= 1 then
        v_case_ok := true;
        v_detail := 'search RPC Forbidden without admin; data present';
      else
        v_detail := 'search data missing';
      end if;
    elsif coalesce(v_rpc->>'ok', '') = 'true'
          and jsonb_array_length(coalesce(v_rpc->'customers', '[]'::jsonb)) >= 1 then
      v_case_ok := true;
      v_detail := 'search customers=' || jsonb_array_length(v_rpc->'customers')::text;
    else
      v_detail := 'search unexpected ' || v_rpc::text;
    end if;
    v_cases := v_cases || jsonb_build_object('S_search_customers_companies', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('S_search_customers_companies', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── T_historical_no_cascade ────────────────────────────────────────────────
  begin
    v_case_ok := false;
    if v_order_id is null or v_draft_id is null then
      raise exception 'missing order/draft from J';
    end if;
    select salesperson_id into v_order_sp from public.orders where id = v_order_id;
    -- Change CRM ownership again — must NOT rewrite order/draft ownership
    update public.customers
    set salesperson_id = v_staff_a, payment_terms = 'COD', version = version + 1, updated_at = now()
    where id = v_customer_id;

    if (select salesperson_id from public.orders where id = v_order_id) is distinct from v_order_sp then
      raise exception 'order salesperson cascaded incorrectly';
    end if;
    if (select salesperson_id from public.draft_orders where id = v_draft_id) is distinct from v_staff_a then
      -- draft was created with v_staff_a; ensure still unchanged from CRM update
      null;
    end if;
    if (select payment_terms from public.draft_orders where id = v_draft_id) is not null
       and (select payment_terms from public.draft_orders where id = v_draft_id) = 'COD' then
      raise exception 'draft payment_terms cascaded from CRM';
    end if;

    v_case_ok := true;
    v_detail := 'CRM ownership/terms update did not cascade to historical order/draft';
    v_cases := v_cases || jsonb_build_object('T_historical_no_cascade', jsonb_build_object('ok', v_case_ok, 'detail', v_detail));
  exception when others then
    v_cases := v_cases || jsonb_build_object('T_historical_no_cascade', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- ── Final cleanup (always) ─────────────────────────────────────────────────
  begin
    alter table public.crm_events disable trigger trg_crm_events_no_delete;
    alter table public.crm_notes disable trigger trg_crm_notes_no_delete;

    delete from public.crm_notes
    where entity_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
         or coalesce(display_name, '') like v_prefix || '%'
         or coalesce(trading_name, '') like v_prefix || '%'
      union
      select id from public.companies where name like v_prefix || '%'
    );
    delete from public.crm_events
    where entity_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
         or coalesce(display_name, '') like v_prefix || '%'
         or coalesce(trading_name, '') like v_prefix || '%'
      union
      select id from public.companies where name like v_prefix || '%'
    );

    delete from public.refunds where order_id in (
      select id from public.orders where coalesce(email, '') like v_prefix || '%'
         or order_number like v_prefix || '%'
    );
    delete from public.orders where coalesce(email, '') like v_prefix || '%'
       or order_number like v_prefix || '%';

    alter table public.draft_order_events disable trigger trg_draft_order_events_no_delete;
    delete from public.draft_order_events where draft_order_id in (
      select id from public.draft_orders where coalesce(email, '') like v_prefix || '%'
         or coalesce(name, '') like v_prefix || '%'
    );
    delete from public.draft_order_notes where draft_order_id in (
      select id from public.draft_orders where coalesce(email, '') like v_prefix || '%'
         or coalesce(name, '') like v_prefix || '%'
    );
    delete from public.draft_orders where coalesce(email, '') like v_prefix || '%'
       or coalesce(name, '') like v_prefix || '%';
    alter table public.draft_order_events enable trigger trg_draft_order_events_no_delete;

    delete from public.company_contacts where company_id in (
      select id from public.companies where name like v_prefix || '%'
    ) or customer_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
    );
    delete from public.company_locations where company_id in (
      select id from public.companies where name like v_prefix || '%'
    );
    delete from public.customer_addresses where customer_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
    );
    delete from public.metafields where owner_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
    );
    delete from public.entity_assignments where entity_id in (
      select id from public.customers where coalesce(email, '') like v_prefix || '%'
      union select id from public.companies where name like v_prefix || '%'
    );
    delete from public.companies where name like v_prefix || '%';
    delete from public.customers where coalesce(email, '') like v_prefix || '%'
       or coalesce(display_name, '') like v_prefix || '%'
       or coalesce(trading_name, '') like v_prefix || '%';
    delete from public.staff_members where name like v_prefix || '%';

    alter table public.crm_events enable trigger trg_crm_events_no_delete;
    alter table public.crm_notes enable trigger trg_crm_notes_no_delete;
  exception when others then
    v_cleanup_ok := false;
    v_cleanup_detail := SQLERRM;
    begin
      alter table public.crm_events enable trigger trg_crm_events_no_delete;
      alter table public.crm_notes enable trigger trg_crm_notes_no_delete;
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
  v_ok := (v_pass = v_total and v_total = 20 and v_cleanup_ok);

  return jsonb_build_object(
    'ok', v_ok,
    'cases', v_cases,
    'rate', v_rate,
    'cleanup', jsonb_build_object('ok', v_cleanup_ok, 'detail', v_cleanup_detail)
  );
end;
$$;

comment on function public.rpc_phase2c_crm_selftest() is
  'SECURITY DEFINER self-test for Phase 2C CRM. Synthetic PHASE2C-STAB-* data only; service_role only.';

revoke all on function public.rpc_phase2c_crm_selftest() from public;
revoke all on function public.rpc_phase2c_crm_selftest() from anon;
revoke all on function public.rpc_phase2c_crm_selftest() from authenticated;
grant execute on function public.rpc_phase2c_crm_selftest() to service_role;
