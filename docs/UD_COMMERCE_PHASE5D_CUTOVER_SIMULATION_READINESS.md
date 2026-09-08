# Phase 5D — Cutover simulation, reconciliation & operational readiness

**Status:** COMPLETE — STOP FOR REVIEW  
**Nature:** Simulation / shadow / dry-run / readiness only — **NOT a production cutover**  
**Migrations:**
- `20260907161237_phase5d_cutover_simulation_readiness.sql`
- `20260907161518_phase5d_simulations_wms_gates.sql`
- `20260907161845_phase5d_simulation_order_status_fix.sql`

**UI:** `/backend/cutover` — Cutover Control Centre  
**Selftest:** `rpc_phase5d_cutover_simulation_selftest` → **PASS**  
**Vitest:** `src/admin/cutover/phase5dCutoverSimulation.selftest.test.ts` → **6 passed**

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
automation_engine_enabled = false
cutover_executed = false

Phase 4C ownership = 1,353 PENDING
```

**NO CUSTOMER CONTACT. NO LIVE EXTERNAL TRANSACTIONS. DO NOT CUT OVER.**

---

## 1. Cutover Control Centre

**Route:** `/backend/cutover`  
**RPC:** `rpc_admin_cutover_control_centre` (config/test-backed, not cosmetic)

| Domain | Status | Reason (summary) |
|---|---|---|
| COMMERCE | READY | catalogue_open |
| CRM | PARTIAL | Data present; 1,353 ownership pending |
| TRADE/AUTH | DISABLED | TECHNICALLY_READY; BUSINESS_APPROVAL_REQUIRED |
| COMPLIANCE | DISABLED | OBSERVE; BUSINESS_LEGAL_DECISION_REQUIRED |
| ORDERS | READY | 21,772 imported + native create |
| DRAFTS | READY | Draft ops + quote path |
| PAYMENTS | BLOCKED | Worldpay BLOCKED_EXTERNAL |
| FINANCE | READY | AR + docs; flags available |
| INVENTORY/WMS | DISABLED | READY_FOR_OPENING_BALANCE; wms off; catalogue gap |
| FULFILMENT | PARTIAL | Native ops; carrier blocked |
| CARRIER | BLOCKED | DPD BLOCKED_EXTERNAL |
| DOCUMENTS | PARTIAL | Templates; numbering unresolved |
| AUTOMATIONS | DISABLED | Flow-lite off |
| REPORTING | PARTIAL | saved_reports + admin RPCs |
| EXTERNAL DEPENDENCIES | BLOCKED | Worldpay/DPD/SKULabs opening |
| DATA MIGRATION | BLOCKED | Catalogue 1 vs Shopify ~2,213 |
| SECURITY | READY | 4H attack suite PASS |
| CUSTOMER ACTIVATION | DISABLED | Pilot NOT_SENT |
| CHECKOUT RULES | PARTIAL | Engine on; rules incomplete |
| PROMOTIONS | PARTIAL | Engine on; export incomplete |

---

## 2. Historical Data Reconciliation

Live Unique counts vs forensic Shopify baselines:

| ENTITY | SHOPIFY | UNIQUE | DIFF | STATUS |
|---|---:|---:|---:|---|
| orders | 21,767 | 21,772 | +5 | OK |
| customers | 6,225 | 6,257 | +32 | OK |
| companies | 3,518 | 3,520 | +2 | OK |
| drafts | 4,093 | 4,097 | +4 | OK |
| payment_transactions | 34,430 | 34,430 | 0 | OK |
| refunds | 3,774 | 3,774 | 0 | OK |
| refund_line_items | 23,918 | 23,918 | 0 | OK |
| fulfillments | 22,917 | 22,917 | 0 | OK |
| products | 2,213 | **1** | −2,212 | **DATA_GAP** |
| trade_approved | 5,728 | 5,748 | +20 | OK |

**Unexplained silent mismatches:** none for money/ops imports.  
**Full-parity readiness:** **false** due to catalogue DATA_GAP (blocker).

---

## 3. Order Reconstruction Matrix

Read-only sample of representative historical orders (Worldpay, Bank Deposit, PAY LATER, cash/manual, draft-origin, refund, multi-fulfilment, DPD, company/no-company, salesperson, discount).

Typical classifications:
- Worldpay orders → **BLOCKED_EXTERNAL** for live capture; history stored
- DPD → **PARTIAL** (tracking present; live labels blocked)
- Bank/manual/PAY LATER/draft → **FUNCTIONAL_PARITY** / **FULL_PARITY** where fields exist
- SKULabs pick/pack → **DATA_GAP by design** (not reconstructed)

**Historical rows not mutated.**

---

## 4. Unique-Native Order Simulation

Synthetic `@unique.invalid` customer + order + draft:

| Scenario | Result |
|---|---|
| Approved trade → order | PASS |
| Worldpay route | STOPPED_AT_DISABLED_GATEWAY |
| Bank Deposit | TECHNICALLY AVAILABLE / BUSINESS ACCEPTANCE REQUIRED |
| Manual payment | TECHNICALLY AVAILABLE / BUSINESS ACCEPTANCE REQUIRED |
| PAY LATER eligible/denied | Paths documented; no grant |
| Quote → draft | PASS |
| Emails sent | **0** |

---

## 5. End-to-End Lifecycle Simulation

Internal path exercised via simulation + WMS shadow:

order created → payment pending → (manual path available) → allocation/pick/pack on **UD_SHADOW** → documents templates present → audit via `cutover_simulation_runs`.

No customer contact. No production gateway/carrier.

---

## 6. WMS Shadow Validation

Warehouse **UD_SHADOW** only. `wms_enabled` remained **false**.

| Check | Result |
|---|---|
| Opening + receipt + adjustment | PASS |
| Allocation / partial / release | PASS |
| Pick + short pick | PASS |
| Pack (no on_hand change) | PASS |
| Transfer net-zero | PASS |
| Restock | PASS |
| Final on_hand = 97 | PASS |
| Ledger sum = balance | PASS |

---

## 7. Inventory Ledger Integrity

Shadow semantics proven:

```
OPENING + RECEIPT + ADJUSTMENT + PICK + TRANSFER(net) + RESTOCK = on_hand
```

ALLOCATION/RELEASE change **allocated/available**, not on_hand.  
PACK does not change on_hand.

---

## 8. Double-Deduction Audit

| Stage | Changes on_hand? |
|---|---|
| Payment | No |
| Allocation | No (available only) |
| **Pick** | **Yes — primary Unique decrement when WMS live** |
| Pack | No |
| Fulfilment | Must not double-decrement if pick already did |
| Carrier | No |
| `products.inventory_count` | Snapshot only — do not dual-write with WMS |

While `wms_enabled=false`, concurrent reservation risk is **LOW**.

---

## 9. Opening Stock Preview

**Wrote opening balances:** false  

Shopify forensic remains the reference catalogue. Unique products table is incomplete — preview is **not authoritative**.

Import structure when approved later:
`sku, warehouse_code, location_code, quantity, counted_at, approved_by` → movement type **OPENING** only.  
**Forbidden:** fabricate SKULabs pick/pack history.

---

## 10. SKU / Barcode Cutover Quality

| Source | Finding | Class |
|---|---|---|
| Unique products | 1 row; catalogue incomplete | **BLOCKS_WMS** |
| Shopify forensic | 12,677 variants; 279 without SKU; 8,689 barcodes; 121 barcode dup groups | REQUIRES_REVIEW |

**No automatic SKU merges/renames.**

---

## 11. WMS Activation Gate

Mandatory before `wms_enabled=true` (none satisfied for go-live):

1. opening stock approved  
2. SKU mapping acceptable  
3. warehouse/location confirmed  
4. movement ledger PASS (shadow PASS)  
5. allocation/pick/pack PASS (shadow PASS)  
6. inventory reconciliation PASS  
7. staff permissions PASS  
8. rollback procedure ready  

**wms_enabled stays false.**

---

## 12. Worldpay Continuity Analysis

| Metric | Value |
|---|---|
| Transactions `Worldpay eCommerce` | **11,528** / 34,430 (~33%) |
| `Worldpay Payments` | 7 |
| gateway_mode | disabled |

| Continuity option | Technical | Business |
|---|---|---|
| Bank Deposit (16,788 tx) | AVAILABLE | ACCEPTANCE REQUIRED |
| Manual / cash | AVAILABLE | ACCEPTANCE REQUIRED |
| PAY LATER (2,964 tx) | AVAILABLE for eligible only | ACCEPTANCE REQUIRED |
| Card capture | BLOCKED_EXTERNAL | — |

**Do not treat manual methods as approved production substitutes without business decision.**

---

## 13. DPD Continuity Analysis

| Metric | Value |
|---|---|
| Fulfillments | 22,917 |
| DPD-ish tracking_company | **~10,087** (~44%) |
| carrier_mode | disabled |

| Option | Technical | Operational |
|---|---|---|
| Manual fulfilment + tracking | AVAILABLE | Not equivalent to DPD automation |
| Live DPD labels | BLOCKED_EXTERNAL | — |

---

## 14. External Failure Modes

| System | Fails | Continues | Fallback | Data risk | Cutover impact | Decision |
|---|---|---|---|---|---|---|
| Worldpay | Card checkout | Manual/Bank/PAY LATER paths | Staff post payment | High volume historical | BLOCKER for full parity | BUSINESS |
| DPD | Auto labels | Manual fulfilment | Staff tracking | High fulfilment share | BLOCKER for full parity | BUSINESS |
| SKULabs history | Historical picks | Native WMS from OPENING | Physical count | No history migrate | BLOCKER until opening stock | OPS |
| Xero/Synder | GL sync | Unique ops AR | Manual books | Medium | HIGH / UNKNOWN | FINANCE |
| xtimcatlogx | Unknown | Catalogue if imported | — | Unknown | LIKELY_NON_BLOCKING | DEV interview |

---

## 15. Flow-Lite Dry Run

Engine **disabled**. 4 rules dry-run only; **actions_executed=false**.

| Rule | Trigger matches (approx) | Confidence | Conflicts |
|---|---|---|---|
| FromDraft | draft-origin orders | STRONGLY_INFERRED | none |
| WebsiteOrder | web/storefront | STRONGLY_INFERRED | none |
| Awaiting Payment | pending financial | STRONGLY_INFERRED | pairs with clear-on-payment |
| Clear Awaiting Payment | SUCCESS txs | WEAKLY_INFERRED | order vs add-tag |

Idempotency unique on `(rule_id, idempotency_key)`. No recursive self-trigger support.

---

## 16–18. Checkout / Promo / Quote Validation

- Checkout rules RPC returns fields/messages; **PASS**
- Synthetic 10% promo applied then deleted; no negative totals; **PASS**
- BXGY not enabled  
- Quote → draft simulation **PASS**; CRM synthetic customer created; emails=0

---

## 19. Document Parity

Templates seeded (inactive): invoice, packing slip, delivery note, order printout.  
Finance invoices/statements + ops packing slips exist.  
Production invoice numbering **still unresolved**.  
Reconstructed docs must remain labelled reconstructed.

---

## 20. Reporting Validation

`saved_reports` + existing admin list RPCs. Control centre can invoke reconciliation/selftest. Full report workspace UI = Phase 5E.

---

## 21. UD Sales Portal Final Parity

| Capability | Portal evidence | Unique | Parity | Gap | Risk |
|---|---|---|---|---|---|
| Customers/companies | ACTIVE API | CRM | PARTIAL→strong | — | Low if Unique used |
| Orders/drafts | ACTIVE | Orders/Drafts | PARTIAL→strong | — | Low |
| Ownership/CG | ACTIVE | Sales hub | PARTIAL | 1,353 pending | High if auto-apply |
| AR/payments | ACTIVE | Finance | PARTIAL | — | Medium |
| Live Shopify writes | ACTIVE | — | KEEP until freeze | Do not disconnect | High if early disconnect |

**Portal remains active. Do not disconnect.**

---

## 22. SureCust Final Parity

| Item | Class |
|---|---|
| Forms / fields | READY (config) |
| Trade application review | READY |
| Page/product/price/checkout locks | DISABLED_PENDING_CUTOVER (rules exist; trade_required off) |
| Live Lock UX | GAP until cutover approval |

**trade_required not activated.**

---

## 23. Storefront Smoke (catalogue_open)

Price security regression (`rpc_phase4h_postgrest_attack_selftest`) **PASS**.  
Forced `trade_required` evaluation remains available via existing shadow/precheck RPCs without activating.

*(Full browser smoke of every page = recommended manual QA before freeze; automated security gate green.)*

---

## 24. Security Regression

| Suite | Result |
|---|---|
| PostgREST / price leak (4H) | PASS |
| Ownership untouched | 1,353 PENDING |
| WMS/automation/gateway gates | disabled |
| No CRITICAL new cutover blocker from security suite | Confirmed |

---

## 25–26. Shopify Delta Architecture & Watermarks

Table `delta_watermarks` seeded for: products, variants, customers, companies, orders, drafts, transactions, refunds, fulfillments, inventory_snapshot, metafields, tags.

**Requirements:** idempotent, repeatable, reconcilable; prefer source `updatedAt` / GID cursors — not “last run succeeded” alone.  
**Freeze not executed.**

---

## 27. Freeze Plan (prepared, not executed)

| Area | True freeze needed? | Notes |
|---|---|---|
| Shopify checkout | Prefer freeze at T-0 | Else delta race |
| Draft creation | Prefer freeze | Staff drafts race |
| Inventory | Freeze + count | Opening balance |
| App writes (SKULabs/DPD/Worldpay) | Freeze or accept orphans | |
| Staff metafield/tag edits | Prefer freeze | Delta can tolerate briefly with watermark |

---

## 28. Cutover Clock / Runbook

| Time | Task |
|---|---|
| **T-7d** | Approve degraded vs full-parity mode; catalogue import plan; Worldpay/DPD credentials status; physical count schedule |
| **T-72h** | Delta rehearsal; reconciliation checksum dry-run; portal staff briefing; opening-stock sheet ready |
| **T-24h** | Final forensic pull; finance flag review; disable non-essential Shopify apps writes if approved |
| **T-4h** | Staff freeze checklist; confirm kill switches; UD_WH_1 count start |
| **T-1h** | Stop Shopify checkout if approved; final order watermark; Unique health check |
| **T-0** | Cutover decision; OPENING balances if approved; flip only approved gates |
| **T+15m** | Order create smoke; manual payment smoke; kill-switch verify |
| **T+1h** | Fulfilment/manual carrier check; AR post check; error triage |
| **T+24h** | Full reconciliation report; decide remaining gate flips |

**Not executed.**

---

## 29. Reconciliation / Checksum Plan (future T-0)

Machine checks: order count/value, customers, companies, drafts, transactions, refunds, fulfillments, inventory OPENING sum, product/variant counts.  
Expected designed diffs must be pre-declared (e.g. post-freeze Unique-native creates).

---

## 30. Business Continuity Modes (not activated)

| Mode | Available | Disabled | Risks | Approval |
|---|---|---|---|---|
| FULL_OPERATION | All Unique + adapters | — | Adapter readiness | YES |
| PAYMENTS_MANUAL | Bank/manual/PAY LATER | Worldpay | Card customers blocked | YES |
| SHIPPING_MANUAL | Manual fulfil/track | DPD API | Volume/SLA | YES |
| WMS_MANUAL | Staff stock process | Auto WMS | Error rate | YES |
| CATALOGUE_ONLY | Browse | Checkout | Revenue stop | YES |
| EMERGENCY_CATALOGUE_OPEN | Kill-switch open | Trade lock | Price exposure if mis-set | YES |

---

## 31. Kill Switch Matrix

All independently disableable (RPC `rpc_phase5d_kill_switch_matrix`):

`commercial_access_mode`, `trade_required_cutover_approved`, `compliance_enforcement_mode`, `payment_gateway_mode`, `carrier_mode`, `wms_enabled`, `automation_engine_enabled`, `promotions_engine_enabled`, `checkout_rules_enabled`, `pilot_send_authorized`.

---

## 32. Observability

Control centre + `cutover_simulation_runs` + existing commercial/policy events.  
Surfaces: orders, checkout/payment/AR errors, allocation/WMS exceptions, fulfilment/carrier, automation failures, auth/commercial denials — without unnecessary PII in dashboards.

---

## 33. Support Runbook (concise)

| Issue | Staff action |
|---|---|
| Cannot log in | Auth activation workspace; do not edit DB |
| Cannot see price | Confirm catalogue_open vs trade status; commercial session |
| Trade app pending | CRM trade applications queue |
| Payment issue | Manual/Bank post in finance; Worldpay disabled |
| Order stuck | Orders admin + notes; do not mutate Shopify |
| Stock unavailable | Do not enable WMS ad-hoc; use opening procedure |
| Pick short | WMS shadow semantics; live WMS still off |
| Tracking | Manual carrier fields; DPD disabled |
| Invoice/statement | Finance document generators |

**Never instruct raw SQL row edits as SOP.**

---

## 34. Remaining Unknown Apps

| App | Class | Evidence |
|---|---|---|
| xtimcatlogx | **LIKELY_NON_BLOCKING** / UNKNOWN | Sparse footprint; no ops SoR found |
| Synder | **POTENTIAL_BLOCKER** (finance) / UNKNOWN | Accounting bridge unclear vs Xero |

Do not block simulation on these alone.

---

## 35. Remaining Cutover Blockers

| Item | Severity | What prevents cutover | Needed | Who |
|---|---|---|---|---|
| Catalogue import (products=1) | **BLOCKER** | No sellable Unique catalogue | Import 2,213 products/variants + media | Data/eng |
| Worldpay adapter live | **BLOCKER** (full parity) | No card capture | Credentials + enable gate | Payments |
| DPD adapter live | **BLOCKER** (full parity) | No auto labels | Credentials + enable gate | Ops |
| Opening stock | **BLOCKER** (WMS) | No inventory SoT | Physical count + OPENING | Warehouse |
| Finance outstanding mismatches | **HIGH** | 2,741 mismatch flags | Review/repair policy (no silent rewrite) | Finance |
| Ownership 1,353 | **HIGH** | Wrong salesperson risk | Human review apply | Sales |
| Invoice numbering | **MEDIUM** | Statutory docs | Business numbering scheme | Finance/legal |
| Compliance enforce | **BUSINESS_DECISION** | Legal | Policy approval | Legal |
| trade_required | **BUSINESS_DECISION** | Commercial lock | Cutover approval | Leadership |
| Pilot send | **BUSINESS_DECISION** | Activation | Explicit authorize | Leadership |

---

## 36. Full-Parity Cutover Requirements

1. Catalogue fully imported + delta watermarks  
2. Worldpay adapter + test then live gate  
3. DPD adapter + test then live gate  
4. Opening stock approved; `wms_enabled` after gate  
5. Finance flag remediation plan  
6. Ownership apply policy  
7. trade_required + compliance decisions  
8. Portal freeze handoff  
9. Invoice numbering  
10. Signed freeze clock execution  

---

## 37. Degraded Cutover Capability (analysis only)

**Technically possible** if business accepts:

- Catalogue open (or limited) with Unique orders  
- Bank Deposit + manual payments (no cards)  
- Manual fulfilment/tracking (no DPD API)  
- No WMS (or WMS after emergency count)  
- Portal retained for Shopify API until freeze complete  

**Risks:** lost card conversion (~33% Worldpay tx share), slower shipping (~44% DPD share), stock errors without WMS, staff overload.

**Not recommended without explicit business acceptance.**

---

## 38. Tests / Files Changed

**Migrations:** listed above  
**UI:** `src/admin/cutover/AdminCutoverControlCentre.tsx`, `src/routes/backend/cutover.tsx`, `AdminShell` nav, `adminRpc` wrappers, `routeTree.gen.ts`  
**Tests:** `phase5dCutoverSimulation.selftest.test.ts` (6/6 PASS)  
**Docs:** this file  

**SQL selftest cases A–M:** PASS (catalogue full_parity_ok=false expected)

---

## 39. Recommended Phase 5E

1. **Catalogue delta import** (critical) — products/variants/media/inventory snapshot  
2. Wire storefront checkout fields + cart merge on login  
3. Finance mismatch triage workflow (no silent history rewrite)  
4. Worldpay/DPD adapter completion in **test** mode only  
5. Opening-stock rehearsal (dry-run count sheets)  
6. Ownership review tooling for 1,353  
7. Freeze clock dry-run with staff  

**DO NOT START PHASE 5E AUTOMATICALLY.**  
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
