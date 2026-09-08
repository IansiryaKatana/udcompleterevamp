# Phase 5A — Regulated commerce & compliance foundation

**Status:** COMPLETE — STOP FOR REVIEW  
**Migration:** `20260907131931_phase5a_compliance_foundation.sql`  
**Selftest:** `rpc_phase5a_compliance_foundation_selftest`  
**Enforcement:** `compliance_enforcement_mode = observe` (no new purchase denials)

This document is an engineering evidence inventory. It is **not UK legal advice**.

---

## Locked end state (confirmed)

```
PHASE4I_PILOT_001 = NOT_SENT
pilot_send_authorized = false
emails_sent = 0

commercial_access_mode = catalogue_open
trade_required_cutover_approved = false

compliance_enforcement_mode = observe
age_gate_display_enabled = true  -- display-only 18+ notice; not verification

Worldpay / DPD / SKULabs / Warehouse / Phase 4C ownership (1,353) — untouched
```

---

## 1. Existing Compliance Audit

| Area | Finding | Rec |
|---|---|---|
| Age gate in UD app | **Absent** | BUILD display scaffolding (off by default) + EXTERNAL CONFIRMATION for legal sufficiency / Shopify theme history |
| Cookie consent | Client `localStorage` only | KEEP; EXTEND if server audit needed |
| Legal pages | CMS privacy/terms/cookies | KEEP / EXTEND copy for UD wholesale |
| Newsletter | Email only, no consent checkbox | EXTEND if marketing lawful-basis required |
| Terms acceptance record | Absent historically | BUILD table (empty; not required until business confirms) |
| Trade / SureCust | Strong Phase 4D–4I | KEEP — **not age verification** |
| Product nicotine metafield | Shopify forensic `custom.nicotine_strength` (384); live UD catalog largely not imported | EXTEND classify-from-evidence |
| Product regulated columns | Did not exist | BUILD minimal indicators |
| Destination blocks | Shipping zone `countries=[]` = all | EXTERNAL / BUSINESS — do not invent |
| Draft compliance | No regulated checks | EXTEND when enforce authorized |
| Staff override | Not evidenced as formal compliance override | EXTERNAL CONFIRMATION before BUILD |

---

## 2. Existing Age Gate Findings

| Question | Answer |
|---|---|
| Where implemented? | **Nowhere** in UD storefront (pre-5A) |
| Client-only? | N/A |
| Cookie/session? | N/A (cookie stack is consent-only) |
| Server authorization? | **No** |
| Bypassable? | N/A |
| Audited? | No |
| Classification | **DISPLAY GATE ABSENT** — not ACCESS GATE, not PURCHASE CONTROL |

Phase 5A adds optional `AgeGateDisplayNotice` gated by `age_gate_display_enabled=false`. When enabled it is explicitly **display-only**, not verification.

---

## 3. Trade vs Compliance Boundary

| Concept | Field / system | Equals age verified? |
|---|---|---|
| Trade eligibility | `trade_access_status` | **NO** |
| PAY LATER | `pay_later_eligible` | **NO** |
| Compliance | `compliance_status` (new) | Separate; default `NOT_RECORDED` |
| SureCust_Wholesale | tag / provenance | Wholesale ACCESS evidence only |

Hard rule encoded in policy: `trade_is_not_age_verified = true`.

---

## 4. Product Regulation Classification

| Indicator | Source | Live count (UD DB) | Forensic | Confidence | Current use |
|---|---|---|---|---|---|
| `custom.nicotine_strength` | Shopify metafield | ~0 product metafields (catalog not fully imported; 1 product row) | **384** definitions | HIGH when present | Classification foundation |
| Categories in UD | Demo electronics names | Present | N/A | — | Not used for regulation |
| Name inference | — | — | — | — | **Not used** |

---

## 5. Restricted Product Model (minimum)

Columns on `products`:

- `regulated_indicator` boolean nullable  
- `regulated_source` text  
- `regulated_confidence` HIGH\|MEDIUM\|LOW\|UNKNOWN  
- `regulated_classified_at`

Populated **only** via `rpc_admin_classify_regulated_products_from_evidence` from `custom.nicotine_strength`. Raw tags/metafields preserved.

---

## 6–8. Customer/Company Compliance + State + Evidence

**States:** `NOT_RECORDED` · `PENDING_REVIEW` · `RECORDED_PASS` · `RECORDED_FAIL` · `SUSPENDED` · `EXPIRED`

Default for all existing customers/companies: **NOT_RECORDED** (honest: no Unique-native check on file).

Evidence table `compliance_evidence_refs`: method, result, external_reference, timestamps — **no document blobs / passport / licence numbers** (CHECK constraint).

---

## 9–10. Policy Integration + Reason Codes

`compliance_policy_evaluate(...)` merges with commercial policy.

Reason codes (examples): `TRADE_NOT_APPROVED`, `COMPLIANCE_REQUIRED`, `COMPLIANCE_SUSPENDED`, `PRODUCT_REGULATED_INDICATOR`, `PAY_LATER_NOT_ELIGIBLE`, `ACCOUNT_SUSPENDED`.

**Observe mode (live):** records `COMPLIANCE_REQUIRED` for regulated + NOT_RECORDED but **does not deny** purchase.  
**Enforce mode:** would deny — **not enabled**; requires business/legal confirmation.

---

## 11–17. Server / UX / Cart / Checkout / Order / Draft / Override

| Surface | Phase 5A behavior |
|---|---|
| Server assert | Merges compliance; denials only if `enforce` |
| Age UX | Display component off by default |
| Product UX | Admin inventory; no clutter on all cards yet |
| Cart / checkout | Existing trade/price gates unchanged under observe |
| Order snapshot | `orders.compliance_snapshot` jsonb for Unique-native future use |
| Draft | No silent admin=bypass; override not implemented (needs workflow confirm) |
| Override | **Not built** — EXTERNAL CONFIRMATION REQUIRED |

---

## 18–20. Destination / Payment / Marketing

| Topic | Finding | Class |
|---|---|---|
| Shipping zones | Empty country list = worldwide match | CONFIGURATION RULE; LEGAL REVIEW if UK-only intended |
| Payment | Trade + PAY LATER only; Worldpay disabled | BUSINESS / TECHNICAL |
| Marketing | Newsletter email capture; cookie marketing flag | Distinguish transactional (activation) vs marketing — do not auto-subscribe |

---

## 21–23. Terms / Events / Admin

- `policy_acceptances` table ready; `terms_acceptance_required=false`
- `compliance_events` append-only
- Customer detail shows compliance fields separately from trade
- Review queue RPC for PENDING_REVIEW etc. (empty until used)

Permissions: reuse `is_admin()` for mutations; no RBAC explosion in 5A.

---

## 24–25. Historical Shopify + App Footprints

| Evidence | Class |
|---|---|
| SureCust Forms / Lock / Wholesale tags | CURRENT DATA IN SHOPIFY + imported tags; REPLACEABLE by trade_access; **not age app** |
| Checkout Blocks order-limits | LIKELY APP-PRIVATE / EXTERNAL INVESTIGATION for live rules |
| Flow tags | OBSERVED |
| AgeChecker / similar | **NO EVIDENCE** in forensic pull → EXTERNAL INVESTIGATION REQUIRED |
| nicotine_strength metafield | CURRENT IN SHOPIFY definitions |

---

## 26. Regulatory Requirements Matrix

| Control | Evidence | Implementation | Gap | Classification |
|---|---|---|---|---|
| Wholesale trade gate | SureCust + Phase 4 | `trade_access_status` | — | CONFIRMED BUSINESS REQUIREMENT |
| Age verification | None in UD / unclear on live theme | Display notice scaffolding only | Sufficiency unknown | LEGAL/REGULATORY CONFIRMATION REQUIRED |
| Regulated product flag | nicotine_strength | Indicator + classify RPC | Catalog import incomplete | OBSERVED HISTORICAL CONTROL |
| Cookie consent | Client CMP | Banner | Server log | TECHNICAL BEST PRACTICE |
| Terms acceptance | None recorded | Table ready | Whether required | BUSINESS / LEGAL CONFIRMATION REQUIRED |
| Destination restriction | Empty zone | None | UK-only? | BUSINESS / LEGAL CONFIRMATION REQUIRED |
| Enforce compliance on purchase | None live | Observe hooks | When to enforce | LEGAL/REGULATORY CONFIRMATION REQUIRED |

---

## 27–28. Data Minimization & Retention

| Data | Necessity |
|---|---|
| Evidence ref + result + method | NECESSARY for audit foundation |
| Identity document storage | **UNNECESSARY / not built** |
| Policy version acceptances | OPTIONAL until required |
| Retention periods | **BUSINESS/LEGAL DECISION REQUIRED** |

---

## 29. Cutover Readiness Matrix (compliance slice)

| Item | Status |
|---|---|
| Regulated product classification | FOUNDATION (await catalog) |
| Trade access | READY (Phase 4) |
| Customer/company compliance fields | READY (NOT_RECORDED) |
| Cart/checkout enforcement | OBSERVE only |
| Draft enforcement | GAP until enforce policy decided |
| Destination | GAP / decision required |
| Audit trail | READY |
| Staff override | NOT BUILT |
| Policy acceptance | TABLE READY / not required |
| Price security | REGRESSION PASS |

Production Shopify cutover **not** performed.

---

## 30. Tests

| Suite | Result |
|---|---|
| `rpc_phase5a_compliance_foundation_selftest` | PASS (via Vitest) |
| Trade ≠ compliance observe | PASS |
| Enforce preview blocks unrecorded+regulated | PASS |
| Age gate not verification | PASS |
| Phase 4H PostgREST regression | PASS |

---

## 31. Migrations / Files Changed

- `supabase/migrations/20260907131931_phase5a_compliance_foundation.sql`
- `src/components/legal/AgeGateDisplayNotice.tsx`
- `src/routes/__root.tsx`
- `src/admin/crm/AdminCustomerDetail.tsx`
- `src/admin/lib/adminRpc.ts` (compliance helpers)
- `src/admin/crm/phase5aComplianceFoundation.selftest.test.ts`
- `scripts/phase5a-audit.mjs`
- `docs/UD_COMMERCE_PHASE5A_COMPLIANCE_FOUNDATION.md`

---

## 32. Remaining Compliance Gaps

1. Live product catalog largely not in Supabase → nicotine indicators not populated yet  
2. No legally confirmed age-verification provider/workflow  
3. Enforce mode not authorized  
4. Destination allowlist undecided  
5. Terms acceptance requirement undecided  
6. Draft/staff override workflow undecided  
7. Retention policy undecided  
8. Shopify theme/app age gate history still EXTERNAL  

---

## 33. Exact Business/Legal Decisions Required

1. Is a **display** 18+ notice required on the Unique storefront? (`age_gate_display_enabled`)  
2. Is **age verification** (provider) required for B2B trade accounts, and if so for whom?  
3. When may `compliance_enforcement_mode` move from `observe` → `enforce`?  
4. Are sales destinations restricted to GB/IE/other?  
5. Must checkout record terms/trade-terms acceptance with version?  
6. May staff override compliance on drafts/orders? Under what permission?  
7. Evidence retention period?  
8. Confirm historical SureCust Lock behavior on live Shopify (trade lock vs any age UX)

---

## 34. Recommended Phase 5B

1. Import/map product metafields → run classification at scale  
2. Owner decisions on display gate + verification provider (if any)  
3. Destination policy implementation if confirmed  
4. Terms acceptance wiring if confirmed  
5. Only then consider `enforce` mode + draft overrides  
6. Return to Phase 4I pilot send when separately authorized  

**Do not start Phase 5B automatically.**

---

## STOP

```
PHASE4I_PILOT_001 = NOT_SENT
pilot_send_authorized = false
commercial_access_mode = catalogue_open
trade_required_cutover_approved = false
Worldpay gateway_mode = disabled
DPD carrier_mode = disabled
```
