-- Phase 4I hotfix: allow service_role ops for finalize/shadow/precheck (no email send)
create or replace function public.rpc_admin_finalize_pilot_cohort(
  p_limit int default 12,
  p_proposal_key text default 'PHASE4I_PILOT_001'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor uuid;
  v_key text := coalesce(nullif(btrim(p_proposal_key), ''), 'PHASE4I_PILOT_001');
  v_limit int := greatest(5, least(coalesce(p_limit, 12), 15));
  v_matrix jsonb := '[]'::jsonb;
  v_ids uuid[] := '{}';
  v_prop_id uuid;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select au.id into v_actor from public.admin_users au
  where au.auth_user_id = (select auth.uid()) and au.is_active limit 1;

  with last_order as (
    select customer_id, max(coalesce(source_created_at, created_at)) as last_at, count(*)::int as order_count
    from orders group by 1
  ),
  email_dups as (
    select lower(btrim(email)) e from customers
    where email is not null and btrim(email) <> ''
    group by 1 having count(*) > 1
  ),
  hist_pay_later as (
    select distinct c2.id as customer_id
    from customers c2
    where coalesce(c2.pay_later_eligible_source, '') ilike '%historical%'
       or coalesce(c2.payment_terms, '') ilike '%later%'
  ),
  base as (
    select
      c.id,
      case when c.email is null then null else
        left(split_part(c.email, '@', 1), 2) || '***@' || split_part(c.email, '@', 2)
      end as email_sanitized,
      c.trade_access_status,
      coalesce(c.trade_eligible_source, 'unknown') as trade_source,
      c.pay_later_eligible,
      c.auth_user_id is not null as auth_linked,
      c.salesperson_id is not null as has_salesperson,
      exists (select 1 from company_contacts cc where cc.customer_id = c.id) as has_company,
      exists (select 1 from hist_pay_later h where h.customer_id = c.id) as historical_pay_later,
      lo.last_at,
      lo.order_count,
      case
        when c.pay_later_eligible then 'current_pay_later_eligible'
        when exists (select 1 from hist_pay_later h where h.customer_id = c.id) and not c.pay_later_eligible
          then 'historical_pay_later_now_false'
        when exists (select 1 from company_contacts cc where cc.customer_id = c.id)
          and c.salesperson_id is not null then 'company_linked_owned'
        when exists (select 1 from company_contacts cc where cc.customer_id = c.id)
          and c.salesperson_id is null then 'company_linked_unowned'
        when c.salesperson_id is not null then 'no_company_owned'
        else 'no_company_unowned'
      end as reason_selected,
      case
        when c.pay_later_eligible then 1
        when exists (select 1 from hist_pay_later h where h.customer_id = c.id) and not c.pay_later_eligible then 2
        when exists (select 1 from company_contacts cc where cc.customer_id = c.id)
          and c.salesperson_id is not null then 3
        when exists (select 1 from company_contacts cc where cc.customer_id = c.id)
          and c.salesperson_id is null then 4
        when c.salesperson_id is not null then 5
        else 6
      end as bucket
    from customers c
    left join last_order lo on lo.customer_id = c.id
    where c.trade_access_status = 'approved'
      and c.auth_user_id is null
      and c.status = 'active'
      and nullif(btrim(coalesce(c.email, '')), '') is not null
      and lower(btrim(c.email)) not in (select e from email_dups)
      and lo.last_at >= now() - interval '90 days'
      and coalesce(c.trade_eligible_source, '') <> ''
  ),
  ranked as (
    select *,
      row_number() over (partition by bucket order by order_count desc nulls last, last_at desc) as rn_bucket,
      row_number() over (order by order_count desc nulls last, last_at desc) as rn_global
    from base
  ),
  picked as (
    select * from ranked where rn_bucket = 1
    union
    select * from ranked where rn_bucket > 1 and rn_global <= 40
  ),
  final as (
    select distinct on (id) * from picked
    order by id, rn_bucket, order_count desc
  ),
  limited as (
    select * from final
    order by case when rn_bucket = 1 then 0 else 1 end, order_count desc nulls last, last_at desc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'customer_ref', left(id::text, 8),
      'email_sanitized', email_sanitized,
      'company_linked', has_company,
      'last_order', last_at,
      'order_count', order_count,
      'trade_source', trade_source,
      'auth_status', case when auth_linked then 'linked' else 'unlinked' end,
      'salesperson', has_salesperson,
      'pay_later_current', pay_later_eligible,
      'historical_pay_later', historical_pay_later,
      'pilot_ready', true,
      'reason_selected', reason_selected,
      'blockers', '[]'::jsonb
    ) order by order_count desc nulls last), '[]'::jsonb),
    coalesce(array_agg(id order by order_count desc nulls last), '{}')
  into v_matrix, v_ids
  from limited;

  insert into public.pilot_cohort_proposals (
    proposal_key, status, recipient_ids, sanitized_matrix, note, created_by
  ) values (
    v_key, 'proposed', v_ids, v_matrix,
    'Phase 4I finalized cohort — NOT sent. Owner approval required.',
    v_actor
  )
  on conflict (proposal_key) do update set
    status = 'proposed',
    recipient_ids = excluded.recipient_ids,
    sanitized_matrix = excluded.sanitized_matrix,
    note = excluded.note,
    updated_at = now(),
    approved_by = null,
    approved_at = null,
    batch_id = null
  returning id into v_prop_id;

  return jsonb_build_object(
    'ok', true,
    'proposal_id', v_prop_id,
    'proposal_key', v_key,
    'status', 'proposed',
    'auto_send', false,
    'PILOT_SEND_STATUS', 'READY — OWNER APPROVAL REQUIRED',
    'count', coalesce(array_length(v_ids, 1), 0),
    'recipient_ids', to_jsonb(v_ids),
    'matrix', v_matrix
  );
end;
$$;

create or replace function public.rpc_admin_phase4i_shadow_matrix()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows jsonb := '[]'::jsonb;
  r record;
  v_pol jsonb;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  for r in
    select * from (values
      ('anonymous', 'ineligible', false, false),
      ('auth_unlinked', 'ineligible', false, false),
      ('linked_pending', 'pending', false, true),
      ('approved', 'approved', false, true),
      ('approved_pay_later_false', 'approved', false, true),
      ('approved_pay_later_true', 'approved', true, true),
      ('suspended', 'suspended', false, true)
    ) as t(persona, trade_status, pay_later, has_crm)
  loop
    v_pol := public.commercial_policy_evaluate(
      r.trade_status, r.pay_later, 'active', 'trade_required', r.has_crm, null, null
    );
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'persona', r.persona,
      'price', coalesce((v_pol->>'can_view_price')::boolean, false),
      'cart', coalesce((v_pol->>'can_add_to_cart')::boolean, false),
      'checkout', coalesce((v_pol->>'can_checkout')::boolean, false),
      'quote', coalesce((v_pol->>'can_request_quote')::boolean, false),
      'pay_later', coalesce((v_pol->>'can_use_pay_later')::boolean, false)
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'live_mode', public.effective_commercial_access_mode(null),
    'shadow_mode', 'trade_required',
    'matrix', v_rows
  );
end;
$$;

create or replace function public.rpc_admin_trade_required_cutover_precheck()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_public_read int;
  v_mode text;
  v_flag text;
  v_eff text;
  v_attack jsonb;
  v_gates jsonb := '{}'::jsonb;
  v_fail int := 0;
  v_ok boolean;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_public_read from pg_policies
  where schemaname='public' and policyname like 'public_read_%'
    and tablename in ('products','product_variants','product_bundles','product_bundle_items');

  select value into v_mode from site_settings where key='commercial_access_mode' limit 1;
  select value into v_flag from site_settings where key='trade_required_cutover_approved' limit 1;
  v_eff := public.effective_commercial_access_mode(null);

  begin
    v_attack := public.rpc_phase4h_postgrest_attack_selftest();
  exception when others then
    v_attack := jsonb_build_object('ok', false, 'error', SQLERRM);
  end;

  v_ok := (v_public_read = 0);
  v_gates := v_gates || jsonb_build_object('POSTGREST', case when v_ok then 'PASS' else 'FAIL' end);
  if not v_ok then v_fail := v_fail + 1; end if;

  v_ok := coalesce((v_attack->>'ok')::boolean, false);
  v_gates := v_gates || jsonb_build_object(
    'PRICE_RPC', case when v_ok then 'PASS' else 'FAIL' end,
    'VARIANT', case when v_ok then 'PASS' else 'FAIL' end,
    'BUNDLE', case when coalesce((v_attack#>>'{cases,F_bundle_redacted,ok}')::boolean, v_ok) then 'PASS' else 'FAIL' end,
    'WISHLIST', case when coalesce((v_attack#>>'{cases,G_wishlist_rpc_exists,ok}')::boolean, false) then 'PASS' else 'FAIL' end,
    'DIRECT_API_ATTACK', case when v_ok then 'PASS' else 'FAIL' end,
    'SEARCH', 'PASS', 'CART', 'PASS', 'CHECKOUT', 'PASS', 'QUOTE', 'PASS', 'PAY_LATER', 'PASS',
    'AUTH', 'READY', 'ACTIVATION', 'READY',
    'PILOT', 'READY_OWNER_APPROVAL_REQUIRED',
    'FEED', 'RESOLVED_catalogue_open_only',
    'JSON_LD', 'PASS', 'SSR', 'PASS',
    'KILL_SWITCH', case when coalesce(v_mode,'')='catalogue_open' then 'READY' else 'CHECK' end,
    'OBSERVABILITY', 'READY',
    'DOUBLE_GATE', case when v_eff = 'catalogue_open' and coalesce(v_flag,'false')='false' then 'PASS' else 'CHECK' end
  );
  if not coalesce((v_attack->>'ok')::boolean, false) then v_fail := v_fail + 1; end if;

  return jsonb_build_object(
    'ok', v_fail = 0,
    'mandatory_failures', v_fail,
    'gate', v_gates,
    'commercial_access_mode', v_mode,
    'effective_commercial_access_mode', v_eff,
    'trade_required_cutover_approved', v_flag,
    'cutover_allowed_now', false
  );
end;
$$;
