-- UD Commerce Foundation slice 1M/1N:
-- order_events (append-only) + order_comments

-- ── Order events (immutable audit timeline) ─────────────────────────────────
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: append-only events must not vanish via order CASCADE deletes.
  order_id uuid not null references public.orders(id) on delete restrict,
  event_type text not null,
  category text not null default 'system',
  source_system text,
  source_app text,
  actor_type text,
  actor_id uuid,
  actor_name_snapshot text,
  message text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  external_event_id text,
  occurred_at timestamptz not null default now(),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  constraint order_events_event_type_chk check (char_length(trim(event_type)) > 0),
  constraint order_events_category_chk check (char_length(trim(category)) > 0)
);

comment on table public.order_events is
  'Append-only order timeline (Shopify events + native UD). No casual UPDATE/DELETE.';

create index if not exists order_events_order_occurred_idx
  on public.order_events (order_id, occurred_at);

create index if not exists order_events_category_idx
  on public.order_events (category);

create unique index if not exists order_events_external_event_uidx
  on public.order_events (source_system, external_event_id)
  where external_event_id is not null and source_system is not null;

-- Hard block UPDATE/DELETE at trigger level (defense in depth beyond RLS).
create or replace function public.forbid_order_events_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'order_events is append-only; UPDATE/DELETE are not allowed'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_order_events_no_update on public.order_events;
create trigger trg_order_events_no_update
  before update on public.order_events
  for each row execute function public.forbid_order_events_mutation();

drop trigger if exists trg_order_events_no_delete on public.order_events;
create trigger trg_order_events_no_delete
  before delete on public.order_events
  for each row execute function public.forbid_order_events_mutation();

alter table public.order_events enable row level security;

drop policy if exists "admin_select_order_events" on public.order_events;
create policy "admin_select_order_events" on public.order_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_order_events" on public.order_events;
create policy "admin_insert_order_events" on public.order_events
  for insert to authenticated with check (public.is_admin());

-- Intentionally no UPDATE/DELETE policies for authenticated.
-- service_role bypasses RLS but still hits append-only triggers.

grant select, insert on public.order_events to authenticated;
grant select, insert on public.order_events to service_role;
-- Revoke update/delete explicitly if previously granted.
revoke update, delete on public.order_events from authenticated;
revoke update, delete on public.order_events from anon;

-- Customers may read events for their own orders (account history).
drop policy if exists "customer_read_own_order_events" on public.order_events;
create policy "customer_read_own_order_events" on public.order_events
  for select to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_events.order_id
        and (
          o.user_id = (select auth.uid())
          or exists (
            select 1 from public.customers c
            where c.id = o.customer_id
              and c.auth_user_id = (select auth.uid())
          )
        )
    )
  );

-- ── Order comments (staff / imported Shopify CommentEvent) ──────────────────
create table if not exists public.order_comments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  author_staff_id uuid references public.staff_members(id) on delete set null,
  author_name_snapshot text,
  body text not null,
  source_system text,
  source_app text,
  external_event_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint order_comments_body_chk check (char_length(trim(body)) > 0)
);

comment on table public.order_comments is
  'Operational order comments. Author may be unknown when Shopify read_users is unavailable.';

create index if not exists order_comments_order_occurred_idx
  on public.order_comments (order_id, occurred_at);

create unique index if not exists order_comments_external_event_uidx
  on public.order_comments (source_system, external_event_id)
  where external_event_id is not null and source_system is not null;

alter table public.order_comments enable row level security;

drop policy if exists "admin_select_order_comments" on public.order_comments;
create policy "admin_select_order_comments" on public.order_comments
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_order_comments" on public.order_comments;
create policy "admin_insert_order_comments" on public.order_comments
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_order_comments" on public.order_comments;
create policy "admin_update_order_comments" on public.order_comments
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_delete_order_comments" on public.order_comments;
create policy "admin_delete_order_comments" on public.order_comments
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.order_comments to authenticated;
grant all on public.order_comments to service_role;
