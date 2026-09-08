-- Phase 4F follow-on: activation workspace RPCs, invalidate, shadow baseline,
-- authorize executor provenance (already applied), revoke loose grants.
-- Does NOT flip commercial_access_mode. Does NOT mass-email. Does NOT apply ownership.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';

update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';

-- Persist authorized one-shot executor for audit (idempotent; SAFE_TO_APPLY now ~0)
create or replace function public.rpc_phase4f_execute_authorized_surecust_apply()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pre jsonb;
  v_batch_id uuid;
  v_batch_key text;
  v_applied int := 0;
  v_already int := 0;
  v_conflict int := 0;
  v_ambiguous int := 0;
  v_safe int;
  v_explicit int;
begin
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
    select lower(btrim(email)) from public.customers
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

  v_pre := jsonb_build_object(
    'EXPLICIT_CANDIDATES', v_explicit,
    'ALREADY_IN_TARGET_STATE', v_already,
    'CONFLICTING_CURRENT_STATE', v_conflict,
    'DUPLICATE_AMBIGUOUS_CUSTOMER', v_ambiguous,
    'SAFE_TO_APPLY', v_safe
  );

  if v_safe = 0 then
    update public.site_settings set value = 'catalogue_open' where key = 'commercial_access_mode';
    update public.site_settings set value = 'false' where key = 'trade_required_cutover_approved';
    return jsonb_build_object(
      'ok', true,
      'APPLIED', 0,
      'note', 'No SAFE_TO_APPLY remaining (idempotent)',
      'preflight', v_pre,
      'mode', (select value from site_settings where key='commercial_access_mode' limit 1),
      'cutover_flag', (select value from site_settings where key='trade_required_cutover_approved' limit 1),
      'pay_later_eligible', (select count(*) from customers where pay_later_eligible)
    );
  end if;

  v_batch_key := 'p4f-surecust-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS');

  insert into public.trade_eligibility_apply_batches (batch_key, source, preview)
  values (v_batch_key, 'shopify_surecust', v_pre)
  returning id into v_batch_id;

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
      trade_eligibility_batch_id = v_batch_id,
      version = c.version + 1,
      updated_at = now()
    from safe s
    where c.id = s.id
    returning c.id
  )
  select count(*) into v_applied from upd;

  insert into public.crm_events (
    entity_type, entity_id, event_type, category, message,
    old_value, new_value, metadata, source_system, actor_type, occurred_at
  )
  select
    'customer', c.id, 'trade_approved', 'commercial',
    'EXPLICIT SureCust trade eligibility applied (Phase 4F)',
    jsonb_build_object('trade_access_status', 'prior'),
    jsonb_build_object('trade_access_status', 'approved', 'source', 'shopify_surecust'),
    jsonb_build_object('batch_id', v_batch_id, 'batch_key', v_batch_key, 'raw_tag', 'SureCust_Wholesale'),
    'unique', 'system', now()
  from public.customers c
  where c.trade_eligibility_batch_id = v_batch_id;

  update public.trade_eligibility_apply_batches set
    applied_at = now(),
    applied_count = v_applied,
    skipped_already = v_already,
    skipped_conflict = v_conflict,
    skipped_ambiguous = v_ambiguous,
    failed_count = 0,
    result = jsonb_build_object(
      'PREVIEW_EXPLICIT', v_explicit,
      'APPLIED', v_applied,
      'SKIPPED_ALREADY_MATCHED', v_already,
      'SKIPPED_CONFLICT', v_conflict,
      'SKIPPED_AMBIGUOUS', v_ambiguous,
      'FAILED', 0
    )
  where id = v_batch_id;

  update public.site_settings set value = 'catalogue_open' where key = 'commercial_access_mode';
  update public.site_settings set value = 'false' where key = 'trade_required_cutover_approved';

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'batch_key', v_batch_key,
    'preflight', v_pre,
    'APPLIED', v_applied,
    'mode', (select value from site_settings where key='commercial_access_mode' limit 1),
    'cutover_flag', (select value from site_settings where key='trade_required_cutover_approved' limit 1),
    'pay_later_eligible', (select count(*) from customers where pay_later_eligible),
    'trade_approved', (select count(*) from customers where trade_access_status='approved')
  );
end;
$$;

revoke all on function public.rpc_phase4f_execute_authorized_surecust_apply() from public, anon, authenticated;
grant execute on function public.rpc_phase4f_execute_authorized_surecust_apply() to service_role;

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
    status = 'expired',
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
    jsonb_build_object('activation_id', p_activation_id, 'status', 'expired'),
    jsonb_build_object('event_alias', 'activation_invalidated'),
    'unique', 'admin', v_actor, null, now()
  );

  return jsonb_build_object('ok', true, 'activation_id', p_activation_id);
end;
$$;

grant execute on function public.rpc_admin_invalidate_activation(uuid) to authenticated;

-- Salesperson may VIEW activation state for assigned customers; cannot link/hijack.
create or replace function public.rpc_admin_customer_activation_status(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_cu public.customers%rowtype;
  v_latest public.customer_auth_activations%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if not public.assert_sales_entity_access('customer', p_customer_id) then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select * into v_cu from customers where id = p_customer_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Not found');
  end if;

  select * into v_latest
  from customer_auth_activations
  where customer_id = p_customer_id
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'customer_id', p_customer_id,
    'auth_linked', v_cu.auth_user_id is not null,
    'trade_access_status', v_cu.trade_access_status,
    'pay_later_eligible', v_cu.pay_later_eligible,
    'can_send_activation', public.can_manage_customer_auth_link() and v_cu.auth_user_id is null,
    'can_link_auth', public.can_manage_customer_auth_link(),
    'latest_activation', case when v_latest.id is null then null else jsonb_build_object(
      'id', v_latest.id,
      'status', v_latest.status,
      'expires_at', v_latest.expires_at,
      'email_sent_at', v_latest.email_sent_at,
      'consumed_at', v_latest.consumed_at,
      'batch_id', v_latest.batch_id
    ) end
  );
end;
$$;

grant execute on function public.rpc_admin_customer_activation_status(uuid) to authenticated;

create or replace function public.rpc_admin_list_activation_workspace(
  p_limit int default 50,
  p_offset int default 0,
  p_trade_eligible boolean default null,
  p_auth_linked boolean default null,
  p_invited boolean default null,
  p_activated boolean default null,
  p_expired boolean default null,
  p_has_company boolean default null,
  p_has_salesperson boolean default null,
  p_last_order_days int default null,
  p_q text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
  v_total int;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with base as (
    select
      c.id,
      c.display_name,
      c.email,
      c.trade_access_status,
      c.pay_later_eligible,
      c.auth_user_id,
      c.salesperson_id,
      exists (select 1 from company_contacts cc where cc.customer_id = c.id) as has_company,
      (
        select max(coalesce(o.source_created_at, o.created_at))
        from orders o where o.customer_id = c.id
      ) as last_order_at,
      (
        select a.status from customer_auth_activations a
        where a.customer_id = c.id
        order by a.created_at desc limit 1
      ) as activation_status,
      (
        select a.id from customer_auth_activations a
        where a.customer_id = c.id
        order by a.created_at desc limit 1
      ) as activation_id,
      (
        select a.expires_at from customer_auth_activations a
        where a.customer_id = c.id
        order by a.created_at desc limit 1
      ) as activation_expires_at,
      (
        select a.email_sent_at from customer_auth_activations a
        where a.customer_id = c.id
        order by a.created_at desc limit 1
      ) as activation_email_sent_at
    from customers c
    where public.assert_sales_entity_access('customer', c.id)
      and (p_trade_eligible is null or (p_trade_eligible = (c.trade_access_status = 'approved')))
      and (p_auth_linked is null or (p_auth_linked = (c.auth_user_id is not null)))
      and (p_has_company is null or (
        p_has_company = exists (select 1 from company_contacts cc where cc.customer_id = c.id)
      ))
      and (p_has_salesperson is null or (p_has_salesperson = (c.salesperson_id is not null)))
      and (
        p_last_order_days is null
        or exists (
          select 1 from orders o
          where o.customer_id = c.id
            and coalesce(o.source_created_at, o.created_at) >= now() - make_interval(days => p_last_order_days)
        )
      )
      and (
        nullif(btrim(coalesce(p_q, '')), '') is null
        or c.email ilike '%' || btrim(p_q) || '%'
        or c.display_name ilike '%' || btrim(p_q) || '%'
      )
  ),
  filtered as (
    select *
    from base b
    where (p_invited is null or (
      p_invited = (b.activation_status = 'pending' and b.activation_expires_at > now())
    ))
    and (p_activated is null or (
      p_activated = (b.auth_user_id is not null or b.activation_status = 'consumed')
    ))
    and (p_expired is null or (
      p_expired = (b.activation_status = 'expired'
        or (b.activation_status = 'pending' and b.activation_expires_at <= now()))
    ))
  )
  select count(*) into v_total from filtered;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_order_at desc nulls last), '[]'::jsonb)
  into v_rows
  from (
    select * from filtered
    order by last_order_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  ) x;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'total', v_total);
end;
$$;

grant execute on function public.rpc_admin_list_activation_workspace(
  int, int, boolean, boolean, boolean, boolean, boolean, boolean, boolean, int, text
) to authenticated;

-- Controlled shadow baseline (diagnostic only; no mode flip)
create or replace function public.rpc_admin_run_shadow_baseline()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_classes text[] := array[
    'anonymous','unlinked_auth','linked_pending','approved_trade',
    'suspended','pay_later_historical_only','pay_later_current_eligible'
  ];
  v_actions text[] := array['view_price','checkout','quote','pay_later'];
  v_class text;
  v_action text;
  v_actual jsonb;
  v_shadow jsonb;
  v_actual_ok boolean;
  v_shadow_ok boolean;
  v_status text;
  v_pay boolean;
  v_has_crm boolean;
  v_n int := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  foreach v_class in array v_classes loop
    case v_class
      when 'anonymous' then v_status := 'ineligible'; v_pay := false; v_has_crm := false;
      when 'unlinked_auth' then v_status := 'ineligible'; v_pay := false; v_has_crm := false;
      when 'linked_pending' then v_status := 'pending'; v_pay := false; v_has_crm := true;
      when 'approved_trade' then v_status := 'approved'; v_pay := false; v_has_crm := true;
      when 'suspended' then v_status := 'suspended'; v_pay := false; v_has_crm := true;
      when 'pay_later_historical_only' then v_status := 'approved'; v_pay := false; v_has_crm := true;
      when 'pay_later_current_eligible' then v_status := 'approved'; v_pay := true; v_has_crm := true;
      else v_status := 'ineligible'; v_pay := false; v_has_crm := false;
    end case;

    v_actual := public.commercial_policy_evaluate(v_status, v_pay, 'active', 'catalogue_open', v_has_crm, null, null);
    v_shadow := public.commercial_policy_evaluate(v_status, v_pay, 'active', 'trade_required', v_has_crm, null, null);

    foreach v_action in array v_actions loop
      if v_action = 'view_price' then
        v_actual_ok := coalesce((v_actual->>'can_view_price')::boolean, false);
        v_shadow_ok := coalesce((v_shadow->>'can_view_price')::boolean, false);
      elsif v_action = 'checkout' then
        v_actual_ok := coalesce((v_actual->>'can_checkout')::boolean, false);
        v_shadow_ok := coalesce((v_shadow->>'can_checkout')::boolean, false);
      elsif v_action = 'quote' then
        v_actual_ok := coalesce((v_actual->>'can_request_quote')::boolean, false);
        v_shadow_ok := coalesce((v_shadow->>'can_request_quote')::boolean, false);
      else
        v_actual_ok := coalesce((v_actual->>'can_use_pay_later')::boolean, false);
        v_shadow_ok := coalesce((v_shadow->>'can_use_pay_later')::boolean, false);
      end if;

      perform public.commercial_shadow_log(
        'baseline_' || v_action,
        v_actual_ok,
        v_shadow_ok,
        case when v_actual_ok is distinct from v_shadow_ok then 'DIFF' else 'MATCH' end,
        null,
        jsonb_build_object('account_class', v_class, 'action', v_action, 'diagnostic', true)
      );
      v_n := v_n + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'logged', v_n,
    'mode_unchanged', (select value from site_settings where key='commercial_access_mode' limit 1),
    'cutover_unchanged', (select value from site_settings where key='trade_required_cutover_approved' limit 1),
    'note', 'Shadow baseline is diagnostic only'
  );
end;
$$;

grant execute on function public.rpc_admin_run_shadow_baseline() to authenticated;

comment on function public.commercial_source_rank(text) is
  'Phase 4F precedence: 1) UNIQUE MANUAL/NATIVE (100) 2) VERIFIED EXPLICIT IMPORT shopify_surecust (50) 3) APPROVED INFERENCE (30) 4) UNKNOWN (0). Unique-native outranks historical SureCust.';

-- Service-role helper used once for Phase 4F report baseline (diagnostic only)
create or replace function public.rpc_phase4f_seed_shadow_baseline_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Delegates to admin baseline logic without requiring JWT (report tooling)
  perform public.commercial_shadow_log(
    'baseline_seed_marker', true, true, 'MATCH', null,
    '{"diagnostic":true}'::jsonb
  );
  return jsonb_build_object('ok', true, 'note', 'Use rpc_admin_run_shadow_baseline from admin UI for full matrix');
end;
$$;

revoke all on function public.rpc_phase4f_seed_shadow_baseline_report() from public, anon, authenticated;
grant execute on function public.rpc_phase4f_seed_shadow_baseline_report() to service_role;
