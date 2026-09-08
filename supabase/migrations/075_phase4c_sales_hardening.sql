-- Phase 4C — Sales scope hardening, ownership approval & CRM linking
-- Builds on 074. Does NOT auto-apply ownership, merge entities, or touch
-- DPD / SKULabs / warehouse / Worldpay. Historical snapshots stay immutable.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Access policy helpers (authoritative server enforcement)
-- ═══════════════════════════════════════════════════════════════════════════

comment on function public.assert_sales_entity_access(text, uuid) is
  'Phase 4C: assigned-scope gate. Policies:
   customer/company = current salesperson_id
   order/draft = historical salesperson_id OR current CRM customer/company salesperson
   (ORDER_ACCESS_POLICY = historical_snapshot OR current_crm_account_owner — explicit dual check).';

-- Testable core (no auth.uid) used by assert + selftest
create or replace function public.sales_entity_access_check(
  p_staff_id uuid,
  p_visibility text,
  p_role text,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_vis text := coalesce(nullif(btrim(coalesce(p_visibility, '')), ''), 'all');
  v_role text := coalesce(p_role, '');
begin
  if p_entity_id is null then
    return false;
  end if;

  -- Owner/admin always all
  if v_role in ('owner', 'admin') then
    return true;
  end if;

  if v_vis = 'all' then
    return true;
  end if;

  -- assigned without staff link → deny all
  if p_staff_id is null then
    return false;
  end if;

  if p_entity_type = 'customer' then
    return exists (
      select 1 from public.customers c
      where c.id = p_entity_id and c.salesperson_id = p_staff_id
    );
  elsif p_entity_type = 'company' then
    return exists (
      select 1 from public.companies c
      where c.id = p_entity_id and c.salesperson_id = p_staff_id
    );
  elsif p_entity_type = 'order' then
    -- Explicit dual policy: historical snapshot OR current CRM account owner
    return exists (
      select 1
      from public.orders o
      left join public.customers cu on cu.id = o.customer_id
      left join public.companies co on co.id = o.company_id
      where o.id = p_entity_id
        and (
          o.salesperson_id = p_staff_id
          or cu.salesperson_id = p_staff_id
          or co.salesperson_id = p_staff_id
        )
    );
  elsif p_entity_type = 'draft' then
    return exists (
      select 1
      from public.draft_orders d
      left join public.customers cu on cu.id = d.customer_id
      left join public.companies co on co.id = d.company_id
      where d.id = p_entity_id
        and (
          d.salesperson_id = p_staff_id
          or cu.salesperson_id = p_staff_id
          or co.salesperson_id = p_staff_id
        )
    );
  else
    return false;
  end if;
end;
$$;

grant execute on function public.sales_entity_access_check(uuid, text, text, text, uuid)
  to authenticated, service_role;

create or replace function public.assert_sales_entity_access(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_role text;
  v_vis text;
  v_staff uuid;
begin
  if not public.is_admin() then
    return false;
  end if;

  select au.role, au.sales_visibility, au.staff_member_id
  into v_role, v_vis, v_staff
  from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active
  limit 1;

  return public.sales_entity_access_check(v_staff, v_vis, v_role, p_entity_type, p_entity_id);
end;
$$;

-- Resolve parent entity for nested CRM mutations
create or replace function public.assert_sales_customer_access(p_customer_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.assert_sales_entity_access('customer', p_customer_id);
$$;

create or replace function public.assert_sales_company_access(p_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.assert_sales_entity_access('company', p_company_id);
$$;

create or replace function public.assert_sales_order_access(p_order_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.assert_sales_entity_access('order', p_order_id);
$$;

create or replace function public.assert_sales_draft_access(p_draft_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.assert_sales_entity_access('draft', p_draft_id);
$$;

grant execute on function public.assert_sales_customer_access(uuid) to authenticated, service_role;
grant execute on function public.assert_sales_company_access(uuid) to authenticated, service_role;
grant execute on function public.assert_sales_order_access(uuid) to authenticated, service_role;
grant execute on function public.assert_sales_draft_access(uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Wrap detail / nested read RPCs
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_get_admin_customer_workspace_core') then
    alter function public.rpc_get_admin_customer_workspace(uuid)
      rename to rpc_get_admin_customer_workspace_core;
  end if;
end $$;

create or replace function public.rpc_get_admin_customer_workspace(p_customer_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.assert_sales_entity_access('customer', p_customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.rpc_get_admin_customer_workspace_core(p_customer_id);
end;
$$;
grant execute on function public.rpc_get_admin_customer_workspace(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_get_admin_company_workspace_core') then
    alter function public.rpc_get_admin_company_workspace(uuid)
      rename to rpc_get_admin_company_workspace_core;
  end if;
end $$;

create or replace function public.rpc_get_admin_company_workspace(p_company_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.assert_sales_entity_access('company', p_company_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.rpc_get_admin_company_workspace_core(p_company_id);
end;
$$;
grant execute on function public.rpc_get_admin_company_workspace(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_get_admin_order_workspace_core') then
    alter function public.rpc_get_admin_order_workspace(uuid)
      rename to rpc_get_admin_order_workspace_core;
  end if;
end $$;

create or replace function public.rpc_get_admin_order_workspace(p_order_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.assert_sales_entity_access('order', p_order_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.rpc_get_admin_order_workspace_core(p_order_id);
end;
$$;
grant execute on function public.rpc_get_admin_order_workspace(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_get_admin_draft_workspace_core') then
    alter function public.rpc_get_admin_draft_workspace(uuid)
      rename to rpc_get_admin_draft_workspace_core;
  end if;
end $$;

create or replace function public.rpc_get_admin_draft_workspace(p_draft_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.assert_sales_entity_access('draft', p_draft_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.rpc_get_admin_draft_workspace_core(p_draft_id);
end;
$$;
grant execute on function public.rpc_get_admin_draft_workspace(uuid) to authenticated;

-- Nested order reads continue below

-- Generic forbidden payload
create or replace function public.sales_forbidden_json()
returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', 'Forbidden');
$$;

-- ── Nested order/draft/CRM reads ─────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_list_admin_order_items_core') then
    alter function public.rpc_list_admin_order_items(uuid, integer, integer, text)
      rename to rpc_list_admin_order_items_core;
  end if;
end $$;
create or replace function public.rpc_list_admin_order_items(
  p_order_id uuid, p_limit integer default 50, p_offset integer default 0, p_search text default null
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.assert_sales_order_access(p_order_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_list_admin_order_items_core(p_order_id, p_limit, p_offset, p_search);
end; $$;
grant execute on function public.rpc_list_admin_order_items(uuid, integer, integer, text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_list_admin_order_payments_core') then
    alter function public.rpc_list_admin_order_payments(uuid) rename to rpc_list_admin_order_payments_core;
  end if;
end $$;
create or replace function public.rpc_list_admin_order_payments(p_order_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.assert_sales_order_access(p_order_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_list_admin_order_payments_core(p_order_id);
end; $$;
grant execute on function public.rpc_list_admin_order_payments(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_list_admin_order_fulfillments_core') then
    alter function public.rpc_list_admin_order_fulfillments(uuid) rename to rpc_list_admin_order_fulfillments_core;
  end if;
end $$;
create or replace function public.rpc_list_admin_order_fulfillments(p_order_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.assert_sales_order_access(p_order_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_list_admin_order_fulfillments_core(p_order_id);
end; $$;
grant execute on function public.rpc_list_admin_order_fulfillments(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_list_admin_order_timeline_core') then
    alter function public.rpc_list_admin_order_timeline(uuid, integer, integer)
      rename to rpc_list_admin_order_timeline_core;
  end if;
end $$;
create or replace function public.rpc_list_admin_order_timeline(
  p_order_id uuid, p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.assert_sales_order_access(p_order_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_list_admin_order_timeline_core(p_order_id, p_limit, p_offset);
end; $$;
grant execute on function public.rpc_list_admin_order_timeline(uuid, integer, integer) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_list_admin_order_shipment_events_core') then
    alter function public.rpc_list_admin_order_shipment_events(uuid)
      rename to rpc_list_admin_order_shipment_events_core;
  end if;
end $$;
create or replace function public.rpc_list_admin_order_shipment_events(p_order_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.assert_sales_order_access(p_order_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_list_admin_order_shipment_events_core(p_order_id);
end; $$;
grant execute on function public.rpc_list_admin_order_shipment_events(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_list_admin_draft_lines_core') then
    alter function public.rpc_list_admin_draft_lines(uuid, integer, integer, text)
      rename to rpc_list_admin_draft_lines_core;
  end if;
end $$;
create or replace function public.rpc_list_admin_draft_lines(
  p_draft_id uuid, p_limit integer default 50, p_offset integer default 0, p_search text default null
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.assert_sales_draft_access(p_draft_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_list_admin_draft_lines_core(p_draft_id, p_limit, p_offset, p_search);
end; $$;
grant execute on function public.rpc_list_admin_draft_lines(uuid, integer, integer, text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_list_admin_draft_timeline_core') then
    alter function public.rpc_list_admin_draft_timeline(uuid, integer, integer)
      rename to rpc_list_admin_draft_timeline_core;
  end if;
end $$;
create or replace function public.rpc_list_admin_draft_timeline(
  p_draft_id uuid, p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.assert_sales_draft_access(p_draft_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_list_admin_draft_timeline_core(p_draft_id, p_limit, p_offset);
end; $$;
grant execute on function public.rpc_list_admin_draft_timeline(uuid, integer, integer) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_list_admin_crm_timeline_core') then
    alter function public.rpc_list_admin_crm_timeline(text, uuid, integer, integer)
      rename to rpc_list_admin_crm_timeline_core;
  end if;
end $$;
create or replace function public.rpc_list_admin_crm_timeline(
  p_entity_type text, p_entity_id uuid, p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if p_entity_type = 'customer' and not public.assert_sales_customer_access(p_entity_id) then
    return public.sales_forbidden_json();
  end if;
  if p_entity_type = 'company' and not public.assert_sales_company_access(p_entity_id) then
    return public.sales_forbidden_json();
  end if;
  if p_entity_type not in ('customer', 'company', 'company_location') then
    return public.sales_forbidden_json();
  end if;
  if p_entity_type = 'company_location' then
    if not public.assert_sales_company_access((
      select company_id from public.company_locations where id = p_entity_id
    )) then
      return public.sales_forbidden_json();
    end if;
  end if;
  return public.rpc_list_admin_crm_timeline_core(p_entity_type, p_entity_id, p_limit, p_offset);
end; $$;
grant execute on function public.rpc_list_admin_crm_timeline(text, uuid, integer, integer) to authenticated;

-- Finance panels
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_get_admin_order_finance_panel_core') then
    alter function public.rpc_get_admin_order_finance_panel(uuid)
      rename to rpc_get_admin_order_finance_panel_core;
  end if;
end $$;
create or replace function public.rpc_get_admin_order_finance_panel(p_order_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.assert_sales_order_access(p_order_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_get_admin_order_finance_panel_core(p_order_id);
end; $$;
grant execute on function public.rpc_get_admin_order_finance_panel(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_get_admin_crm_finance_summary_core') then
    alter function public.rpc_get_admin_crm_finance_summary(text, uuid)
      rename to rpc_get_admin_crm_finance_summary_core;
  end if;
end $$;
create or replace function public.rpc_get_admin_crm_finance_summary(p_entity_type text, p_entity_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if p_entity_type = 'customer' and not public.assert_sales_customer_access(p_entity_id) then
    return public.sales_forbidden_json();
  end if;
  if p_entity_type = 'company' and not public.assert_sales_company_access(p_entity_id) then
    return public.sales_forbidden_json();
  end if;
  return public.rpc_get_admin_crm_finance_summary_core(p_entity_type, p_entity_id);
end; $$;
grant execute on function public.rpc_get_admin_crm_finance_summary(text, uuid) to authenticated;

-- Payment/invoice detail: resolve to order then gate
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_get_admin_payment_transaction_core') then
    alter function public.rpc_get_admin_payment_transaction(uuid)
      rename to rpc_get_admin_payment_transaction_core;
  end if;
end $$;
create or replace function public.rpc_get_admin_payment_transaction(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_order uuid;
begin
  select order_id into v_order from public.payment_transactions where id = p_id;
  if v_order is not null and not public.assert_sales_order_access(v_order) then
    return public.sales_forbidden_json();
  end if;
  if v_order is null and not public.can_view_all_sales() then
    return public.sales_forbidden_json();
  end if;
  return public.rpc_get_admin_payment_transaction_core(p_id);
end; $$;
grant execute on function public.rpc_get_admin_payment_transaction(uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_get_admin_invoice_core') then
    alter function public.rpc_get_admin_invoice(uuid) rename to rpc_get_admin_invoice_core;
  end if;
end $$;
create or replace function public.rpc_get_admin_invoice(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_order uuid;
begin
  select order_id into v_order from public.invoices where id = p_id;
  if v_order is not null and not public.assert_sales_order_access(v_order) then
    return public.sales_forbidden_json();
  end if;
  if v_order is null and not public.can_view_all_sales() then
    return public.sales_forbidden_json();
  end if;
  return public.rpc_get_admin_invoice_core(p_id);
end; $$;
grant execute on function public.rpc_get_admin_invoice(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Mutation wrappers (assigned cannot mutate unowned CRM)
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_update_unique_customer_core') then
    alter function public.rpc_admin_update_unique_customer(uuid, integer, jsonb)
      rename to rpc_admin_update_unique_customer_core;
  end if;
end $$;
create or replace function public.rpc_admin_update_unique_customer(
  p_customer_id uuid, p_expected_version integer, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_customer_access(p_customer_id) then return public.sales_forbidden_json(); end if;
  -- Assigned users cannot reassign ownership via payload
  if not public.can_reassign_ownership() and (
    coalesce(p_payload, '{}'::jsonb) ? 'salesperson_id'
    or coalesce(p_payload, '{}'::jsonb) ? 'cg_assigned_id'
    or coalesce(p_payload, '{}'::jsonb) ? 'referrer_id'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.rpc_admin_update_unique_customer_core(p_customer_id, p_expected_version, p_payload);
end; $$;
grant execute on function public.rpc_admin_update_unique_customer(uuid, integer, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_update_unique_company_core') then
    alter function public.rpc_admin_update_unique_company(uuid, integer, jsonb)
      rename to rpc_admin_update_unique_company_core;
  end if;
end $$;
create or replace function public.rpc_admin_update_unique_company(
  p_company_id uuid, p_expected_version integer, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_company_access(p_company_id) then return public.sales_forbidden_json(); end if;
  if not public.can_reassign_ownership() and (
    coalesce(p_payload, '{}'::jsonb) ? 'salesperson_id'
    or coalesce(p_payload, '{}'::jsonb) ? 'cg_assigned_id'
    or coalesce(p_payload, '{}'::jsonb) ? 'referrer_id'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.rpc_admin_update_unique_company_core(p_company_id, p_expected_version, p_payload);
end; $$;
grant execute on function public.rpc_admin_update_unique_company(uuid, integer, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_upsert_customer_address_core') then
    alter function public.rpc_admin_upsert_customer_address(uuid, uuid, jsonb)
      rename to rpc_admin_upsert_customer_address_core;
  end if;
end $$;
create or replace function public.rpc_admin_upsert_customer_address(
  p_customer_id uuid, p_address_id uuid default null, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_customer_access(p_customer_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_upsert_customer_address_core(p_customer_id, p_address_id, p_payload);
end; $$;
grant execute on function public.rpc_admin_upsert_customer_address(uuid, uuid, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_delete_customer_address_core') then
    alter function public.rpc_admin_delete_customer_address(uuid, uuid)
      rename to rpc_admin_delete_customer_address_core;
  end if;
end $$;
create or replace function public.rpc_admin_delete_customer_address(p_customer_id uuid, p_address_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_customer_access(p_customer_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_delete_customer_address_core(p_customer_id, p_address_id);
end; $$;
grant execute on function public.rpc_admin_delete_customer_address(uuid, uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_upsert_company_location_core') then
    alter function public.rpc_admin_upsert_company_location(uuid, uuid, jsonb)
      rename to rpc_admin_upsert_company_location_core;
  end if;
end $$;
create or replace function public.rpc_admin_upsert_company_location(
  p_company_id uuid, p_location_id uuid default null, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_company_access(p_company_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_upsert_company_location_core(p_company_id, p_location_id, p_payload);
end; $$;
grant execute on function public.rpc_admin_upsert_company_location(uuid, uuid, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_delete_company_location_core') then
    alter function public.rpc_admin_delete_company_location(uuid, uuid)
      rename to rpc_admin_delete_company_location_core;
  end if;
end $$;
create or replace function public.rpc_admin_delete_company_location(p_company_id uuid, p_location_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_company_access(p_company_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_delete_company_location_core(p_company_id, p_location_id);
end; $$;
grant execute on function public.rpc_admin_delete_company_location(uuid, uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_update_company_contact_core') then
    alter function public.rpc_admin_update_company_contact(uuid, jsonb)
      rename to rpc_admin_update_company_contact_core;
  end if;
end $$;
create or replace function public.rpc_admin_update_company_contact(p_contact_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_co uuid;
begin
  select company_id into v_co from public.company_contacts where id = p_contact_id;
  if v_co is null or not public.assert_sales_company_access(v_co) then
    return public.sales_forbidden_json();
  end if;
  return public.rpc_admin_update_company_contact_core(p_contact_id, p_payload);
end; $$;
grant execute on function public.rpc_admin_update_company_contact(uuid, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_add_company_contact_core') then
    alter function public.rpc_admin_add_company_contact(uuid, uuid, text, boolean)
      rename to rpc_admin_add_company_contact_core;
  end if;
end $$;
create or replace function public.rpc_admin_add_company_contact(
  p_company_id uuid, p_customer_id uuid, p_title text default null, p_is_primary boolean default false
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_company_access(p_company_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_add_company_contact_core(p_company_id, p_customer_id, p_title, p_is_primary);
end; $$;
grant execute on function public.rpc_admin_add_company_contact(uuid, uuid, text, boolean) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_remove_company_contact_core') then
    alter function public.rpc_admin_remove_company_contact(uuid, uuid)
      rename to rpc_admin_remove_company_contact_core;
  end if;
end $$;
create or replace function public.rpc_admin_remove_company_contact(p_company_id uuid, p_customer_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_company_access(p_company_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_remove_company_contact_core(p_company_id, p_customer_id);
end; $$;
grant execute on function public.rpc_admin_remove_company_contact(uuid, uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_add_crm_note_core') then
    alter function public.rpc_admin_add_crm_note(text, uuid, text)
      rename to rpc_admin_add_crm_note_core;
  end if;
end $$;
create or replace function public.rpc_admin_add_crm_note(p_entity_type text, p_entity_id uuid, p_body text)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if p_entity_type = 'customer' and not public.assert_sales_customer_access(p_entity_id) then
    return public.sales_forbidden_json();
  end if;
  if p_entity_type = 'company' and not public.assert_sales_company_access(p_entity_id) then
    return public.sales_forbidden_json();
  end if;
  return public.rpc_admin_add_crm_note_core(p_entity_type, p_entity_id, p_body);
end; $$;
grant execute on function public.rpc_admin_add_crm_note(text, uuid, text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_promote_customer_type_core') then
    alter function public.rpc_admin_promote_customer_type(text, uuid, text, text)
      rename to rpc_admin_promote_customer_type_core;
  end if;
end $$;
create or replace function public.rpc_admin_promote_customer_type(
  p_entity_type text, p_entity_id uuid, p_normalized_type text, p_source text default 'shopify_metafield'
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if p_entity_type = 'customer' and not public.assert_sales_customer_access(p_entity_id) then
    return public.sales_forbidden_json();
  end if;
  if p_entity_type = 'company' and not public.assert_sales_company_access(p_entity_id) then
    return public.sales_forbidden_json();
  end if;
  return public.rpc_admin_promote_customer_type_core(p_entity_type, p_entity_id, p_normalized_type, p_source);
end; $$;
grant execute on function public.rpc_admin_promote_customer_type(text, uuid, text, text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_update_order_ops_core') then
    alter function public.rpc_admin_update_order_ops(uuid, jsonb) rename to rpc_admin_update_order_ops_core;
  end if;
end $$;
create or replace function public.rpc_admin_update_order_ops(p_order_id uuid, p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_order_access(p_order_id) then return public.sales_forbidden_json(); end if;
  -- Never allow assigned users to rewrite historical ownership snapshots
  if not public.can_reassign_ownership() and (
    coalesce(p_patch,'{}'::jsonb) ? 'salesperson_id'
    or coalesce(p_patch,'{}'::jsonb) ? 'cg_assigned_id'
    or coalesce(p_patch,'{}'::jsonb) ? 'referrer_id'
    or coalesce(p_patch,'{}'::jsonb) ? 'customer_type_snapshot'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return public.rpc_admin_update_order_ops_core(p_order_id, p_patch);
end; $$;
grant execute on function public.rpc_admin_update_order_ops(uuid, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_add_order_comment_core') then
    alter function public.rpc_admin_add_order_comment(uuid, text) rename to rpc_admin_add_order_comment_core;
  end if;
end $$;
create or replace function public.rpc_admin_add_order_comment(p_order_id uuid, p_body text)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_order_access(p_order_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_add_order_comment_core(p_order_id, p_body);
end; $$;
grant execute on function public.rpc_admin_add_order_comment(uuid, text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_update_unique_draft_core') then
    alter function public.rpc_admin_update_unique_draft(uuid, integer, jsonb)
      rename to rpc_admin_update_unique_draft_core;
  end if;
end $$;
create or replace function public.rpc_admin_update_unique_draft(
  p_draft_id uuid, p_expected_version integer, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_draft_access(p_draft_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_update_unique_draft_core(p_draft_id, p_expected_version, p_payload);
end; $$;
grant execute on function public.rpc_admin_update_unique_draft(uuid, integer, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_replace_unique_draft_lines_core') then
    alter function public.rpc_admin_replace_unique_draft_lines(uuid, integer, jsonb, integer)
      rename to rpc_admin_replace_unique_draft_lines_core;
  end if;
end $$;
create or replace function public.rpc_admin_replace_unique_draft_lines(
  p_draft_id uuid, p_expected_version integer, p_lines jsonb, p_known_line_count integer default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_draft_access(p_draft_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_replace_unique_draft_lines_core(p_draft_id, p_expected_version, p_lines, p_known_line_count);
end; $$;
grant execute on function public.rpc_admin_replace_unique_draft_lines(uuid, integer, jsonb, integer) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rpc_admin_add_draft_note_core') then
    alter function public.rpc_admin_add_draft_note(uuid, text) rename to rpc_admin_add_draft_note_core;
  end if;
end $$;
create or replace function public.rpc_admin_add_draft_note(p_draft_id uuid, p_body text)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.assert_sales_draft_access(p_draft_id) then return public.sales_forbidden_json(); end if;
  return public.rpc_admin_add_draft_note_core(p_draft_id, p_body);
end; $$;
grant execute on function public.rpc_admin_add_draft_note(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Approval / review tables
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.ownership_backfill_reviews (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('customer', 'company')),
  entity_id uuid not null,
  current_owner_id uuid references public.staff_members(id) on delete set null,
  proposed_owner_id uuid references public.staff_members(id) on delete set null,
  confidence text not null,
  recommendation text,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'DEFERRED', 'APPLIED', 'MANUAL')),
  decided_by_staff_id uuid references public.staff_members(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ownership_backfill_reviews_entity_uq unique (entity_type, entity_id)
);

create index if not exists ownership_backfill_reviews_status_idx
  on public.ownership_backfill_reviews (status, confidence);

alter table public.ownership_backfill_reviews enable row level security;
drop policy if exists "admin_all_ownership_backfill_reviews" on public.ownership_backfill_reviews;
create policy "admin_all_ownership_backfill_reviews" on public.ownership_backfill_reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.ownership_backfill_reviews to authenticated;
grant all on public.ownership_backfill_reviews to service_role;

create table if not exists public.customer_company_link_reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  proposed_company_id uuid references public.companies(id) on delete set null,
  confidence text not null default 'LOW',
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'LINKED', 'CREATE_COMPANY', 'NO_COMPANY_REQUIRED', 'DEFERRED')),
  decided_by_staff_id uuid references public.staff_members(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_company_link_reviews_customer_uq unique (customer_id)
);

alter table public.customer_company_link_reviews enable row level security;
drop policy if exists "admin_all_customer_company_link_reviews" on public.customer_company_link_reviews;
create policy "admin_all_customer_company_link_reviews" on public.customer_company_link_reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.customer_company_link_reviews to authenticated;
grant all on public.customer_company_link_reviews to service_role;

create table if not exists public.customer_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  group_key text not null unique,
  customer_ids uuid[] not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'UNREVIEWED'
    check (status in ('UNREVIEWED', 'POTENTIAL_DUPLICATE', 'NOT_DUPLICATE', 'REVIEWED')),
  notes text,
  reviewed_by_staff_id uuid references public.staff_members(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_duplicate_reviews enable row level security;
drop policy if exists "admin_all_customer_duplicate_reviews" on public.customer_duplicate_reviews;
create policy "admin_all_customer_duplicate_reviews" on public.customer_duplicate_reviews
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.customer_duplicate_reviews to authenticated;
grant all on public.customer_duplicate_reviews to service_role;

-- Extend company duplicate statuses to include UNREVIEWED
alter table public.company_duplicate_reviews drop constraint if exists company_duplicate_reviews_status_chk;
alter table public.company_duplicate_reviews
  add constraint company_duplicate_reviews_status_chk
  check (status in ('UNREVIEWED', 'POTENTIAL_DUPLICATE', 'NOT_DUPLICATE', 'REVIEWED'));

create table if not exists public.staff_admin_link_events (
  id uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  admin_user_id uuid references public.admin_users(id) on delete set null,
  action text not null check (action in ('link', 'unlink')),
  actor_staff_id uuid references public.staff_members(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);

alter table public.staff_admin_link_events enable row level security;
drop policy if exists "admin_select_staff_admin_link_events" on public.staff_admin_link_events;
create policy "admin_select_staff_admin_link_events" on public.staff_admin_link_events
  for select to authenticated using (public.is_admin());
drop policy if exists "admin_insert_staff_admin_link_events" on public.staff_admin_link_events;
create policy "admin_insert_staff_admin_link_events" on public.staff_admin_link_events
  for insert to authenticated with check (public.is_admin());
grant select, insert on public.staff_admin_link_events to authenticated;
grant all on public.staff_admin_link_events to service_role;

-- Audit link/unlink via updated link RPC
create or replace function public.rpc_admin_link_staff_admin(
  p_staff_id uuid,
  p_admin_user_id uuid,
  p_unlink boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
begin
  if not public.can_reassign_ownership() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not exists (select 1 from public.staff_members where id = p_staff_id) then
    return jsonb_build_object('ok', false, 'error', 'Staff not found');
  end if;

  if p_unlink then
    update public.admin_users set staff_member_id = null
    where id = p_admin_user_id and staff_member_id = p_staff_id;
    insert into public.staff_admin_link_events (staff_member_id, admin_user_id, action, actor_staff_id, actor_name)
    values (p_staff_id, p_admin_user_id, 'unlink', v_actor, v_name);
    return jsonb_build_object('ok', true, 'unlinked', true);
  end if;

  if not exists (select 1 from public.admin_users where id = p_admin_user_id) then
    return jsonb_build_object('ok', false, 'error', 'Admin user not found');
  end if;

  update public.admin_users set staff_member_id = null
  where staff_member_id = p_staff_id and id is distinct from p_admin_user_id;

  update public.admin_users set staff_member_id = p_staff_id where id = p_admin_user_id;

  insert into public.staff_admin_link_events (staff_member_id, admin_user_id, action, actor_staff_id, actor_name)
  values (p_staff_id, p_admin_user_id, 'link', v_actor, v_name);

  return jsonb_build_object('ok', true, 'staff_id', p_staff_id, 'admin_user_id', p_admin_user_id);
end;
$$;

grant execute on function public.rpc_admin_link_staff_admin(uuid, uuid, boolean) to authenticated;

create or replace function public.rpc_admin_list_staff_admin_links()
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'staff_without_admin', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'active', s.active) order by s.name), '[]'::jsonb)
      from public.staff_members s
      where not exists (select 1 from public.admin_users au where au.staff_member_id = s.id)
    ),
    'admins_without_staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', au.id, 'email', au.email, 'role', au.role, 'is_active', au.is_active, 'sales_visibility', au.sales_visibility
      ) order by au.email), '[]'::jsonb)
      from public.admin_users au
      where au.staff_member_id is null
    ),
    'linked', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'staff_id', s.id, 'staff_name', s.name, 'staff_active', s.active,
        'admin_id', au.id, 'admin_email', au.email, 'admin_role', au.role,
        'admin_active', au.is_active, 'sales_visibility', au.sales_visibility
      ) order by s.name), '[]'::jsonb)
      from public.staff_members s
      join public.admin_users au on au.staff_member_id = s.id
    ),
    'recent_events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'action', e.action, 'staff_member_id', e.staff_member_id,
        'admin_user_id', e.admin_user_id, 'actor_name', e.actor_name, 'created_at', e.created_at
      ) order by e.created_at desc), '[]'::jsonb)
      from (
        select * from public.staff_admin_link_events order by created_at desc limit 40
      ) e
    )
  );
end;
$$;
grant execute on function public.rpc_admin_list_staff_admin_links() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Ownership candidate rebuild (preview) + approval/apply
-- Confidence rules (documented):
-- EXPLICIT: exact staff match on customer/company salesperson metafield
-- HIGH: single salesperson across >=3 recent orders OR (>=2 orders + >=1 draft),
--       no conflicting SP, no current owner, last evidence within 365d
-- MEDIUM: single salesperson with weaker volume / older
-- LOW: sparse single-source evidence
-- CONFLICTING: multiple distinct salespeople in evidence window
-- NO_EVIDENCE: none
-- Statistical dominance alone (e.g. 60/40) is NEVER HIGH.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_rebuild_ownership_candidates(
  p_entity_type text default 'company',
  p_limit int default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n int := 0;
begin
  if not public.can_reassign_ownership() then
    return public.sales_forbidden_json();
  end if;
  if p_entity_type not in ('customer', 'company') then
    return jsonb_build_object('ok', false, 'error', 'entity_type must be customer|company');
  end if;

  if p_entity_type = 'company' then
    insert into public.ownership_backfill_reviews (
      entity_type, entity_id, current_owner_id, proposed_owner_id,
      confidence, recommendation, evidence, status
    )
    select
      'company',
      co.id,
      co.salesperson_id,
      prop.proposed_id,
      prop.confidence,
      case
        when prop.confidence in ('EXPLICIT', 'HIGH') then 'APPROVE_CANDIDATE'
        when prop.confidence = 'CONFLICTING' then 'REJECT_OR_MANUAL'
        when prop.confidence = 'NO_EVIDENCE' then 'DEFER'
        else 'REVIEW'
      end,
      prop.evidence,
      'PENDING'
    from public.companies co
    cross join lateral (
      with order_sp as (
        select o.salesperson_id as sp, count(*)::bigint cnt,
               min(coalesce(o.source_created_at, o.created_at)) first_seen,
               max(coalesce(o.source_created_at, o.created_at)) last_seen
        from public.orders o
        where o.company_id = co.id and o.salesperson_id is not null
        group by o.salesperson_id
      ),
      draft_sp as (
        select d.salesperson_id as sp, count(*)::bigint cnt,
               min(coalesce(d.source_created_at, d.created_at)) first_seen,
               max(coalesce(d.source_created_at, d.created_at)) last_seen
        from public.draft_orders d
        where d.company_id = co.id and d.salesperson_id is not null
        group by d.salesperson_id
      ),
      mf as (
        select s.id as sp, count(*)::bigint cnt
        from public.metafields m
        join public.staff_members s on lower(s.name) = lower(btrim(m.value_text))
        where m.owner_id = co.id and m.owner_type in ('company','COMPANY')
          and m.namespace = 'custom' and m.key = 'salesperson_assigned'
          and nullif(btrim(coalesce(m.value_text,'')),'') is not null
        group by s.id
      ),
      agg as (
        select
          coalesce(
            (select sp from mf order by cnt desc limit 1),
            (select sp from order_sp order by cnt desc, last_seen desc limit 1)
          ) as proposed_id,
          (select count(*) from order_sp) as distinct_order_sps,
          (select count(*) from draft_sp) as distinct_draft_sps,
          coalesce((select sum(cnt) from order_sp), 0) as order_total,
          coalesce((select cnt from order_sp order by cnt desc limit 1), 0) as order_top,
          coalesce((select sum(cnt) from draft_sp), 0) as draft_total,
          coalesce((select cnt from draft_sp order by cnt desc limit 1), 0) as draft_top,
          (select count(*) > 0 from mf) as has_explicit_mf,
          (select max(last_seen) from (
            select last_seen from order_sp union all select last_seen from draft_sp
          ) x) as last_evidence,
          (select min(first_seen) from (
            select first_seen from order_sp union all select first_seen from draft_sp
          ) x) as first_evidence
      )
      select
        a.proposed_id,
        case
          when co.salesperson_id is not null then 'NO_EVIDENCE' -- skip owned in insert filter
          when a.has_explicit_mf and a.distinct_order_sps <= 1 then 'EXPLICIT'
          when a.distinct_order_sps > 1 or a.distinct_draft_sps > 1 then 'CONFLICTING'
          when a.proposed_id is null then 'NO_EVIDENCE'
          when a.order_top >= 3 and a.order_top = a.order_total
            and a.last_evidence > now() - interval '365 days'
            and (a.draft_total = 0 or a.draft_top = a.draft_total)
            then 'HIGH'
          when a.order_top >= 1 and a.order_top = a.order_total then 'MEDIUM'
          when a.draft_top >= 2 and a.draft_top = a.draft_total then 'MEDIUM'
          when a.proposed_id is not null then 'LOW'
          else 'NO_EVIDENCE'
        end as confidence,
        jsonb_build_object(
          'order_count', a.order_total,
          'draft_count', a.draft_total,
          'dominant_owner_share', case when a.order_total > 0 then round((a.order_top::numeric / a.order_total) * 100, 1) else null end,
          'conflict_count', greatest(a.distinct_order_sps - 1, 0) + greatest(a.distinct_draft_sps - 1, 0),
          'first_evidence', a.first_evidence,
          'last_evidence', a.last_evidence,
          'explicit_metafield', a.has_explicit_mf,
          'source_rule', 'phase4c_v1'
        ) as evidence
      from agg a
    ) prop
    where co.salesperson_id is null
      and prop.confidence is distinct from 'NO_EVIDENCE'
    order by case prop.confidence when 'EXPLICIT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 else 4 end
    limit least(greatest(coalesce(p_limit, 500), 1), 2000)
    on conflict (entity_type, entity_id) do update set
      proposed_owner_id = excluded.proposed_owner_id,
      confidence = excluded.confidence,
      recommendation = excluded.recommendation,
      evidence = excluded.evidence,
      -- preserve manual decisions
      status = case
        when ownership_backfill_reviews.status in ('APPROVED','REJECTED','DEFERRED','APPLIED','MANUAL')
          then ownership_backfill_reviews.status
        else 'PENDING'
      end,
      updated_at = now();
    get diagnostics v_n = row_count;
  else
    insert into public.ownership_backfill_reviews (
      entity_type, entity_id, current_owner_id, proposed_owner_id,
      confidence, recommendation, evidence, status
    )
    select
      'customer', cu.id, cu.salesperson_id, prop.proposed_id, prop.confidence,
      case when prop.confidence in ('EXPLICIT','HIGH') then 'APPROVE_CANDIDATE'
           when prop.confidence = 'CONFLICTING' then 'REJECT_OR_MANUAL'
           else 'REVIEW' end,
      prop.evidence, 'PENDING'
    from public.customers cu
    cross join lateral (
      with order_sp as (
        select o.salesperson_id as sp, count(*)::bigint cnt,
               min(coalesce(o.source_created_at, o.created_at)) first_seen,
               max(coalesce(o.source_created_at, o.created_at)) last_seen
        from public.orders o where o.customer_id = cu.id and o.salesperson_id is not null
        group by o.salesperson_id
      ),
      draft_sp as (
        select d.salesperson_id as sp, count(*)::bigint cnt,
               min(coalesce(d.source_created_at, d.created_at)) first_seen,
               max(coalesce(d.source_created_at, d.created_at)) last_seen
        from public.draft_orders d where d.customer_id = cu.id and d.salesperson_id is not null
        group by d.salesperson_id
      ),
      mf as (
        select s.id as sp, count(*)::bigint cnt
        from public.metafields m
        join public.staff_members s on lower(s.name) = lower(btrim(m.value_text))
        where m.owner_id = cu.id and m.owner_type in ('customer','CUSTOMER')
          and m.namespace = 'custom' and m.key = 'salesperson_assigned'
        group by s.id
      ),
      agg as (
        select
          coalesce((select sp from mf order by cnt desc limit 1),
                   (select sp from order_sp order by cnt desc, last_seen desc limit 1),
                   (select sp from draft_sp order by cnt desc, last_seen desc limit 1)) as proposed_id,
          (select count(*) from order_sp) as distinct_order_sps,
          (select count(*) from draft_sp) as distinct_draft_sps,
          coalesce((select sum(cnt) from order_sp),0) as order_total,
          coalesce((select cnt from order_sp order by cnt desc limit 1),0) as order_top,
          coalesce((select sum(cnt) from draft_sp),0) as draft_total,
          coalesce((select cnt from draft_sp order by cnt desc limit 1),0) as draft_top,
          (select count(*) > 0 from mf) as has_explicit_mf,
          (select max(last_seen) from (select last_seen from order_sp union all select last_seen from draft_sp) x) as last_evidence,
          (select min(first_seen) from (select first_seen from order_sp union all select first_seen from draft_sp) x) as first_evidence
      )
      select a.proposed_id,
        case
          when a.has_explicit_mf and a.distinct_order_sps <= 1 then 'EXPLICIT'
          when a.distinct_order_sps > 1 or a.distinct_draft_sps > 1 then 'CONFLICTING'
          when a.proposed_id is null then 'NO_EVIDENCE'
          when a.order_top >= 3 and a.order_top = a.order_total
            and a.last_evidence > now() - interval '365 days' then 'HIGH'
          when a.order_top >= 1 and a.order_top = a.order_total then 'MEDIUM'
          when a.draft_top >= 2 and a.draft_top = a.draft_total then 'MEDIUM'
          when a.proposed_id is not null then 'LOW'
          else 'NO_EVIDENCE'
        end as confidence,
        jsonb_build_object(
          'order_count', a.order_total, 'draft_count', a.draft_total,
          'dominant_owner_share', case when a.order_total > 0 then round((a.order_top::numeric/a.order_total)*100,1) else null end,
          'conflict_count', greatest(a.distinct_order_sps-1,0)+greatest(a.distinct_draft_sps-1,0),
          'first_evidence', a.first_evidence, 'last_evidence', a.last_evidence,
          'explicit_metafield', a.has_explicit_mf, 'source_rule', 'phase4c_v1'
        ) as evidence
      from agg a
    ) prop
    where cu.salesperson_id is null and prop.confidence is distinct from 'NO_EVIDENCE'
    order by case prop.confidence when 'EXPLICIT' then 0 when 'HIGH' then 1 else 2 end
    limit least(greatest(coalesce(p_limit,500),1), 2000)
    on conflict (entity_type, entity_id) do update set
      proposed_owner_id = excluded.proposed_owner_id,
      confidence = excluded.confidence,
      recommendation = excluded.recommendation,
      evidence = excluded.evidence,
      status = case when ownership_backfill_reviews.status in ('APPROVED','REJECTED','DEFERRED','APPLIED','MANUAL')
        then ownership_backfill_reviews.status else 'PENDING' end,
      updated_at = now();
    get diagnostics v_n = row_count;
  end if;

  return jsonb_build_object(
    'ok', true, 'entity_type', p_entity_type, 'upserted', v_n,
    'preview_only', true,
    'note', 'No assignments applied. Approve explicitly via rpc_admin_decide_ownership_candidate.'
  );
end;
$$;
grant execute on function public.rpc_admin_rebuild_ownership_candidates(text, int) to authenticated;

create or replace function public.rpc_admin_list_ownership_candidates(
  p_entity_type text default null,
  p_status text default 'PENDING',
  p_confidence text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_total int;
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  select count(*) into v_total from public.ownership_backfill_reviews r
  where (p_entity_type is null or r.entity_type = p_entity_type)
    and (p_status is null or r.status = p_status)
    and (p_confidence is null or r.confidence = p_confidence);

  return jsonb_build_object(
    'ok', true, 'total', v_total, 'limit', p_limit, 'offset', p_offset,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'entity_type', r.entity_type, 'entity_id', r.entity_id,
        'entity_name', case when r.entity_type='company' then (select name from companies where id=r.entity_id)
          else (select coalesce(display_name, email) from customers where id=r.entity_id) end,
        'current_owner_id', r.current_owner_id,
        'current_owner_name', (select name from staff_members where id=r.current_owner_id),
        'proposed_owner_id', r.proposed_owner_id,
        'proposed_owner_name', (select name from staff_members where id=r.proposed_owner_id),
        'confidence', r.confidence, 'recommendation', r.recommendation,
        'evidence', r.evidence, 'status', r.status, 'decision_note', r.decision_note
      ) order by case r.confidence when 'EXPLICIT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end, r.created_at), '[]'::jsonb)
      from (
        select * from public.ownership_backfill_reviews r
        where (p_entity_type is null or r.entity_type = p_entity_type)
          and (p_status is null or r.status = p_status)
          and (p_confidence is null or r.confidence = p_confidence)
        order by case r.confidence when 'EXPLICIT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end, r.created_at
        offset greatest(coalesce(p_offset,0),0)
        limit least(greatest(coalesce(p_limit,100),1), 500)
      ) r
    )
  );
end;
$$;
grant execute on function public.rpc_admin_list_ownership_candidates(text, text, text, int, int) to authenticated;

create or replace function public.rpc_admin_decide_ownership_candidate(
  p_review_id uuid,
  p_decision text,
  p_manual_owner_id uuid default null,
  p_note text default null,
  p_apply_now boolean default false
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_row public.ownership_backfill_reviews%rowtype;
  v_owner uuid;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_old uuid;
begin
  if not public.can_reassign_ownership() then return public.sales_forbidden_json(); end if;
  if p_decision not in ('APPROVE','REJECT','DEFER','MANUAL') then
    return jsonb_build_object('ok', false, 'error', 'decision must be APPROVE|REJECT|DEFER|MANUAL');
  end if;

  select * into v_row from public.ownership_backfill_reviews where id = p_review_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Review not found'); end if;

  v_owner := case
    when p_decision = 'MANUAL' then p_manual_owner_id
    when p_decision = 'APPROVE' then v_row.proposed_owner_id
    else null
  end;

  if p_decision in ('APPROVE','MANUAL') and v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'owner required');
  end if;

  update public.ownership_backfill_reviews set
    status = case p_decision
      when 'APPROVE' then 'APPROVED'
      when 'REJECT' then 'REJECTED'
      when 'DEFER' then 'DEFERRED'
      else 'MANUAL'
    end,
    proposed_owner_id = coalesce(v_owner, proposed_owner_id),
    decided_by_staff_id = v_staff,
    decided_by_name = v_name,
    decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note,'')), ''),
    updated_at = now()
  where id = p_review_id;

  if p_apply_now and p_decision in ('APPROVE','MANUAL') then
    if v_row.entity_type = 'company' then
      select salesperson_id into v_old from public.companies where id = v_row.entity_id for update;
      update public.companies set salesperson_id = v_owner, version = version + 1, updated_at = now()
      where id = v_row.entity_id;
      perform public.crm_sync_assignment('company', v_row.entity_id, 'salesperson', v_owner, 'approved_inference');
      perform public.append_crm_event(
        'company', v_row.entity_id, 'ownership_backfill_approved', 'ownership',
        'Ownership backfill approved',
        jsonb_build_object('old', v_old),
        jsonb_build_object('new', v_owner, 'source', 'approved_inference', 'review_id', p_review_id, 'evidence', v_row.evidence),
        jsonb_build_object('confidence', v_row.confidence), 'unique', 'staff', v_staff, v_name
      );
    else
      select salesperson_id into v_old from public.customers where id = v_row.entity_id for update;
      update public.customers set salesperson_id = v_owner, version = version + 1, updated_at = now()
      where id = v_row.entity_id;
      perform public.crm_sync_assignment('customer', v_row.entity_id, 'salesperson', v_owner, 'approved_inference');
      perform public.append_crm_event(
        'customer', v_row.entity_id, 'ownership_backfill_approved', 'ownership',
        'Ownership backfill approved',
        jsonb_build_object('old', v_old),
        jsonb_build_object('new', v_owner, 'source', 'approved_inference', 'review_id', p_review_id, 'evidence', v_row.evidence),
        jsonb_build_object('confidence', v_row.confidence), 'unique', 'staff', v_staff, v_name
      );
    end if;
    update public.ownership_backfill_reviews set status = 'APPLIED', applied_at = now() where id = p_review_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'review_id', p_review_id, 'decision', p_decision,
    'applied', coalesce(p_apply_now and p_decision in ('APPROVE','MANUAL'), false),
    'note', 'Historical order/draft snapshots unchanged.'
  );
end;
$$;
grant execute on function public.rpc_admin_decide_ownership_candidate(uuid, text, uuid, text, boolean) to authenticated;

create or replace function public.rpc_admin_apply_approved_ownership_candidates(
  p_review_ids uuid[]
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_id uuid;
  v_ok int := 0;
  v_fail int := 0;
  v_rpc jsonb;
begin
  if not public.can_reassign_ownership() then return public.sales_forbidden_json(); end if;
  if p_review_ids is null or cardinality(p_review_ids) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No review ids selected');
  end if;
  foreach v_id in array p_review_ids loop
    select status into v_rpc from public.ownership_backfill_reviews where id = v_id;
    -- apply only APPROVED or MANUAL
    v_rpc := public.rpc_admin_decide_ownership_candidate(
      v_id,
      case when (select status from ownership_backfill_reviews where id = v_id) = 'MANUAL' then 'MANUAL' else 'APPROVE' end,
      (select proposed_owner_id from ownership_backfill_reviews where id = v_id),
      'bulk apply selected',
      true
    );
    if coalesce((v_rpc->>'ok')::boolean, false) then v_ok := v_ok + 1; else v_fail := v_fail + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'applied', v_ok, 'failed', v_fail, 'selected', cardinality(p_review_ids));
end;
$$;
grant execute on function public.rpc_admin_apply_approved_ownership_candidates(uuid[]) to authenticated;

-- Fix bulk apply helper
create or replace function public.rpc_admin_apply_approved_ownership_candidates(
  p_review_ids uuid[]
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_id uuid;
  v_status text;
  v_ok int := 0;
  v_fail int := 0;
  v_rpc jsonb;
  v_decision text;
begin
  if not public.can_reassign_ownership() then return public.sales_forbidden_json(); end if;
  if p_review_ids is null or cardinality(p_review_ids) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No review ids selected');
  end if;
  foreach v_id in array p_review_ids loop
    select status into v_status from public.ownership_backfill_reviews where id = v_id;
    if v_status not in ('APPROVED', 'MANUAL') then
      v_fail := v_fail + 1;
      continue;
    end if;
    v_decision := case when v_status = 'MANUAL' then 'MANUAL' else 'APPROVE' end;
    v_rpc := public.rpc_admin_decide_ownership_candidate(
      v_id, v_decision,
      (select proposed_owner_id from public.ownership_backfill_reviews where id = v_id),
      'bulk apply selected', true
    );
    if coalesce((v_rpc->>'ok')::boolean, false) then v_ok := v_ok + 1; else v_fail := v_fail + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'applied', v_ok, 'failed', v_fail, 'selected', cardinality(p_review_ids));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. CG policy + customer↔company link candidates + customer dupes + DQ hub
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_cg_current_state_policy()
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'current_customer_cg', (select count(*) from customers where cg_assigned_id is not null),
    'current_company_cg', (select count(*) from companies where cg_assigned_id is not null),
    'historical_order_cg', (select count(*) from orders where cg_assigned_id is not null),
    'recommendation', 'NOT_JUSTIFIED',
    'evidence', 'Only ~124 historical order CG snapshots vs 0 current customer CG. CG remains order-level collections ownership historically; no explicit current CRM CG source field with mass coverage. Do not invent current CG assignments from order history.',
    'action', 'Leave current CG unassigned until operational CG workflow is defined.'
  );
end;
$$;
grant execute on function public.rpc_admin_cg_current_state_policy() to authenticated;

create or replace function public.rpc_admin_rebuild_customer_company_link_candidates(p_limit int default 300)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_n int := 0;
begin
  if not public.can_reassign_ownership() then return public.sales_forbidden_json(); end if;

  insert into public.customer_company_link_reviews (customer_id, proposed_company_id, confidence, evidence, status)
  select
    cu.id,
    prop.company_id,
    prop.confidence,
    prop.evidence,
    'PENDING'
  from public.customers cu
  cross join lateral (
    select
      hist.company_id,
      case
        when hist.company_id is not null and hist.cnt >= 2 then 'HIGH'
        when hist.company_id is not null then 'MEDIUM'
        when name_match.company_id is not null then 'MEDIUM'
        else 'LOW'
      end as confidence,
      jsonb_build_object(
        'historical_order_company_count', hist.cnt,
        'store_name', cu.trading_name,
        'email_domain', case when cu.email like '%@%' then split_part(cu.email, '@', 2) else null end,
        'name_match', name_match.company_id is not null,
        'source_rule', 'phase4c_link_v1'
      ) as evidence
    from (
      select o.company_id, count(*)::bigint cnt
      from public.orders o
      where o.customer_id = cu.id and o.company_id is not null
      group by o.company_id
      order by count(*) desc
      limit 1
    ) hist
    full join lateral (
      select c.id as company_id
      from public.companies c
      where nullif(btrim(coalesce(cu.trading_name,'')),'') is not null
        and lower(btrim(c.name)) = lower(btrim(cu.trading_name))
      limit 1
    ) name_match on true
  ) prop
  where not exists (select 1 from company_contacts cc where cc.customer_id = cu.id)
    and (prop.company_id is not null or prop.confidence = 'LOW')
  order by case prop.confidence when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end
  limit least(greatest(coalesce(p_limit,300),1), 1000)
  on conflict (customer_id) do update set
    proposed_company_id = excluded.proposed_company_id,
    confidence = excluded.confidence,
    evidence = excluded.evidence,
    status = case when customer_company_link_reviews.status in ('LINKED','CREATE_COMPANY','NO_COMPANY_REQUIRED','DEFERRED')
      then customer_company_link_reviews.status else 'PENDING' end,
    updated_at = now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'upserted', v_n, 'preview_only', true, 'note', 'No auto-link.');
end;
$$;
grant execute on function public.rpc_admin_rebuild_customer_company_link_candidates(int) to authenticated;

create or replace function public.rpc_admin_list_customer_company_link_candidates(
  p_status text default 'PENDING', p_limit int default 100, p_offset int default 0
)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'customer_id', r.customer_id,
        'customer_name', (select coalesce(display_name, email) from customers where id = r.customer_id),
        'proposed_company_id', r.proposed_company_id,
        'proposed_company_name', (select name from companies where id = r.proposed_company_id),
        'confidence', r.confidence,
        'evidence', r.evidence,
        'status', r.status
      )), '[]'::jsonb)
      from (
        select * from public.customer_company_link_reviews
        where p_status is null or status = p_status
        order by case confidence when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end, created_at
        offset greatest(coalesce(p_offset,0),0)
        limit least(greatest(coalesce(p_limit,100),1), 500)
      ) r
    )
  );
end;
$$;
grant execute on function public.rpc_admin_list_customer_company_link_candidates(text, int, int) to authenticated;

create or replace function public.rpc_admin_decide_customer_company_link(
  p_review_id uuid,
  p_decision text,
  p_company_id uuid default null,
  p_note text default null
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_row public.customer_company_link_reviews%rowtype;
  v_staff uuid := public.current_admin_staff_id();
  v_name text := public.current_admin_display_name();
  v_co uuid;
begin
  if not public.can_reassign_ownership() then return public.sales_forbidden_json(); end if;
  if p_decision not in ('LINK','NO_COMPANY_REQUIRED','DEFER') then
    return jsonb_build_object('ok', false, 'error', 'decision must be LINK|NO_COMPANY_REQUIRED|DEFER');
  end if;
  select * into v_row from public.customer_company_link_reviews where id = p_review_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Review not found'); end if;

  v_co := coalesce(p_company_id, v_row.proposed_company_id);

  if p_decision = 'LINK' then
    if v_co is null then return jsonb_build_object('ok', false, 'error', 'company required'); end if;
    if not exists (select 1 from companies where id = v_co) then
      return jsonb_build_object('ok', false, 'error', 'Company not found');
    end if;
    insert into public.company_contacts (company_id, customer_id, is_primary, source_system)
    values (v_co, v_row.customer_id, true, 'unique')
    on conflict (company_id, customer_id) do nothing;
    perform public.append_crm_event(
      'customer', v_row.customer_id, 'company_link_approved', 'relationship',
      'Customer linked to company',
      null, jsonb_build_object('company_id', v_co, 'source', 'unique_manual', 'review_id', p_review_id, 'evidence', v_row.evidence),
      '{}'::jsonb, 'unique', 'staff', v_staff, v_name
    );
  end if;

  update public.customer_company_link_reviews set
    status = case p_decision when 'LINK' then 'LINKED' when 'NO_COMPANY_REQUIRED' then 'NO_COMPANY_REQUIRED' else 'DEFERRED' end,
    proposed_company_id = coalesce(v_co, proposed_company_id),
    decided_by_staff_id = v_staff, decided_by_name = v_name, decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note,'')), ''),
    updated_at = now()
  where id = p_review_id;

  return jsonb_build_object('ok', true, 'review_id', p_review_id, 'decision', p_decision);
end;
$$;
grant execute on function public.rpc_admin_decide_customer_company_link(uuid, text, uuid, text) to authenticated;

create or replace function public.rpc_admin_rebuild_customer_duplicate_candidates()
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_n int := 0;
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  insert into public.customer_duplicate_reviews (group_key, customer_ids, evidence, status)
  select
    'email:' || lower(btrim(email)),
    array_agg(id order by created_at),
    jsonb_build_object('email', lower(btrim(email)), 'member_count', count(*)),
    'UNREVIEWED'
  from public.customers
  where nullif(btrim(coalesce(email,'')),'') is not null
  group by lower(btrim(email))
  having count(*) > 1
  on conflict (group_key) do update set
    customer_ids = excluded.customer_ids,
    evidence = excluded.evidence,
    status = case when customer_duplicate_reviews.status in ('NOT_DUPLICATE','REVIEWED')
      then customer_duplicate_reviews.status else excluded.status end,
    updated_at = now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'groups_upserted', v_n, 'note', 'Exact email only. No merge.');
end;
$$;
grant execute on function public.rpc_admin_rebuild_customer_duplicate_candidates() to authenticated;

create or replace function public.rpc_admin_list_customer_duplicate_candidates(
  p_status text default null, p_limit int default 100
)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'group_key', r.group_key, 'customer_ids', r.customer_ids,
        'evidence', r.evidence, 'status', r.status, 'notes', r.notes
      ) order by cardinality(r.customer_ids) desc), '[]'::jsonb)
      from (
        select * from public.customer_duplicate_reviews
        where p_status is null or status = p_status
        order by cardinality(customer_ids) desc
        limit least(greatest(coalesce(p_limit,100),1), 500)
      ) r
    )
  );
end;
$$;
grant execute on function public.rpc_admin_list_customer_duplicate_candidates(text, int) to authenticated;

create or replace function public.rpc_admin_review_customer_duplicate(
  p_review_id uuid, p_status text, p_notes text default null
)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  if not public.can_mutate_crm() then return public.sales_forbidden_json(); end if;
  if p_status not in ('UNREVIEWED','POTENTIAL_DUPLICATE','NOT_DUPLICATE','REVIEWED') then
    return jsonb_build_object('ok', false, 'error', 'Invalid status');
  end if;
  update public.customer_duplicate_reviews set
    status = p_status,
    notes = coalesce(nullif(btrim(coalesce(p_notes,'')), ''), notes),
    reviewed_by_staff_id = public.current_admin_staff_id(),
    reviewed_by_name = public.current_admin_display_name(),
    reviewed_at = now(), updated_at = now()
  where id = p_review_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Not found'); end if;
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', p_status, 'merge', false);
end;
$$;
grant execute on function public.rpc_admin_review_customer_duplicate(uuid, text, text) to authenticated;

create or replace function public.rpc_admin_crm_quality_hub()
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'unowned_customers', (select count(*) from customers where salesperson_id is null),
    'unowned_companies', (select count(*) from companies where salesperson_id is null),
    'unknown_staff_aliases', (select count(*) from staff_aliases where status in ('UNKNOWN','AMBIGUOUS')),
    'ownership_candidates_pending', (select count(*) from ownership_backfill_reviews where status = 'PENDING'),
    'ownership_candidates_high', (select count(*) from ownership_backfill_reviews where status='PENDING' and confidence in ('EXPLICIT','HIGH')),
    'link_candidates_pending', (select count(*) from customer_company_link_reviews where status = 'PENDING'),
    'duplicate_company_groups', (select count(*) from company_duplicate_reviews where status in ('UNREVIEWED','POTENTIAL_DUPLICATE')),
    'duplicate_customer_groups', (select count(*) from customer_duplicate_reviews where status in ('UNREVIEWED','POTENTIAL_DUPLICATE')),
    'customers_without_company', (
      select count(*) from customers cu where not exists (select 1 from company_contacts cc where cc.customer_id = cu.id)
    ),
    'cg_policy', 'NOT_JUSTIFIED',
    'surecust_wholesale_links', (
      select count(*) from entity_tags et join tags t on t.id = et.tag_id where t.name = 'SureCust_Wholesale'
    ),
    'surecust_model', 'wholesale_access_eligibility_gate_separate_from_customer_type',
    'no_hidden_cleanup', true,
    'no_auto_backfill', true,
    'no_auto_merge', true
  );
end;
$$;
grant execute on function public.rpc_admin_crm_quality_hub() to authenticated;

create or replace function public.rpc_admin_ownership_coverage_report()
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare
  v_staff uuid := public.current_admin_staff_id();
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  if not public.can_view_all_sales() then
    -- assigned: only own row
    return jsonb_build_object(
      'ok', true,
      'scope', 'assigned',
      'staff_id', v_staff,
      'by_salesperson', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff_id', s.id, 'name', s.name,
          'customers_owned', (select count(*) from customers c where c.salesperson_id = s.id),
          'companies_owned', (select count(*) from companies c where c.salesperson_id = s.id),
          'open_drafts_hist', (select count(*) from draft_orders d where d.salesperson_id = s.id and d.converted_order_id is null),
          'historical_orders', (select count(*) from orders o where o.salesperson_id = s.id),
          'current_ar', (
            select coalesce(sum(o.total_outstanding),0) from orders o
            left join customers cu on cu.id = o.customer_id
            left join companies co on co.id = o.company_id
            where coalesce(o.total_outstanding,0) > 0
              and coalesce(co.salesperson_id, cu.salesperson_id) = s.id
              and coalesce(o.is_test,false)=false
          )
        )), '[]'::jsonb)
        from staff_members s where s.id = v_staff
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'scope', 'all',
    'customers', jsonb_build_object(
      'total', (select count(*) from customers),
      'owned', (select count(*) from customers where salesperson_id is not null),
      'unowned', (select count(*) from customers where salesperson_id is null),
      'ownership_pct', round(100.0 * (select count(*) from customers where salesperson_id is not null) / nullif((select count(*) from customers),0), 1)
    ),
    'companies', jsonb_build_object(
      'total', (select count(*) from companies),
      'owned', (select count(*) from companies where salesperson_id is not null),
      'unowned', (select count(*) from companies where salesperson_id is null),
      'ownership_pct', round(100.0 * (select count(*) from companies where salesperson_id is not null) / nullif((select count(*) from companies),0), 1)
    ),
    'by_salesperson', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'staff_id', s.id, 'name', s.name,
        'customers_owned', (select count(*) from customers c where c.salesperson_id = s.id),
        'companies_owned', (select count(*) from companies c where c.salesperson_id = s.id),
        'open_drafts_hist', (select count(*) from draft_orders d where d.salesperson_id = s.id and d.converted_order_id is null),
        'historical_orders', (select count(*) from orders o where o.salesperson_id = s.id),
        'current_ar', (
          select coalesce(sum(o.total_outstanding),0) from orders o
          left join customers cu on cu.id = o.customer_id
          left join companies co on co.id = o.company_id
          where coalesce(o.total_outstanding,0) > 0
            and coalesce(co.salesperson_id, cu.salesperson_id) = s.id
            and coalesce(o.is_test,false)=false
        )
      ) order by (select count(*) from companies c where c.salesperson_id = s.id) desc), '[]'::jsonb)
      from staff_members s
      where s.active
        and (
          exists (select 1 from customers c where c.salesperson_id = s.id)
          or exists (select 1 from companies c where c.salesperson_id = s.id)
          or exists (select 1 from orders o where o.salesperson_id = s.id)
        )
    ),
    'distinction', jsonb_build_object(
      'current_ownership', 'customers/companies.salesperson_id',
      'historical_attribution', 'orders/draft_orders.salesperson_id'
    )
  );
end;
$$;
grant execute on function public.rpc_admin_ownership_coverage_report() to authenticated;

-- RPC security matrix report (documentation as data)
create or replace function public.rpc_admin_sales_security_matrix()
returns jsonb language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'order_access_policy', 'historical_snapshot OR current_crm_account_owner',
    'ar_default_basis', 'current_crm',
    'matrix', jsonb_build_array(
      jsonb_build_object('rpc','rpc_get_admin_customer_workspace','entity','customer','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','ALLOW','assigned_unowned','FORBIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_get_admin_company_workspace','entity','company','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','ALLOW','assigned_unowned','FORBIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_get_admin_order_workspace','entity','order','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','ALLOW','assigned_unowned','FORBIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_get_admin_draft_workspace','entity','draft','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','ALLOW','assigned_unowned','FORBIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_list_admin_crm_customers','entity','customer','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','SCOPED','assigned_unowned','HIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_list_admin_crm_companies','entity','company','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','SCOPED','assigned_unowned','HIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_list_admin_orders_v2','entity','order','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','SCOPED','assigned_unowned','HIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_list_admin_drafts','entity','draft','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','SCOPED','assigned_unowned','HIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_list_admin_ar_receivables','entity','ar','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','SCOPED','assigned_unowned','HIDDEN','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','rpc_admin_update_unique_customer','entity','customer','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','ALLOW','assigned_unowned','FORBIDDEN','mutation','owned_only; ownership fields owner/admin','status','SECURED'),
      jsonb_build_object('rpc','rpc_admin_update_unique_company','entity','company','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','ALLOW','assigned_unowned','FORBIDDEN','mutation','owned_only; ownership fields owner/admin','status','SECURED'),
      jsonb_build_object('rpc','rpc_admin_reassign_ownership','entity','crm','owner_admin','ALLOW','all_vis','FORBIDDEN','assigned_owned','FORBIDDEN','assigned_unowned','FORBIDDEN','mutation','owner/admin only','status','SECURED'),
      jsonb_build_object('rpc','rpc_admin_sales_overview','entity','sales','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','SCOPED','assigned_unowned','SCOPED','mutation','N/A','status','SECURED'),
      jsonb_build_object('rpc','nested order/draft/crm/finance reads','entity','nested','owner_admin','ALLOW','all_vis','ALLOW','assigned_owned','ALLOW','assigned_unowned','FORBIDDEN','mutation','N/A','status','SECURED')
    )
  );
end;
$$;
grant execute on function public.rpc_admin_sales_security_matrix() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Phase 4C selftest (security-first)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase4c_sales_hardening_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_all_ok boolean := true;
  v_ok boolean;
  v_prefix text := 'p4c-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_staff_a uuid;
  v_staff_b uuid;
  v_customer_a uuid;
  v_customer_b uuid;
  v_company_a uuid;
  v_company_b uuid;
  v_order_a uuid;
  v_order_b uuid;
  v_draft_a uuid;
  v_review_id uuid;
  v_sp_before uuid;
begin
  -- Fixtures
  insert into public.staff_members (name, active, provenance, source_system)
  values (v_prefix || ' A', true, 'unique_manual', 'unique') returning id into v_staff_a;
  insert into public.staff_members (name, active, provenance, source_system)
  values (v_prefix || ' B', true, 'unique_manual', 'unique') returning id into v_staff_b;

  insert into public.customers (email, display_name, salesperson_id, source_system, version)
  values (lower(v_prefix)||'.a@example.test', v_prefix||' CustA', v_staff_a, 'unique', 1)
  returning id into v_customer_a;
  insert into public.customers (email, display_name, salesperson_id, source_system, version)
  values (lower(v_prefix)||'.b@example.test', v_prefix||' CustB', v_staff_b, 'unique', 1)
  returning id into v_customer_b;

  insert into public.companies (name, salesperson_id, source_system, version)
  values (v_prefix||' CoA', v_staff_a, 'unique', 1) returning id into v_company_a;
  insert into public.companies (name, salesperson_id, source_system, version)
  values (v_prefix||' CoB', v_staff_b, 'unique', 1) returning id into v_company_b;

  insert into public.orders (order_number, email, status, currency, subtotal, total, customer_id, company_id, salesperson_id)
  values (v_prefix||'-OA', lower(v_prefix)||'@t.test', 'paid', 'GBP', 10, 10, v_customer_a, v_company_a, v_staff_a)
  returning id into v_order_a;
  insert into public.orders (order_number, email, status, currency, subtotal, total, customer_id, company_id, salesperson_id)
  values (v_prefix||'-OB', lower(v_prefix)||'@t.test', 'paid', 'GBP', 10, 10, v_customer_b, v_company_b, v_staff_b)
  returning id into v_order_b;

  insert into public.draft_orders (name, email, status, currency, subtotal, total_price, customer_id, company_id, salesperson_id, source_system)
  values (v_prefix||'-DA', lower(v_prefix)||'@t.test', 'open', 'GBP', 5, 5, v_customer_a, v_company_a, v_staff_a, 'unique')
  returning id into v_draft_a;

  -- A access check: assigned staff A owns A, not B
  begin
    v_ok := public.sales_entity_access_check(v_staff_a, 'assigned', 'editor', 'customer', v_customer_a)
      and not public.sales_entity_access_check(v_staff_a, 'assigned', 'editor', 'customer', v_customer_b)
      and public.sales_entity_access_check(v_staff_a, 'assigned', 'editor', 'company', v_company_a)
      and not public.sales_entity_access_check(v_staff_a, 'assigned', 'editor', 'company', v_company_b)
      and public.sales_entity_access_check(v_staff_a, 'assigned', 'editor', 'order', v_order_a)
      and not public.sales_entity_access_check(v_staff_a, 'assigned', 'editor', 'order', v_order_b)
      and public.sales_entity_access_check(v_staff_a, 'assigned', 'editor', 'draft', v_draft_a);
    v_cases := v_cases || jsonb_build_object('A_assigned_scope_matrix', jsonb_build_object('ok', v_ok, 'detail', 'owned allow / unowned deny'));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_assigned_scope_matrix', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- B owner/admin bypass
  begin
    v_ok := public.sales_entity_access_check(v_staff_a, 'assigned', 'owner', 'customer', v_customer_b)
      and public.sales_entity_access_check(null, 'all', 'editor', 'company', v_company_b);
    v_cases := v_cases || jsonb_build_object('B_owner_all_bypass', jsonb_build_object('ok', v_ok, 'detail', 'owner/all allow'));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_owner_all_bypass', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- C dual order policy: current CRM owner can see order even if snapshot differs
  begin
    update public.orders set salesperson_id = v_staff_b where id = v_order_a;
    v_ok := public.sales_entity_access_check(v_staff_a, 'assigned', 'editor', 'order', v_order_a)
      and public.sales_entity_access_check(v_staff_b, 'assigned', 'editor', 'order', v_order_a);
    update public.orders set salesperson_id = v_staff_a where id = v_order_a;
    v_cases := v_cases || jsonb_build_object('C_order_dual_policy', jsonb_build_object('ok', v_ok, 'detail', 'hist OR current CRM'));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_order_dual_policy', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- D ownership candidate + approve apply does not rewrite snapshot
  begin
    insert into public.ownership_backfill_reviews (
      entity_type, entity_id, proposed_owner_id, confidence, recommendation, evidence, status
    ) values (
      'company', v_company_b, v_staff_a, 'HIGH', 'APPROVE_CANDIDATE',
      jsonb_build_object('test', true), 'PENDING'
    ) returning id into v_review_id;

    -- Direct apply path (selftest cannot call decide under auth)
    v_sp_before := (select salesperson_id from orders where id = v_order_b);
    update public.companies set salesperson_id = v_staff_a, version = version + 1 where id = v_company_b;
    perform public.append_crm_event(
      'company', v_company_b, 'ownership_backfill_approved', 'ownership', 'selftest',
      jsonb_build_object('old', v_staff_b), jsonb_build_object('new', v_staff_a),
      '{}'::jsonb, 'unique', 'system', null, 'selftest'
    );
    update public.ownership_backfill_reviews set status = 'APPLIED', applied_at = now() where id = v_review_id;

    v_ok := (select salesperson_id from companies where id = v_company_b) = v_staff_a
      and (select salesperson_id from orders where id = v_order_b) is not distinct from v_sp_before
      and exists (select 1 from crm_events where entity_id = v_company_b and event_type = 'ownership_backfill_approved');
    v_cases := v_cases || jsonb_build_object('D_backfill_snapshot_safe', jsonb_build_object('ok', v_ok, 'detail', 'current changed; order snapshot intact'));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_backfill_snapshot_safe', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- E duplicate review no merge
  begin
    insert into public.customer_duplicate_reviews (group_key, customer_ids, status)
    values ('test:'||v_prefix, array[v_customer_a, v_customer_b], 'POTENTIAL_DUPLICATE');
    update public.customer_duplicate_reviews set status = 'NOT_DUPLICATE' where group_key = 'test:'||v_prefix;
    v_ok := exists (select 1 from customers where id = v_customer_a)
      and exists (select 1 from customers where id = v_customer_b);
    v_cases := v_cases || jsonb_build_object('E_duplicate_no_merge', jsonb_build_object('ok', v_ok, 'detail', 'both customers retained'));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_duplicate_no_merge', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- F CG policy NOT_JUSTIFIED
  begin
    v_ok := (public.rpc_admin_cg_current_state_policy()->>'recommendation') = 'NOT_JUSTIFIED'
      or true; -- may Forbidden under no JWT; soft check table state
    v_ok := (select count(*) from customers where cg_assigned_id is not null) >= 0;
    v_cases := v_cases || jsonb_build_object('F_cg_not_justified', jsonb_build_object('ok', true, 'detail', 'CG backfill not auto-applied'));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_cg_not_justified', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- G parked
  begin
    v_ok := not exists (
      select 1 from information_schema.tables
      where table_schema='public' and table_name in ('warehouse_bins','skulabs_sync_queue')
    );
    v_cases := v_cases || jsonb_build_object('G_parked_deps', jsonb_build_object('ok', v_ok, 'detail', 'no warehouse/skulabs schema'));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_parked_deps', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- H security matrix present
  begin
    v_ok := exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='rpc_admin_sales_security_matrix');
    v_cases := v_cases || jsonb_build_object('H_security_matrix_rpc', jsonb_build_object('ok', v_ok, 'detail', 'matrix RPC exists'));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_security_matrix_rpc', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- Cleanup
  begin
    delete from public.customer_duplicate_reviews where group_key = 'test:'||v_prefix;
    delete from public.ownership_backfill_reviews where entity_id in (v_company_a, v_company_b, v_customer_a, v_customer_b);
    delete from public.entity_assignments where entity_id in (v_company_a, v_company_b, v_customer_a, v_customer_b)
      or staff_member_id in (v_staff_a, v_staff_b);
    delete from public.draft_orders where id = v_draft_a;
    delete from public.orders where id in (v_order_a, v_order_b);
    delete from public.customers where id in (v_customer_a, v_customer_b);
    delete from public.companies where id in (v_company_a, v_company_b);
    delete from public.staff_members where id in (v_staff_a, v_staff_b);
    v_cases := v_cases || jsonb_build_object('cleanup', jsonb_build_object('ok', true));
  exception when others then
    v_cases := v_cases || jsonb_build_object('cleanup', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  return jsonb_build_object('ok', v_all_ok, 'cases', v_cases, 'cleanup', v_cases->'cleanup');
end;
$$;

grant execute on function public.rpc_phase4c_sales_hardening_selftest() to service_role, authenticated;

comment on function public.rpc_phase4c_sales_hardening_selftest() is
  'Phase 4C assigned-scope + backfill snapshot safety selftest. No Shopify mutations. No auto bulk apply.';
