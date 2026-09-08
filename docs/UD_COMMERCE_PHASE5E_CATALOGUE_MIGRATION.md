# Phase 5E — Full catalogue migration & commerce data parity

**Status:** COMPLETE — STOP FOR REVIEW  
**Nature:** DATA + PARITY — storefront/CMS **not** rebuilt  
**Outcome:** Shopify forensic catalogue fully loaded into Unique product architecture

**Migrations:**
- `20260907163629_phase5e_catalogue_schema_parity.sql`
- `20260907164506_phase5e_bulk_catalogue_merge.sql`
- `20260907164752_phase5e_media_tags_reconcile.sql`
- `20260907165736_phase5e_drop_product_sku_unique.sql`

**Import:** `scripts/phase5e-catalogue-import-fast.mjs` (idempotent bulk RPCs)  
**Selftest:** `rpc_phase5e_catalogue_selftest` → **PASS**  
**Vitest:** `src/admin/crm/phase5eCatalogueMigration.selftest.test.ts` → **6 passed**

---

## Locked end state (confirmed)

```
PHASE4I_PILOT_001 = NOT_SENT
pilot_send_authorized = false
commercial_access_mode = catalogue_open
trade_required_cutover_approved = false
compliance_mode = observe
Worldpay gateway_mode = disabled
DPD carrier_mode = disabled
wms_enabled = false
ownership pending = 1,353
```

**NO CUSTOMER CONTACT. NO CUTOVER.**

---

## 1. Existing Product Architecture Audit

| Area | Action |
|---|---|
| `products` + `product_variants` | **KEEP** — filled via import |
| `option_values` jsonb | **KEEP** |
| `categories` / single `collection_id` | **EXTEND** + `product_collections` M2M |
| Wishlists / bundles / reviews | **KEEP** |
| `metafields` / `tags` / `entity_tags` | **KEEP** — wired on import |
| `regulated_*` | **KEEP** — reclassified |
| Price-redacting DEFINER RPCs | **KEEP** |
| SEO / vendor / status / GIDs | **EXTEND** |
| Media | **EXTEND** `product_media` + CDN `SOURCE_REFERENCED` |
| Demo/static catalogue as SoT | **DEPRECATE** (1 UNIQUE_NATIVE remains) |
| New product engine | **NOT CREATED** |

---

## 2. Shopify Catalogue Source Baseline (exact forensic)

| Entity | Count |
|---|---:|
| Products | **2,213** (ACTIVE 723 · ARCHIVED 1,430 · DRAFT 58 · other 2) |
| Variants | **12,677** |
| Collections | **368** |
| Metafield nodes (product+variant) | **4,509** |
| Inventory items JSONL | **13,247** |
| Missing SKU | **279** |
| Duplicate SKU groups | **40** |
| Missing barcode | **3,988** |
| Duplicate barcode groups | **121** |

---

## 3. Product Import Architecture

- Identity: `shopify_product_gid` / `shopify_variant_gid` / collection / media GIDs  
- `source_system = shopify`, `catalogue_origin = SHOPIFY_IMPORTED`  
- Bulk RPCs: `rpc_phase5e_bulk_upsert_{products,variants,collections,media,metafields}`, memberships  
- Batches recorded in `catalogue_import_batches`  
- Delta watermarks updated  
- Idempotent re-run safe (onConflict by GID)

---

## 4. Full Import Batch Result

| Metric | Result |
|---|---:|
| Products imported | **2,213** |
| Variants | **12,677** |
| Collections | **368** |
| Memberships | **11,540** |
| Product/variant metafields | **4,509** |
| Media rows | **9,674** |
| Inventory snapshots | **13,247** |
| Tag links attempted | **14,240** |
| Regulated (nicotine_strength) | **384** |

---

## 5–6. Product / Variant Reconciliation

| | Shopify | Unique | Diff | Status |
|---|---:|---:|---:|---|
| Products | 2,213 | 2,213 | 0 | **OK** |
| Variants | 12,677 | 12,677 | 0 | **OK** |

`catalogue_readiness = READY`  
Published (ACTIVE) storefront products: **723** (+1 demo published possible → live published count 724)

---

## 7. Options

Preserved on `products.options_json` and variant `option_values` jsonb. No flatten to separate products.

---

## 8–9. SKU / Barcode Quality

| | Count | Class |
|---|---:|---|
| Missing SKU | 279 | REQUIRES_REVIEW |
| Duplicate SKU groups | 40 | REQUIRES_REVIEW (not auto-merged) |
| Missing barcode | 3,988 | REQUIRES_REVIEW / WMS scan risk |
| Duplicate barcode groups | 121 | REQUIRES_REVIEW |

Product-level unique SKU index **dropped** (blocked import); variant SKU remains working identity.

---

## 10. Price Reconciliation

Product `price` vs min variant price mismatches: **0**  
`price_mode` remains base. No invented wholesale tiers.

---

## 11–13. Metafields / Normalization / Compliance

- **All** product/variant metafields preserved in `metafields` EAV  
- Known: `custom.nicotine_strength` → regulated classification (**384** HIGH evidence)  
- UNKNOWN metafields retained  
- `compliance_mode = observe` (not enforced)

---

## 14–16. Tags / Collections / Memberships

- `tags_raw[]` + `entity_tags`  
- Collections 368 with GIDs/handles/SEO/ruleSet when known  
- Memberships idempotent; primary `collection_id` set to first membership  
- Smart collection **rules** preserved when present; else `rule_definition_status=UNKNOWN`

---

## 17. Category Mapping

| Approach | Status |
|---|---|
| Shopify collection → Unique collection | DIRECT_MAP (imported) |
| Product type → category | REVIEW (not auto-merged into unrelated Unique categories) |
| Existing Unique categories | KEPT |

---

## 18–19. Media Migration / Failures

- Featured + gallery URLs on products  
- `product_media` with `SOURCE_REFERENCED` (Shopify CDN) + source GID  
- Owned-storage copy = **PENDING** architecture (`PENDING_COPY` / resumable path ready) — not hotlink-final forever  
- Failures not blocking product import  

---

## 20–22. SEO / Handles / Redirects

- `seo_title` / `seo_description` / handles imported  
- Unique URL pattern remains `/product/{slug}` using Shopify handle where possible  
- SAME handle → SAME path for continuity  
- `seo_redirects` available for collisions (`*-shopify` remaps logged in conflicts)  
- Unique JSON-LD remains authoritative (no Avada clone)

---

## 23–24. Search / Filters

- Existing search RPCs operate on full catalogue  
- Recommended filters by population: vendor, product_type, collection, nicotine_strength metafield, variant options  
- Do not activate empty filters

---

## 25–27. Relationships / Bundles / Wishlist / Cart / Checkout

- No fabricated S&D relationships  
- Bundles/wishlist/cart continue on product/variant UUIDs (not SKU-alone)  
- Checkout snapshots use IDs; historical order lines unchanged  
- Storefront list RPC scale: total published ≥700 PASS in tests

---

## 28–29. Inventory Identity / Snapshot / Locations

- Variant `shopify_inventory_item_gid` preserved  
- `shopify_inventory_snapshots` = SOURCE only (**13,247** rows)  
- **No WMS ledger posts**  
- Location map: UD WH 1 = PHYSICAL; UD002–UD008 = SALESPERSON_VIRTUAL (not warehouses)

---

## 30–31. CMS / Metafield Admin

- Existing `/backend` catalog pages can page/search larger set (server RPC)  
- Metafields viewable via `metafields` table (admin); unknown fields not forced editable  
- No CMS rebuild

---

## 32–33. Provenance / Delta / Conflicts

- `catalogue_import_batches` + watermarks  
- Conflicts table for handle/SKU remap cases  
- UNIQUE_NATIVE demo product preserved (not deleted)  
- Re-import idempotent (Vitest confirmed counts stable)

---

## 34. Field Completeness (Shopify-sourced)

| Field | Notes |
|---|---|
| title/handle | 100% |
| vendor/type/status | populated from source |
| description_html | preserved |
| SKU on variants | 12,398 present / 279 missing |
| barcode | 8,689 present / 3,988 missing |
| price | all variants with source price |
| media | 9,674 media rows + product URLs |
| SEO | where Shopify provided |
| regulated | 384 by metafield evidence |

---

## 35. Storefront Scale

~2.2k products / 12.6k variants loaded.  
List/search/detail remain DEFINER RPC + redaction.  
No Elasticsearch introduced.

---

## 36–37. Security / Compliance Regression

| Check | Result |
|---|---|
| Phase 4H PostgREST attack | **PASS** |
| Forced trade_required list | redaction path intact |
| Compliance classify | 384 regulated; mode **observe** |

---

## 38. Finance Checksum

Outstanding mismatches still **2,741** (unchanged from 5D) — catalogue import did not rewrite order finance.

---

## 39. Updated Cutover Control Centre

`/backend/cutover` → `rpc_admin_cutover_control_centre` now includes **CATALOGUE** domain:

**CATALOGUE: READY** (2213/2213 products, 12677/12677 variants)

DATA MIGRATION domain aligned to catalogue readiness.

---

## 40. Remaining Cutover Blockers

| Item | Severity |
|---|---|
| Worldpay adapter | BLOCKER (full parity) |
| DPD adapter | BLOCKER (full parity) |
| WMS opening stock | BLOCKER |
| Finance 2,741 flags | HIGH |
| Ownership 1,353 | HIGH |
| trade_required / compliance enforce | BUSINESS_DECISION |
| Pilot activation | BUSINESS_DECISION |
| Media owned-storage copy completion | MEDIUM |
| SKU/barcode review | MEDIUM (WMS) |
| **Catalogue** | **CLEARED** |

---

## 41. Tests / Files Changed

**Scripts:** `scripts/phase5e-catalogue-import.mjs`, `scripts/phase5e-catalogue-import-fast.mjs`  
**Migrations:** listed above  
**Tests:** `phase5eCatalogueMigration.selftest.test.ts` (6/6)  
**Docs:** this file  

---

## 42. Recommended Phase 5F

1. Owned media copy into `cms-media` (resumable; rewrite destination_url)  
2. Admin metafield browser + SKU/barcode review queues  
3. Collection/category merchandising polish  
4. Worldpay/DPD **test** adapters (still disabled live)  
5. Opening-stock rehearsal using inventory snapshots  
6. Finance flag triage (no silent rewrite)  

**DO NOT START PHASE 5F AUTOMATICALLY.**  
**DO NOT CUT OVER.**

---

## Confirmations

```
NO CUSTOMER CONTACT

PHASE4I_PILOT_001 = NOT_SENT
pilot_send_authorized = false

commercial_access_mode = catalogue_open
trade_required_cutover_approved = false

compliance_mode = observe

Worldpay gateway_mode = disabled
DPD carrier_mode = disabled
wms_enabled = false
```

**STOP FOR REVIEW.**
