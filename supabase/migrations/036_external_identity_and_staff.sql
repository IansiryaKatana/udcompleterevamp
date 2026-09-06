-- UD Commerce Foundation slice 1A/1G:
-- external_system_refs + staff_members
-- Additive only. Does not alter storefront/CMS behaviour.

-- ── Shared updated_at helper (idempotent) ───────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── External / source identities ───────────────────────────────────────────
create table if not exists public.external_system_refs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  system text not null,
  external_gid text,
  external_legacy_id text,
  external_key text,
  external_number text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_system_refs_entity_type_chk
    check (char_length(trim(entity_type)) > 0),
  constraint external_system_refs_system_chk
    check (char_length(trim(system)) > 0),
  constraint external_system_refs_has_identifier_chk
    check (
      external_gid is not null
      or external_legacy_id is not null
      or external_key is not null
      or external_number is not null
    )
);

comment on table public.external_system_refs is
  'Cross-system identity map (Shopify GID/legacy id, Odoo, SKULabs, etc.). Polymorphic by design — no FK to entity tables.';

create unique index if not exists external_system_refs_system_gid_uidx
  on public.external_system_refs (system, external_gid)
  where external_gid is not null;

create unique index if not exists external_system_refs_system_legacy_uidx
  on public.external_system_refs (system, entity_type, external_legacy_id)
  where external_legacy_id is not null;

create unique index if not exists external_system_refs_system_key_uidx
  on public.external_system_refs (system, entity_type, external_key)
  where external_key is not null;

create unique index if not exists external_system_refs_entity_system_uidx
  on public.external_system_refs (entity_type, entity_id, system);

create index if not exists external_system_refs_entity_idx
  on public.external_system_refs (entity_type, entity_id);

create index if not exists external_system_refs_system_number_idx
  on public.external_system_refs (system, external_number)
  where external_number is not null;

drop trigger if exists trg_external_system_refs_updated_at on public.external_system_refs;
create trigger trg_external_system_refs_updated_at
  before update on public.external_system_refs
  for each row execute function public.set_updated_at();

alter table public.external_system_refs enable row level security;

drop policy if exists "admin_select_external_system_refs" on public.external_system_refs;
create policy "admin_select_external_system_refs" on public.external_system_refs
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_external_system_refs" on public.external_system_refs;
create policy "admin_insert_external_system_refs" on public.external_system_refs
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_external_system_refs" on public.external_system_refs;
create policy "admin_update_external_system_refs" on public.external_system_refs
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_delete_external_system_refs" on public.external_system_refs;
create policy "admin_delete_external_system_refs" on public.external_system_refs
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.external_system_refs to authenticated;
grant all on public.external_system_refs to service_role;

-- ── Staff / sales / CG people ───────────────────────────────────────────────
-- Separate from admin_users (CMS auth). Optional link only.
create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text,
  active boolean not null default true,
  staff_type text not null default 'sales',
  role_metadata jsonb not null default '{}'::jsonb,
  notes text,
  source_system text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_members_name_chk check (char_length(trim(name)) > 0)
);

comment on table public.staff_members is
  'Canonical people for salesperson / referrer / CG assignment. Not a replacement for admin_users.';

create index if not exists staff_members_active_name_idx
  on public.staff_members (active, lower(name));

create index if not exists staff_members_email_idx
  on public.staff_members (lower(email))
  where email is not null;

drop trigger if exists trg_staff_members_updated_at on public.staff_members;
create trigger trg_staff_members_updated_at
  before update on public.staff_members
  for each row execute function public.set_updated_at();

alter table public.staff_members enable row level security;

drop policy if exists "admin_select_staff_members" on public.staff_members;
create policy "admin_select_staff_members" on public.staff_members
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_staff_members" on public.staff_members;
create policy "admin_insert_staff_members" on public.staff_members
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_staff_members" on public.staff_members;
create policy "admin_update_staff_members" on public.staff_members
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_delete_staff_members" on public.staff_members;
create policy "admin_delete_staff_members" on public.staff_members
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.staff_members to authenticated;
grant all on public.staff_members to service_role;

-- Additive optional link from CMS admins → staff directory (non-breaking).
alter table public.admin_users
  add column if not exists staff_member_id uuid references public.staff_members(id) on delete set null;

create index if not exists admin_users_staff_member_id_idx
  on public.admin_users (staff_member_id)
  where staff_member_id is not null;
