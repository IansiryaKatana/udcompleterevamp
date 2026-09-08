-- Phase 5F — Finance reconciliation & cutover balance closure
-- Hard rules: do not overwrite imported Shopify source money; do not invent payments/due dates;
-- do not enable live gateway/carrier/WMS; do not contact customers; do not cut over.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Monetary tolerance (GBP)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.finance_money_tolerance_gbp()
returns numeric
language sql
immutable
security invoker
set search_path = public
as $$
  select 0.02::numeric; -- 2 pence; trivial rounding only — not a material shield
$$;

comment on function public.finance_money_tolerance_gbp() is
  'Phase 5F: GBP rounding tolerance. WITHIN_TOLERANCE ≤ 0.02; larger gaps are MATERIAL_VARIANCE.';

grant execute on function public.finance_money_tolerance_gbp() to authenticated, service_role;

create or replace function public.finance_variance_materiality(p_amount numeric)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when abs(coalesce(p_amount, 0)) <= public.finance_money_tolerance_gbp() then 'WITHIN_TOLERANCE'
    else 'MATERIAL_VARIANCE'
  end;
$$;

grant execute on function public.finance_variance_materiality(numeric) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Review queue + append-only notes + future cutover snapshot shell
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.finance_reconciliation_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_number text,
  pattern_code text,
  classification text not null,
  severity text not null default 'INFO',
  variance_amount numeric(14,2) not null default 0,
  abs_variance numeric(14,2) not null default 0,
  materiality text not null default 'MATERIAL_VARIANCE',
  source_total numeric(14,2),
  source_received numeric(14,2),
  source_outstanding numeric(14,2),
  source_financial_status text,
  calculated_received numeric(14,2),
  calculated_outstanding numeric(14,2),
  calculated_financial_status text,
  raw_outstanding_unclamped numeric(14,2),
  reviewed_outstanding numeric(14,2),
  opening_basis text,
  opening_outstanding numeric(14,2),
  gateway_summary text,
  refund_class text,
  exception_flags jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  review_status text not null default 'UNREVIEWED',
  reason text,
  decision text,
  notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  classified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_recon_reviews_order_uidx unique (order_id),
  constraint finance_recon_reviews_classification_chk check (classification in (
    'SEMANTICALLY_EXPLAINED',
    'SOURCE_INCONSISTENCY',
    'IMPORT_DEFECT',
    'CALCULATION_DEFECT',
    'REFUND_TIMING',
    'PAYMENT_TIMING',
    'LEGACY_MANUAL_WORKFLOW',
    'INSUFFICIENT_EVIDENCE',
    'BUSINESS_REVIEW_REQUIRED'
  )),
  constraint finance_recon_reviews_severity_chk check (severity in (
    'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  )),
  constraint finance_recon_reviews_status_chk check (review_status in (
    'UNREVIEWED',
    'EXPLAINED',
    'ACCEPTED_SOURCE_VARIANCE',
    'REQUIRES_ACTION',
    'RESOLVED_BY_CODE_FIX'
  )),
  constraint finance_recon_reviews_opening_basis_chk check (
    opening_basis is null or opening_basis in (
      'SOURCE_OUTSTANDING', 'CALCULATED_OUTSTANDING', 'REVIEWED_OUTSTANDING'
    )
  ),
  constraint finance_recon_reviews_materiality_chk check (materiality in (
    'WITHIN_TOLERANCE', 'MATERIAL_VARIANCE'
  ))
);

create index if not exists finance_recon_reviews_status_idx
  on public.finance_reconciliation_reviews (review_status, severity, classification);
create index if not exists finance_recon_reviews_abs_var_idx
  on public.finance_reconciliation_reviews (abs_variance desc);
create index if not exists finance_recon_reviews_gateway_idx
  on public.finance_reconciliation_reviews (gateway_summary);

comment on table public.finance_reconciliation_reviews is
  'Phase 5F: classified finance mismatches. Does not mutate orders.source_* money snapshots.';

alter table public.finance_reconciliation_reviews enable row level security;

drop policy if exists finance_recon_reviews_admin_select on public.finance_reconciliation_reviews;
create policy finance_recon_reviews_admin_select
  on public.finance_reconciliation_reviews for select to authenticated
  using (public.can_view_finance());

drop policy if exists finance_recon_reviews_admin_write on public.finance_reconciliation_reviews;
create policy finance_recon_reviews_admin_write
  on public.finance_reconciliation_reviews for all to authenticated
  using (public.current_admin_is_owner_or_admin())
  with check (public.current_admin_is_owner_or_admin());

revoke all on table public.finance_reconciliation_reviews from public, anon;
grant select on table public.finance_reconciliation_reviews to authenticated;
grant select, insert, update on table public.finance_reconciliation_reviews to service_role;

create table if not exists public.finance_reconciliation_review_notes (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.finance_reconciliation_reviews(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid,
  action text not null,
  classification text,
  review_status text,
  reason text,
  decision text,
  notes text,
  reviewed_outstanding numeric(14,2),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_recon_notes_review_idx
  on public.finance_reconciliation_review_notes (review_id, created_at desc);

comment on table public.finance_reconciliation_review_notes is
  'Append-only audit for finance reconciliation review decisions. Never rewrite history.';

alter table public.finance_reconciliation_review_notes enable row level security;

drop policy if exists finance_recon_notes_select on public.finance_reconciliation_review_notes;
create policy finance_recon_notes_select
  on public.finance_reconciliation_review_notes for select to authenticated
  using (public.can_view_finance());

drop policy if exists finance_recon_notes_insert on public.finance_reconciliation_review_notes;
create policy finance_recon_notes_insert
  on public.finance_reconciliation_review_notes for insert to authenticated
  with check (public.current_admin_is_owner_or_admin());

-- Prevent UPDATE/DELETE on notes (append-only)
revoke update, delete on table public.finance_reconciliation_review_notes from authenticated, public, anon;
grant select, insert on table public.finance_reconciliation_review_notes to authenticated, service_role;

-- Immutable cutover snapshot shell (no T-0 rows yet)
create table if not exists public.finance_cutover_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  cutover_batch text not null,
  recorded_at timestamptz not null default now(),
  order_id uuid not null references public.orders(id),
  order_number text,
  customer_id uuid,
  company_id uuid,
  source_outstanding numeric(14,2),
  calculated_outstanding numeric(14,2),
  reviewed_outstanding numeric(14,2),
  opening_outstanding numeric(14,2),
  opening_basis text,
  classification text,
  variance_amount numeric(14,2),
  source_timestamp timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  constraint finance_cutover_snap_batch_order_uidx unique (cutover_batch, order_id)
);

comment on table public.finance_cutover_balance_snapshots is
  'Phase 5F design: immutable T-0 finance opening snapshot. Do not populate until authorized cutover.';

alter table public.finance_cutover_balance_snapshots enable row level security;

drop policy if exists finance_cutover_snap_select on public.finance_cutover_balance_snapshots;
create policy finance_cutover_snap_select
  on public.finance_cutover_balance_snapshots for select to authenticated
  using (public.can_view_finance());

revoke insert, update, delete on table public.finance_cutover_balance_snapshots from authenticated, public, anon;
grant select on table public.finance_cutover_balance_snapshots to authenticated;
grant select, insert on table public.finance_cutover_balance_snapshots to service_role;

-- Repair log (import repairs only — none auto-applied unless logged here)
create table if not exists public.finance_import_repair_log (
  id uuid primary key default gen_random_uuid(),
  repair_batch text not null,
  source text not null,
  entity_type text not null,
  entity_id uuid,
  external_ref text,
  before_state jsonb,
  after_state jsonb,
  note text,
  created_at timestamptz not null default now()
);

alter table public.finance_import_repair_log enable row level security;
drop policy if exists finance_import_repair_select on public.finance_import_repair_log;
create policy finance_import_repair_select
  on public.finance_import_repair_log for select to authenticated
  using (public.can_view_finance());
grant select on table public.finance_import_repair_log to authenticated, service_role;
grant insert on table public.finance_import_repair_log to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Enhance ledger calc: expose unclamped outstanding (no source mutation)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.finance_calculate_order_ledger(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_received numeric(14,2) := 0;
  v_refunded numeric(14,2) := 0;
  v_pending_external numeric(14,2) := 0;
  v_authorized numeric(14,2) := 0;
  v_net numeric(14,2);
  v_outstanding numeric(14,2);
  v_raw_outstanding numeric(14,2);
  v_status text;
  v_recon text;
  v_variance_received numeric(14,2);
  v_variance_outstanding numeric(14,2);
  v_tol numeric(14,2) := public.finance_money_tolerance_gbp();
  r record;
  sem jsonb;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  for r in
    select gateway, kind, status, amount, source_system
    from public.payment_transactions
    where order_id = p_order_id
  loop
    sem := public.payment_tx_semantic_classify(r.gateway, r.kind, r.status, r.source_system);
    if coalesce((sem->>'affects_received')::boolean, false) then
      v_received := v_received + coalesce(r.amount, 0);
    end if;
    if coalesce((sem->>'affects_refunded')::boolean, false) then
      v_refunded := v_refunded + coalesce(r.amount, 0);
    end if;
    if sem->>'meaning' = 'PENDING_EXTERNAL_PAYMENT' then
      v_pending_external := v_pending_external + coalesce(r.amount, 0);
    end if;
    if coalesce((sem->>'affects_available_to_capture')::boolean, false) then
      v_authorized := v_authorized + coalesce(r.amount, 0);
    end if;
  end loop;

  v_net := greatest(v_received - v_refunded, 0);
  v_raw_outstanding := coalesce(v_order.total, 0) - v_net; -- may be negative; never silently discarded
  v_outstanding := greatest(v_raw_outstanding, 0);
  v_status := public.finance_financial_status_from_amounts(
    coalesce(v_order.total, 0), v_net, v_outstanding
  );

  v_variance_received := round(coalesce(v_order.source_total_received, v_order.total_received, 0) - v_net, 2);
  v_variance_outstanding := round(
    coalesce(v_order.source_total_outstanding, v_order.total_outstanding, 0) - v_outstanding, 2
  );

  if abs(v_variance_received) <= v_tol and abs(v_variance_outstanding) <= v_tol then
    v_recon := 'MATCHED';
  elsif not exists (select 1 from public.payment_transactions where order_id = p_order_id)
        and coalesce(v_order.source_total_received, 0) > 0.01 then
    v_recon := 'INSUFFICIENT_EVIDENCE';
  else
    v_recon := 'MISMATCHED';
  end if;

  if v_order.reconciliation_status in ('REVIEWED_ACCEPTED', 'REVIEWED_CORRECTED_BY_UNIQUE_EVENT') then
    v_recon := v_order.reconciliation_status;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'money_ledger_mode', v_order.money_ledger_mode,
    'imported', jsonb_build_object(
      'total', v_order.source_total,
      'received', v_order.source_total_received,
      'outstanding', v_order.source_total_outstanding,
      'financial_status', v_order.source_financial_status
    ),
    'calculated', jsonb_build_object(
      'received', round(v_received, 2),
      'refunded', round(v_refunded, 2),
      'net_received', round(v_net, 2),
      'outstanding', round(v_outstanding, 2),
      'raw_outstanding_unclamped', round(v_raw_outstanding, 2),
      'financial_status', v_status,
      'pending_external', round(v_pending_external, 2),
      'authorized_available', round(v_authorized, 2)
    ),
    'working_cache', jsonb_build_object(
      'total', v_order.total,
      'received', v_order.total_received,
      'outstanding', v_order.total_outstanding,
      'financial_status', v_order.financial_status
    ),
    'variance', jsonb_build_object(
      'received', v_variance_received,
      'outstanding', v_variance_outstanding,
      'materiality', public.finance_variance_materiality(
        greatest(abs(v_variance_received), abs(v_variance_outstanding))
      )
    ),
    'reconciliation_status', v_recon,
    'rule', 'PENDING_EXTERNAL_PAYMENT does NOT count as received; raw_outstanding_unclamped preserved (not clamped away)'
  );
end;
$$;

grant execute on function public.finance_calculate_order_ledger(uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Opening AR model (per-order; not a global single choice)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.finance_opening_position_for_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_review public.finance_reconciliation_reviews%rowtype;
  v_calc jsonb;
  v_source_out numeric(14,2);
  v_calc_out numeric(14,2);
  v_basis text;
  v_amount numeric(14,2);
  v_ready boolean := false;
  v_reason text;
  v_tol numeric := public.finance_money_tolerance_gbp();
  v_source_consistent boolean;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_calc := public.finance_calculate_order_ledger(p_order_id);
  v_source_out := coalesce(v_order.source_total_outstanding, v_order.total_outstanding, 0);
  v_calc_out := coalesce((v_calc->'calculated'->>'outstanding')::numeric, 0);
  v_source_consistent :=
    round(v_source_out, 2) = round(greatest(coalesce(v_order.source_total, v_order.total, 0)
      - coalesce(v_order.source_total_received, v_order.total_received, 0), 0), 2);

  select * into v_review from public.finance_reconciliation_reviews where order_id = p_order_id;

  if v_review.id is not null
     and v_review.reviewed_outstanding is not null
     and v_review.review_status in ('EXPLAINED', 'ACCEPTED_SOURCE_VARIANCE', 'RESOLVED_BY_CODE_FIX') then
    v_basis := 'REVIEWED_OUTSTANDING';
    v_amount := v_review.reviewed_outstanding;
    v_ready := true;
    v_reason := 'Finance review decision takes precedence';
  elsif coalesce(v_order.money_ledger_mode, '') = 'unique_ledger' then
    v_basis := 'CALCULATED_OUTSTANDING';
    v_amount := v_calc_out;
    v_ready := true;
    v_reason := 'Unique-native ledger uses calculated semantics';
  elsif v_source_consistent then
    v_basis := 'SOURCE_OUTSTANDING';
    v_amount := greatest(v_source_out, 0);
    v_ready := true;
    v_reason := 'Source snapshot arithmetic consistent';
  elsif upper(coalesce(v_order.source_financial_status, v_order.financial_status, '')) in ('PAID', 'VOIDED', 'REFUNDED')
        and v_source_out <= v_tol then
    -- Do not inflate opening AR from formula gaps when Shopify closed the balance
    v_basis := 'SOURCE_OUTSTANDING';
    v_amount := 0;
    v_ready := false; -- still needs review acceptance for material gaps
    v_reason := 'Source closed (PAID/VOIDED/REFUNDED, out≈0); formula gap must not auto-create collectible AR';
  elsif abs(v_calc_out - greatest(v_source_out, 0)) <= v_tol then
    v_basis := 'CALCULATED_OUTSTANDING';
    v_amount := v_calc_out;
    v_ready := true;
    v_reason := 'Calculated agrees with non-negative source within tolerance';
  elsif v_source_out > v_tol then
    v_basis := 'SOURCE_OUTSTANDING';
    v_amount := v_source_out;
    v_ready := false;
    v_reason := 'Open source AR retained pending review; calculated may differ';
  else
    v_basis := 'CALCULATED_OUTSTANDING';
    v_amount := v_calc_out;
    v_ready := false;
    v_reason := 'Insufficient proven position — review required before cutover inclusion';
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'opening_basis', v_basis,
    'opening_outstanding', round(v_amount, 2),
    'source_outstanding', round(v_source_out, 2),
    'calculated_outstanding', round(v_calc_out, 2),
    'reviewed_outstanding', v_review.reviewed_outstanding,
    'ready_for_cutover_opening', v_ready,
    'reason', v_reason,
    'aging_bucket', public.finance_aging_bucket(v_order.payment_due_on, current_date)
  );
end;
$$;

grant execute on function public.finance_opening_position_for_order(uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Classify a single order mismatch (evidence-bearing)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.finance_classify_order_reconciliation(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_calc jsonb;
  v_total numeric(14,2);
  v_recv numeric(14,2);
  v_out numeric(14,2);
  v_exp numeric(14,2);
  v_var numeric(14,2);
  v_abs numeric(14,2);
  v_fs text;
  v_pattern text;
  v_class text;
  v_sev text;
  v_reason text;
  v_gateway text;
  v_refund_class text := null;
  v_flags jsonb := '[]'::jsonb;
  v_pending numeric(14,2);
  v_calc_recv numeric(14,2);
  v_calc_out numeric(14,2);
  v_raw numeric(14,2);
  v_tx_count int := 0;
  v_has_refund_hdr boolean := false;
  v_has_refund_tx boolean := false;
  v_opening jsonb;
  v_tol numeric := public.finance_money_tolerance_gbp();
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_total := coalesce(v_order.total, 0);
  v_recv := coalesce(v_order.total_received, 0);
  v_out := coalesce(v_order.total_outstanding, 0);
  v_exp := greatest(v_total - v_recv, 0);
  v_var := round(v_out - v_exp, 2);
  v_abs := abs(v_var);
  v_fs := upper(coalesce(v_order.financial_status, ''));

  -- Only classify exception universe (plus paid-zero / refund oddities)
  if round(v_out, 2) is not distinct from round(v_exp, 2)
     and not (v_fs in ('PAID', 'PARTIALLY_PAID') and v_recv = 0 and v_total > 0)
     and v_out >= 0
     and v_recv <= v_total + 0.009 then
    return jsonb_build_object('ok', true, 'in_scope', false, 'order_id', p_order_id);
  end if;

  v_calc := public.finance_calculate_order_ledger(p_order_id);
  v_pending := coalesce((v_calc->'calculated'->>'pending_external')::numeric, 0);
  v_calc_recv := coalesce((v_calc->'calculated'->>'received')::numeric, 0);
  v_calc_out := coalesce((v_calc->'calculated'->>'outstanding')::numeric, 0);
  v_raw := coalesce((v_calc->'calculated'->>'raw_outstanding_unclamped')::numeric, 0);

  select count(*) into v_tx_count from public.payment_transactions where order_id = p_order_id;
  select exists(select 1 from public.refunds r where r.order_id = p_order_id) into v_has_refund_hdr;
  select exists(
    select 1 from public.payment_transactions pt
    where pt.order_id = p_order_id and upper(pt.kind) = 'REFUND' and upper(pt.status) = 'SUCCESS'
  ) into v_has_refund_tx;

  select string_agg(distinct lower(trim(coalesce(gateway, ''))), ',' order by lower(trim(coalesce(gateway, ''))))
  into v_gateway
  from public.payment_transactions where order_id = p_order_id;

  if v_gateway is null or v_gateway = '' then
    v_gateway := 'NO_TX';
  end if;

  -- Pattern
  if v_out < 0 then
    v_pattern := 'NEG_OUT';
    v_flags := v_flags || jsonb_build_array('NEGATIVE_OUTSTANDING');
  elsif v_recv > v_total + 0.009 then
    v_pattern := 'RECV_GT_TOTAL';
    v_flags := v_flags || jsonb_build_array('RECEIVED_EXCEEDS_TOTAL');
  elsif v_fs in ('PAID', 'PARTIALLY_PAID') and v_recv = 0 and v_total > 0 then
    v_pattern := 'PAID_ZERO_RECEIVED';
    v_flags := v_flags || jsonb_build_array('PAID_ZERO_RECEIVED');
  elsif v_out = 0 and v_recv + 0.009 < v_total and v_fs in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') then
    v_pattern := 'PAIDISH_OUT0_RECV_LT_TOTAL';
    v_flags := v_flags || jsonb_build_array('OUTSTANDING_MISMATCH');
  elsif v_out = 0 and v_recv = 0 and v_total > 0 then
    v_pattern := 'OUT0_RECV0_TOTAL_GT0';
    v_flags := v_flags || jsonb_build_array('OUTSTANDING_MISMATCH');
  elsif round(v_out, 2) is distinct from round(v_exp, 2) then
    v_pattern := 'OUT_NE_TOTAL_MINUS_RECV';
    v_flags := v_flags || jsonb_build_array('OUTSTANDING_MISMATCH');
  else
    v_pattern := 'OTHER';
    v_flags := v_flags || jsonb_build_array('OTHER');
  end if;

  -- Refund class
  if v_has_refund_hdr and v_has_refund_tx then
    v_refund_class := 'FULLY_RECONCILED';
  elsif v_has_refund_hdr and not v_has_refund_tx then
    v_refund_class := 'ZERO_CASH_RESTOCK_STYLE';
    v_flags := v_flags || jsonb_build_array('REFUND_MISMATCH');
  elsif v_has_refund_tx and not v_has_refund_hdr then
    v_refund_class := 'TX_MISSING'; -- header missing relative to tx
    v_flags := v_flags || jsonb_build_array('REFUND_MISMATCH');
  elsif v_has_refund_hdr then
    v_refund_class := 'PARTIAL';
  end if;

  -- Classification (priority)
  if coalesce(v_order.is_test, false)
     or v_order.order_number ~* '^(p4[a-z]|p5[a-z]|phase)' then
    v_class := 'LEGACY_MANUAL_WORKFLOW';
    v_reason := 'Synthetic/test Unique order with cache arithmetic inconsistent with total-received formula';
  elsif v_tx_count = 0 and v_recv > v_tol then
    v_class := 'INSUFFICIENT_EVIDENCE';
    v_reason := 'Source received > 0 but no payment_transactions rows';
  elsif v_pattern = 'PAID_ZERO_RECEIVED' and v_tx_count = 0 then
    v_class := 'INSUFFICIENT_EVIDENCE';
    v_reason := 'PAID/PARTIALLY_PAID with £0 received and no transaction evidence — do not fabricate payments';
  elsif v_pattern = 'PAID_ZERO_RECEIVED' then
    v_class := 'SOURCE_INCONSISTENCY';
    v_reason := 'Shopify financial_status paid-like with zero received snapshot; txs present but do not settle to received';
  elsif v_pattern = 'NEG_OUT' then
    v_class := 'SOURCE_INCONSISTENCY';
    v_reason := format(
      'Source/cache outstanding is negative (%s); raw calculated unclamped=%s (not clamped away in evidence)',
      v_out, v_raw
    );
  elsif v_pattern = 'RECV_GT_TOTAL' then
    v_class := 'SOURCE_INCONSISTENCY';
    v_reason := 'Received snapshot exceeds order total (overpayment/duplication/refund sequencing) — no auto-correction';
  elsif v_pending > v_tol and v_calc_recv + v_tol < v_total
        and v_gateway like '%bank deposit%' then
    v_class := 'PAYMENT_TIMING';
    v_reason := 'Bank Deposit PENDING present — PENDING is not cash received; snapshot may show closed AR';
  elsif v_gateway like '%pay later%' or v_gateway like '%order now, pay later%' then
    if v_pending > v_tol and v_calc_recv <= v_tol then
      v_class := 'PAYMENT_TIMING';
      v_reason := 'Historical PAY LATER PENDING commitment — not received; eligibility permissions unchanged';
    elsif v_calc_recv > v_tol then
      v_class := 'LEGACY_MANUAL_WORKFLOW';
      v_reason := 'PAY LATER history settled via later SUCCESS/manual posts; finance-only analysis';
    else
      v_class := 'SOURCE_INCONSISTENCY';
      v_reason := 'PAY LATER related order with source outstanding arithmetic inconsistent';
    end if;
  elsif v_refund_class = 'ZERO_CASH_RESTOCK_STYLE' and v_pattern in ('PAIDISH_OUT0_RECV_LT_TOTAL', 'OUT0_RECV0_TOTAL_GT0') then
    v_class := 'REFUND_TIMING';
    v_reason := 'Refund header without SUCCESS refund payment tx (restock/adjustment style) — REFUND≠RETURN≠RESTOCK cash';
  elsif abs(v_calc_recv - v_recv) <= v_tol
        and round(v_out, 2) is distinct from round(v_exp, 2) then
    v_class := 'SOURCE_INCONSISTENCY';
    v_reason := 'Calculated received matches source received; outstanding ≠ total−received is Shopify snapshot inconsistency';  elsif abs(v_calc_recv - v_recv) > v_tol and v_tx_count > 0 then
    -- Likely semantic/source labelling, not Unique rewriting source
    v_class := 'SEMANTICALLY_EXPLAINED';
    v_reason := format(
      'Gateway-semantic calculated received (%s) differs from source received (%s); PENDING≠received preserved',
      v_calc_recv, v_recv
    );
  elsif v_tx_count = 0 then
    v_class := 'INSUFFICIENT_EVIDENCE';
    v_reason := 'No payment transactions to prove cash position';
  else
    v_class := 'BUSINESS_REVIEW_REQUIRED';
    v_reason := 'Material mismatch without a single conclusive technical explanation';
  end if;

  -- Severity
  if v_abs <= v_tol and v_pattern <> 'PAID_ZERO_RECEIVED' then
    v_sev := 'INFO';
  elsif v_pattern = 'PAID_ZERO_RECEIVED' and v_total >= 1000 then
    v_sev := 'CRITICAL';
  elsif v_pattern = 'PAID_ZERO_RECEIVED' then
    v_sev := 'HIGH';
  elsif v_abs >= 10000 then
    v_sev := 'CRITICAL';
  elsif v_abs >= 1000 then
    v_sev := 'HIGH';
  elsif v_abs >= 100 then
    v_sev := 'MEDIUM';
  elsif v_out < 0 and v_abs >= 50 then
    v_sev := 'HIGH';
  elsif v_out < 0 then
    v_sev := 'MEDIUM';
  else
    v_sev := 'LOW';
  end if;

  v_opening := public.finance_opening_position_for_order(p_order_id);

  return jsonb_build_object(
    'ok', true,
    'in_scope', true,
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'pattern_code', v_pattern,
    'classification', v_class,
    'severity', v_sev,
    'variance_amount', v_var,
    'abs_variance', v_abs,
    'materiality', public.finance_variance_materiality(v_abs),
    'source_total', v_total,
    'source_received', v_recv,
    'source_outstanding', v_out,
    'source_financial_status', v_order.financial_status,
    'calculated_received', v_calc_recv,
    'calculated_outstanding', v_calc_out,
    'calculated_financial_status', v_calc->'calculated'->>'financial_status',
    'raw_outstanding_unclamped', v_raw,
    'gateway_summary', v_gateway,
    'refund_class', v_refund_class,
    'exception_flags', v_flags,
    'opening_basis', v_opening->>'opening_basis',
    'opening_outstanding', (v_opening->>'opening_outstanding')::numeric,
    'reason', v_reason,
    'evidence', jsonb_build_object(
      'ledger', v_calc,
      'tx_count', v_tx_count,
      'has_refund_header', v_has_refund_hdr,
      'has_refund_success_tx', v_has_refund_tx,
      'pending_external', v_pending,
      'expected_outstanding_formula', v_exp,
      'tolerance_gbp', v_tol
    )
  );
end;
$$;

grant execute on function public.finance_classify_order_reconciliation(uuid) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Rebuild / delta queue
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5f_reconcile_order_delta(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cls jsonb;
  v_existing public.finance_reconciliation_reviews%rowtype;
begin
  if auth.uid() is not null and not public.current_admin_is_owner_or_admin() and not public.is_admin() then
    -- allow service role (auth.uid null)
    if auth.uid() is not null then
      return jsonb_build_object('ok', false, 'error', 'Forbidden');
    end if;
  end if;

  v_cls := public.finance_classify_order_reconciliation(p_order_id);
  if coalesce(v_cls->>'ok', 'false') <> 'true' then
    return v_cls;
  end if;

  if coalesce((v_cls->>'in_scope')::boolean, false) is not true then
    delete from public.finance_reconciliation_reviews where order_id = p_order_id
      and review_status = 'UNREVIEWED';
    return jsonb_build_object('ok', true, 'in_scope', false, 'cleared_unreviewed', true);
  end if;

  select * into v_existing from public.finance_reconciliation_reviews where order_id = p_order_id;

  insert into public.finance_reconciliation_reviews as r (
    order_id, order_number, pattern_code, classification, severity,
    variance_amount, abs_variance, materiality,
    source_total, source_received, source_outstanding, source_financial_status,
    calculated_received, calculated_outstanding, calculated_financial_status,
    raw_outstanding_unclamped, opening_basis, opening_outstanding,
    gateway_summary, refund_class, exception_flags, evidence, reason,
    review_status, reviewed_outstanding, decision, notes, reviewed_by, reviewed_at,
    classified_at, updated_at
  ) values (
    p_order_id,
    v_cls->>'order_number',
    v_cls->>'pattern_code',
    v_cls->>'classification',
    v_cls->>'severity',
    (v_cls->>'variance_amount')::numeric,
    (v_cls->>'abs_variance')::numeric,
    v_cls->>'materiality',
    (v_cls->>'source_total')::numeric,
    (v_cls->>'source_received')::numeric,
    (v_cls->>'source_outstanding')::numeric,
    v_cls->>'source_financial_status',
    (v_cls->>'calculated_received')::numeric,
    (v_cls->>'calculated_outstanding')::numeric,
    v_cls->>'calculated_financial_status',
    (v_cls->>'raw_outstanding_unclamped')::numeric,
    v_cls->>'opening_basis',
    (v_cls->>'opening_outstanding')::numeric,
    v_cls->>'gateway_summary',
    v_cls->>'refund_class',
    coalesce(v_cls->'exception_flags', '[]'::jsonb),
    coalesce(v_cls->'evidence', '{}'::jsonb),
    v_cls->>'reason',
    coalesce(v_existing.review_status, 'UNREVIEWED'),
    v_existing.reviewed_outstanding,
    v_existing.decision,
    v_existing.notes,
    v_existing.reviewed_by,
    v_existing.reviewed_at,
    now(),
    now()
  )
  on conflict (order_id) do update set
    order_number = excluded.order_number,
    pattern_code = excluded.pattern_code,
    classification = case
      when r.review_status in ('EXPLAINED', 'ACCEPTED_SOURCE_VARIANCE', 'RESOLVED_BY_CODE_FIX')
        then r.classification
      else excluded.classification
    end,
    severity = excluded.severity,
    variance_amount = excluded.variance_amount,
    abs_variance = excluded.abs_variance,
    materiality = excluded.materiality,
    source_total = excluded.source_total,
    source_received = excluded.source_received,
    source_outstanding = excluded.source_outstanding,
    source_financial_status = excluded.source_financial_status,
    calculated_received = excluded.calculated_received,
    calculated_outstanding = excluded.calculated_outstanding,
    calculated_financial_status = excluded.calculated_financial_status,
    raw_outstanding_unclamped = excluded.raw_outstanding_unclamped,
    opening_basis = excluded.opening_basis,
    opening_outstanding = excluded.opening_outstanding,
    gateway_summary = excluded.gateway_summary,
    refund_class = excluded.refund_class,
    exception_flags = excluded.exception_flags,
    evidence = excluded.evidence,
    reason = case
      when r.review_status in ('EXPLAINED', 'ACCEPTED_SOURCE_VARIANCE', 'RESOLVED_BY_CODE_FIX')
        then r.reason
      else excluded.reason
    end,
    classified_at = now(),
    updated_at = now();

  return jsonb_build_object('ok', true, 'in_scope', true, 'order_id', p_order_id, 'classification', v_cls->>'classification');
end;
$$;

revoke all on function public.rpc_phase5f_reconcile_order_delta(uuid) from public, anon;
grant execute on function public.rpc_phase5f_reconcile_order_delta(uuid) to authenticated, service_role;

create or replace function public.rpc_phase5f_rebuild_reconciliation_queue(p_limit int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_n int := 0;
  v_lim int := coalesce(p_limit, 100000);
  v_res jsonb;
begin
  if auth.uid() is not null and not public.is_admin() and not public.current_admin_is_owner_or_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  for r in
    select id from public.orders o
    where
      round(coalesce(o.total_outstanding, 0), 2)
        is distinct from round(greatest(coalesce(o.total, 0) - coalesce(o.total_received, 0), 0), 2)
      or coalesce(o.total_outstanding, 0) < 0
      or coalesce(o.total_received, 0) > coalesce(o.total, 0) + 0.009
      or (
        upper(coalesce(o.financial_status, '')) in ('PAID', 'PARTIALLY_PAID')
        and coalesce(o.total_received, 0) = 0
        and coalesce(o.total, 0) > 0
      )
    order by abs(coalesce(o.total_outstanding, 0) - greatest(coalesce(o.total, 0) - coalesce(o.total_received, 0), 0)) desc
    limit v_lim
  loop
    v_res := public.rpc_phase5f_reconcile_order_delta(r.id);
    if coalesce(v_res->>'ok', 'false') = 'true' and coalesce((v_res->>'in_scope')::boolean, false) then
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'classified', v_n);
end;
$$;

revoke all on function public.rpc_phase5f_rebuild_reconciliation_queue(int) from public, anon;
grant execute on function public.rpc_phase5f_rebuild_reconciliation_queue(int) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Baseline + exposure + review queue RPCs
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rpc_phase5f_finance_baseline()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders bigint;
  v_tx bigint;
  v_ref bigint;
  v_reflines bigint;
  v_total numeric;
  v_recv numeric;
  v_out numeric;
  v_mismatch bigint;
  v_neg bigint;
  v_exceed bigint;
  v_tx_exceed bigint;
  v_paid_zero bigint;
  v_refund_mis bigint;
  v_abs numeric;
  v_net numeric;
  v_no_due bigint;
  v_queue bigint;
begin
  if auth.uid() is not null and not public.can_view_finance() and not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_orders from orders;
  select count(*) into v_tx from payment_transactions;
  select count(*) into v_ref from refunds;
  select count(*) into v_reflines from refund_line_items;
  select round(coalesce(sum(total),0),2), round(coalesce(sum(total_received),0),2), round(coalesce(sum(total_outstanding),0),2)
    into v_total, v_recv, v_out from orders;

  select count(*) into v_mismatch from orders
  where round(coalesce(total_outstanding,0),2)
        is distinct from round(greatest(coalesce(total,0)-coalesce(total_received,0),0),2);
  select count(*) into v_neg from orders where coalesce(total_outstanding,0) < 0;
  select count(*) into v_exceed from orders where coalesce(total_received,0) > coalesce(total,0) + 0.009;
  select count(*) into v_paid_zero from orders
  where upper(coalesce(financial_status,'')) in ('PAID','PARTIALLY_PAID')
    and coalesce(total_received,0)=0 and coalesce(total,0)>0;
  select count(*) into v_tx_exceed from (
    select o.id from orders o
    join payment_transactions pt on pt.order_id = o.id
    where upper(pt.kind)='SALE' and upper(pt.status)='SUCCESS'
    group by o.id, o.total
    having sum(pt.amount) > coalesce(o.total,0) + 0.009
  ) z;
  select count(distinct o.id) into v_refund_mis from orders o
  where exists (select 1 from refunds r where r.order_id = o.id)
    and not exists (
      select 1 from payment_transactions pt
      where pt.order_id = o.id and upper(pt.kind)='REFUND' and upper(pt.status)='SUCCESS'
    );
  select round(coalesce(sum(abs(coalesce(total_outstanding,0) - greatest(coalesce(total,0)-coalesce(total_received,0),0))),0),2),
         round(coalesce(sum(coalesce(total_outstanding,0) - greatest(coalesce(total,0)-coalesce(total_received,0),0)),0),2)
    into v_abs, v_net
  from orders
  where round(coalesce(total_outstanding,0),2)
        is distinct from round(greatest(coalesce(total,0)-coalesce(total_received,0),0),2);
  select count(*) into v_no_due from orders where payment_due_on is null;
  select count(*) into v_queue from finance_reconciliation_reviews;

  return jsonb_build_object(
    'ok', true,
    'baseline', jsonb_build_object(
      'orders', v_orders,
      'order_total', v_total,
      'received_snapshot', v_recv,
      'outstanding_snapshot', v_out,
      'payment_transactions', v_tx,
      'refund_headers', v_ref,
      'refund_lines', v_reflines
    ),
    'exceptions', jsonb_build_object(
      'OUTSTANDING_MISMATCH', v_mismatch,
      'NEGATIVE_OUTSTANDING', v_neg,
      'RECEIVED_EXCEEDS_TOTAL', v_exceed,
      'TX_EXCEEDS_TOTAL', v_tx_exceed,
      'PAID_ZERO_RECEIVED', v_paid_zero,
      'REFUND_MISMATCH', v_refund_mis,
      'OTHER', 0
    ),
    'material_exposure', jsonb_build_object(
      'total_absolute_mismatch', v_abs,
      'net_mismatch', v_net,
      'note', 'Absolute formula-gap on outstanding cache; not automatic collectible AR'
    ),
    'due_dates', jsonb_build_object(
      'NO_DUE_DATE', v_no_due,
      'HAS_DUE_DATE', v_orders - v_no_due
    ),
    'review_queue_rows', v_queue,
    'tolerance_gbp', public.finance_money_tolerance_gbp(),
    'views', jsonb_build_object(
      'A_imported_source', 'orders.source_* immutable',
      'B_calculated_ledger', 'finance_calculate_order_ledger',
      'C_reconciliation_status', 'finance_reconciliation_reviews'
    )
  );
end;
$$;

revoke all on function public.rpc_phase5f_finance_baseline() from public, anon;
grant execute on function public.rpc_phase5f_finance_baseline() to authenticated, service_role;

create or replace function public.rpc_admin_finance_review_queue(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int, 0), 0);
  v_class text := nullif(btrim(coalesce(p_filters->>'classification','')), '');
  v_sev text := nullif(btrim(coalesce(p_filters->>'severity','')), '');
  v_status text := nullif(btrim(coalesce(p_filters->>'review_status','')), '');
  v_gateway text := nullif(btrim(coalesce(p_filters->>'gateway','')), '');
  v_min_var numeric := nullif(p_filters->>'min_abs_variance','')::numeric;
  v_items jsonb;
  v_total bigint;
begin
  if not public.can_view_finance() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_total
  from finance_reconciliation_reviews r
  where (v_class is null or r.classification = v_class)
    and (v_sev is null or r.severity = v_sev)
    and (v_status is null or r.review_status = v_status)
    and (v_gateway is null or r.gateway_summary ilike '%' || v_gateway || '%')
    and (v_min_var is null or r.abs_variance >= v_min_var);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.abs_variance desc), '[]'::jsonb) into v_items
  from (
    select r.*
    from finance_reconciliation_reviews r
    where (v_class is null or r.classification = v_class)
      and (v_sev is null or r.severity = v_sev)
      and (v_status is null or r.review_status = v_status)
      and (v_gateway is null or r.gateway_summary ilike '%' || v_gateway || '%')
      and (v_min_var is null or r.abs_variance >= v_min_var)
    order by r.abs_variance desc
    offset v_offset limit v_limit
  ) x;

  return jsonb_build_object('ok', true, 'items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

revoke all on function public.rpc_admin_finance_review_queue(jsonb) from public, anon;
grant execute on function public.rpc_admin_finance_review_queue(jsonb) to authenticated, service_role;

create or replace function public.rpc_admin_finance_review_decision(
  p_order_id uuid,
  p_review_status text,
  p_classification text default null,
  p_reason text default null,
  p_decision text default null,
  p_notes text default null,
  p_reviewed_outstanding numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.finance_reconciliation_reviews%rowtype;
begin
  if not public.current_admin_is_owner_or_admin() then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;
  if p_review_status not in ('UNREVIEWED','EXPLAINED','ACCEPTED_SOURCE_VARIANCE','REQUIRES_ACTION','RESOLVED_BY_CODE_FIX') then
    return jsonb_build_object('ok', false, 'error', 'invalid_review_status');
  end if;

  update finance_reconciliation_reviews
  set review_status = p_review_status,
      classification = coalesce(nullif(p_classification,''), classification),
      reason = coalesce(p_reason, reason),
      decision = coalesce(p_decision, decision),
      notes = coalesce(p_notes, notes),
      reviewed_outstanding = coalesce(p_reviewed_outstanding, reviewed_outstanding),
      opening_basis = case when p_reviewed_outstanding is not null then 'REVIEWED_OUTSTANDING' else opening_basis end,
      opening_outstanding = coalesce(p_reviewed_outstanding, opening_outstanding),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where order_id = p_order_id
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'review_not_found');
  end if;

  insert into finance_reconciliation_review_notes (
    review_id, order_id, actor_id, action, classification, review_status,
    reason, decision, notes, reviewed_outstanding, payload
  ) values (
    v_row.id, p_order_id, auth.uid(), 'REVIEW_DECISION', v_row.classification, v_row.review_status,
    v_row.reason, v_row.decision, v_row.notes, v_row.reviewed_outstanding,
    jsonb_build_object('source_untouched', true)
  );

  -- Label only on orders — never mutate source_* money
  update orders
  set reconciliation_status = case
        when p_review_status = 'ACCEPTED_SOURCE_VARIANCE' then 'REVIEWED_ACCEPTED'
        when p_review_status = 'RESOLVED_BY_CODE_FIX' then 'REVIEWED_CORRECTED_BY_UNIQUE_EVENT'
        else reconciliation_status
      end
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'review', to_jsonb(v_row));
end;
$$;

revoke all on function public.rpc_admin_finance_review_decision(uuid, text, text, text, text, text, numeric) from public, anon;
grant execute on function public.rpc_admin_finance_review_decision(uuid, text, text, text, text, text, numeric) to authenticated, service_role;


commit;

