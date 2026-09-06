-- UD Commerce Foundation slice 1I/1J:
-- tags + generic metafields (preserve ALL Shopify tags/metafields)

-- ── Tag dictionary ──────────────────────────────────────────────────────────
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text,
  created_at timestamptz not null default now(),
  constraint tags_name_chk check (char_length(name) > 0)
);

comment on table public.tags is
  'Canonical tag dictionary. Historical raw strings are stored on entity_tags.raw_value.';

-- Exact name unique (case-sensitive) so "Awaiting payment" and "Awaiting Payment" can coexist as dictionary entries if needed.
create unique index if not exists tags_name_uidx on public.tags (name);

create index if not exists tags_normalized_name_idx
  on public.tags (normalized_name)
  where normalized_name is not null;

alter table public.tags enable row level security;

drop policy if exists "admin_all_tags" on public.tags;
create policy "admin_all_tags" on public.tags
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.tags to authenticated;
grant all on public.tags to service_role;

-- ── Entity ↔ tag links (preserve raw spelling) ──────────────────────────────
create table if not exists public.entity_tags (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  raw_value text not null,
  source_system text,
  created_at timestamptz not null default now(),
  constraint entity_tags_entity_type_chk check (char_length(trim(entity_type)) > 0),
  constraint entity_tags_raw_value_chk check (char_length(raw_value) > 0)
);

comment on column public.entity_tags.raw_value is
  'Exact original tag string from source (do not clean during import).';

create index if not exists entity_tags_entity_idx
  on public.entity_tags (entity_type, entity_id);

create index if not exists entity_tags_tag_id_idx
  on public.entity_tags (tag_id);

create index if not exists entity_tags_raw_value_idx
  on public.entity_tags (raw_value);

create unique index if not exists entity_tags_unique_link_uidx
  on public.entity_tags (entity_type, entity_id, tag_id, raw_value);

alter table public.entity_tags enable row level security;

drop policy if exists "admin_all_entity_tags" on public.entity_tags;
create policy "admin_all_entity_tags" on public.entity_tags
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.entity_tags to authenticated;
grant all on public.entity_tags to service_role;

-- ── Generic metafields (EAV) ────────────────────────────────────────────────
create table if not exists public.metafields (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null,
  owner_id uuid not null,
  namespace text not null,
  key text not null,
  value_type text,
  value_text text,
  value_json jsonb,
  definition_name text,
  definition_description text,
  source_system text not null default 'shopify',
  external_gid text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint metafields_owner_type_chk check (char_length(trim(owner_type)) > 0),
  constraint metafields_namespace_chk check (char_length(namespace) > 0),
  constraint metafields_key_chk check (char_length(key) > 0)
);

comment on table public.metafields is
  'Generic preserve-all metafield store. Dynamic namespaces (e.g. css_sales_team_*) must not become columns.';

create unique index if not exists metafields_owner_ns_key_system_uidx
  on public.metafields (owner_type, owner_id, namespace, key, source_system);

create unique index if not exists metafields_external_gid_uidx
  on public.metafields (external_gid)
  where external_gid is not null;

create index if not exists metafields_owner_idx
  on public.metafields (owner_type, owner_id);

create index if not exists metafields_namespace_key_idx
  on public.metafields (namespace, key);

create index if not exists metafields_source_system_idx
  on public.metafields (source_system);

drop trigger if exists trg_metafields_updated_at on public.metafields;
create trigger trg_metafields_updated_at
  before update on public.metafields
  for each row execute function public.set_updated_at();

alter table public.metafields enable row level security;

drop policy if exists "admin_all_metafields" on public.metafields;
create policy "admin_all_metafields" on public.metafields
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.metafields to authenticated;
grant all on public.metafields to service_role;
