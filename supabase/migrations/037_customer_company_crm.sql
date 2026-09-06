-- UD Commerce Foundation slice 1B–1H:
-- customers CRM, addresses, companies, locations, contacts, assignment history
-- Additive. Does not touch auth.users semantics or admin_users roles.

-- ── Customers (CRM) — separate from auth.users ──────────────────────────────
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text,
  phone text,
  first_name text,
  last_name text,
  display_name text,
  company_name_snapshot text,
  trading_name text,
  notes text,
  tax_exempt boolean not null default false,
  tax_exemption_details jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  approval_status text not null default 'pending',
  registration_channel text,
  customer_type text,
  salesperson_id uuid references public.staff_members(id) on delete set null,
  referrer_id uuid references public.staff_members(id) on delete set null,
  cg_assigned_id uuid references public.staff_members(id) on delete set null,
  legacy_customer_id text,
  source_system text,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customers is
  'Business CRM person. May exist without auth.users (historical / never-ordered wholesale accounts).';

create index if not exists customers_email_idx
  on public.customers (lower(email))
  where email is not null;

create index if not exists customers_phone_idx
  on public.customers (phone)
  where phone is not null;

create index if not exists customers_salesperson_id_idx
  on public.customers (salesperson_id)
  where salesperson_id is not null;

create index if not exists customers_cg_assigned_id_idx
  on public.customers (cg_assigned_id)
  where cg_assigned_id is not null;

create index if not exists customers_status_idx
  on public.customers (status, approval_status);

create index if not exists customers_legacy_customer_id_idx
  on public.customers (legacy_customer_id)
  where legacy_customer_id is not null;

create index if not exists customers_trading_name_idx
  on public.customers (lower(trading_name))
  where trading_name is not null;

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

alter table public.customers enable row level security;

drop policy if exists "admin_select_customers" on public.customers;
create policy "admin_select_customers" on public.customers
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_customers" on public.customers;
create policy "admin_insert_customers" on public.customers
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_customers" on public.customers;
create policy "admin_update_customers" on public.customers
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_delete_customers" on public.customers;
create policy "admin_delete_customers" on public.customers
  for delete to authenticated using (public.is_admin());

-- Own CRM profile when linked to auth (read-only for now).
drop policy if exists "customer_read_own_customer" on public.customers;
create policy "customer_read_own_customer" on public.customers
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;

-- ── Customer addresses ──────────────────────────────────────────────────────
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  address_type text not null default 'shipping',
  is_default boolean not null default false,
  first_name text,
  last_name text,
  company text,
  address1 text,
  address2 text,
  city text,
  province text,
  province_code text,
  postal_code text,
  country text,
  country_code text,
  phone text,
  company_location_id uuid,
  source_system text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customer_addresses is
  'CRM addresses with source fidelity. address_type examples: shipping, billing, other.';

create index if not exists customer_addresses_customer_id_idx
  on public.customer_addresses (customer_id);

create index if not exists customer_addresses_customer_default_idx
  on public.customer_addresses (customer_id, is_default)
  where is_default = true;

drop trigger if exists trg_customer_addresses_updated_at on public.customer_addresses;
create trigger trg_customer_addresses_updated_at
  before update on public.customer_addresses
  for each row execute function public.set_updated_at();

alter table public.customer_addresses enable row level security;

drop policy if exists "admin_all_customer_addresses" on public.customer_addresses;
create policy "admin_all_customer_addresses" on public.customer_addresses
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "customer_read_own_addresses" on public.customer_addresses;
create policy "customer_read_own_addresses" on public.customer_addresses
  for select to authenticated
  using (
    exists (
      select 1 from public.customers c
      where c.id = customer_addresses.customer_id
        and c.auth_user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.customer_addresses to authenticated;
grant all on public.customer_addresses to service_role;

-- ── Companies (B2B trade accounts) ──────────────────────────────────────────
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trading_name text,
  legal_name text,
  company_number text,
  vat_number text,
  status text not null default 'active',
  customer_type text,
  salesperson_id uuid references public.staff_members(id) on delete set null,
  referrer_id uuid references public.staff_members(id) on delete set null,
  cg_assigned_id uuid references public.staff_members(id) on delete set null,
  notes text,
  source_system text,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_name_chk check (char_length(trim(name)) > 0)
);

comment on table public.companies is
  'First-class B2B trade-account entity (Shopify Companies equivalent).';

create index if not exists companies_name_idx
  on public.companies (lower(name));

create index if not exists companies_trading_name_idx
  on public.companies (lower(trading_name))
  where trading_name is not null;

create index if not exists companies_salesperson_id_idx
  on public.companies (salesperson_id)
  where salesperson_id is not null;

create index if not exists companies_status_idx
  on public.companies (status);

drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

alter table public.companies enable row level security;

drop policy if exists "admin_all_companies" on public.companies;
create policy "admin_all_companies" on public.companies
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.companies to authenticated;
grant all on public.companies to service_role;

-- ── Company locations ───────────────────────────────────────────────────────
create table if not exists public.company_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text,
  phone text,
  email text,
  tax_exempt boolean not null default false,
  tax_exemptions jsonb not null default '[]'::jsonb,
  -- Placeholder for future payment-terms attachment (no engine yet).
  payment_terms_template jsonb,
  billing_address jsonb not null default '{}'::jsonb,
  shipping_address jsonb not null default '{}'::jsonb,
  address1 text,
  address2 text,
  city text,
  province text,
  province_code text,
  postal_code text,
  country text,
  country_code text,
  is_primary boolean not null default false,
  source_system text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.company_locations.payment_terms_template is
  'Future payment-terms attachment point. No schedules/AR in this slice.';

create index if not exists company_locations_company_id_idx
  on public.company_locations (company_id);

create index if not exists company_locations_company_primary_idx
  on public.company_locations (company_id, is_primary)
  where is_primary = true;

drop trigger if exists trg_company_locations_updated_at on public.company_locations;
create trigger trg_company_locations_updated_at
  before update on public.company_locations
  for each row execute function public.set_updated_at();

-- Late FK for customer_addresses.company_location_id (table order)
alter table public.customer_addresses
  drop constraint if exists customer_addresses_company_location_id_fkey;
alter table public.customer_addresses
  add constraint customer_addresses_company_location_id_fkey
  foreign key (company_location_id) references public.company_locations(id) on delete set null;

alter table public.company_locations enable row level security;

drop policy if exists "admin_all_company_locations" on public.company_locations;
create policy "admin_all_company_locations" on public.company_locations
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.company_locations to authenticated;
grant all on public.company_locations to service_role;

-- ── Company contacts (person ↔ company) ─────────────────────────────────────
create table if not exists public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  company_location_id uuid references public.company_locations(id) on delete set null,
  title text,
  role text,
  is_primary boolean not null default false,
  receives_orders boolean not null default true,
  receives_invoices boolean not null default true,
  source_system text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_contacts_unique_pair unique (company_id, customer_id)
);

comment on table public.company_contacts is
  'Maps CRM customers (people) to B2B companies without duplicating identity.';

create index if not exists company_contacts_customer_id_idx
  on public.company_contacts (customer_id);

create index if not exists company_contacts_company_id_idx
  on public.company_contacts (company_id);

drop trigger if exists trg_company_contacts_updated_at on public.company_contacts;
create trigger trg_company_contacts_updated_at
  before update on public.company_contacts
  for each row execute function public.set_updated_at();

alter table public.company_contacts enable row level security;

drop policy if exists "admin_all_company_contacts" on public.company_contacts;
create policy "admin_all_company_contacts" on public.company_contacts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.company_contacts to authenticated;
grant all on public.company_contacts to service_role;

-- ── Assignment history (salesperson / referrer / CG / …) ────────────────────
create table if not exists public.entity_assignments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  assignment_type text not null,
  staff_member_id uuid not null references public.staff_members(id) on delete restrict,
  source text,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  constraint entity_assignments_entity_type_chk
    check (char_length(trim(entity_type)) > 0),
  constraint entity_assignments_assignment_type_chk
    check (char_length(trim(assignment_type)) > 0),
  constraint entity_assignments_valid_range_chk
    check (valid_to is null or valid_to >= valid_from)
);

comment on table public.entity_assignments is
  'Historical ownership: who owns customer/company/order and when. assignment_type is free text (salesperson, referrer, cg, …).';

create index if not exists entity_assignments_entity_idx
  on public.entity_assignments (entity_type, entity_id, assignment_type);

create index if not exists entity_assignments_staff_idx
  on public.entity_assignments (staff_member_id);

create index if not exists entity_assignments_current_idx
  on public.entity_assignments (entity_type, entity_id, assignment_type)
  where valid_to is null;

-- At most one open assignment per entity+type+staff (allows handoff history).
create unique index if not exists entity_assignments_open_unique_idx
  on public.entity_assignments (entity_type, entity_id, assignment_type, staff_member_id)
  where valid_to is null;

alter table public.entity_assignments enable row level security;

drop policy if exists "admin_select_entity_assignments" on public.entity_assignments;
create policy "admin_select_entity_assignments" on public.entity_assignments
  for select to authenticated using (public.is_admin());

drop policy if exists "admin_insert_entity_assignments" on public.entity_assignments;
create policy "admin_insert_entity_assignments" on public.entity_assignments
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin_update_entity_assignments" on public.entity_assignments;
create policy "admin_update_entity_assignments" on public.entity_assignments
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Soft-close via valid_to preferred; delete restricted to admins for corrections only.
drop policy if exists "admin_delete_entity_assignments" on public.entity_assignments;
create policy "admin_delete_entity_assignments" on public.entity_assignments
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.entity_assignments to authenticated;
grant all on public.entity_assignments to service_role;
