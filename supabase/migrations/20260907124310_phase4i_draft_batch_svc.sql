-- Phase 4I: service_role may prepare draft pilot batch / preview / kill-switch docs (still no email)
create or replace function public.rpc_admin_create_pilot_batch_from_proposal(
  p_proposal_key text default 'PHASE4I_PILOT_001',
  p_issue_tokens boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prop public.pilot_cohort_proposals%rowtype;
  v_actor uuid;
  v_batch_id uuid;
  v_cid uuid;
  v_n int := 0;
  v_act jsonb;
  v_is_svc boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if not v_is_svc then
    if not public.is_admin() or not public.can_manage_customer_auth_link() then
      return jsonb_build_object('ok', false, 'error', 'Forbidden');
    end if;
  end if;

  select * into v_prop from pilot_cohort_proposals where proposal_key = p_proposal_key;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'PROPOSAL_NOT_FOUND');
  end if;
  if v_prop.batch_id is not null then
    return jsonb_build_object('ok', false, 'error', 'BATCH_ALREADY_CREATED', 'batch_id', v_prop.batch_id);
  end if;

  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  insert into public.customer_activation_batches (
    batch_key, batch_name, rollout_mode, status, note, created_by, recipient_count
  ) values (
    p_proposal_key || '-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'),
    p_proposal_key,
    'PILOT',
    'draft',
    'Phase 4I immutable pilot batch — send gated by pilot_send_authorized',
    v_actor,
    coalesce(array_length(v_prop.recipient_ids, 1), 0)
  ) returning id into v_batch_id;

  foreach v_cid in array v_prop.recipient_ids
  loop
    if p_issue_tokens then
      if v_is_svc then
        insert into public.customer_activation_batch_recipients (batch_id, customer_id, status, error)
        values (v_batch_id, v_cid, 'queued', 'tokens_require_admin_session');
        continue;
      end if;
      v_act := public.rpc_admin_create_customer_auth_activation(v_cid, 168, 'pilot_batch '||v_batch_id::text);
      if coalesce((v_act->>'ok')::boolean, false) then
        update public.customer_auth_activations set batch_id = v_batch_id
        where id = (v_act->>'activation_id')::uuid;
        insert into public.customer_activation_batch_recipients (
          batch_id, customer_id, activation_id, status
        ) values (v_batch_id, v_cid, (v_act->>'activation_id')::uuid, 'queued');
        v_n := v_n + 1;
      else
        insert into public.customer_activation_batch_recipients (batch_id, customer_id, status, error)
        values (v_batch_id, v_cid, 'skipped', left(coalesce(v_act->>'error','issue_failed'), 200));
      end if;
    else
      insert into public.customer_activation_batch_recipients (batch_id, customer_id, status)
      values (v_batch_id, v_cid, 'queued');
      v_n := v_n + 1;
    end if;
  end loop;

  update public.pilot_cohort_proposals set
    batch_id = v_batch_id,
    updated_at = now()
  where id = v_prop.id;

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'batch_name', p_proposal_key,
    'recipient_count', v_n,
    'tokens_issued', p_issue_tokens and not v_is_svc,
    'send_status', 'NOT_SENT',
    'PILOT_SEND_STATUS', 'READY — OWNER APPROVAL REQUIRED'
  );
end;
$$;

create or replace function public.rpc_admin_preview_next_activation_cohort(p_limit int default 50)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with last_order as (
    select customer_id, max(coalesce(source_created_at, created_at)) as last_at
    from orders group by 1
  ),
  email_dups as (
    select lower(btrim(email)) e from customers
    where email is not null and btrim(email) <> ''
    group by 1 having count(*) > 1
  )
  select count(*) into v_count
  from customers c
  join last_order lo on lo.customer_id = c.id
  where c.trade_access_status = 'approved'
    and c.auth_user_id is null
    and c.status = 'active'
    and nullif(btrim(coalesce(c.email, '')), '') is not null
    and lower(btrim(c.email)) not in (select e from email_dups)
    and lo.last_at >= now() - interval '30 days';

  return jsonb_build_object(
    'ok', true,
    'tier', 'A_30d',
    'preview_count', v_count,
    'sample_limit', least(coalesce(p_limit, 50), 100),
    'auto_send', false,
    'note', 'PREVIEW ONLY — separate authorization required.'
  );
end;
$$;

create or replace function public.rpc_admin_cutover_kill_switch_procedure()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  return jsonb_build_object(
    'ok', true,
    'procedure', jsonb_build_array(
      'UPDATE site_settings SET value = ''catalogue_open'' WHERE key = ''commercial_access_mode'';',
      'UPDATE site_settings SET value = ''false'' WHERE key = ''trade_required_cutover_approved'';',
      'Purge CDN/ISR caches for product/collection pages if applicable',
      'Smoke: anon price visible again under catalogue_open',
      'Confirm CRM trade statuses, auth links, activation records RETAINED'
    ),
    'does_not_rollback', jsonb_build_array(
      'trade_access_status','auth_user_id links','activation tokens/history','audit events','SureCust provenance'
    ),
    'current_mode', (select value from site_settings where key='commercial_access_mode' limit 1),
    'current_flag', (select value from site_settings where key='trade_required_cutover_approved' limit 1),
    'effective_mode', public.effective_commercial_access_mode(null)
  );
end;
$$;
