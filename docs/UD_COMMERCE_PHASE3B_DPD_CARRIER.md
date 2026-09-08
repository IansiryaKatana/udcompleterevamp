# Phase 3B — DPD product discovery & carrier foundation

**Status:** discovery + gated foundation.  
**DPD national API family:** UNCONFIRMED  
**carrier_mode:** disabled  
**Live DPD:** blocked (`phase_3b_live_blocked=true`)

## Evidence summary

Historical Shopify path used **DPD Integration by WSA** (WebShopAssist), which writes tracking + `DPD Delivery Status` into Shopify. Tracking hosts observed: `www.dpdlocal.co.uk`, `www.dpd.co.uk`. Raw labels: DPD / DPD UK / DPD Local.

WSA is middleware — Unique still needs the **exact UK DPD product/API** + credentials. Do not invent endpoints.

## What shipped

- `carrier_gateway_config` gate (disabled / unconfirmed)
- Inactive `carrier_service_mappings` (null service codes)
- Additive fulfilment carrier columns + `carrier_name_raw` preservation
- `fulfillment_parcels` model (no historical backfill yet)
- `carrier_shipment_requests` + create RPC that **rejects** while disabled/unconfirmed
- Backfill **preview** only (tracking 10,087 · delivered 6,778 · OFD 166 · …)
- TS: `dpdClient` + `DpdCarrierAdapter` behind `CarrierProvider`
- Admin fulfilment workspace shows carrier mode / product status

## Explicit non-goals

- Live DPD labels/consignments
- Invented service codes / API URLs
- Mass `shipment_events` backfill (preview only)
- SKULabs replacement / inventory redesign
- Worldpay / payment gateway changes

## SKULabs next-phase requirements

Need: API/export access, warehouse location model, pick/pack event export, stock movement history, bin data if any, order→SKULabs id map, confirmation whether Unique or SKULabs owns stock SoR post-cutover.

## Migrations

069–071
