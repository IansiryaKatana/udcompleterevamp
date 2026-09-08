-- Phase 2E: Payment semantics, historical money boundary, gateway foundation.
-- Production Worldpay money movement remains BLOCKED.
-- Does not rewrite Shopify payment_transactions or invent due dates.
-- Invoice numbering unchanged (UD-INV-TEST-).

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Gateway mode gate (default disabled; live hard-blocked in Phase 2E)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.payment_gateway_config (
  key text primary key default 'default',
  gateway_provider text not null default 'worldpay_access_unconfirmed',
  gateway_mode text not null default 'disabled'
    check (gateway_mode in ('disabled', 'test', 'live')),
  product_label text,
  api_family text,
  auth_method text,
  webhook_model text,
  supported_operations jsonb not null default '[]'::jsonb,
  merchant_config_required jsonb not null default '[]'::jsonb,
  notes text,
  phase_2e_live_blocked boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid
);

comment on table public.payment_gateway_config is
  'Payment gateway activation gate. Phase 2E: gateway_mode must stay disabled|test; live blocked by phase_2e_live_blocked.';

insert into public.payment_gateway_config (
  key, gateway_provider, gateway_mode, product_label, api_family, auth_method, webhook_model,
  supported_operations, merchant_config_required, notes, phase_2e_live_blocked
) values (
  'default',
  'worldpay_access_unconfirmed',
  'disabled',
  'Shopify historical label: Worldpay eCommerce (product for Unique native API UNCONFIRMED)',
  'Likely Access Worldpay Payments API if merchant confirms — NOT proven for this store',
  'Basic auth username/password + merchant entity (Access) OR TBD',
  'Access Worldpay event notifications / webhooks (official) — credentials required',
  jsonb_build_array('authorize','capture','void','refund','getPayment','parseWebhook','verifyWebhook'),
  jsonb_build_array(
    'Confirm Worldpay product (Access vs legacy WPG vs Shopify-only plugin)',
    'Merchant entity / merchant code',
    'API username + password (test)',
    'Webhook/notification secret or signature key',
    'Try vs Live base URLs from Worldpay Implementation Manager',
    'Explicit business approval for test mode'
  ),
  'No Worldpay secrets in repo/env. Adapter foundation only. Do not invent endpoints.',
  true
)
on conflict (key) do nothing;

alter table public.payment_gateway_config enable row level security;

drop policy if exists "admin_select_payment_gateway_config" on public.payment_gateway_config;
create policy "admin_select_payment_gateway_config" on public.payment_gateway_config
  for select to authenticated using (public.can_view_finance());

drop policy if exists "admin_update_payment_gateway_config" on public.payment_gateway_config;
create policy "admin_update_payment_gateway_config" on public.payment_gateway_config
  for update to authenticated
  using (public.current_admin_is_owner_or_admin())
  with check (
    public.current_admin_is_owner_or_admin()
    and (
      gateway_mode <> 'live'
      or phase_2e_live_blocked = false
    )
  );

grant select on public.payment_gateway_config to authenticated;
grant update on public.payment_gateway_config to authenticated;
grant all on public.payment_gateway_config to service_role;

create or replace function public.payment_gateway_mode()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select gateway_mode from public.payment_gateway_config where key = 'default'),
    'disabled'
  );
$$;

create or replace function public.payment_gateway_live_blocked()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (select phase_2e_live_blocked from public.payment_gateway_config where key = 'default'),
    true
  );
$$;

-- Returns whether Unique may attempt ANY outbound gateway money call.
-- Phase 2E: never live; test only if mode=test AND live_blocked still allows test.
create or replace function public.payment_gateway_actions_permitted()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_mode text := public.payment_gateway_mode();
  v_blocked boolean := public.payment_gateway_live_blocked();
begin
  if v_mode = 'live' and v_blocked then
    return jsonb_build_object(
      'ok', false,
      'mode', v_mode,
      'allowed', false,
      'error', 'production_gateway_blocked_phase_2e'
    );
  end if;
  if v_mode = 'disabled' then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'allowed', false,
      'error', 'gateway_disabled'
    );
  end if;
  if v_mode = 'test' then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'allowed', true,
      'environment', 'test',
      'note', 'Outbound calls still require credentials; adapter may return not_configured'
    );
  end if;
  if v_mode = 'live' then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'allowed', true,
      'environment', 'live',
      'note', 'Live only after Phase 2E gate removed by authorized later phase'
    );
  end if;
  return jsonb_build_object('ok', false, 'allowed', false, 'error', 'unknown_mode', 'mode', v_mode);
end;
$$;

grant execute on function public.payment_gateway_mode() to authenticated, service_role, anon;
grant execute on function public.payment_gateway_live_blocked() to authenticated, service_role, anon;
grant execute on function public.payment_gateway_actions_permitted() to authenticated, service_role, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Finance capability extensions (capture / void / refund)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.can_finance_capture()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'finance_capture' = any(coalesce(public.current_admin_finance_capabilities(), '{}'::text[]));
$$;

create or replace function public.can_finance_void()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'finance_void' = any(coalesce(public.current_admin_finance_capabilities(), '{}'::text[]));
$$;

create or replace function public.can_finance_refund()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_admin_is_owner_or_admin()
      or 'finance_refund' = any(coalesce(public.current_admin_finance_capabilities(), '{}'::text[]));
$$;

grant execute on function public.can_finance_capture() to authenticated, service_role;
grant execute on function public.can_finance_void() to authenticated, service_role;
grant execute on function public.can_finance_refund() to authenticated, service_role;

comment on column public.admin_users.finance_capabilities is
  'Optional finance caps: finance_post, finance_reverse, finance_invoice, finance_statement, finance_notes, finance_capture, finance_void, finance_refund. Editors view-only by default.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Historical financial boundary on orders (immutable source snapshot)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists source_total numeric(14,2),
  add column if not exists source_total_received numeric(14,2),
  add column if not exists source_total_outstanding numeric(14,2),
  add column if not exists source_financial_status text,
  add column if not exists money_ledger_mode text,
  add column if not exists reconciliation_status text;

comment on column public.orders.source_total is
  'Immutable imported commercial total snapshot (Shopify migration). Never rewrite.';
comment on column public.orders.source_total_received is
  'Immutable imported received snapshot. Distinct from calculated ledger position.';
comment on column public.orders.source_total_outstanding is
  'Immutable imported outstanding snapshot.';
comment on column public.orders.source_financial_status is
  'Immutable imported financial status snapshot.';
comment on column public.orders.money_ledger_mode is
  'imported_snapshot = Shopify historical; unique_ledger = Unique-native SoR from payment_transactions.';
comment on column public.orders.reconciliation_status is
  'MATCHED | MISMATCHED | INSUFFICIENT_EVIDENCE | REVIEWED_ACCEPTED | REVIEWED_CORRECTED_BY_UNIQUE_EVENT';

-- Freeze snapshots once (additive). Do not overwrite if already set.
update public.orders
set
  source_total = coalesce(source_total, total),
  source_total_received = coalesce(source_total_received, total_received),
  source_total_outstanding = coalesce(source_total_outstanding, total_outstanding),
  source_financial_status = coalesce(source_financial_status, financial_status),
  money_ledger_mode = coalesce(
    money_ledger_mode,
    case
      when shopify_order_gid is not null then 'imported_snapshot'
      when coalesce(metadata->>'source_system', '') = 'unique' then 'unique_ledger'
      when coalesce(order_source, '') in ('unique_draft', 'unique') then 'unique_ledger'
      else 'imported_snapshot'
    end
  )
where source_total is null
   or source_total_received is null
   or source_total_outstanding is null
   or source_financial_status is null
   or money_ledger_mode is null;

alter table public.orders
  drop constraint if exists orders_money_ledger_mode_chk;
alter table public.orders
  add constraint orders_money_ledger_mode_chk
  check (money_ledger_mode is null or money_ledger_mode in ('imported_snapshot', 'unique_ledger'));

alter table public.orders
  drop constraint if exists orders_reconciliation_status_chk;
alter table public.orders
  add constraint orders_reconciliation_status_chk
  check (
    reconciliation_status is null
    or reconciliation_status in (
      'MATCHED',
      'MISMATCHED',
      'INSUFFICIENT_EVIDENCE',
      'REVIEWED_ACCEPTED',
      'REVIEWED_CORRECTED_BY_UNIQUE_EVENT'
    )
  );

create or replace function public.trg_orders_source_money_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.source_total is not null and new.source_total is distinct from old.source_total then
      raise exception 'orders.source_total is immutable';
    end if;
    if old.source_total_received is not null and new.source_total_received is distinct from old.source_total_received then
      raise exception 'orders.source_total_received is immutable';
    end if;
    if old.source_total_outstanding is not null and new.source_total_outstanding is distinct from old.source_total_outstanding then
      raise exception 'orders.source_total_outstanding is immutable';
    end if;
    if old.source_financial_status is not null and new.source_financial_status is distinct from old.source_financial_status then
      raise exception 'orders.source_financial_status is immutable';
    end if;
    if old.money_ledger_mode = 'imported_snapshot'
       and new.money_ledger_mode is distinct from old.money_ledger_mode then
      raise exception 'orders.money_ledger_mode cannot leave imported_snapshot';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_source_money_immutable on public.orders;
create trigger trg_orders_source_money_immutable
  before update on public.orders
  for each row execute function public.trg_orders_source_money_immutable();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Payment transaction additive fields + intents + gateway events
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.payment_transactions
  add column if not exists error_message text,
  add column if not exists canonical_meaning text,
  add column if not exists gateway_event_id uuid,
  add column if not exists payment_intent_id uuid;

comment on column public.payment_transactions.canonical_meaning is
  'Evidence-based semantic meaning (SETTLED_SALE, PENDING_EXTERNAL_PAYMENT, …). May be set by classifier.';
comment on column public.payment_transactions.error_message is
  'Safe gateway/error text. Never store PAN/CVV.';

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  gateway text not null,
  environment text not null default 'disabled'
    check (environment in ('disabled', 'test', 'live')),
  state text not null default 'NOT_STARTED'
    check (state in (
      'NOT_STARTED', 'PENDING', 'AUTHORIZED', 'PARTIALLY_CAPTURED',
      'CAPTURED', 'FAILED', 'VOIDED', 'CANCELLED'
    )),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'GBP',
  amount_authorized numeric(14,2) not null default 0,
  amount_captured numeric(14,2) not null default 0,
  amount_refunded numeric(14,2) not null default 0,
  external_intent_id text,
  idempotency_key text,
  source_system text not null default 'unique',
  metadata jsonb not null default '{}'::jsonb,
  last_error_code text,
  last_error_message text,
  created_by_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_intents_idempotency_uidx unique (idempotency_key)
);

comment on table public.payment_intents is
  'Unique payment intent/attempt. Worldpay live ops gated; no card data.';

create index if not exists payment_intents_order_id_idx on public.payment_intents (order_id);
create index if not exists payment_intents_state_idx on public.payment_intents (state);

alter table public.payment_intents enable row level security;
drop policy if exists "admin_select_payment_intents" on public.payment_intents;
create policy "admin_select_payment_intents" on public.payment_intents
  for select to authenticated using (public.can_view_finance());
drop policy if exists "admin_insert_payment_intents" on public.payment_intents;
create policy "admin_insert_payment_intents" on public.payment_intents
  for insert to authenticated with check (
    public.can_finance_capture() or public.can_post_manual_payment()
  );
drop policy if exists "admin_update_payment_intents" on public.payment_intents;
create policy "admin_update_payment_intents" on public.payment_intents
  for update to authenticated
  using (public.can_finance_capture() or public.can_finance_void() or public.can_finance_refund())
  with check (public.can_finance_capture() or public.can_finance_void() or public.can_finance_refund());

grant select, insert, update on public.payment_intents to authenticated;
revoke delete on public.payment_intents from authenticated;
grant all on public.payment_intents to service_role;

create table if not exists public.payment_gateway_events (
  id uuid primary key default gen_random_uuid(),
  gateway text not null default 'worldpay',
  external_event_id text,
  event_type text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in (
      'received', 'verified', 'processed', 'duplicate', 'ignored', 'failed', 'retry'
    )),
  payload_hash text,
  payload_redacted jsonb not null default '{}'::jsonb,
  signature_header text,
  signature_valid boolean,
  related_payment_id uuid references public.payment_transactions(id) on delete set null,
  related_intent_id uuid references public.payment_intents(id) on delete set null,
  related_order_id uuid references public.orders(id) on delete set null,
  error_message text,
  retry_count int not null default 0,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_gateway_events_external_uidx unique (gateway, external_event_id)
);

comment on table public.payment_gateway_events is
  'Raw inbound gateway webhook/events. Store redacted payload only — never PAN/CVV.';

create index if not exists payment_gateway_events_status_idx
  on public.payment_gateway_events (processing_status, received_at desc);
create index if not exists payment_gateway_events_order_idx
  on public.payment_gateway_events (related_order_id)
  where related_order_id is not null;

alter table public.payment_gateway_events enable row level security;
drop policy if exists "admin_select_payment_gateway_events" on public.payment_gateway_events;
create policy "admin_select_payment_gateway_events" on public.payment_gateway_events
  for select to authenticated using (public.can_view_finance());

grant select on public.payment_gateway_events to authenticated;
grant all on public.payment_gateway_events to service_role;

-- FK from payment_transactions.gateway_event_id / payment_intent_id
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'payment_transactions_gateway_event_id_fkey'
  ) then
    alter table public.payment_transactions
      add constraint payment_transactions_gateway_event_id_fkey
      foreign key (gateway_event_id) references public.payment_gateway_events(id) on delete set null;
  end if;
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'payment_transactions_payment_intent_id_fkey'
  ) then
    alter table public.payment_transactions
      add constraint payment_transactions_payment_intent_id_fkey
      foreign key (payment_intent_id) references public.payment_intents(id) on delete set null;
  end if;
end $$;

commit;
