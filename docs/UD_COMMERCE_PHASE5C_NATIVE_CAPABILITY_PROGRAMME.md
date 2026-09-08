# Phase 5C — Native Shopify app replacement programme

**Status:** COMPLETE — STOP FOR REVIEW  
**Strategy:** Rebuild **business capabilities** in Unique Commerce OS. Do **not** clone Shopify apps. Do **not** wait indefinitely for app API/export access.  
**Migrations:**
- `20260907141454_phase5c_native_capability_programme.sql`
- `20260907143000_phase5c_register_polish.sql`
- `20260907143120_phase5c_cart_auth_merge.sql`

**Selftest:** `rpc_phase5c_capability_selftest` → **PASS**  
**Vitest:** `src/admin/crm/phase5cNativeCapability.selftest.test.ts` → **6 passed**

Inference labels used throughout: **CONFIRMED** / **STRONGLY_INFERRED** / **WEAKLY_INFERRED** / **UNKNOWN**.  
Feature parity: **COMPLETE** / **PARTIAL** / **NOT_BUILT** / **NOT_REQUIRED** / **EXTERNAL_ADAPTER_REQUIRED**.

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

automation_engine_enabled = false
wms_enabled = false

Phase 4C ownership candidates = 1,353 PENDING
```

**NO CUSTOMER CONTACT.** No pilot send. No Shopify mutations. No app disconnects. No ownership apply. No merges.

---

## 1. Final App Replacement Matrix

| APP | LIKELY BUSINESS PURPOSE | EVIDENCE | CONFIDENCE | EXISTING UNIQUE | MISSING | ACTION | PRIORITY | EXTERNAL DEP | CUTOVER RISK |
|---|---|---|---|---|---|---|---|---|---|
| SureCust Forms/Lock | Trade apply + catalogue/price/checkout lock | Trade tags, eligibility metafields, Phases 4D–4G | CONFIRMED | Trade apps, policy, CRM, fields, access_rules | Live trade_required Lock UX | PARTIAL — finish under cutover | HIGH | Config review | MEDIUM |
| SA Request a Quote | Quote → draft/order | request-quote fn, drafts | CONFIRMED | Drafts + quote form | Historical SA archive optional | REPLACED | LOW | — | LOW |
| UD Special Request | B2B special/stock/qty requests | App name + B2B pattern | WEAKLY_INFERRED | commercial_request_forms | Confirm field set with business | PARTIAL | MEDIUM | — | LOW |
| Checkout Blocks | Checkout fields/validation/blocks | B2B PO / notes pattern | STRONGLY_INFERRED | checkout_rules RPC | Exact historical rule export | PARTIAL | HIGH | Export useful | MEDIUM |
| Shopify Flow | Tag/status automations | FromDraft, WebsiteOrder, Awaiting payment tags | STRONGLY_INFERRED | automation_rules (DISABLED seeds) | Enable only after review | PARTIAL (engine off) | HIGH | Export preferred | MEDIUM |
| SMART Discounts | Code/auto discounts | Coupons + wholesale norms | STRONGLY_INFERRED | promotions + coupons | Discount export list | PARTIAL | HIGH | Export | MEDIUM |
| AOV.ai / BXGY | Free gift / BOGO | Weak install footprint | WEAKLY_INFERRED | promotions actions FREE_ITEM | Confirm usage before enable | PARTIAL model | LOW | — | LOW |
| Magefan Persistent Cart | Cross-device cart | storefront_carts | CONFIRMED | sync + auth merge + cleanup | Call merge on login UX | REPLACED | LOW | — | LOW |
| Search & Discovery | Search/filter/merch | Search RPCs | CONFIRMED | synonyms/boosts/merch tables | Wire admin + boost into RPC | PARTIAL | MEDIUM | — | LOW |
| Avada SEO | Meta/OG/JSON-LD/redirects | CMS SEO + sitemap | CONFIRMED | seo_redirects | Admin redirect UI | PARTIAL | LOW | — | LOW |
| Order Printer / Pro / PT2 | Invoice/packing/docs | finance_documents, ops_documents | CONFIRMED | document_templates seeds | Active templates + PDF polish | PARTIAL | HIGH | Historical PDFs | MEDIUM |
| Report Pundit | Ops reporting | Admin workspaces | STRONGLY_INFERRED | saved_reports | Report workspace UI | PARTIAL | MEDIUM | — | LOW |
| UD Sales Portal | Staff sales ops | Forensic LINKED/ACTIVE | CONFIRMED | /backend/sales + CRM | Keep until freeze | PARTIAL | HIGH | Keep scopes | HIGH if early disconnect |
| CSS Sales Team | Ownership / CG | SP_* tags, ownership | CONFIRMED | Sales RBAC + candidates | Apply 1,353 later | PARTIAL | HIGH | — | HIGH if auto-apply |
| Dollarback | Loyalty | Weak evidence | WEAKLY_INFERRED | — | — | NOT_REQUIRED | — | — | — |
| Brevo / PushOwl | Marketing campaigns | Consent/export need | STRONGLY_INFERRED | segments + Resend TX | Campaigns stay external | PARTIAL boundary | HIGH | Lists export | LOW (no send) |
| Messaging | Customer comms ledger | Name + ops need | WEAKLY_INFERRED | communication_* tables | No live chat | PARTIAL | MEDIUM | Export? | LOW |
| datafetchodoo | ERP sync | App name | STRONGLY_INFERRED | integration_connections | Credentials | INTEGRATION | MEDIUM | Odoo | LOW until wired |
| RangeMe | Marketplace syndication | Weak | WEAKLY_INFERRED | Catalogue exportable | — | NOT_REQUIRED | — | — | — |
| xtimcatlogx | Unknown custom | Sparse footprint | UNKNOWN | Catalogue/metafields | Interview | UNKNOWN_REMAINS | HIGH | Dev | MEDIUM |
| Shopify GraphQL App | Dev utility | No ops footprint | WEAKLY_INFERRED | — | — | NOT_REQUIRED | — | — | — |
| Theme Access | Theme tooling | — | CONFIRMED tooling | — | — | NOT_REQUIRED | — | — | — |
| Veeqo | WMS alt | No meaningful footprint | CONFIRMED absent | — | — | NOT_REQUIRED | — | — | — |
| Worldpay | Card payments | Phase 2E–2F | CONFIRMED | PaymentService | Live adapter | EXTERNAL_ADAPTER_ONLY | BLOCKER | API | HIGH until adapter |
| DPD WSA | Carrier labels/tracking | 55k events | CONFIRMED | CarrierProvider | Live adapter | EXTERNAL_ADAPTER_ONLY | BLOCKER | API | HIGH until adapter |
| SKULabs | WMS pick/pack | 20k events; UD WH 1 | CONFIRMED footprint | Native WMS foundation | Opening stock + enable | PARTIAL (disabled) | BLOCKER | Count procedure | HIGH |
| Xero | Statutory GL | Finance ops | STRONGLY_INFERRED | Ops AR native | GL connector | INTEGRATION | HIGH | Org access | MEDIUM |
| Synder | Accounting bridge? | Sparse | UNKNOWN | Finance modules | Interview | UNKNOWN_REMAINS | HIGH | — | MEDIUM |
| Google Shopping (mm-) | Feed | Merchant feed | CONFIRMED | Feed route + lockdown | — | PARTIAL→near COMPLETE | MEDIUM | — | LOW |
| EasyScan / ScanPick | Scan packing | Historical | WEAKLY_INFERRED | Native pack workflow | — | LIKELY_RETIRED / covered by WMS | LOW | — | LOW |
| zenvio | Legacy | Archive | WEAKLY_INFERRED | — | — | ARCHIVE_ONLY | — | — | — |

---

## 2. Confidence / Inference Matrix

| Capability | Confidence | Parity | Notes |
|---|---|---|---|
| Trade application + review | CONFIRMED | PARTIAL→near COMPLETE | Fields configurable; Lock not live |
| Quote → draft | CONFIRMED | COMPLETE path | Reuses drafts |
| Special request engine | WEAKLY_INFERRED | PARTIAL | Generic forms; not hard-coded |
| Checkout rules | STRONGLY_INFERRED | PARTIAL | Configurable model |
| Flow-lite | STRONGLY_INFERRED tags | PARTIAL | Seeds DISABLED |
| Promotions | STRONGLY_INFERRED | PARTIAL | BXGY modelled, unused |
| Persistent cart | CONFIRMED | COMPLETE foundation | Merge RPC added |
| Search config tables | CONFIRMED need | PARTIAL | Tables ready |
| SEO redirects | CONFIRMED | PARTIAL | Table ready |
| Documents | CONFIRMED | PARTIAL | Templates inactive seeds |
| Reporting | STRONGLY_INFERRED | PARTIAL | saved_reports |
| Sales portal | CONFIRMED | PARTIAL | Keep portal |
| Loyalty | WEAKLY_INFERRED | NOT_REQUIRED | No ledger |
| Marketing boundary | STRONGLY_INFERRED | PARTIAL | No campaigns |
| WMS | STRONGLY_INFERRED ops + industry | PARTIAL Unique-native | Not SKULabs clone |
| Worldpay/DPD | CONFIRMED need | EXTERNAL_ADAPTER | Disabled |

---

## 3. Flow-Lite Automation Engine

**Tables:** `automation_rules`, `automation_runs`  
**Runner:** `rpc_run_automation_event`  
**Gate:** `automation_engine_enabled = false`  
**Safety:** enabled flag, priority, idempotency key unique per rule, run log, soft actions only (`CREATE_EVENT` → `commercial_policy_events`). No arbitrary code. Never mutates Shopify-imported historical objects.

---

## 4. Reconstructed Automation Rules (DISABLED_BY_DEFAULT)

| Rule | Trigger | Confidence | Evidence |
|---|---|---|---|
| Tag FromDraft on draft conversion | DRAFT_CONVERTED | STRONGLY_INFERRED | ~3,742 FromDraft tags |
| Tag WebsiteOrder on storefront order | ORDER_CREATED | STRONGLY_INFERRED | ~17,872 WebsiteOrder |
| Awaiting Payment on pending | ORDER_PAYMENT_PENDING | STRONGLY_INFERRED | Awaiting payment* tags |
| Clear Awaiting Payment on payment | PAYMENT_POSTED | WEAKLY_INFERRED | Lifecycle inference |

**None enabled.** Do not auto-enable.

---

## 5. SureCust Replacement Completion

| Item | Status |
|---|---|
| A configurable trade application form | `trade_application_fields` |
| B application field storage | Existing trade applications + fields |
| C admin review | Existing admin RPCs |
| D approval/rejection | Existing trade eligibility |
| E–I page/product/collection/price/checkout rules | `trade_access_rules` (server model) |

**Not collapsed with:** age/compliance, PAY LATER, customer type.  
**Live Lock:** still gated by `catalogue_open` / cutover flags — **not activated**.

---

## 6. Quote Replacement

**Path:** QUOTE REQUEST → CRM → DRAFT → salesperson → commercial review → convert.  
**Reuse:** drafts, CRM, sales ownership, pricing, notes.  
**Forms:** `commercial_request_forms.quote_request` + existing `request-quote` edge.  
**No second draft engine.**

---

## 7. Special Request Replacement

**Engine:** `commercial_request_forms` + `commercial_requests`  
**Seeded type:** `special_product_request` with selectable request types (special / large qty / stock / commercial / other).  
**WEAKLY_INFERRED** — not hard-coded to one interpretation.

---

## 8. Checkout Blocks Replacement

**Tables/RPC:** `checkout_rules`, `rpc_evaluate_checkout_rules`  
**Seeded:** optional PO number, delivery instructions.  
**Server-side evaluation;** frontend may render.  
**B2B fields supported in model:** PO, delivery instructions, commercial notes — enable only as used. Snapshot onto orders remains a Phase 5D wiring task where checkout UI is extended.

---

## 9. Promotion / Discount Engine

**Canonical:** `promotions`, `promotion_redemptions` (+ existing `coupons`)  
**Calc:** `rpc_calculate_promotions`  
**Actions:** PERCENT_DISCOUNT, FIXED_DISCOUNT; FREE_ITEM / DISCOUNT_ITEM modelled as `REQUIRES_LINE_MATCH`.

---

## 10. AOV / BXGY Findings

Historical usage **not confirmed** as active value driver.  
**Decision:** model only; do **not** force into base discount path. Classification: **PARTIAL model / NOT required to enable**.

---

## 11. Persistent Cart Parity

| Feature | Status |
|---|---|
| storefront_carts + sync | CONFIRMED existing |
| Auth cart merge | `rpc_merge_guest_cart_on_auth` |
| Session continuity | session_id + user_id indexes |
| Expired cleanup | `rpc_cleanup_expired_storefront_carts` |
| Recovery linkage | abandoned cart fields remain |

**Classification:** **REPLACED_BY_UNIQUE** (wire merge call on login in storefront if not already).

---

## 12. Search & Discovery Replacement

**Config tables:** `search_synonyms`, `search_boosts`, `search_merchandising_rules`  
**Extend existing Postgres search RPCs** — no new search platform.  
**Filters:** derive from options/metafields/categories/collections/vendor/type/nicotine — do not hardcode unused dimensions (admin wiring = 5D).

---

## 13. SEO Replacement

CMS already owns title/description/OG/Twitter/JSON-LD/sitemap/robots.  
**Added:** `seo_redirects` (301/302). No competing structured-data generators.

---

## 14. Document / Printer Replacement

Unified via Unique document engine:  
`document_templates` (invoice, packing_slip, delivery_note, order_printout seeds **inactive**) + existing finance/ops documents.  
Historical reconstructed docs remain labelled. Production invoice numbering **still unresolved**.

---

## 15. Reporting Replacement

**saved_reports** for lightweight definitions (filters/columns/owner/visibility).  
Operational reports continue via existing admin RPCs/workspaces. No scheduled campaign emailing.

---

## 16. UD Sales Portal Parity

| Portal capability | Unique module | Status |
|---|---|---|
| Customers | CRM customers | PARTIAL→strong |
| Companies | CRM companies | PARTIAL→strong |
| Orders | Orders admin | PARTIAL→strong |
| Drafts | Draft ops | PARTIAL→strong |
| Sales ownership | Sales hub + RBAC | PARTIAL |
| AR / payments | Finance | PARTIAL |
| StoreName / CG / referral | CRM fields + tags | PARTIAL |
| Order creation | Drafts → convert | PARTIAL |
| Live Shopify API | Portal | KEEP until freeze |

**Do not disconnect portal.** Continue extending `/backend/sales`.

---

## 17. Loyalty Decision

Evidence **insufficient** for active balances.  
**Decision:** **NOT_REQUIRED_YET** — no loyalty ledger schema. Revisit if new evidence appears.

---

## 18. Marketing / Communication Boundary

- **Transactional:** Resend (unchanged)  
- **Segments:** `marketing_segments` definitions only — **no contact**  
- **Comms ledger:** `communication_threads` / `communication_messages`  
- **No campaigns. No live chat.**

---

## 19. Odoo / External Connector Boundary

`integration_connections` + `integration_sync_runs`  
Seeded **disabled:** odoo, xero, worldpay, dpd, rangeme.  
**No live external calls.**

---

## 20. Unknown App Decisions

| App | Decision |
|---|---|
| xtimcatlogx | **UNKNOWN_REMAINS** — preserve metafield/source evidence; no speculative subsystem |
| Synder | **UNKNOWN_REMAINS** — finance interview |
| Shopify GraphQL App | **NOT_REQUIRED** |
| Theme Access | **SHOPIFY_ONLY_TOOLING / NOT_REQUIRED** |
| Veeqo | **NOT_REQUIRED** |
| RangeMe | **EXTERNAL_INTEGRATION_OPTIONAL / NOT_REQUIRED** |

---

## 21. Worldpay Internal Readiness

Payment intent/state, gateway abstraction, webhook store, idempotency, admin controls — **already present**.  
**Remaining:** live adapter + credentials.  
`gateway_mode = disabled`. **EXTERNAL_ADAPTER_REQUIRED.**

---

## 22. DPD Internal Readiness

Fulfilments, parcels, CarrierProvider, tracking events — **present**.  
**Remaining:** live DPD adapter + credentials.  
`carrier_mode = disabled`. **EXTERNAL_ADAPTER_REQUIRED.**

---

## 23. Native WMS Architecture

Unique-native (not SKULabs clone):

```
warehouses → warehouse_locations
inventory_balances (materialized)
inventory_movements (immutable ledger)
inventory_allocations
picks / pick_lines
packs / pack_lines
stock_receipts / stock_receipt_lines
```

Seed warehouse: **UD_WH_1**.  
`wms_enabled = false` until opening-stock procedure.

---

## 24. Inventory Ledger

`inventory_movements` types: OPENING, RECEIPT, ALLOCATION, RELEASE, PICK, SHIP, RETURN, RESTOCK, ADJUSTMENT, TRANSFER, DAMAGE, CORRECTION.  
Use only as workflows need. Historical Shopify/SKULabs remain separate provenance.

---

## 25. Allocation Workflow

`rpc_admin_allocate_order_line` — separate from payment/fulfilment.  
Statuses: pending / allocated / partial / released / insufficient.  
Blocked while `wms_enabled=false`.

---

## 26. Pick Workflow

Statuses: READY_TO_PICK, IN_PROGRESS, PARTIAL, COMPLETED, CANCELLED.  
**Unique-native — not claimed SKULabs parity.**

---

## 27. Pack Workflow

Separate from fulfilment. PACKED ≠ SHIPPED ≠ DELIVERED.

---

## 28. Receiving / Adjustment / Transfer

- Receiving: `stock_receipts` + lines  
- Adjustment: `rpc_admin_stock_adjustment` (reason + actor + movement required; no silent `inventory_count` edits)  
- Transfer: movement type supported; UI later  

---

## 29. WMS Historical Migration Boundary

**DO NOT migrate SKULabs pick/pack/movement history.**  
At future cutover: archive Shopify evidence; physical count → **OPENING** balances; Unique-native movements begin thereafter.

---

## 30. Opening Stock Cutover Procedure (prepare only — NOT executed)

Documented in `site_settings.wms_opening_stock_procedure`:

1. Final Shopify + SKULabs snapshot (read-only)  
2. Physical warehouse count UD_WH_1  
3. Reconcile deltas  
4. Insert OPENING movements only  
5. Approve `wms_enabled=true`  

**Not executed in Phase 5C.**

---

## 31. Tests

| Test | Result |
|---|---|
| `rpc_phase5c_capability_selftest` | PASS |
| Locked gates / automation off / WMS off | PASS |
| Checkout rules + promotions calc | PASS |
| Price security (4H attack) | PASS |
| Ownership untouched = 1,353 | PASS |
| Worldpay/DPD disabled | PASS |
| Vitest phase5cNativeCapability | **6/6 PASS** |

Covered subsystems: automation skip/idempotency gate, trade/forms presence, checkout validation RPC, promotions, cart foundation, WMS disabled gate, register blockers, price security.

---

## 32. Migrations / Files Changed

**Migrations**
- `supabase/migrations/20260907141454_phase5c_native_capability_programme.sql`
- `supabase/migrations/20260907143000_phase5c_register_polish.sql`
- `supabase/migrations/20260907143120_phase5c_cart_auth_merge.sql`

**Tests / docs**
- `src/admin/crm/phase5cNativeCapability.selftest.test.ts`
- `docs/UD_COMMERCE_PHASE5C_NATIVE_CAPABILITY_PROGRAMME.md` (this file)

---

## 33. Remaining TRUE External Dependencies

1. **Worldpay** adapter + credentials (`gateway_mode` still disabled)  
2. **DPD** adapter + credentials (`carrier_mode` still disabled)  
3. **SKULabs** — opening stock / physical count (history unavailable)  
4. **Xero / Odoo** connectors when approved  
5. **Brevo** list/consent export (optional)  
6. **UD Sales Portal** Shopify API until freeze  
7. Optional: Flow/discount/Checkout Blocks exports to raise confidence (not blockers for native rebuild)

**Cutover blockers in register:** `skulabs`, `dpd_wsa`, `worldpay_ecommerce`  
**Flow** no longer a hard blocker (native engine exists, off by default).

---

## 34. Remaining UNKNOWN Capabilities

- **xtimcatlogx** — UNKNOWN_CAPABILITY  
- **Synder** — purpose unclear  
- Exact historical Checkout Blocks / SMART rule lists (native engines exist; parity list incomplete)  
- Production invoice numbering scheme  

---

## 35. Recommended Phase 5D

1. Wire storefront: trade form fields, commercial requests, checkout rules UX, cart merge on login  
2. Admin UIs: automation rules review, promotions, SEO redirects, saved reports, document templates  
3. Search RPC consume synonyms/boosts/merchandising  
4. Sales portal parity checklist closure in `/backend/sales`  
5. WMS admin ops (still `wms_enabled=false`) + opening-stock rehearsal (dry run)  
6. Worldpay/DPD adapter completion **without** enabling live modes  
7. Resolve UNKNOWN apps via short business/dev interviews  
8. Do **not** flip trade_required / compliance enforce / pilot send  

**DO NOT START PHASE 5D AUTOMATICALLY.**

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

automation_engine_enabled = false
wms_enabled = false
ownership pending = 1,353
```

**STOP FOR REVIEW.**
