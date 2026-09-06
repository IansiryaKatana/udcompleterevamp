# UD Commerce Foundation (Phase 1)

Additive database foundation for Unique Distribution wholesale commerce, driven by `shopify-forensic-audit/FORENSIC-AUDIT.md`.

**Status:** schema only — no Shopify import, no deploy, no storefront rewrite.

## Compatibility decisions

| Existing | Decision |
|---|---|
| `orders.status` check (`pending\|paid\|…\|quote_requested`) | **Unchanged.** Checkout, Stripe, quotes keep using it. |
| `orders.fulfillment_status` (`unfulfilled\|processing\|shipped\|delivered`) | **Unchanged.** Admin ship UI keeps using it. |
| `orders.user_id` → `auth.users` | **Unchanged.** Storefront account orders still work. |
| CRM person | New nullable `orders.customer_id` → `customers`. |
| Wholesale financial / Fulfillment enums | New parallel columns `financial_status`, `commerce_fulfillment_status`. |
| `admin_users` | Untouched roles/RLS. Optional `staff_member_id` link only. |
| `order_items.product_id` ON DELETE SET NULL | Kept; snapshots + `deleted_product` for history. |
| `numeric(10,2)` on existing money columns | Widened in **047** to `numeric(14,2)` before Shopify import. New money columns already use `numeric(14,2)`. |

## Entities added

### Identity & staff
- `external_system_refs` — polymorphic map to Shopify GID/legacy id and other systems
- `staff_members` — salesperson / referrer / CG people (not CMS admins)

### CRM / B2B
- `customers` — business person; **may exist without** `auth.users` (supports ~3,996 zero-order accounts)
- `customer_addresses`
- `companies` — trade accounts (~3,518 Shopify Companies)
- `company_locations` — includes `payment_terms_template` jsonb placeholder only
- `company_contacts` — person ↔ company
- `entity_assignments` — ownership history (`salesperson`, `referrer`, `cg`, …)

### Tags & metafields
- `tags` + `entity_tags` — raw tag strings preserved (`Awaiting payment` vs `Awaiting Payment`)
- `metafields` — generic EAV; dynamic namespaces (`css_sales_team_*`) do not become columns

### Orders
- Extended `orders` / `order_items` (additive columns only)
- `order_events` — append-only timeline (UPDATE/DELETE blocked by trigger; FK `ON DELETE RESTRICT`)
- `order_comments` — staff/imported comments; author may be unknown

## Relationships (summary)

```
auth.users ──?── customers ──< company_contacts >── companies
                    │                                  │
                    └── addresses                      └── locations
staff_members <── salesperson/referrer/cg on customers, companies, orders
staff_members <── entity_assignments (history)
orders.user_id → auth.users
orders.customer_id → customers
orders.company_id → companies
order_events / order_comments → orders
metafields / entity_tags / external_system_refs → polymorphic owner ids
```

## Source-system strategy

1. Prefer `external_system_refs` for cross-system identity (Shopify, SKULabs, DPD, Worldpay, Xero, Odoo, …).
2. Put high-traffic operational Shopify ids on `orders` (`shopify_order_gid`, `shopify_legacy_id`, `source_order_number`) for query convenience.
3. Never discard metafields or tags during import — normalize later if needed.
4. Distinguish `created_at`/`updated_at` (UD) from `source_*` / `imported_at` / `occurred_at`.

## Shopify field mappings (foundation)

| Shopify | UD |
|---|---|
| Customer | `customers` + `external_system_refs` |
| Company / location / contact | `companies` / `company_locations` / `company_contacts` |
| `custom.salesperson` / tags `SP_*` | `staff_members` + `orders.salesperson_id` + `entity_assignments` + raw `metafields`/`entity_tags` |
| `custom.referrer` / `REF:*` | same pattern with `referrer` |
| `custom.cg_assigned` | `cg_assigned_id` + assignment history |
| All metafields | `metafields` |
| All tags | `tags` + `entity_tags.raw_value` |
| Order GID / legacy / name | `shopify_*` / `source_order_number` / keep `order_number` for UD |
| Line item snapshots / deleted products | `order_items.*_snapshot`, `deleted_product` |
| Timeline / CommentEvent | `order_events`, `order_comments` |

## Migrations

| File | Contents |
|---|---|
| `036_external_identity_and_staff.sql` | refs + staff + `admin_users.staff_member_id` |
| `037_customer_company_crm.sql` | CRM + companies + assignments |
| `038_tags_and_metafields.sql` | tags + metafields |
| `039_order_foundation.sql` | order / order_item extensions |
| `040_order_events.sql` | events + comments |

Verification script (manual): `supabase/tests/041_commerce_foundation_verify.sql`

## RLS

- New ops tables: admin via `is_admin()`; no anon writes.
- `customers` / `customer_addresses`: owner can **read** own row when `auth_user_id` matches.
- `order_events`: admin select/insert only; no update/delete policies; trigger forbids mutation.
- Customers can read events for their own orders (`user_id` or linked `customer_id`).

## Intentionally deferred (next slices)

- Payment transaction ledger / AR / payment schedules
- Refunds / credit notes / invoices / statements
- Fulfilments / delivery events / DPD status entities
- Draft orders
- Inventory movements / multi-location WMS
- Discount engine
- Shopify data import
- Widening existing `numeric(10,2)` money columns
- Staff author resolution (`read_users`)

## Recommended next slice

**Phase 2 — Money & AR foundation** — see `docs/UD_COMMERCE_PHASE2_MONEY.md` (implemented as migrations 041–043).

Following Phase 2, next is **Phase 3 — Fulfilment & delivery** — see `docs/UD_COMMERCE_PHASE3_FULFILLMENT.md` (migrations 044–045).

## Apply locally

```bash
npx supabase db reset   # or db push against linked project — do not auto-deploy production
psql "$DATABASE_URL" -f supabase/tests/041_commerce_foundation_verify.sql
```

Types: this repo maintains `src/integrations/supabase/database.types.ts` manually (no `gen types` script). Types were updated for this slice.
