# UD Commerce Phase 3A — Fulfilment, shipping & delivery operations foundation

**Status:** operational foundation shipped (TEST/manual Unique-native).  
**Live DPD:** NOT enabled.  
**Worldpay:** unchanged (`gateway_mode=disabled`).

## What already existed (pre-3A)

Schema from earlier migrations (`044`/`045`/`050`): `fulfillments`, `fulfillment_line_items`, `shipment_events`, `order_shipping_lines`, `inventory_locations` (UD WH 1), order fulfilment fields, read-only admin order panel.

## What Phase 3A added

| Area | Delivery |
|---|---|
| Capabilities | `fulfilment_*` caps + `can_*` helpers |
| Immutability | Shopify fulfilments blocked from UPDATE/DELETE |
| Manual ops | create / cancel / tracking RPCs (no inventory decrement) |
| Status | `order_recompute_commerce_fulfillment_status` — partial + multi-fulfilment |
| Delivery | mapped separately from fulfilment; FULFILLED ≠ DELIVERED |
| Documents | `ops_documents` packing slip (no prices) |
| Workspace | `/backend/fulfilment` server-filtered list + metrics |
| Carrier interface | `CarrierProvider` stub — DPD product unconfirmed |
| Selftest | `rpc_phase3a_fulfilment_selftest` A–L |

## Inventory boundary

1. **AVAILABLE** — `product_variants` / `products.inventory_count`  
2. **RESERVED** — `inventory_reservations` at checkout/quote  
3. **COMMITTED / deducted** — `rpc_fulfill_order_inventory` on Stripe payment  
4. **FULFILLED/SHIPPED** — fulfilment rows only (no second stock decrement)  
5. **RETURNED** — refund `restock_type` imported; no Unique restock automation yet  

## External apps

| App | Classification |
|---|---|
| DPD Integration by WSA | ACTIVE DEPENDENCY historically; Shopify footprint only in OS — **REQUIRES EXTERNAL ACCESS** for full shipment SoR |
| SKULabs | ACTIVE DEPENDENCY historically (WMS/pick); Shopify events footprint — **REQUIRES EXTERNAL ACCESS** |
| Veeqo | UNKNOWN / no Shopify namespace evidence |

## Migrations

- `066_phase3a_fulfilment_ops.sql`
- `067_phase3a_fulfilment_metrics_display_status.sql`
- `068_phase3a_workspace_trading_name_fix.sql`

## Explicit non-goals (this phase)

- Live DPD label purchase / dispatch / cancel  
- Disconnect Shopify / Veeqo / SKULabs / DPD WSA  
- Pick/pack stage machine as historical fact  
- Worldpay / gateway_mode changes  
- Automatic customer dispatch emails  

## Recommended Phase 3B

Confirm DPD product + credentials; wire carrier adapter behind `CarrierProvider` in TEST only; optionally backfill `shipment_events` from order_events DPD/SKULabs footprints; delivery_status derivation job for historical display_status.
