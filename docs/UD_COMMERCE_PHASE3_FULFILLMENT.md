# UD Commerce Phase 3 — Fulfilment & delivery

Builds on Phase 1–2. Driven by Shopify forensic audit (Manual fulfilments, DPD WSA, SKULabs).

**Status:** schema only — no Shopify import, no deploy.

## Compatibility

| Existing | Decision |
|---|---|
| `orders.fulfillment_status` | **Unchanged** — Admin ship UI + account pages |
| `orders.tracking_number` / `carrier` / `shipped_at` | **Unchanged** — CMS summary fields |
| New detailed shipments | `fulfillments` + line items + `shipment_events` |

## Tables added

| Table | Role |
|---|---|
| `inventory_locations` | Warehouses; seeded **UD WH 1** (Shopify location) |
| `order_shipping_lines` | Method titles (Standard Delivery, Saturday, …) |
| `fulfillments` | Shipment headers, tracking, DPD `carrier_status` |
| `fulfillment_line_items` | Qty shipped per order line (snapshots) |
| `shipment_events` | Append-only carrier/WMS timeline |

## Orders columns added

- `primary_fulfillment_id`
- `dpd_delivery_status` — snapshot of Shopify custom attribute

## Shopify mapping

| Shopify | UD |
|---|---|
| `Order.fulfillments` | `fulfillments` |
| `trackingInfo[]` | `tracking_info` jsonb + denormalized company/number/url |
| `service.serviceName` (Manual) | `service_name` |
| Custom attribute `DPD Delivery Status` | `fulfillments.carrier_status` + `orders.dpd_delivery_status` |
| DPD WSA / SKULabs events | `shipment_events` (`source_app`) |
| Location UD WH 1 | `inventory_locations` |

## Migrations

- `044_fulfillments.sql`
- `045_shipment_events.sql`

Verify: `supabase/tests/043_phase3_fulfillment_verify.sql`

## Deferred

- Shopify FulfillmentOrder API objects (scopes still denied)
- Inventory quantity movements / bin history (SKULabs external)
- Multi-warehouse routing
- Draft orders (**Phase 4**)

## Next slice

**Phase 4 — Draft orders** — implemented: `docs/UD_COMMERCE_PHASE4_DRAFT_ORDERS.md`.

Next: **Phase 5** — Shopify import tooling **or** Admin CRM/AR/fulfilment UI.
