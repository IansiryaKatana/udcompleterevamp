# Phase 5G — WMS Opening Stock & Warehouse Cutover Readiness

**Status:** COMPLETE — STOP FOR REVIEW  
**Not a cutover. WMS not enabled. No production opening post.**

## Locked state (unchanged)

| Gate | Value |
|---|---|
| PHASE4I_PILOT_001 | NOT_SENT |
| pilot_send_authorized | false |
| commercial_access_mode | catalogue_open |
| trade_required_cutover_approved | false |
| compliance_mode | observe |
| Worldpay / DPD | disabled |
| wms_enabled | **false** |
| wms_opening_post_authorized | **false** |
| catalogue_readiness | READY |
| finance_readiness | REVIEW_REQUIRED |

## 1. Inventory source baseline

| Metric | Source / Unique | Status |
|---|---:|---|
| Inventory snapshot rows | 13,247 | OK |
| Variants | 12,677 | OK |
| Snapshot→variant exact ID matches | 12,677 | OK |
| Unmapped inventory items | 570 | REVIEW |
| Tracked snapshot rows | 13,247 | OK |
| Sum ON_HAND | 597,648 | — |
| Sum AVAILABLE | 533,290 | — |
| Sum COMMITTED | 63,253 | — |
| Sum INCOMING | 205,753 | — |

All live snapshot rows currently under location name **UD WH 1**.

## 2–4. Locations & canonical warehouse

| Location | Classification | Opening? |
|---|---|---|
| UD WH 1 | PHYSICAL_ACTIVE → **UD_WH_1** | Yes (candidate) |
| Warehouse 2 | PHYSICAL_HISTORICAL | No |
| UD002–UD008 | SALESPERSON_LOGICAL | No / EXCLUDE_FROM_WMS |

Canonical warehouse **UD_WH_1** + `DEFAULT` location; shadow **UD_SHADOW** + `SHADOW_DEFAULT`.

## 5–7. Identity / SKU / barcode

| Check | Count | Impact |
|---|---:|---|
| Missing SKU | 279 | MANUAL_PICK_ALLOWED |
| Duplicate SKU groups | 40 | BLOCKS_SCANNING / review |
| Missing barcode | 3,988 | MANUAL_SKU_PICK_ONLY |
| Duplicate barcode groups | 121 | IDENTITY_AMBIGUOUS → STOP_REQUIRE_SELECTION |

Source IDs remain migration identity. No auto-merge.

## 8–10. Semantics & committed stock

ON_HAND / AVAILABLE / COMMITTED / INCOMING are **not interchangeable**.

Cutover forbid:
- OPENING=ON_HAND then re-allocate open orders without seeding ALLOCATED / freeze
- OPENING=AVAILABLE then subtract COMMITTED again

Allowed patterns documented in `rpc_phase5g_inventory_baseline`.

**Opening basis = BUSINESS_APPROVAL_REQUIRED** (not silently chosen).

## 11–12. Open orders / drafts

Unfulfilled+processing exposure: **716 orders** (selftest).  
`inventory_reservations` = **0**. Drafts: recommend **NOT_RESERVE** until business decides. No historical backfill.

## 13–17. Opening model / staging / shadow

Tables: `wms_opening_batches`, `wms_opening_staging`, `wms_physical_count_lines`.

Shadow import (authorized):
- Staged 13,247 rows (ON_HAND candidate)
- 1 negative qty held in REVIEW (cannot OPENING)
- Posted **12,595** non-negative mapped rows to **UD_SHADOW**
- Reconcile: SOURCE_POSTABLE = OPENING_LEDGER (**PASS**)
- UD_WH_1 post **blocked** (`PRODUCTION_OPENING_BLOCKED`)

## 18–28. Rehearsals (shadow)

Allocation (no oversell via FOR UPDATE), short pick, pack≠ship, receiving partial, damage adjust, restock≠refund, barcode empty→manual pick. Transfers = **FUTURE_NOT_REQUIRED** (only one physical WH).

Stock deduction: pick is primary on_hand leave; pack does not decrement.

## 29–31. Incoming / adjust / transfer

Incoming excluded from opening ON_HAND — business decision required. Adjustments audited. Transfers not required.

## 32–34. Admin / RBAC / approval

`/backend/wms` opening workspace. Opening approve = owner/admin. Prepare≠silent post (production gate off).

## 35–36. Opening post

Production-capable RPC exists; **hard-blocked for UD_WH_1**. Shadow post + duplicate-batch idempotency tested. Rollback = compensating **CORRECTION** (never delete OPENING).

## 37–42. Delta / freeze / count / checksum

T-24h / T-4h / T-0 snapshot procedure documented (not executed). Freeze setting `wms_freeze_window_active=false`. Physical count sheets table ready (RECOMMENDED BUSINESS CONTROL). Checksum via shadow reconcile.

## 43–47. Observability / negatives / reservations / SoR

Observability RPC; negative ON_HAND prevented; `inventory_reservations` **DEPRECATED** → use `inventory_allocations`. Future SoR Unique after activation; no Shopify writeback now.

## 48–56. Independence & locks

Finance still REVIEW_REQUIRED. Catalogue READY. No finance auto-review. Externals disabled.

## Cutover WMS readiness

**SHADOW_RECONCILED** — awaiting opening-basis approval. **Not READY_TO_ACTIVATE.**

## Remaining blockers / human decisions

1. Approve opening basis (ON_HAND vs AVAILABLE vs physical count)  
2. Committed-stock cutover pattern choice  
3. Incoming stock treatment  
4. Draft reserve policy  
5. Review negative source qty + duplicate SKU/barcode groups  
6. Physical/sample count acceptance  
7. Freeze window approval  
8. Later: `wms_opening_post_authorized` + production OPENING (not now)

## Recommended Phase 5H

CRM ownership/commercial activation readiness **or** fulfilment/carrier dry-run — **only after** opening-basis business approval. Do **not** auto-start.

### Tests / files

- Migrations `20260907174943` … `20260907175440`
- SQL selftest **16/16**
- UI `/backend/wms`, cutover centre WMS stages
- Vitest `phase5gWmsOpening.selftest.test.ts`

---

**NO CUSTOMER CONTACT · NO CUTOVER · NO PRODUCTION OPENING · wms_enabled=false**

**STOP FOR REVIEW. DO NOT START PHASE 5H.**
