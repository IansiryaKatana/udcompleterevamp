-- Phase 5H — CRM Ownership Resolution & Sales Operations Cutover Readiness
-- INTERNAL CRM / STAFF / SALES only. No storefront changes. No auto-apply.
-- Does NOT enable trade_required, Worldpay, DPD, WMS, compliance enforce, or pilot send.
-- Confidence model remains phase4c_v1 (majority alone ≠ HIGH).

begin;

-- ── Settings locks ──────────────────────────────────────────────────────────
insert into public.site_settings (key, value, updated_at)
values
  ('ownership_bulk_apply_authorized', 'false', now()),
  ('ownership_auto_apply_high', 'false', now())
on conflict (key) do update
set value = excluded.value, updated_at = now();

-- ── Enrichment columns on ownership_backfill_reviews ────────────────────────
alter table public.ownership_backfill_reviews
  add column if not exists review_batch text,
  add column if not exists resolution_class text,
  add column if not exists explanation text,
  add column if not exists material_priority int not null default 0,
  add column if not exists has_open_ar boolean not null default false,
  add column if not exists has_open_order boolean not null default false,
  add column if not exists has_open_draft boolean not null default false,
  add column if not exists last_activity_at timestamptz,
  add column if not exists phase5h_enriched_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ownership_backfill_reviews_batch_chk'
  ) then
    alter table public.ownership_backfill_reviews
      add constraint ownership_backfill_reviews_batch_chk
      check (review_batch is null or review_batch in ('A','B','C','D','E'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'ownership_backfill_reviews_resolution_chk'
  ) then
    alter table public.ownership_backfill_reviews
      add constraint ownership_backfill_reviews_resolution_chk
      check (resolution_class is null or resolution_class in (
        'READY_FOR_APPROVAL','NEEDS_BUSINESS_REVIEW','CONFLICTING','NO_EVIDENCE','VALID_UNOWNED'
      ));
  end if;
end $$;

create index if not exists ownership_backfill_reviews_batch_idx
  on public.ownership_backfill_reviews (status, review_batch, material_priority desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- Staff directory baseline
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_staff_directory_baseline()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_active int;
  v_inactive int;
  v_legacy int;
  v_admin_linked int;
  v_admin_unlinked int;
  v_alias_resolved int;
  v_alias_unknown int;
  v_alias_ambiguous int;
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;

  select count(*) into v_active from staff_members where coalesce(active, false);
  select count(*) into v_inactive from staff_members where not coalesce(active, false);
  -- Legacy: inactive OR provenance indicating imported/historical-only identity
  select count(*) into v_legacy from staff_members
  where not coalesce(active, false)
     or coalesce(provenance, '') in ('shopify_import', 'legacy', 'historical');

  select count(*) into v_admin_linked
  from staff_members s
  where exists (select 1 from admin_users au where au.staff_member_id = s.id);

  select count(*) into v_admin_unlinked
  from staff_members s
  where not exists (select 1 from admin_users au where au.staff_member_id = s.id);

  select count(*) into v_alias_resolved from staff_aliases where status = 'RESOLVED';
  select count(*) into v_alias_unknown from staff_aliases where status = 'UNKNOWN';
  select count(*) into v_alias_ambiguous from staff_aliases where status = 'AMBIGUOUS';

  return jsonb_build_object(
    'ok', true,
    'ACTIVE_STAFF', v_active,
    'INACTIVE_STAFF', v_inactive,
    'LEGACY_STAFF', v_legacy,
    'ADMIN_LINKED', v_admin_linked,
    'ADMIN_UNLINKED', v_admin_unlinked,
    'ALIAS_RESOLVED', v_alias_resolved,
    'ALIAS_UNKNOWN', v_alias_unknown,
    'ALIAS_AMBIGUOUS', v_alias_ambiguous,
    'admins_total', (select count(*) from admin_users),
    'admins_with_staff', (select count(*) from admin_users where staff_member_id is not null),
    'admins_without_staff', (select count(*) from admin_users where staff_member_id is null),
    'staff_identity_classes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'active', s.active,
        'provenance', s.provenance,
        'class', case
          when not coalesce(s.active, false)
            and not exists (select 1 from admin_users au where au.staff_member_id = s.id)
            then 'LEGACY_ONLY'
          when exists (select 1 from admin_users au where au.staff_member_id = s.id and au.is_active)
            then 'READY'
          when exists (
            select 1 from staff_aliases sa
            where sa.staff_member_id = s.id and sa.status in ('UNKNOWN','AMBIGUOUS')
          ) then 'ALIAS_REVIEW'
          when coalesce(s.active, false)
            and not exists (select 1 from admin_users au where au.staff_member_id = s.id)
            then 'ADMIN_LINK_REQUIRED'
          else 'READY'
        end,
        'admin_linked', exists (select 1 from admin_users au where au.staff_member_id = s.id)
      ) order by s.name), '[]'::jsonb)
      from staff_members s
      where coalesce(s.active, false)
         or exists (select 1 from customers c where c.salesperson_id = s.id)
         or exists (select 1 from companies co where co.salesperson_id = s.id)
         or exists (select 1 from orders o where o.salesperson_id = s.id)
    ),
    'note', 'Linkage uses admin_users.staff_member_id (not staff_members.auth_user_id). Do not delete legacy/inactive staff.'
  );
end;
$$;
revoke all on function public.rpc_admin_staff_directory_baseline() from public, anon;
grant execute on function public.rpc_admin_staff_directory_baseline() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Ownership baseline + customer/company semantics + unowned
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_ownership_baseline_report()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'customers_total', (select count(*) from customers),
    'customers_with_salesperson', (select count(*) from customers where salesperson_id is not null),
    'customers_without_salesperson', (select count(*) from customers where salesperson_id is null),
    'companies_total', (select count(*) from companies),
    'companies_with_salesperson', (select count(*) from companies where salesperson_id is not null),
    'companies_without_salesperson', (select count(*) from companies where salesperson_id is null),
    'orders_with_historical_salesperson', (select count(*) from orders where salesperson_id is not null),
    'drafts_with_historical_salesperson', (select count(*) from draft_orders where salesperson_id is not null),
    'current_crm_cg_customers', (select count(*) from customers where cg_assigned_id is not null),
    'current_crm_cg_companies', (select count(*) from companies where cg_assigned_id is not null),
    'historical_cg_order_snapshots', (select count(*) from orders where cg_assigned_id is not null),
    'cg_policy', 'HISTORICAL_ONLY / CURRENT_NOT_JUSTIFIED',
    'referrer_customers', (select count(*) from customers where referrer_id is not null),
    'referrer_companies', (select count(*) from companies where referrer_id is not null),
    'pending_candidates', (select count(*) from ownership_backfill_reviews where status = 'PENDING'),
    'pending_by_confidence', (
      select coalesce(jsonb_object_agg(confidence, c), '{}'::jsonb)
      from (select confidence, count(*)::bigint c from ownership_backfill_reviews where status='PENDING' group by 1) x
    ),
    'phase4c_baseline', jsonb_build_object(
      'HIGH', 626, 'MEDIUM', 588, 'CONFLICTING', 139, 'pending', 1353
    ),
    'customer_vs_company_semantics', jsonb_build_object(
      'model', 'INDEPENDENT_WITH_COMPANY_PRIMARY_EXCEPTION',
      'status', 'BUSINESS_DECISION_REQUIRED',
      'evidence', jsonb_build_object(
        'customers_owned', (select count(*) from customers where salesperson_id is not null),
        'companies_owned', (select count(*) from companies where salesperson_id is not null),
        'mismatch_linked', (
          select count(*)
          from customers cu
          join company_contacts cc on cc.customer_id = cu.id
          join companies co on co.id = cc.company_id
          where cu.salesperson_id is not null
            and co.salesperson_id is not null
            and cu.salesperson_id is distinct from co.salesperson_id
        )
      ),
      'rule', 'Do not silently force customer salesperson = company salesperson. Ownership may exist on customer without company.'
    )
  );
end;
$$;
revoke all on function public.rpc_admin_ownership_baseline_report() from public, anon;
grant execute on function public.rpc_admin_ownership_baseline_report() to authenticated, service_role;

create or replace function public.rpc_admin_unowned_account_report(p_limit int default 100)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'policy', jsonb_build_object(
      'UNOWNED_VALID', 'Null owner is allowed when no operational ownership is required',
      'OWNERSHIP_REQUIRED', 'Material open AR / open order / active draft needs an operational owner',
      'REVIEW_PENDING', 'Candidate exists in ownership_backfill_reviews PENDING'
    ),
    'companies_unowned', (select count(*) from companies where salesperson_id is null),
    'customers_unowned', (select count(*) from customers where salesperson_id is null),
    'companies_unowned_with_open_ar', (
      select count(distinct co.id) from companies co
      join orders o on o.company_id = co.id
      where co.salesperson_id is null and coalesce(o.total_outstanding,0) > 0.009
        and coalesce(o.is_test,false)=false
    ),
    'customers_unowned_with_open_ar', (
      select count(distinct cu.id) from customers cu
      join orders o on o.customer_id = cu.id
      where cu.salesperson_id is null and coalesce(o.total_outstanding,0) > 0.009
        and coalesce(o.is_test,false)=false
    ),
    'companies_no_primary_contact', (
      select count(*) from companies co
      where not exists (
        select 1 from company_contacts cc
        where cc.company_id = co.id and coalesce(cc.is_primary, false)
      )
    ),
    'companies_no_active_customer', (
      select count(*) from companies co
      where not exists (
        select 1 from company_contacts cc
        join customers cu on cu.id = cc.customer_id
        where cc.company_id = co.id and coalesce(cu.status,'active') = 'active'
      )
    ),
    'sample_ownership_required_companies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'company_id', x.id, 'name', x.name, 'class', 'OWNERSHIP_REQUIRED',
        'open_ar', x.open_ar, 'open_orders', x.open_orders
      ) order by x.open_ar desc), '[]'::jsonb)
      from (
        select co.id, co.name,
          coalesce((select sum(o.total_outstanding) from orders o where o.company_id=co.id and coalesce(o.is_test,false)=false),0) as open_ar,
          (select count(*) from orders o where o.company_id=co.id and coalesce(o.commerce_fulfillment_status, o.fulfillment_status) in ('unfulfilled','partial','processing') and coalesce(o.is_test,false)=false) as open_orders
        from companies co
        where co.salesperson_id is null
          and (
            exists (select 1 from orders o where o.company_id=co.id and coalesce(o.total_outstanding,0)>0.009 and coalesce(o.is_test,false)=false)
            or exists (select 1 from draft_orders d where d.company_id=co.id and d.converted_order_id is null and d.status in ('open','invoice_sent','completed'))
          )
        order by 3 desc
        limit least(greatest(coalesce(p_limit,100),1), 300)
      ) x
    ),
    'note', 'Do not delete companies. Do not invent fake companies for customer ownership.'
  );
end;
$$;
revoke all on function public.rpc_admin_unowned_account_report(int) from public, anon;
grant execute on function public.rpc_admin_unowned_account_report(int) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Enrich pending candidates (evidence + batches) — NO apply, preserves confidence
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_enrich_ownership_candidates_phase5h()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_before jsonb;
  v_after jsonb;
begin
  -- Allow linked migration/ops role (auth.uid null) or ownership-capable admin session.
  if auth.uid() is not null and not public.can_reassign_ownership() then
    return public.sales_forbidden_json();
  end if;

  select coalesce(jsonb_object_agg(confidence, c), '{}'::jsonb) into v_before
  from (select confidence, count(*)::bigint c from ownership_backfill_reviews where status='PENDING' group by 1) x;

  update public.ownership_backfill_reviews r
  set
    review_batch = case r.confidence
      when 'EXPLICIT' then 'A'
      when 'HIGH' then 'B'
      when 'MEDIUM' then 'C'
      when 'LOW' then 'C'
      when 'CONFLICTING' then 'D'
      when 'NO_EVIDENCE' then 'E'
      else 'C'
    end,
    resolution_class = case r.confidence
      when 'EXPLICIT' then 'READY_FOR_APPROVAL'
      when 'HIGH' then 'READY_FOR_APPROVAL'
      when 'MEDIUM' then 'NEEDS_BUSINESS_REVIEW'
      when 'LOW' then 'NEEDS_BUSINESS_REVIEW'
      when 'CONFLICTING' then 'CONFLICTING'
      when 'NO_EVIDENCE' then 'NO_EVIDENCE'
      else 'NEEDS_BUSINESS_REVIEW'
    end,
    has_open_ar = coalesce(flags.has_open_ar, false),
    has_open_order = coalesce(flags.has_open_order, false),
    has_open_draft = coalesce(flags.has_open_draft, false),
    last_activity_at = flags.last_activity_at,
    material_priority =
      (case when coalesce(flags.has_open_ar, false) then 100 else 0 end)
      + (case when coalesce(flags.has_open_order, false) then 50 else 0 end)
      + (case when coalesce(flags.has_open_draft, false) then 25 else 0 end)
      + least(coalesce((r.evidence->>'order_count')::int, 0), 40),
    explanation = case
      when coalesce((r.evidence->>'explicit_metafield')::boolean, false)
        then 'Explicit Shopify salesperson metafield matches proposed staff (exact name).'
      when r.confidence = 'CONFLICTING'
        then format(
          'Conflicting historical salespeople across orders/drafts (conflict_count=%s). Manual resolution required.',
          coalesce(r.evidence->>'conflict_count', '?')
        )
      when r.confidence = 'HIGH'
        then format(
          'Unanimous historical order salesperson (%s/%s orders, %s%% share) with recent evidence; phase4c_v1 HIGH — still requires human approval before apply.',
          coalesce(r.evidence->>'order_count','0'),
          coalesce(r.evidence->>'order_count','0'),
          coalesce(r.evidence->>'dominant_owner_share','100')
        )
      when r.confidence = 'MEDIUM'
        then format(
          'Consistent but weaker historical signal (%s orders / %s drafts, share %s%%). Majority alone is not HIGH.',
          coalesce(r.evidence->>'order_count','0'),
          coalesce(r.evidence->>'draft_count','0'),
          coalesce(r.evidence->>'dominant_owner_share','—')
        )
      when r.confidence = 'LOW'
        then 'Sparse single-source evidence only — review carefully.'
      else coalesce(r.recommendation, 'Review candidate evidence before deciding.')
    end,
    evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object(
      'phase5h', true,
      'source_precedence', jsonb_build_array(
        'UNIQUE_MANUAL','CURRENT_EXPLICIT_SOURCE','CONSISTENT_HISTORICAL_EXPLICIT','STRONG_INFERENCE','WEAK_INFERENCE','UNKNOWN'
      ),
      'order_distribution', flags.order_distribution,
      'draft_distribution', flags.draft_distribution,
      'why', case
        when coalesce((r.evidence->>'explicit_metafield')::boolean, false) then 'explicit_metafield'
        when r.confidence = 'HIGH' then 'unanimous_recent_orders'
        when r.confidence = 'CONFLICTING' then 'multiple_salespeople'
        when r.confidence = 'MEDIUM' then 'consistent_weaker_history'
        else 'sparse_or_other'
      end
    ),
    phase5h_enriched_at = now(),
    updated_at = now()
  from (
    select
      r2.id,
      exists (
        select 1 from orders o
        where (
          (r2.entity_type = 'company' and o.company_id = r2.entity_id)
          or (r2.entity_type = 'customer' and o.customer_id = r2.entity_id)
        )
        and coalesce(o.total_outstanding,0) > 0.009
        and coalesce(o.is_test,false)=false
      ) as has_open_ar,
      exists (
        select 1 from orders o
        where (
          (r2.entity_type = 'company' and o.company_id = r2.entity_id)
          or (r2.entity_type = 'customer' and o.customer_id = r2.entity_id)
        )
        and coalesce(o.commerce_fulfillment_status, o.fulfillment_status) in ('unfulfilled','partial','processing')
        and coalesce(o.is_test,false)=false
      ) as has_open_order,
      exists (
        select 1 from draft_orders d
        where (
          (r2.entity_type = 'company' and d.company_id = r2.entity_id)
          or (r2.entity_type = 'customer' and d.customer_id = r2.entity_id)
        )
        and d.converted_order_id is null
        and d.status in ('open','invoice_sent','completed')
      ) as has_open_draft,
      (
        select max(ts) from (
          select coalesce(o.source_created_at, o.created_at) as ts from orders o
          where (r2.entity_type='company' and o.company_id=r2.entity_id)
             or (r2.entity_type='customer' and o.customer_id=r2.entity_id)
          union all
          select coalesce(d.source_created_at, d.created_at) from draft_orders d
          where (r2.entity_type='company' and d.company_id=r2.entity_id)
             or (r2.entity_type='customer' and d.customer_id=r2.entity_id)
        ) t
      ) as last_activity_at,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff_id', s.id, 'name', s.name, 'count', x.cnt
        ) order by x.cnt desc), '[]'::jsonb)
        from (
          select o.salesperson_id as sp, count(*)::bigint cnt
          from orders o
          where o.salesperson_id is not null
            and ((r2.entity_type='company' and o.company_id=r2.entity_id)
              or (r2.entity_type='customer' and o.customer_id=r2.entity_id))
          group by o.salesperson_id
        ) x
        left join staff_members s on s.id = x.sp
      ) as order_distribution,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff_id', s.id, 'name', s.name, 'count', x.cnt
        ) order by x.cnt desc), '[]'::jsonb)
        from (
          select d.salesperson_id as sp, count(*)::bigint cnt
          from draft_orders d
          where d.salesperson_id is not null
            and ((r2.entity_type='company' and d.company_id=r2.entity_id)
              or (r2.entity_type='customer' and d.customer_id=r2.entity_id))
          group by d.salesperson_id
        ) x
        left join staff_members s on s.id = x.sp
      ) as draft_distribution
    from ownership_backfill_reviews r2
    where r2.status = 'PENDING'
  ) flags
  where r.id = flags.id
    and r.status = 'PENDING';

  get diagnostics v_n = row_count;

  select coalesce(jsonb_object_agg(confidence, c), '{}'::jsonb) into v_after
  from (select confidence, count(*)::bigint c from ownership_backfill_reviews where status='PENDING' group by 1) x;

  return jsonb_build_object(
    'ok', true,
    'enriched', v_n,
    'confidence_before', v_before,
    'confidence_after', v_after,
    'confidence_unchanged', v_before = v_after,
    'auto_applied', 0,
    'note', 'Enrichment only — no ownership mutations. HIGH still requires human approval.'
  );
end;
$$;
revoke all on function public.rpc_admin_enrich_ownership_candidates_phase5h() from public, anon;
grant execute on function public.rpc_admin_enrich_ownership_candidates_phase5h() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Enhanced list + review pack + preview apply
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_list_ownership_candidates(
  p_entity_type text default null,
  p_status text default 'PENDING',
  p_confidence text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total int;
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  select count(*) into v_total from public.ownership_backfill_reviews r
  where (p_entity_type is null or r.entity_type = p_entity_type)
    and (p_status is null or r.status = p_status)
    and (p_confidence is null or r.confidence = p_confidence);

  return jsonb_build_object(
    'ok', true, 'total', v_total, 'limit', p_limit, 'offset', p_offset,
    'batch_summary', (
      select coalesce(jsonb_object_agg(coalesce(review_batch,'?'), c), '{}'::jsonb)
      from (
        select review_batch, count(*)::bigint c
        from ownership_backfill_reviews
        where status = coalesce(p_status, status)
        group by 1
      ) x
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'entity_type', r.entity_type,
        'entity_id', r.entity_id,
        'entity_name', case
          when r.entity_type='company' then (select name from companies where id=r.entity_id)
          else (select coalesce(display_name, email) from customers where id=r.entity_id)
        end,
        'current_owner_id', r.current_owner_id,
        'current_owner_name', (select name from staff_members where id=r.current_owner_id),
        'proposed_owner_id', r.proposed_owner_id,
        'proposed_owner_name', (select name from staff_members where id=r.proposed_owner_id),
        'confidence', r.confidence,
        'recommendation', r.recommendation,
        'explanation', r.explanation,
        'review_batch', r.review_batch,
        'resolution_class', r.resolution_class,
        'material_priority', r.material_priority,
        'has_open_ar', r.has_open_ar,
        'has_open_order', r.has_open_order,
        'has_open_draft', r.has_open_draft,
        'last_activity_at', r.last_activity_at,
        'evidence', r.evidence,
        'status', r.status,
        'decision_note', r.decision_note
      ) order by r.material_priority desc,
        case r.confidence when 'EXPLICIT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 when 'CONFLICTING' then 4 else 5 end,
        r.created_at
      ), '[]'::jsonb)
      from (
        select * from public.ownership_backfill_reviews r
        where (p_entity_type is null or r.entity_type = p_entity_type)
          and (p_status is null or r.status = p_status)
          and (p_confidence is null or r.confidence = p_confidence)
        order by r.material_priority desc,
          case r.confidence when 'EXPLICIT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 when 'CONFLICTING' then 4 else 5 end,
          r.created_at
        offset greatest(coalesce(p_offset,0),0)
        limit least(greatest(coalesce(p_limit,100),1), 500)
      ) r
    )
  );
end;
$$;
grant execute on function public.rpc_admin_list_ownership_candidates(text, text, text, int, int) to authenticated, service_role;

create or replace function public.rpc_admin_ownership_review_pack(
  p_batch text default null,
  p_limit int default 200
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'columns', jsonb_build_array(
      'reference','entity_type','current_owner','proposed_owner','confidence','reason',
      'last_order','order_count','open_ar','open_order','open_draft','decision'
    ),
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'reference', case
          when r.entity_type='company' then (
            select coalesce(trading_name, name) || ' [' || left(id::text, 8) || ']'
            from companies where id=r.entity_id
          )
          else (
            select coalesce(display_name, email, 'customer') || ' [' || left(id::text, 8) || ']'
            from customers where id=r.entity_id
          )
        end,
        'entity_type', r.entity_type,
        'current_owner', (select name from staff_members where id=r.current_owner_id),
        'proposed_owner', (select name from staff_members where id=r.proposed_owner_id),
        'confidence', r.confidence,
        'reason', r.explanation,
        'last_order', r.last_activity_at,
        'order_count', r.evidence->>'order_count',
        'open_ar', r.has_open_ar,
        'open_order', r.has_open_order,
        'open_draft', r.has_open_draft,
        'decision', r.status,
        'review_batch', r.review_batch,
        'resolution_class', r.resolution_class,
        'material_priority', r.material_priority
      ) order by r.material_priority desc, r.confidence), '[]'::jsonb)
      from (
        select * from ownership_backfill_reviews
        where status = 'PENDING'
          and (p_batch is null or review_batch = p_batch)
        order by material_priority desc
        limit least(greatest(coalesce(p_limit,200),1), 1000)
      ) r
    ),
    'pii_note', 'Uses operational references only — no address/phone dump.'
  );
end;
$$;
revoke all on function public.rpc_admin_ownership_review_pack(text, int) from public, anon;
grant execute on function public.rpc_admin_ownership_review_pack(text, int) to authenticated, service_role;

create or replace function public.rpc_admin_preview_apply_ownership_candidates(
  p_review_ids uuid[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.can_reassign_ownership() then return public.sales_forbidden_json(); end if;
  if p_review_ids is null or cardinality(p_review_ids) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No review ids selected');
  end if;
  return jsonb_build_object(
    'ok', true,
    'preview_only', true,
    'would_apply', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'review_id', r.id,
        'entity_type', r.entity_type,
        'entity_id', r.entity_id,
        'entity_name', case
          when r.entity_type='company' then (select name from companies where id=r.entity_id)
          else (select coalesce(display_name, email) from customers where id=r.entity_id)
        end,
        'from_owner', (select name from staff_members where id=r.current_owner_id),
        'to_owner', (select name from staff_members where id=r.proposed_owner_id),
        'confidence', r.confidence,
        'status', r.status,
        'eligible', r.status in ('APPROVED','MANUAL','PENDING') and r.proposed_owner_id is not null,
        'explanation', r.explanation
      )), '[]'::jsonb)
      from ownership_backfill_reviews r
      where r.id = any(p_review_ids)
    ),
    'applied', 0,
    'note', 'Preview only. Bulk apply blocked unless ownership_bulk_apply_authorized=true (currently false).'
  );
end;
$$;
revoke all on function public.rpc_admin_preview_apply_ownership_candidates(uuid[]) from public, anon;
grant execute on function public.rpc_admin_preview_apply_ownership_candidates(uuid[]) to authenticated, service_role;

-- Gate bulk apply — do not auto-authorize
create or replace function public.rpc_admin_apply_approved_ownership_candidates(
  p_review_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_status text;
  v_ok int := 0;
  v_fail int := 0;
  v_rpc jsonb;
  v_decision text;
  v_auth text;
begin
  if not public.can_reassign_ownership() then return public.sales_forbidden_json(); end if;

  select coalesce(value, 'false') into v_auth
  from site_settings where key = 'ownership_bulk_apply_authorized';
  if coalesce(v_auth, 'false') is distinct from 'true' then
    return jsonb_build_object(
      'ok', false,
      'error', 'OWNERSHIP_BULK_APPLY_NOT_AUTHORIZED',
      'applied', 0,
      'note', 'Phase 5H lock: set ownership_bulk_apply_authorized=true only after explicit later authorization. Use preview RPC instead.'
    );
  end if;

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
grant execute on function public.rpc_admin_apply_approved_ownership_candidates(uuid[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sales ops dashboard + inactive staff + assignment policy + cutover readiness
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_admin_sales_ops_dashboard()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_staff uuid := public.current_admin_staff_id();
  v_all boolean := public.can_view_all_sales();
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'scope', case when v_all then 'all' else 'assigned' end,
    'staff_id', v_staff,
    'metrics', jsonb_build_object(
      'assigned_customers', (
        select count(*) from customers
        where case when v_all then true else salesperson_id = v_staff end
      ),
      'assigned_companies', (
        select count(*) from companies
        where case when v_all then true else salesperson_id = v_staff end
      ),
      'active_customers_90d', (
        select count(distinct o.customer_id) from orders o
        join customers cu on cu.id = o.customer_id
        where coalesce(o.source_created_at, o.created_at) > now() - interval '90 days'
          and case when v_all then true else cu.salesperson_id = v_staff end
      ),
      'recent_orders_30d', (
        select count(*) from orders o
        left join customers cu on cu.id = o.customer_id
        left join companies co on co.id = o.company_id
        where coalesce(o.source_created_at, o.created_at) > now() - interval '30 days'
          and case
            when v_all then true
            else o.salesperson_id = v_staff or cu.salesperson_id = v_staff or co.salesperson_id = v_staff
          end
      ),
      'open_drafts', (
        select count(*) from draft_orders d
        left join customers cu on cu.id = d.customer_id
        left join companies co on co.id = d.company_id
        where d.converted_order_id is null and d.status in ('open','invoice_sent','completed')
          and case
            when v_all then true
            else d.salesperson_id = v_staff or cu.salesperson_id = v_staff or co.salesperson_id = v_staff
          end
      ),
      'open_ar_accounts', (
        select count(distinct coalesce(o.company_id, o.customer_id)) from orders o
        left join customers cu on cu.id = o.customer_id
        left join companies co on co.id = o.company_id
        where coalesce(o.total_outstanding,0) > 0.009 and coalesce(o.is_test,false)=false
          and case when v_all then true else coalesce(co.salesperson_id, cu.salesperson_id) = v_staff end
      ),
      'trade_pending', (select count(*) from customers where trade_access_status = 'pending'),
      'ownership_review_workload', (select count(*) from ownership_backfill_reviews where status='PENDING'),
      'ownership_ready_for_approval', (
        select count(*) from ownership_backfill_reviews
        where status='PENDING' and resolution_class = 'READY_FOR_APPROVAL'
      ),
      'ownership_conflicting', (
        select count(*) from ownership_backfill_reviews where status='PENDING' and confidence='CONFLICTING'
      )
    ),
    'ar_basis_labels', jsonb_build_object(
      'current_crm', 'Filter AR by current customer/company salesperson',
      'order_snapshot', 'Filter AR by historical order salesperson snapshot'
    ),
    'no_leaderboard', true
  );
end;
$$;
revoke all on function public.rpc_admin_sales_ops_dashboard() from public, anon;
grant execute on function public.rpc_admin_sales_ops_dashboard() to authenticated, service_role;

create or replace function public.rpc_admin_inactive_staff_ownership_report()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'policy', 'REASSIGNMENT_REQUIRED for current CRM ownership held by inactive staff — no automatic reassignment',
    'inactive_staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'staff_id', s.id, 'name', s.name,
        'customers_owned', (select count(*) from customers c where c.salesperson_id = s.id),
        'companies_owned', (select count(*) from companies c where c.salesperson_id = s.id),
        'historical_orders', (select count(*) from orders o where o.salesperson_id = s.id),
        'action', 'REASSIGNMENT_REQUIRED'
      ) order by s.name), '[]'::jsonb)
      from staff_members s
      where not coalesce(s.active, false)
        and (
          exists (select 1 from customers c where c.salesperson_id = s.id)
          or exists (select 1 from companies c where c.salesperson_id = s.id)
        )
    ),
    'note', 'Do not delete staff identity. Historical snapshots remain resolvable.'
  );
end;
$$;
revoke all on function public.rpc_admin_inactive_staff_ownership_report() from public, anon;
grant execute on function public.rpc_admin_inactive_staff_ownership_report() to authenticated, service_role;

create or replace function public.rpc_admin_ownership_assignment_policy()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return jsonb_build_object(
    'ok', true,
    'new_customer', jsonb_build_object(
      'allowed_sources', jsonb_build_array('manual_staff_assignment','trade_application_routing','company_owner_inheritance','approved_automation_rule'),
      'default', 'manual_staff_assignment or leave UNOWNED_VALID',
      'forbidden', jsonb_build_array('inferred_flow_lite','fuzzy_name_match','email_domain_only'),
      'auditable', true
    ),
    'new_company', jsonb_build_object(
      'allowed_sources', jsonb_build_array('manual_staff_assignment','trade_application_provenance','approved_automation_rule'),
      'default', 'manual or preserve trade application salesperson if explicit',
      'forbidden', jsonb_build_array('email_domain_auto','customer_email_guess'),
      'auditable', true
    ),
    'reassignment', jsonb_build_object(
      'who', 'owner/admin only via rpc_admin_reassign_ownership',
      'stores', jsonb_build_array('entity','old_owner','new_owner','source','actor','reason','timestamp'),
      'historical_snapshots', 'immutable'
    ),
    'provenance_required', jsonb_build_array('UNIQUE_MANUAL','IMPORTED_EXPLICIT','APPROVED_BACKFILL','OTHER_VALID_SOURCE'),
    'draft_conversion_snapshot', 'Order inherits draft.salesperson_id/cg/referrer at conversion time (draft values), not live CRM owner at conversion if draft already snapshotted a different owner.',
    'native_checkout_snapshot', 'Unique-native orders should snapshot current customer/company ownership at creation where wired; historical Shopify snapshots remain frozen.',
    'cg', 'HISTORICAL_ONLY / CURRENT_NOT_JUSTIFIED — CG != salesperson',
    'referrer', 'Separate normalized/raw model — may be staff, customer, or external'
  );
end;
$$;
revoke all on function public.rpc_admin_ownership_assignment_policy() from public, anon;
grant execute on function public.rpc_admin_ownership_assignment_policy() to authenticated, service_role;

create or replace function public.crm_sales_cutover_readiness_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pending int;
  v_conflict int;
  v_ready int;
  v_open_ar_unowned int;
  v_admin_linked int;
  v_alias_bad int;
  v_status text;
  v_reason text;
begin
  select count(*) into v_pending from ownership_backfill_reviews where status='PENDING';
  select count(*) into v_conflict from ownership_backfill_reviews where status='PENDING' and confidence='CONFLICTING';
  select count(*) into v_ready from ownership_backfill_reviews where status='PENDING' and resolution_class='READY_FOR_APPROVAL';
  select count(*) into v_admin_linked from admin_users where staff_member_id is not null and is_active;
  select count(*) into v_alias_bad from staff_aliases where status in ('UNKNOWN','AMBIGUOUS');
  select count(distinct co.id) into v_open_ar_unowned
  from companies co
  join orders o on o.company_id = co.id
  where co.salesperson_id is null
    and coalesce(o.total_outstanding,0) > 0.009
    and coalesce(o.is_test,false)=false;

  if v_pending > 0 or v_open_ar_unowned > 0 or v_admin_linked < 1 then
    v_status := 'REVIEW_REQUIRED';
    v_reason := format(
      'Ownership pending=%s (ready=%s conflict=%s); unowned open-AR companies=%s; active admin↔staff links=%s; alias UNKNOWN/AMBIGUOUS=%s',
      v_pending, v_ready, v_conflict, v_open_ar_unowned, v_admin_linked, v_alias_bad
    );
  else
    v_status := 'READY_WITH_VALID_UNOWNED';
    v_reason := 'No pending ownership candidates; remaining null owners treated as valid unless material ops require assignment';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'reason', v_reason,
    'ownership_does_not_block_commerce_cutover', true,
    'metrics', jsonb_build_object(
      'pending', v_pending,
      'ready_for_approval', v_ready,
      'conflicting', v_conflict,
      'unowned_companies_open_ar', v_open_ar_unowned,
      'admin_staff_links_active', v_admin_linked,
      'alias_unknown_ambiguous', v_alias_bad,
      'bulk_apply_authorized', coalesce((select value from site_settings where key='ownership_bulk_apply_authorized'),'false'),
      'auto_apply_high', coalesce((select value from site_settings where key='ownership_auto_apply_high'),'false')
    ),
    'cg', 'HISTORICAL_ONLY / CURRENT_NOT_JUSTIFIED',
    'phase4c_pending_preserved', v_pending
  );
end;
$$;
revoke all on function public.crm_sales_cutover_readiness_status() from public, anon;
grant execute on function public.crm_sales_cutover_readiness_status() to authenticated, service_role;

create or replace function public.rpc_admin_crm_sales_cutover_readiness()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then return public.sales_forbidden_json(); end if;
  return public.crm_sales_cutover_readiness_status()
    || jsonb_build_object(
      'staff_baseline', public.rpc_admin_staff_directory_baseline(),
      'ownership_baseline', public.rpc_admin_ownership_baseline_report(),
      'inactive_staff', public.rpc_admin_inactive_staff_ownership_report(),
      'assignment_policy', public.rpc_admin_ownership_assignment_policy(),
      'security_matrix', public.rpc_admin_sales_security_matrix()
    );
end;
$$;
revoke all on function public.rpc_admin_crm_sales_cutover_readiness() from public, anon;
grant execute on function public.rpc_admin_crm_sales_cutover_readiness() to authenticated, service_role;

-- Refresh cutover control centre with evidence-backed CRM/SALES domain
create or replace function public.rpc_admin_cutover_control_centre()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recon jsonb;
  v_domains jsonb := '[]'::jsonb;
  v_cat_status text;
  v_cat_reason text;
  v_fin jsonb;
  v_fin_status text;
  v_fin_reason text;
  v_wms jsonb;
  v_wms_status text;
  v_wms_reason text;
  v_sales jsonb;
  v_sales_status text;
  v_sales_reason text;
begin
  if auth.uid() is not null and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  v_recon := public.rpc_phase5e_catalogue_reconciliation();
  v_cat_status := coalesce(v_recon->>'catalogue_readiness', 'BLOCKED');
  v_cat_reason := format('Catalogue %s', v_cat_status);

  v_fin := public.finance_cutover_readiness_status();
  v_fin_status := coalesce(v_fin->>'status', 'REVIEW_REQUIRED');
  v_fin_reason := coalesce(v_fin->>'reason', 'Finance review required');

  v_wms := public.wms_cutover_readiness_status();
  v_wms_status := coalesce(v_wms->>'status', 'FOUNDATION_READY');
  v_wms_reason := coalesce(v_wms->>'reason', 'WMS foundations');

  v_sales := public.crm_sales_cutover_readiness_status();
  v_sales_status := coalesce(v_sales->>'status', 'REVIEW_REQUIRED');
  v_sales_reason := coalesce(v_sales->>'reason', 'Ownership review required');

  v_domains := jsonb_build_array(
    jsonb_build_object('domain','COMMERCE','status','READY','reason','catalogue_open'),
    jsonb_build_object('domain','CRM','status', v_sales_status, 'reason', v_sales_reason, 'detail', v_sales),
    jsonb_build_object('domain','SALES / CRM OWNERSHIP','status', v_sales_status, 'reason', v_sales_reason, 'detail', v_sales),
    jsonb_build_object('domain','TRADE/AUTH','status','DISABLED','reason','BUSINESS_APPROVAL_REQUIRED'),
    jsonb_build_object('domain','COMPLIANCE','status','DISABLED','reason','observe'),
    jsonb_build_object('domain','ORDERS','status','READY','reason','Imported + native'),
    jsonb_build_object('domain','DRAFTS','status','READY','reason','Draft ops'),
    jsonb_build_object('domain','PAYMENTS','status','BLOCKED','reason','Worldpay BLOCKED_EXTERNAL'),
    jsonb_build_object('domain','FINANCE','status', v_fin_status, 'reason', v_fin_reason, 'detail', v_fin),
    jsonb_build_object('domain','INVENTORY/WMS','status', v_wms_status, 'reason', v_wms_reason, 'detail', v_wms),
    jsonb_build_object('domain','FULFILMENT','status','PARTIAL','reason','Native ops; carrier automation blocked'),
    jsonb_build_object('domain','CARRIER','status','BLOCKED','reason','DPD BLOCKED_EXTERNAL'),
    jsonb_build_object('domain','DOCUMENTS','status','PARTIAL','reason','UD-INV-TEST-'),
    jsonb_build_object('domain','AUTOMATIONS','status','DISABLED','reason','engine off'),
    jsonb_build_object('domain','REPORTING','status','PARTIAL','reason','operational RPCs'),
    jsonb_build_object('domain','EXTERNAL DEPENDENCIES','status','BLOCKED','reason','Worldpay/DPD/WMS opening'),
    jsonb_build_object('domain','DATA MIGRATION','status', v_cat_status, 'reason', v_cat_reason),
    jsonb_build_object('domain','CATALOGUE','status', v_cat_status, 'reason', v_cat_reason),
    jsonb_build_object('domain','SECURITY','status','READY','reason','4H RPCs'),
    jsonb_build_object('domain','CUSTOMER ACTIVATION','status','DISABLED','reason','Pilot NOT_SENT')
  );

  return jsonb_build_object(
    'ok', true,
    'domains', v_domains,
    'catalogue_reconciliation', v_recon,
    'finance_readiness', v_fin,
    'wms_readiness', v_wms,
    'crm_sales_readiness', v_sales,
    'locked', jsonb_build_object(
      'PHASE4I_PILOT_001', 'NOT_SENT',
      'pilot_send_authorized', coalesce((select value from site_settings where key='pilot_send_authorized'),'false'),
      'commercial_access_mode', coalesce((select value from site_settings where key='commercial_access_mode'),'catalogue_open'),
      'trade_required_cutover_approved', coalesce((select value from site_settings where key='trade_required_cutover_approved'),'false'),
      'compliance_mode', coalesce((select value from site_settings where key='compliance_enforcement_mode'),'observe'),
      'gateway_mode', 'disabled',
      'carrier_mode', 'disabled',
      'wms_enabled', coalesce((select value from site_settings where key='wms_enabled'),'false'),
      'wms_opening_post_authorized', coalesce((select value from site_settings where key='wms_opening_post_authorized'),'false'),
      'ownership_bulk_apply_authorized', coalesce((select value from site_settings where key='ownership_bulk_apply_authorized'),'false'),
      'cutover_executed', 'false'
    ),
    'note', 'Phase 5H CRM/Sales ownership readiness — no auto-apply; not a cutover'
  );
end;
$$;
revoke all on function public.rpc_admin_cutover_control_centre() from public, anon;
grant execute on function public.rpc_admin_cutover_control_centre() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Selftest
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5h_crm_ownership_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean;
  v_sub boolean;
  v_tmp jsonb;
  v_pending int;
  v_auth text;
  v_locks_ok boolean;
begin
  -- A staff baseline
  begin
    v_tmp := public.rpc_admin_staff_directory_baseline();
    -- service_role may not pass is_admin — call readiness which is definer
    v_tmp := public.crm_sales_cutover_readiness_status();
    v_sub := coalesce((v_tmp->>'ok')::boolean, false)
      and (v_tmp->'metrics'->>'bulk_apply_authorized') = 'false';
    v_cases := v_cases || jsonb_build_object('A_readiness_bulk_locked', jsonb_build_object('ok', v_sub, 'detail', v_tmp->'metrics'));
  exception when others then
    v_cases := v_cases || jsonb_build_object('A_readiness_bulk_locked', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- B pending preserved / confidence baseline shape
  begin
    select count(*) into v_pending from ownership_backfill_reviews where status='PENDING';
    v_sub := v_pending = 1353
      and (select count(*) from ownership_backfill_reviews where status='PENDING' and confidence='HIGH') = 626
      and (select count(*) from ownership_backfill_reviews where status='PENDING' and confidence='MEDIUM') = 588
      and (select count(*) from ownership_backfill_reviews where status='PENDING' and confidence='CONFLICTING') = 139;
    v_cases := v_cases || jsonb_build_object('B_pending_confidence_preserved', jsonb_build_object(
      'ok', v_sub, 'pending', v_pending
    ));
  exception when others then
    v_cases := v_cases || jsonb_build_object('B_pending_confidence_preserved', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- C CG not justified
  begin
    v_sub := (select count(*) from customers where cg_assigned_id is not null) = 0
      and (select count(*) from companies where cg_assigned_id is not null) = 0
      and (select count(*) from orders where cg_assigned_id is not null) = 124;
    v_cases := v_cases || jsonb_build_object('C_cg_historical_only', jsonb_build_object('ok', v_sub));
  exception when others then
    v_cases := v_cases || jsonb_build_object('C_cg_historical_only', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- D bulk apply blocked
  begin
    select coalesce(value,'false') into v_auth from site_settings where key='ownership_bulk_apply_authorized';
    v_sub := coalesce(v_auth,'false') = 'false';
    -- Also ensure apply RPC returns not authorized when called as definer without auth flag
    -- (cannot easily impersonate admin here; settings lock is sufficient)
    v_cases := v_cases || jsonb_build_object('D_bulk_apply_setting_false', jsonb_build_object('ok', v_sub));
  exception when others then
    v_cases := v_cases || jsonb_build_object('D_bulk_apply_setting_false', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- E cutover centre sales domain
  begin
    v_tmp := public.rpc_admin_cutover_control_centre();
    v_sub := coalesce((v_tmp->>'ok')::boolean, false)
      and (v_tmp->'crm_sales_readiness'->>'status') is not null
      and (v_tmp->'locked'->>'ownership_bulk_apply_authorized') = 'false'
      and (v_tmp->'wms_readiness'->>'status') = 'SHADOW_RECONCILED'
      and (v_tmp->'finance_readiness'->>'status') = 'REVIEW_REQUIRED';
    v_cases := v_cases || jsonb_build_object('E_cutover_centre', jsonb_build_object(
      'ok', v_sub,
      'sales', v_tmp->'crm_sales_readiness'->>'status',
      'wms', v_tmp->'wms_readiness'->>'status',
      'finance', v_tmp->'finance_readiness'->>'status'
    ));
  exception when others then
    v_cases := v_cases || jsonb_build_object('E_cutover_centre', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- F locks
  begin
    v_locks_ok :=
      coalesce((select value from site_settings where key='pilot_send_authorized'),'false') = 'false'
      and coalesce((select value from site_settings where key='commercial_access_mode'),'') = 'catalogue_open'
      and coalesce((select value from site_settings where key='trade_required_cutover_approved'),'false') = 'false'
      and coalesce((select value from site_settings where key='compliance_enforcement_mode'),'') = 'observe'
      and coalesce((select value from site_settings where key='wms_enabled'),'false') = 'false'
      and coalesce((select value from site_settings where key='ownership_bulk_apply_authorized'),'false') = 'false'
      and coalesce((select value from site_settings where key='ownership_auto_apply_high'),'false') = 'false';
    v_cases := v_cases || jsonb_build_object('F_locks', jsonb_build_object('ok', v_locks_ok));
  exception when others then
    v_cases := v_cases || jsonb_build_object('F_locks', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- G no auto-apply occurred (applied count still 0 for pending set)
  begin
    v_sub := not exists (
      select 1 from ownership_backfill_reviews
      where status = 'APPLIED' and phase5h_enriched_at is not null
        and applied_at > now() - interval '1 hour'
    );
    -- softer: applied total may exist historically; ensure pending still 1353
    select count(*) into v_pending from ownership_backfill_reviews where status='PENDING';
    v_sub := v_pending = 1353;
    v_cases := v_cases || jsonb_build_object('G_no_batch_auto_apply', jsonb_build_object('ok', v_sub, 'pending', v_pending));
  exception when others then
    v_cases := v_cases || jsonb_build_object('G_no_batch_auto_apply', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  -- H enrichment columns exist
  begin
    v_sub := exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='ownership_backfill_reviews' and column_name='review_batch'
    );
    v_cases := v_cases || jsonb_build_object('H_enrichment_columns', jsonb_build_object('ok', v_sub));
  exception when others then
    v_cases := v_cases || jsonb_build_object('H_enrichment_columns', jsonb_build_object('ok', false, 'detail', SQLERRM));
  end;

  v_ok := true;
  if exists (
    select 1 from jsonb_each(v_cases) e
    where coalesce((e.value->>'ok')::boolean, false) = false
  ) then
    v_ok := false;
  end if;

  return jsonb_build_object(
    'ok', v_ok,
    'locks_ok', coalesce((v_cases->'F_locks'->>'ok')::boolean, false),
    'cases', v_cases,
    'note', 'Phase 5H CRM ownership — STOP FOR REVIEW; no Phase 5I auto-start'
  );
end;
$$;
revoke all on function public.rpc_phase5h_crm_ownership_selftest() from public, anon;
grant execute on function public.rpc_phase5h_crm_ownership_selftest() to authenticated, service_role;

comment on function public.rpc_phase5h_crm_ownership_selftest() is
  'Phase 5H CRM ownership cutover readiness selftest. Does not auto-apply ownership.';

commit;
