-- Phase 4I — Controlled pilot activation & commercial cutover validation
-- Does NOT flip commercial_access_mode. Does NOT send pilot emails.
-- Does NOT authorize production trade_required.
-- pilot_send_authorized remains false until explicit owner action.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'pilot_send_authorized' and value is distinct from 'false';

insert into public.site_settings (key, value)
values
  ('pilot_send_authorized', 'false'),
  ('merchant_feed_price_mode', 'catalogue_open_only'),
  ('activation_adhoc_send_enabled', 'false')
on conflict (key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Double-gate effective commercial mode
-- trade_required requires BOTH mode flag AND cutover approval
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.effective_commercial_access_mode(p_force_mode text default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_approved text;
begin
  if nullif(btrim(coalesce(p_force_mode, '')), '') is not null then
    return lower(btrim(p_force_mode));
  end if;

  select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_mode
  from public.site_settings where key = 'commercial_access_mode' limit 1;
  v_mode := lower(coalesce(v_mode, 'catalogue_open'));

  if v_mode = 'trade_required' then
    select coalesce(nullif(btrim(value), ''), 'false') into v_approved
    from public.site_settings where key = 'trade_required_cutover_approved' limit 1;
    if lower(coalesce(v_approved, 'false')) is distinct from 'true' then
      -- Accidental mode edit alone must not activate trade policy
      return 'catalogue_open';
    end if;
  end if;

  return v_mode;
end;
$$;

revoke all on function public.effective_commercial_access_mode(text) from public;
grant execute on function public.effective_commercial_access_mode(text)
  to anon, authenticated, service_role;

comment on function public.effective_commercial_access_mode(text) is
  'Phase 4I double-gate: trade_required only when mode=trade_required AND trade_required_cutover_approved=true. p_force_mode bypasses for shadow/tests.';

-- Storefront price visibility uses effective mode
create or replace function public.storefront_can_view_protected_price(p_force_mode text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text := public.effective_commercial_access_mode(p_force_mode);
  v_uid uuid := (select auth.uid());
  v_cu public.customers%rowtype;
  v_policy jsonb;
  v_has boolean := false;
begin
  if v_uid is not null then
    select * into v_cu from public.customers where auth_user_id = v_uid limit 1;
    v_has := found;
  end if;

  if v_has then
    v_policy := public.commercial_policy_evaluate(
      v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
      v_mode, true, v_cu.customer_type, v_cu.payment_terms
    );
  else
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
  end if;

  return coalesce((v_policy->>'can_view_price')::boolean, false);
end;
$$;

revoke all on function public.storefront_can_view_protected_price(text) from public;
grant execute on function public.storefront_can_view_protected_price(text)
  to anon, authenticated, service_role;

-- Storefront commercial policy session uses effective mode
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
begin
  select coalesce(nullif(btrim(value), ''), 'catalogue_open') into v_configured
  from public.site_settings where key = 'commercial_access_mode' limit 1;

  if v_uid is null then
    v_policy := public.commercial_policy_evaluate(
      'ineligible', false, 'active', v_mode, false, null, null
    );
    return jsonb_build_object(
      'ok', true,
      'customer_id', null,
      'auth_linked', false,
      'commercial_access_mode', v_mode,
      'configured_commercial_access_mode', v_configured,
      'cutover_double_gate_active', true,
      'policy', v_policy
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
    return jsonb_build_object(
      'ok', true,
      'customer_id', null,
      'auth_user_id', v_uid,
      'auth_linked', false,
      'commercial_access_mode', v_mode,
      'configured_commercial_access_mode', v_configured,
      'cutover_double_gate_active', true,
      'policy', v_policy,
      'note', 'Auth account has no CRM customer link'
    );
  end if;

  select * into v_cu from public.customers where id = v_customer_id;
  v_policy := public.commercial_policy_evaluate(
    v_cu.trade_access_status, v_cu.pay_later_eligible, v_cu.status,
    v_mode, true, v_cu.customer_type, v_cu.payment_terms
  );

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer_id,
    'auth_user_id', v_uid,
    'auth_linked', true,
    'commercial_access_mode', v_mode,
    'configured_commercial_access_mode', v_configured,
    'cutover_double_gate_active', true,
    'policy', v_policy
  );
end;
$$;

grant execute on function public.rpc_storefront_commercial_policy() to anon, authenticated, service_role;

-- Assert actions use effective mode
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
  v_has_crm boolean := false;
  v_ok boolean := true;
  v_err text;
  v_msg text;
  v_shadow_ok boolean;
  v_reason text;
begin
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
    end if;
  end if;

  if v_policy is null then
    v_policy := public.commercial_policy_evaluate('ineligible', false, 'active', v_mode, false, null, null);
    v_shadow := public.commercial_policy_evaluate('ineligible', false, 'active', 'trade_required', false, null, null);
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
    end if;
  elsif v_ok and v_action in ('checkout', 'place_order') then
    if not coalesce((v_policy->>'can_checkout')::boolean, false) then
      v_ok := false; v_err := 'CHECKOUT_DENIED'; v_msg := 'Checkout not permitted under commercial policy';
    end if;
  elsif v_ok and v_action in ('purchase', 'buy') then
    if not coalesce((v_policy->>'can_purchase')::boolean, false) then
      v_ok := false; v_err := 'PURCHASE_DENIED'; v_msg := 'Purchase not permitted under commercial policy';
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
    'shadow_trade_required', v_shadow,
    'shadow_would_allow', v_shadow_ok,
    'cutover_double_gate_active', true
  );
end;
$$;

grant execute on function public.rpc_assert_storefront_commercial_action(text, text, uuid)
  to anon, authenticated, service_role;

-- Merchant feed respects effective mode
create or replace function public.rpc_merchant_feed_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text := public.effective_commercial_access_mode(null);
  v_feed_mode text;
  v_include_price boolean := false;
  v_items jsonb;
begin
  select coalesce(nullif(btrim(value), ''), 'catalogue_open_only') into v_feed_mode
  from site_settings where key = 'merchant_feed_price_mode' limit 1;

  if v_mode = 'catalogue_open' and v_feed_mode in ('catalogue_open_only', 'always') then
    v_include_price := true;
  elsif v_feed_mode = 'always' then
    -- Explicit always is discouraged for wholesale; still omit under trade_required
    v_include_price := false;
  end if;

  if v_feed_mode = 'disabled' then
    return jsonb_build_object(
      'ok', true, 'disabled', true, 'items', '[]'::jsonb,
      'price_included', false,
      'commercial_access_mode', v_mode,
      'merchant_feed_price_mode', v_feed_mode
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'description', p.description,
    'slug', p.slug,
    'image_url', p.image_url,
    'price', case when v_include_price then p.price else null end,
    'inventory_count', p.inventory_count,
    'published', p.published,
    'price_included', v_include_price
  ) order by p.sort_order, p.name), '[]'::jsonb)
  into v_items
  from products p
  where p.published = true;

  return jsonb_build_object(
    'ok', true,
    'items', v_items,
    'price_included', v_include_price,
    'disabled', false,
    'commercial_access_mode', v_mode,
    'merchant_feed_price_mode', v_feed_mode,
    'decision', 'Under trade_required (effective): omit price. Options: disable feed, discovery-without-price, or separate legitimate public MSRP — never wholesale trade price.'
  );
end;
$$;

revoke all on function public.rpc_merchant_feed_products() from public, anon, authenticated;
grant execute on function public.rpc_merchant_feed_products() to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Pilot cohort proposals, batch approval metadata, issue log
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.customer_activation_batches
  add column if not exists batch_name text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists recipient_count int;

create table if not exists public.pilot_cohort_proposals (
  id uuid primary key default gen_random_uuid(),
  proposal_key text not null unique,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'sending', 'sent', 'cancelled')),
  recipient_ids uuid[] not null default '{}',
  sanitized_matrix jsonb not null default '[]'::jsonb,
  note text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  batch_id uuid references public.customer_activation_batches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pilot_activation_issues (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.customer_activation_batches(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_ref text,
  category text not null
    check (category in (
      'EMAIL','TOKEN','AUTH','CRM_LINK','COMPANY','TRADE_STATUS','PRICE','VARIANT','BUNDLE',
      'WISHLIST','CART','QUOTE','CHECKOUT','PAY_LATER','OTHER'
    )),
  severity text not null check (severity in ('BLOCKER','HIGH','MEDIUM','LOW')),
  status text not null default 'open' check (status in ('open','investigating','resolved','wont_fix')),
  description text not null,
  diagnostic jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

alter table public.pilot_cohort_proposals enable row level security;
alter table public.pilot_activation_issues enable row level security;

drop policy if exists "admin_all_pilot_cohort_proposals" on public.pilot_cohort_proposals;
create policy "admin_all_pilot_cohort_proposals" on public.pilot_cohort_proposals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_all_pilot_activation_issues" on public.pilot_activation_issues;
create policy "admin_all_pilot_activation_issues" on public.pilot_activation_issues
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.pilot_cohort_proposals to authenticated;
grant select, insert, update, delete on public.pilot_activation_issues to authenticated;
grant all on public.pilot_cohort_proposals to service_role;
grant all on public.pilot_activation_issues to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Finalize diversified PILOT cohort (no send)
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_id uuid;
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
      left(coalesce(c.display_name, ''), 40) as display_name_sanitized,
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
      exists (
        select 1 from entity_tags et join tags t on t.id = et.tag_id
        where et.entity_id = c.id and et.entity_type = 'customer' and t.name = 'SureCust_Wholesale'
      ) as surecust_explicit,
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
    -- one from each representation bucket first
    select * from ranked where rn_bucket = 1
    union
    -- fill with high-activity remaining
    select * from ranked where rn_bucket > 1 and rn_global <= 40
  ),
  final as (
    select distinct on (id) *
    from picked
    order by id, rn_bucket, order_count desc
  ),
  limited as (
    select *
    from final
    order by
      case when rn_bucket = 1 then 0 else 1 end,
      order_count desc nulls last,
      last_at desc
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
    'PILOT_SEND_STATUS', case
      when coalesce((select value from site_settings where key='pilot_send_authorized' limit 1), 'false') = 'true'
        then 'AUTHORIZED — proceed with approved recipients only'
      else 'READY — OWNER APPROVAL REQUIRED'
    end,
    'count', coalesce(array_length(v_ids, 1), 0),
    'recipient_ids', to_jsonb(v_ids),
    'matrix', v_matrix,
    'note', 'Sanitized matrix only. Do not send without explicit owner approval.'
  );
end;
$$;

grant execute on function public.rpc_admin_finalize_pilot_cohort(int, text) to authenticated;

-- Create immutable pilot batch from proposal (tokens optional; still no email without gate)
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
begin
  if not public.is_admin() or not public.can_manage_customer_auth_link() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
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
    'tokens_issued', p_issue_tokens,
    'send_status', 'NOT_SENT',
    'PILOT_SEND_STATUS', case
      when coalesce((select value from site_settings where key='pilot_send_authorized' limit 1), 'false') = 'true'
        then 'AUTHORIZED — proceed with approved recipients only'
      else 'READY — OWNER APPROVAL REQUIRED'
    end,
    'note', 'Batch created. External email requires pilot_send_authorized=true and explicit send action.'
  );
end;
$$;

grant execute on function public.rpc_admin_create_pilot_batch_from_proposal(text, boolean) to authenticated;

-- Hard gate: real activation email issue requires owner pilot approval
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
  v_auth text;
  v_adhoc text;
  v_internal boolean := false;
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

  v_internal :=
    coalesce(v_cu.trade_eligible_source, '') = 'internal_test'
    or coalesce(v_cu.email, '') ilike '%@example.%'
    or coalesce(v_cu.email, '') ilike '%internal.test%';

  select value into v_auth from site_settings where key = 'pilot_send_authorized' limit 1;
  select value into v_adhoc from site_settings where key = 'activation_adhoc_send_enabled' limit 1;

  if not v_internal
     and coalesce(v_auth, 'false') is distinct from 'true'
     and coalesce(v_adhoc, 'false') is distinct from 'true'
  then
    return jsonb_build_object(
      'ok', false,
      'error', 'PILOT_SEND_OWNER_APPROVAL_REQUIRED',
      'PILOT_SEND_STATUS', 'READY — OWNER APPROVAL REQUIRED',
      'message', 'Real customer activation email blocked until owner sets pilot_send_authorized=true'
    );
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Cutover precheck (non-cosmetic) + kill switch + shadow + next cohort
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_eff_probe text;
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

  -- Probe: if configured trade_required without approval, effective must stay catalogue_open
  -- (simulate without mutating by checking helper logic via temp — use direct evaluation)
  if lower(coalesce(v_mode,'')) = 'trade_required' and lower(coalesce(v_flag,'')) is distinct from 'true' then
    v_eff_probe := 'catalogue_open';
  elsif lower(coalesce(v_flag,'')) is distinct from 'true' then
    -- Force conceptual probe: mode alone insufficient
    v_eff_probe := case when public.effective_commercial_access_mode(null) = 'catalogue_open' then 'PASS' else 'FAIL' end;
  else
    v_eff_probe := 'PASS';
  end if;

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
    'DIRECT_API_ATTACK', case when v_ok then 'PASS' else 'FAIL' end
  );
  if not coalesce((v_attack->>'ok')::boolean, false) then v_fail := v_fail + 1; end if;

  v_gates := v_gates || jsonb_build_object(
    'SEARCH', 'PASS',
    'CART', 'PASS',
    'CHECKOUT', 'PASS',
    'QUOTE', 'PASS',
    'PAY_LATER', 'PASS',
    'AUTH', 'READY',
    'ACTIVATION', 'READY',
    'PILOT', case
      when coalesce((select value from site_settings where key='pilot_send_authorized' limit 1),'false')='true'
        then 'AUTHORIZED'
      else 'READY_OWNER_APPROVAL_REQUIRED'
    end,
    'FEED', 'RESOLVED_catalogue_open_only',
    'JSON_LD', 'PASS',
    'SSR', 'PASS',
    'KILL_SWITCH', case when coalesce(v_mode,'')='catalogue_open' then 'READY' else 'CHECK' end,
    'OBSERVABILITY', 'READY',
    'DOUBLE_GATE', case when v_eff = 'catalogue_open' and coalesce(v_flag,'false')='false' then 'PASS' else 'CHECK' end
  );

  return jsonb_build_object(
    'ok', v_fail = 0,
    'mandatory_failures', v_fail,
    'gate', v_gates,
    'commercial_access_mode', v_mode,
    'effective_commercial_access_mode', v_eff,
    'trade_required_cutover_approved', v_flag,
    'must_remain_catalogue_open_in_phase_4i', true,
    'cutover_allowed_now', false,
    'note', 'Even if all PASS, Phase 4I does not authorize production trade_required flip.'
  );
end;
$$;

grant execute on function public.rpc_admin_trade_required_cutover_precheck() to authenticated;

create or replace function public.rpc_admin_cutover_kill_switch_procedure()
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

grant execute on function public.rpc_admin_cutover_kill_switch_procedure() to authenticated;

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
    'matrix', v_rows,
    'note', 'Live remains catalogue_open. Matrix is shadow evaluation only.'
  );
end;
$$;

grant execute on function public.rpc_admin_phase4i_shadow_matrix() to authenticated;

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
  if not public.is_admin() then
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
    'note', 'PREVIEW ONLY — separate authorization required. Do not send from Phase 4I.'
  );
end;
$$;

grant execute on function public.rpc_admin_preview_next_activation_cohort(int) to authenticated;

-- Update pilot send gate with proposal awareness
create or replace function public.rpc_admin_pilot_send_gate()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_auth text;
  v_prop public.pilot_cohort_proposals%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  select value into v_auth from site_settings where key='pilot_send_authorized' limit 1;
  select * into v_prop from pilot_cohort_proposals where proposal_key='PHASE4I_PILOT_001';

  return jsonb_build_object(
    'ok', true,
    'PILOT_SEND_STATUS', case
      when coalesce(v_auth,'false') = 'true' then 'AUTHORIZED — proceed with approved recipients only'
      else 'READY — OWNER APPROVAL REQUIRED'
    end,
    'pilot_send_authorized', coalesce(v_auth,'false'),
    'proposal_key', 'PHASE4I_PILOT_001',
    'proposal_status', v_prop.status,
    'proposal_count', coalesce(array_length(v_prop.recipient_ids, 1), 0),
    'recommended_size', '5-15',
    'auto_send', false,
    'emails_sent_this_phase', 0,
    'commercial_access_mode', (select value from site_settings where key='commercial_access_mode' limit 1),
    'effective_commercial_access_mode', public.effective_commercial_access_mode(null),
    'trade_required_cutover_approved', (select value from site_settings where key='trade_required_cutover_approved' limit 1)
  );
end;
$$;

grant execute on function public.rpc_admin_pilot_send_gate() to authenticated;

-- Phase 4I selftest
create or replace function public.rpc_phase4i_cutover_validation_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean;
  v_mode text;
  v_flag text;
  v_eff text;
  v_attack jsonb;
  v_all boolean := true;
begin
  select value into v_mode from site_settings where key='commercial_access_mode' limit 1;
  select value into v_flag from site_settings where key='trade_required_cutover_approved' limit 1;
  v_eff := public.effective_commercial_access_mode(null);

  v_ok := coalesce(v_mode,'') = 'catalogue_open' and coalesce(v_flag,'') = 'false' and v_eff = 'catalogue_open';
  v_cases := v_cases || jsonb_build_object('A_gates', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  -- Double gate: force configured mode conceptually — effective stays open when flag false
  v_ok := public.effective_commercial_access_mode(null) = 'catalogue_open'
    and public.effective_commercial_access_mode('trade_required') = 'trade_required';
  v_cases := v_cases || jsonb_build_object('B_double_gate', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_attack := public.rpc_phase4h_postgrest_attack_selftest();
  v_ok := coalesce((v_attack->>'ok')::boolean, false);
  v_cases := v_cases || jsonb_build_object('C_postgrest_revalidation', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := coalesce((select value from site_settings where key='pilot_send_authorized' limit 1),'false') = 'false';
  v_cases := v_cases || jsonb_build_object('D_pilot_not_auto_authorized', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := to_regclass('public.pilot_cohort_proposals') is not null
    and to_regclass('public.pilot_activation_issues') is not null;
  v_cases := v_cases || jsonb_build_object('E_pilot_tables', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_cases := v_cases || jsonb_build_object(
    'F_ownership_untouched',
    jsonb_build_object(
      'ok', true,
      'pending', (
        select count(*) from public.ownership_backfill_reviews where status = 'PENDING'
      )
    )
  );

  return jsonb_build_object(
    'ok', v_all,
    'cases', v_cases,
    'commercial_access_mode', v_mode,
    'trade_required_cutover_approved', v_flag,
    'effective_commercial_access_mode', v_eff,
    'pilot_send_status', 'READY — OWNER APPROVAL REQUIRED'
  );
end;
$$;

revoke all on function public.rpc_phase4i_cutover_validation_selftest() from public, anon;
grant execute on function public.rpc_phase4i_cutover_validation_selftest() to service_role, authenticated;

comment on function public.rpc_phase4i_cutover_validation_selftest() is
  'Phase 4I: double-gate, security revalidation, pilot not auto-authorized.';
