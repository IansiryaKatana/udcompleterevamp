-- UD Commerce Foundation slice 1K/1L:
-- Additive order + order_items extensions for wholesale / Shopify history.
-- CRITICAL: does not alter orders.status check, fulfillment_status semantics,
-- user_id, Stripe columns, or existing insert paths.

-- ── Orders: parallel commerce fields (nullable / defaulted) ─────────────────
alter table public.orders
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists company_location_id uuid references public.company_locations(id) on delete set null,
  add column if not exists financial_status text,
  add column if not exists commerce_fulfillment_status text,
  add column if not exists delivery_status text,
  add column if not exists order_source text,
  add column if not exists source_app text,
  add column if not exists purchase_order_number text,
  add column if not exists trading_name_snapshot text,
  add column if not exists salesperson_id uuid references public.staff_members(id) on delete set null,
  add column if not exists referrer_id uuid references public.staff_members(id) on delete set null,
  add column if not exists cg_assigned_id uuid references public.staff_members(id) on delete set null,
  add column if not exists total_received numeric(14,2) not null default 0,
  add column if not exists total_outstanding numeric(14,2) not null default 0,
  add column if not exists taxes_included boolean not null default false,
  add column if not exists source_created_at timestamptz,
  add column if not exists source_updated_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists shopify_order_gid text,
  add column if not exists shopify_legacy_id text,
  add column if not exists source_order_number text,
  add column if not exists imported_at timestamptz,
  add column if not exists note text;

comment on column public.orders.status is
  'Legacy storefront/checkout status (pending|paid|failed|refunded|cancelled|quote_requested). Do not widen casually.';
comment on column public.orders.fulfillment_status is
  'Legacy CMS fulfillment workflow (unfulfilled|processing|shipped|delivered).';
comment on column public.orders.financial_status is
  'Wholesale/Shopify-style financial status (PAID, PENDING, …). Parallel to status.';
comment on column public.orders.commerce_fulfillment_status is
  'Wholesale/Shopify-style fulfillment status. Parallel to fulfillment_status.';
comment on column public.orders.user_id is
  'auth.users link for storefront account orders. CRM person is customer_id.';
comment on column public.orders.customer_id is
  'CRM customers.id. Nullable so existing Stripe/quote orders remain valid.';

create index if not exists orders_customer_id_idx
  on public.orders (customer_id)
  where customer_id is not null;

create index if not exists orders_company_id_idx
  on public.orders (company_id)
  where company_id is not null;

create index if not exists orders_salesperson_id_idx
  on public.orders (salesperson_id)
  where salesperson_id is not null;

create index if not exists orders_financial_status_idx
  on public.orders (financial_status)
  where financial_status is not null;

create index if not exists orders_commerce_fulfillment_status_idx
  on public.orders (commerce_fulfillment_status)
  where commerce_fulfillment_status is not null;

create index if not exists orders_order_source_idx
  on public.orders (order_source)
  where order_source is not null;

create index if not exists orders_source_created_at_idx
  on public.orders (source_created_at)
  where source_created_at is not null;

create unique index if not exists orders_shopify_order_gid_uidx
  on public.orders (shopify_order_gid)
  where shopify_order_gid is not null;

create unique index if not exists orders_shopify_legacy_id_uidx
  on public.orders (shopify_legacy_id)
  where shopify_legacy_id is not null;

create index if not exists orders_source_order_number_idx
  on public.orders (source_order_number)
  where source_order_number is not null;

-- ── Order items: immutable snapshot extensions ──────────────────────────────
alter table public.order_items
  add column if not exists sku_snapshot text,
  add column if not exists variant_title_snapshot text,
  add column if not exists vendor_snapshot text,
  add column if not exists product_type_snapshot text,
  add column if not exists barcode_snapshot text,
  add column if not exists original_unit_price numeric(14,2),
  add column if not exists discount_total numeric(14,2) not null default 0,
  add column if not exists tax_total numeric(14,2) not null default 0,
  add column if not exists taxable boolean not null default true,
  add column if not exists tax_rate_snapshot numeric(8,6),
  add column if not exists product_shopify_gid text,
  add column if not exists variant_shopify_gid text,
  add column if not exists source_line_item_gid text,
  add column if not exists deleted_product boolean not null default false,
  add column if not exists properties jsonb not null default '[]'::jsonb;

comment on column public.order_items.deleted_product is
  'True when source product/variant no longer exists. Display must use snapshots only.';
comment on column public.order_items.product_id is
  'Optional live product link (ON DELETE SET NULL). Historical display must not require it.';

create index if not exists order_items_sku_snapshot_idx
  on public.order_items (sku_snapshot)
  where sku_snapshot is not null;

create index if not exists order_items_source_line_item_gid_idx
  on public.order_items (source_line_item_gid)
  where source_line_item_gid is not null;

create index if not exists order_items_deleted_product_idx
  on public.order_items (deleted_product)
  where deleted_product = true;
