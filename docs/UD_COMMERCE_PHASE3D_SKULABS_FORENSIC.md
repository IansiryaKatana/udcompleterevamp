# Phase 3D — SKULabs & warehouse forensic audit

**Status:** COMPLETE (read-only) — **STOP FOR REVIEW**  
**DPD:** remains parked (`carrier_mode=disabled`, product unconfirmed)  
**Warehouse implementation:** none (hard rule)  
**Schema migrations:** none

## Verdict

**SKULabs DIRECT ACCESS REQUIRED** before designing Unique’s warehouse replacement.

Shopify proves SKULabs is the operational fulfilment writer for a large share of modern orders, but does **not** expose pick/pack/bin/stock-movement/PO/user detail.

## Evidence sources (local)

| Source | Result |
|---|---|
| `shopify-forensic-audit/raw/` (JSONL) | Primary — orders, products, inventory, locations |
| `shopify-forensic-audit/analysis/` + FORENSIC-AUDIT.md | Prior footprint + metafield defs |
| Supabase import (`order_events`, `inventory_locations`) | Corroborates SKULabs messages; UD WH 1 seeded |
| `.env` / `private_settings` | **No SKULabs credentials** |
| Carrier config | Untouched — still disabled |

Script: `shopify-forensic-audit/scripts/phase3d-skulabs-forensics.mjs`  
Output: `shopify-forensic-audit/analysis/phase3d-skulabs.json`

## 1. Footprint summary

| Metric | Value |
|---|---|
| Orders total | 21,767 |
| Orders with SKULabs events | **10,143 (46.6%)** |
| SKULabs events | **20,588** |
| First seen | **2025-11-25** |
| Last seen | **2026-09-04** |
| Event shape | Almost always **2 per order** (9,948 orders): fulfil + shipping email |
| Attribution | **100% `attributeToApp`** — 0 staff users |

### Event types (Shopify)

| Pattern | Count | Purpose | Confidence |
|---|---|---|---|
| `SKULabs marked N items as fulfilled from UD WH 1.` | 10,309 | Create Manual fulfilment at UD WH 1 | HIGH |
| `SKULabs sent a shipping confirmation email to …` | 10,279 | Customer shipping email | HIGH |

No pick-start, pick-complete, pack-station, bin, short-pick, or wave events appear in Shopify.

### Other footprint

| Resource | Field | Count | Notes |
|---|---|---|---|
| Customer/Order metafield | `skulabs.shopname` | 1,462 customers / 5 orders | Packing-list / PDF shop name |
| Fulfilment service | Manual | 22,917 | SKULabs writes Manual, not a Shopify FS location |
| Tracking | Present on fulfilments | DPD/Other/etc. | Carrier labels separate from SKULabs events |

## 2. Shopify ↔ SKULabs data flow

| Concept | Direction | Confidence |
|---|---|---|
| Orders (ingest for warehouse) | SHOPIFY → SKULABS | LIKELY (inferred; no sync payload in Shopify) |
| Catalogue / SKUs | SHOPIFY → SKULABS | LIKELY |
| Inventory levels (snapshot) | BIDIRECTIONAL? | UNKNOWN — Shopify holds qty; writer of adjustments unknown |
| Fulfilments | **SKULABS → SHOPIFY** | **CONFIRMED** |
| Shipping confirmation email | **SKULABS → SHOPIFY/customer** | **CONFIRMED** |
| Tracking numbers | SKULABS → SHOPIFY and/or DPD WSA | LIKELY hybrid |
| Pick / pack / bins / users | **SKULABS PRIVATE** | HIGH |
| Purchase orders / receiving | EXTERNAL-ONLY / UNKNOWN | Incoming qty in Shopify implies receiving somewhere |
| Returns restock | UNKNOWN | Shopify restockType present; SKULabs role unclear |

## 3. Inventory source of truth

**INVENTORY SOURCE OF TRUTH = LIKELY HYBRID (Shopify snapshot + SKULabs operational WMS)**

Evidence:

- Single active Shopify location **UD WH 1** holds all 13,247 inventory items.
- Quantities (snapshot): available **533,290** · on_hand **597,648** · committed **63,253** · incoming **205,753** · reserved **0**.
- Bin/location metafields defined (EasyScan, ScanPick, scanpacker, custom) but **0 live values** in Shopify.
- SKULabs is the app that marks items fulfilled from UD WH 1.
- Incoming stock volume is large → receiving/PO truth likely outside Shopify Admin UX.

Do **not** change Unique inventory architecture in this phase.

## 4. Warehouse / location model

### Active Shopify location

| Location | Active | Items | Stock (avail/on_hand/committed/incoming) |
|---|---|---|---|
| UD WH 1 (Darwen BB3 1HN) | Yes / primary | 13,247 | 533,290 / 597,648 / 63,253 / 205,753 |

### Historical fulfilment location names (may be deactivated/deleted)

| Location on fulfilment | Fulfilment count |
|---|---|
| UD WH 1 | 22,487 |
| UNIQUE DISTRIBUTION LTD WAREHOUSE 2 | 385 |
| UD002 | 28 |
| UD004 – Simon Harthshom | 7 |
| UD008 – Karanjot Bassi | 7 |
| UD003 – Rob Lister | 1 |
| UD006 – Adam fysal | 2 |

**Conclusion:** Shopify currently looks single-warehouse; history shows Warehouse 2 + salesperson-named locations. Full multi-site model needs SKULabs + historical location audit.

## 5. SKU integrity

| Metric | Value |
|---|---|
| Variants | 12,677 |
| With SKU | 12,398 |
| Without SKU | 279 |
| Duplicate SKU groups (variants) | 40 |
| Inventory items blank SKU | 310 |
| Historical order lines with SKU | 516,189 / 531,738 |
| Lines without SKU | 15,549 |
| Lines with deleted product | 819 |

## 6. Barcode integrity

| Metric | Value |
|---|---|
| Variants with barcode | 8,689 |
| Without barcode | 3,988 |
| Duplicate barcode groups | 121 |
| Dominant patterns | EAN-13 (3,812), other (3,091), EAN-8 (1,519) |

**Warehouse scanning cannot rely on SKU alone** — ~31% of variants lack barcodes; duplicates exist.

## 7. Order release workflow (evidence-backed candidates)

Among SKULabs-touched orders (10,143):

| Signal | Count |
|---|---|
| PAID | 9,761 |
| PENDING | 259 |
| PARTIALLY_PAID | 33 |
| Worldpay eCommerce | 5,601 |
| Bank Deposit | 4,457 |
| WebsiteOrder | 8,832 |
| FromDraft | 1,284 |
| ON_HOLD (display status, all orders) | 41 |
| ON_HOLD tag | 0 in pull |

**Candidates (not proven rules):**

1. Paid website orders → warehouse actionable (majority).
2. Bank Deposit / PENDING credit accounts can still reach SKULabs (259 PENDING).
3. ON_HOLD appears as fulfilment display status, not a SKULabs event.

Release automation rules live in SKULabs (or Shopify Flow) — **not visible** as structured Shopify data.

## 8–9. Picking / packing

| Question | Finding |
|---|---|
| Pick create/assign/complete | **LIKELY SKULABS-PRIVATE DATA** |
| Pack station / packer / carton | **LIKELY SKULABS-PRIVATE DATA** |
| Shopify evidence of packing | Only fulfilment + multi-tracking (4,819 multi-TI fulfilments) + `skulabs.shopname` packing-list field |
| Fulfilment ≠ packing | Confirmed distinction — Shopify sees ship result, not pack process |

## 10. Allocation / reservation

| System | Concept | Evidence |
|---|---|---|
| Shopify | committed | 63,253 units on 1,548 items |
| Shopify | reserved | 0 |
| Shopify | available / on_hand / incoming | Present |
| Unique | `inventory_reservations` | **0 rows** — unused vs historical Shopify |

Eventual model must support at least: on_hand, available, committed/allocated, incoming. Pick/pack states unknown without SKULabs.

## 11. Stock movements

No inventory adjustment ledger in Shopify pull.  
**inventory_movements ledger: REQUIRED for replacement — EXTERNAL INVESTIGATION (SKULabs) for history.**

## 12. Purchase orders / receiving

| Concept | Classification |
|---|---|
| Incoming quantity in Shopify | **LIKELY USED** (205,753 units) |
| Suppliers / POs / partial receiving | **EXTERNAL-ONLY / UNKNOWN** |
| Landed cost | NO EVIDENCE in this audit |

## 13. Returns / restock

| restockType | Count |
|---|---|
| CANCEL | 15,750 |
| NO_RESTOCK | 4,471 |
| RETURN | 192 |

Native Shopify returns ≈ 7.  
**REFUND ≠ RESTOCK** remains correct. SKULabs restock role: **UNKNOWN**.

## 14. Fulfilment handoff

| SKULabs action | Shopify result | Unique future equivalent |
|---|---|---|
| Mark N items fulfilled from UD WH 1 | Manual fulfilment + lines + location | Create fulfilment via warehouse complete |
| Send shipping confirmation email | Order event + customer email | Notification service |
| (implied) attach tracking | fulfilment.trackingInfo | Carrier integration (DPD parked) |

Imported fulfilments remain **immutable**.

## 15. Multi-fulfilment

- 1,345 multi-fulfilment orders; **406** also have SKULabs events.
- 4,819 fulfilments with multiple tracking numbers (multi-parcel).
- Causes (split stock / multi-parcel / re-fulfilment) **not distinguishable** from Shopify alone.

## 16. Hold / cancel

- ON_HOLD display status: 41 orders.
- Cancelled fulfilments: 1,236.
- SKULabs cancel/hold messages: **0**.

## 17. Staff attribution

Warehouse staff identity **not in Shopify** for SKULabs actions (`attributeToUser=0`).  
**LIKELY SKULABS-PRIVATE.**

## 18–20. Lot / batch / compliance

- Batch metafields defined, **0 populated**.
- Bin/pick metafields defined, **0 populated**.
- Classification: **NO EVIDENCE in Shopify** / possible **EXTERNAL-ONLY**.
- No warehouse compliance markers found beyond catalogue product types. Legal/ops review required separately.

## 21. Unique platform gap matrix

| Concept | Evidence need | Classification |
|---|---|---|
| product/variant inventory_count | Snapshot exists | KEEP / EXTEND |
| inventory_reservations | Unused; Shopify committed exists | EXTEND after SoT decision |
| fulfillments / lines / shipment_events | Present | KEEP |
| Manual / partial / multi-fulfilment | Present | KEEP |
| Warehouses / locations | UD WH 1 + historical names | EXTEND (model) after SKULabs |
| Bins / locations | Defs empty in Shopify | EXTERNAL INVESTIGATION |
| inventory_movements ledger | Not in Shopify | BUILD after extraction |
| Allocations / picks / packs | Private to SKULabs | EXTERNAL INVESTIGATION → BUILD |
| Receiving / POs / transfers | Incoming only | EXTERNAL INVESTIGATION |
| Warehouse users | Not in Shopify | EXTERNAL INVESTIGATION |
| Barcode scanning | Partial barcodes | EXTEND catalogue quality |
| Cycle counts | No evidence | NOT REQUIRED BASED ON EVIDENCE (yet) |

## 22–24. What Shopify has vs SKULabs needs

### In Shopify

Orders, payments, tags, metafields, catalogue, inventory snapshot, Manual fulfilments, tracking headers, SKULabs order events (fulfil + email only).

### Likely private to SKULabs

Picks, packs, bins, stock movement history, warehouse users, automation/release rules, suppliers/POs/receiving detail, kit/bundle warehouse behaviour, discrepancy handling.

### Exact access required

1. Read-only API or export of warehouses/locations/bins  
2. Inventory levels + full stock movement / adjustment history  
3. Order↔SKULabs id map + pick/pack records  
4. Users / roles who performed warehouse actions  
5. Purchase orders + receiving  
6. Transfers / recounts / damage / quarantine if present  
7. Automation rules for release-to-warehouse  
8. Confirmation whether SKULabs or Shopify is stock SoR post-cutover  

Preserve under conceptual `raw_skulabs/` without destructive normalization.

## 25. Migration risk register (warehouse)

| ID | Risk | Level |
|---|---|---|
| W1 | Pick/pack/bin history only in SKULabs | **BLOCKER** |
| W2 | Stock movement history missing | **BLOCKER** for ledger cutover |
| W3 | Incoming stock implies PO/receiving elsewhere | **HIGH** |
| W4 | Historical multi-location fulfilments vs single active location | **HIGH** |
| W5 | SKU/barcode gaps & duplicates | **HIGH** |
| W6 | Staff attribution missing for warehouse audit | **MEDIUM** |
| W7 | Batch/lot metafields unused — compliance gap unknown | **MEDIUM** |
| W8 | Parallel fulfilment paths without SKULabs events still exist in 2026 | **HIGH** |

## 26. Recommended warehouse canonical model (RECOMMEND ONLY)

Do **not** implement yet. Candidate domains after SKULabs extraction confirms objects:

1. `warehouses` / `locations` / optional `bins`  
2. `inventory_balances` (on_hand, available, committed, incoming)  
3. `inventory_movements` append-only ledger  
4. `allocations` (order → stock)  
5. `picks` / `pick_lines`  
6. `packs` / parcels (align with `fulfillment_parcels`)  
7. `receipts` / `purchase_orders` if confirmed  
8. Warehouse `staff` actors for audit  

Until SKULabs export confirms which exist, treat this as a hypothesis list.

## 27. Recommended next phase

**Phase 3E (proposed): SKULabs read-only extraction & warehouse SoT confirmation**

Not: warehouse ops build, DPD live, event backfill, inventory redesign.

## Explicit non-actions this phase

- No live DPD / no carrier mapping activation / no shipment event backfill  
- No warehouse tables created  
- No inventory architecture change  
- No Shopify mutations  
- No SKULabs credentials invented
