-- Phase 5 prep: abandoned checkouts (Shopify abandoned checkout recovery list).

create table if not exists public.abandoned_checkouts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  email text,
  completed_at timestamptz,
  abandoned_checkout_url text,
  subtotal numeric(14,2) not null default 0,
  total_tax numeric(14,2) not null default 0,
  total_discount numeric(14,2) not null default 0,
  total_price numeric(14,2) not null default 0,
  currency text not null default 'GBP',
  billing_address jsonb not null default '{}'::jsonb,
  shipping_address jsonb not null default '{}'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  source_system text,
  shopify_checkout_gid text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.abandoned_checkouts is
  'Shopify abandoned checkouts archive. Separate from storefront_carts / abandoned cart email.';

create unique index if not exists abandoned_checkouts_shopify_gid_uidx
  on public.abandoned_checkouts (shopify_checkout_gid)
  where shopify_checkout_gid is not null;

create index if not exists abandoned_checkouts_email_idx
  on public.abandoned_checkouts (lower(email))
  where email is not null;

create index if not exists abandoned_checkouts_customer_id_idx
  on public.abandoned_checkouts (customer_id)
  where customer_id is not null;

drop trigger if exists trg_abandoned_checkouts_updated_at on public.abandoned_checkouts;
create trigger trg_abandoned_checkouts_updated_at
  before update on public.abandoned_checkouts
  for each row execute function public.set_updated_at();

alter table public.abandoned_checkouts enable row level security;

drop policy if exists "admin_all_abandoned_checkouts" on public.abandoned_checkouts;
create policy "admin_all_abandoned_checkouts" on public.abandoned_checkouts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.abandoned_checkouts to authenticated;
grant all on public.abandoned_checkouts to service_role;
