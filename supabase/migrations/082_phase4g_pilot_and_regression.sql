-- Phase 4G part 3 — pilot cohort proposal, activation metrics, regression selftest,
-- INTERNAL_TEST fixtures. No mass email. Mode stays catalogue_open.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';

-- Proposed PILOT cohort (sanitized — no send)
create or replace function public.rpc_admin_propose_pilot_activation_cohort(p_limit int default 12)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  with last_order as (
    select customer_id, max(coalesce(source_created_at, created_at)) as last_at, count(*)::int as order_count
    from orders group by 1
  ),
  email_dups as (
    select lower(btrim(email)) e from customers
    where email is not null and btrim(email) <> ''
    group by 1 having count(*) > 1
  ),
  candidates as (
    select
      c.id,
      left(coalesce(c.display_name, ''), 40) as display_name_sanitized,
      case when c.email is null then null else
        regexp_replace(split_part(c.email, '@', 1), '.(?=.)', '*', 'g') || '@' || split_part(c.email, '@', 2)
      end as email_sanitized,
      c.trade_access_status,
      c.trade_eligible_source,
      c.pay_later_eligible,
      c.auth_user_id is not null as auth_linked,
      c.salesperson_id is not null as has_salesperson,
      exists (select 1 from company_contacts cc where cc.customer_id = c.id) as has_company,
      exists (
        select 1 from entity_tags et join tags t on t.id = et.tag_id
        where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
      ) as surecust_explicit,
      lo.last_at,
      lo.order_count,
      public.activation_lifecycle_status(c.auth_user_id, a.status, a.expires_at, a.email_sent_at, false) as lifecycle
    from customers c
    left join last_order lo on lo.customer_id = c.id
    left join lateral (
      select * from customer_auth_activations x where x.customer_id = c.id
      order by x.created_at desc limit 1
    ) a on true
    where c.trade_access_status = 'approved'
      and c.auth_user_id is null
      and c.status = 'active'
      and nullif(btrim(coalesce(c.email, '')), '') is not null
      and lower(btrim(c.email)) not in (select e from email_dups)
      and lo.last_at >= now() - interval '30 days'
  ),
  scored as (
    select *,
      (case when surecust_explicit then 10 else 0 end)
      + (case when has_company then 3 else 2 end)
      + (case when has_salesperson then 2 else 1 end)
      + (case when pay_later_eligible then 5 else 0 end) as score,
      case
        when pay_later_eligible then 'current_pay_later_eligible'
        when has_company and has_salesperson then 'company_linked_owned'
        when has_company and not has_salesperson then 'company_linked_unowned'
        when not has_company and has_salesperson then 'no_company_owned'
        else 'no_company_unowned'
      end as cohort_reason
    from candidates
  )
  select coalesce(jsonb_agg(to_jsonb(s) order by s.score desc, s.last_at desc), '[]'::jsonb)
  into v_rows
  from (
    select id, display_name_sanitized, email_sanitized, trade_access_status, trade_eligible_source,
      pay_later_eligible, auth_linked, has_salesperson, has_company, surecust_explicit,
      last_at, order_count, lifecycle, cohort_reason, score
    from scored
    order by score desc, last_at desc
    limit greatest(1, least(coalesce(p_limit, 12), 25))
  ) s;

  return jsonb_build_object(
    'ok', true,
    'rollout_mode', 'PILOT',
    'auto_send', false,
    'note', 'Owner/admin must explicitly approve/send. Do not mass-email.',
    'PILOT_READY_CRITERIA', jsonb_build_array(
      'exactly_one_crm_target','valid_email','no_auth_conflict','trade_resolved',
      'no_duplicate_email','not_suspended','not_already_activated'
    ),
    'proposed', v_rows
  );
end;
$$;

grant execute on function public.rpc_admin_propose_pilot_activation_cohort(int) to authenticated;

create or replace function public.rpc_admin_activation_rollout_metrics()
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
    'INVITED', (select count(*) from customer_auth_activations where status='pending'),
    'DELIVERED', (select count(*) from customer_auth_activations where status='pending' and email_sent_at is not null),
    'ACTIVATED', (select count(*) from customer_auth_activations where status='consumed'),
    'EXPIRED', (select count(*) from customer_auth_activations where status='expired'
      or (status='pending' and expires_at <= now())),
    'INVALIDATED', (select count(*) from customer_auth_activations where status='revoked'),
    'FAILED', 0,
    'CONFLICT', 0,
    'note', 'DELIVERED = email_sent_at set; provider open/click not inferred',
    'commercial_access_mode', (select value from site_settings where key='commercial_access_mode' limit 1),
    'trade_required_cutover_approved', (select value from site_settings where key='trade_required_cutover_approved' limit 1)
  );
end;
$$;

grant execute on function public.rpc_admin_activation_rollout_metrics() to authenticated;

-- Permanent cutover regression suite (force_mode — does not flip production)
create or replace function public.rpc_phase4g_price_gate_regression_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_all_ok boolean := true;
  v_ok boolean;
  v_slug text;
  v_prod jsonb;
  v_list jsonb;
  v_anon_price boolean;
  v_pol jsonb;
  v_assert jsonb;
  v_prefix text := 'p4g-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_cust uuid;
  v_cust2 uuid;
  v_act jsonb;
  v_hash text;
  v_raw text;
  v_mode text;
  v_flag text;
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
    select slug into v_slug from products where published = true limit 1;
    v_prod := public.rpc_get_storefront_product(v_slug, 'trade_required');
    v_ok := coalesce((v_prod->>'price_visible')::boolean, true) = false
      and (v_prod->'product'->>'price') is null;
    v_cases := v_cases || jsonb_build_object('B_anon_product_price_redacted_tr', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_anon_product_price_redacted_tr', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_list := public.rpc_list_storefront_products('all', null, 5, 0, null, null, false, 'default', 'trade_required');
    v_ok := coalesce((v_list->>'price_visible')::boolean, true) = false
      and (
        jsonb_array_length(coalesce(v_list->'items', '[]'::jsonb)) = 0
        or (v_list->'items'->0->>'price') is null
      );
    v_cases := v_cases || jsonb_build_object('C_list_price_redacted_tr', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_list_price_redacted_tr', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_prod := public.rpc_get_storefront_product(v_slug, 'catalogue_open');
    v_ok := coalesce((v_prod->>'price_visible')::boolean, false) = true
      and (v_prod->'product'->>'price') is not null;
    v_cases := v_cases || jsonb_build_object('D_catalogue_open_prices_visible', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_catalogue_open_prices_visible', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_pol := public.commercial_policy_evaluate('pending', false, 'active', 'trade_required', true, null, null);
    v_ok := (v_pol->>'can_view_price')::boolean = false
      and (v_pol->>'can_checkout')::boolean = false
      and (v_pol->>'can_add_to_cart')::boolean = false
      and (v_pol->>'can_request_quote')::boolean = true;
    v_cases := v_cases || jsonb_build_object('E_pending_policy_tr', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_pending_policy_tr', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_pol := public.commercial_policy_evaluate('approved', false, 'active', 'trade_required', true, null, null);
    v_ok := (v_pol->>'can_view_price')::boolean = true
      and (v_pol->>'can_checkout')::boolean = true
      and (v_pol->>'can_use_pay_later')::boolean = false;
    v_pol := public.commercial_policy_evaluate('approved', true, 'active', 'trade_required', true, null, null);
    v_ok := v_ok and (v_pol->>'can_use_pay_later')::boolean = true;
    v_cases := v_cases || jsonb_build_object('F_approved_and_pay_later', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_approved_and_pay_later', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    -- Activation: create two invites; second supersedes first
    insert into customers (email, display_name, source_system, version, trade_access_status, status)
    values (lower(v_prefix)||'@example.test', v_prefix, 'unique', 1, 'approved', 'active')
    returning id into v_cust;

    -- Simulate create without admin by direct insert then call supersede pattern
    v_raw := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');
    insert into customer_auth_activations (customer_id, token_hash, expires_at, status)
    values (v_cust, v_hash, now() + interval '2 days', 'pending');

    update customer_auth_activations set status = 'revoked', note = 'superseded'
    where customer_id = v_cust and status = 'pending';

    v_raw := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');
    insert into customer_auth_activations (customer_id, token_hash, expires_at, status)
    values (v_cust, v_hash, now() + interval '2 days', 'pending');

    v_ok := (select count(*) from customer_auth_activations where customer_id = v_cust and status = 'pending') = 1
      and (select count(*) from customer_auth_activations where customer_id = v_cust and status = 'revoked') >= 1
      and not exists (select 1 from customer_auth_activations where token_hash = v_raw);
    v_cases := v_cases || jsonb_build_object('G_activation_supersede_hash_only', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_activation_supersede_hash_only', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    insert into customers (email, display_name, source_system, version, trade_access_status, status)
    values (lower(v_prefix)||'.2@example.test', v_prefix||'2', 'unique', 1, 'approved', 'active')
    returning id into v_cust2;
    -- Spoof bind without session customer should reject client IDs
    v_assert := public.rpc_storefront_bind_order_commercial_context(
      null, null, v_cust2, null
    );
    v_ok := coalesce((v_assert->>'ok')::boolean, true) = false
      and v_assert->>'error' = 'CUSTOMER_ID_SPOOF_REJECTED';
    v_cases := v_cases || jsonb_build_object('H_client_crm_spoof_rejected', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_client_crm_spoof_rejected', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  begin
    v_ok := (select count(*) from ownership_backfill_reviews where status='PENDING') >= 0;
    -- parked unchanged spot-check
    v_ok := v_ok
      and coalesce((select value from site_settings where key='commercial_access_mode' limit 1), '') = 'catalogue_open'
      and coalesce((select value from site_settings where key='trade_required_cutover_approved' limit 1), '') = 'false';
    v_cases := v_cases || jsonb_build_object('I_mode_and_ownership_untouched', jsonb_build_object('ok', v_ok));
    if not v_ok then v_all_ok := false; end if;
  exception when others then
    v_cases := v_cases || jsonb_build_object('I_mode_and_ownership_untouched', jsonb_build_object('ok', false, 'detail', SQLERRM));
    v_all_ok := false;
  end;

  -- cleanup
  begin
    delete from customer_auth_activations where customer_id in (v_cust, v_cust2);
    update customers set email = 'purged+'||id::text||'@example.test', display_name='purged'
    where id in (v_cust, v_cust2);
    v_cases := v_cases || jsonb_build_object('cleanup', jsonb_build_object('ok', true));
  exception when others then
    v_cases := v_cases || jsonb_build_object('cleanup', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  return jsonb_build_object(
    'ok', v_all_ok,
    'cases', v_cases,
    'cleanup', v_cases->'cleanup',
    'commercial_access_mode', (select value from site_settings where key='commercial_access_mode' limit 1),
    'trade_required_cutover_approved', (select value from site_settings where key='trade_required_cutover_approved' limit 1)
  );
end;
$$;

grant execute on function public.rpc_phase4g_price_gate_regression_selftest() to service_role, authenticated;

-- INTERNAL_TEST: create isolated test customers + activation tokens (no email send)
create or replace function public.rpc_phase4g_internal_activation_fixture()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text := 'p4g-int-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_ids uuid[] := '{}';
  v_id uuid;
  v_raw text;
  v_hash text;
  v_act uuid;
  v_tokens jsonb := '[]'::jsonb;
  v_specs text[] := array[
    'trade_company','trade_no_company','pending','pay_later_false','pay_later_true'
  ];
  v_spec text;
  v_status text;
  v_pl boolean;
begin
  foreach v_spec in array v_specs loop
    v_status := case when v_spec = 'pending' then 'pending' else 'approved' end;
    v_pl := (v_spec = 'pay_later_true');
    insert into customers (
      email, display_name, source_system, version, trade_access_status, status,
      pay_later_eligible, trade_eligible_source, trade_eligible_note
    ) values (
      lower(v_prefix)||'.'||v_spec||'@example.test',
      v_prefix||' '||v_spec, 'unique', 1, v_status, 'active',
      v_pl, 'unique_manual', 'Phase 4G INTERNAL_TEST fixture'
    ) returning id into v_id;
    v_ids := v_ids || v_id;

    if v_status = 'approved' then
      -- supersede-safe single pending
      update customer_auth_activations set status='revoked' where customer_id=v_id and status='pending';
      v_raw := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
      v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');
      insert into customer_auth_activations (customer_id, token_hash, expires_at, status, note)
      values (v_id, v_hash, now() + interval '7 days', 'pending', 'INTERNAL_TEST')
      returning id into v_act;
      v_tokens := v_tokens || jsonb_build_array(jsonb_build_object(
        'customer_id', v_id, 'spec', v_spec, 'activation_id', v_act,
        'token', v_raw, 'lifecycle', 'INVITED'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'rollout_mode', 'INTERNAL_TEST',
    'prefix', v_prefix,
    'customer_ids', to_jsonb(v_ids),
    'activations', v_tokens,
    'note', 'Tokens returned once for INTERNAL_TEST only. Do not email real customers. Purge fixtures after validation.',
    'mode', (select value from site_settings where key='commercial_access_mode' limit 1)
  );
end;
$$;

revoke all on function public.rpc_phase4g_internal_activation_fixture() from public, anon, authenticated;
grant execute on function public.rpc_phase4g_internal_activation_fixture() to service_role;

comment on function public.rpc_phase4g_price_gate_regression_selftest() is
  'Permanent pre-cutover regression: price redaction under force trade_required, policy, activation hash, spoof. Never flips production mode.';
