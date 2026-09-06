-- Phase 5 prep: widen legacy money columns for Shopify-scale totals.
-- Additive precision only (numeric(10,2) → numeric(14,2)). No app behavior change.

alter table public.orders
  alter column subtotal type numeric(14,2),
  alter column total type numeric(14,2),
  alter column shipping_total type numeric(14,2),
  alter column tax_total type numeric(14,2),
  alter column discount_total type numeric(14,2);

alter table public.order_items
  alter column unit_price type numeric(14,2),
  alter column line_total type numeric(14,2);

comment on column public.orders.total is
  'Order total. Widened to numeric(14,2) for wholesale/Shopify-scale GBP amounts.';
