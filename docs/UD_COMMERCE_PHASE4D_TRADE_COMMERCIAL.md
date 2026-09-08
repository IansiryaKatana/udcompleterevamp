# Phase 4D — Trade eligibility, B2B pricing & commercial access

**Status:** COMPLETE — STOP FOR REVIEW  
**Migration:** `076_phase4d_trade_commercial_access.sql`  
**Selftest:** `rpc_phase4d_trade_commercial_selftest` A–J PASS  
**Historical eligibility applied:** **NONE — PREVIEW ONLY (APPROVAL REQUIRED)**  
**Phase 4C ownership candidates:** **NOT APPLIED** (still ~1,353 pending)

Parked unchanged: DPD · SKULabs DIRECT ACCESS REQUIRED · warehouse NOT STARTED · Worldpay disabled.

---

## 1. Existing Commercial/B2B Capability Audit

| Area | Verdict | Notes |
|---|---|---|
| Customer / company CRM | **KEEP** | Status, approval_status, tags, metafields, ownership |
| Auth accounts | **EXTEND** | `customers.auth_user_id` exists; **0 linked** today — CRM ≠ login |
| Registration | **EXTEND** | `registration_channel` on all customers; Website Registration ~6,049 |
| Checkout / quote | **EXTEND** | Quote mode open; now asserts commercial policy server-side |
| Product visibility | **KEEP** | Published catalogue; no SureCust product lock reconstructed |
| Pricing | **KEEP** | Base product/variant price + draft overrides + coupons |
| Coupons | **KEEP** | 1 coupon row; code discounts only |
| PAY LATER | **EXTEND** | Historical gateways + customer tag; now explicit `pay_later_eligible` |
| Payment terms | **KEEP** | CRM field; independent of trade / PAY LATER |
| Customer Type | **KEEP** | Descriptive; metafields/snapshots — ≠ SureCust |
| SureCust | **EXTEND → Unique trade_access** | Access/eligibility gate, not Customer Type |
| Quotes (SA Request a Quote) | **CURRENT UNIQUE SUFFICIENT** | Storefront quote + B2B drafts remain separate |
| Price lists / Plus catalogues | **NOT REQUIRED** | No UD schema / no active usage |

**BUILD:** trade access columns, commercial policy engine, admin review/backfill preview, storefront assert hooks.

---

## 2. SureCust Forensic Findings

| Signal | Count | Interpretation |
|---|---|---|
| `SureCust_Wholesale` on customers | ~5,726 | Wholesale **ACCESS / eligibility** gate (SureCust Forms/Lock) |
| On companies | **0** | Not company-tagged |
| Overlap with `verified` | ~5,497 | Strong co-occurrence; verified alone ≠ wholesale |
| `verified` without SureCust | ~211 | **AMBIGUOUS** — do not auto-approve |
| SureCust without verified | ~229 | Still EXPLICIT SureCust for trade preview |
| Customer Type = Wholesale (column) | **2** | Independent of SureCust |
| Company contact SureCust mix | **2** companies | Extremely rare — do not promote to company-level |

**Controls (evidence):** APPROVED WHOLESALE / WHOLESALE SITE ACCESS / REGISTRATION APPROVED-like behaviour.  
**Not proven as SureCust alone:** product-level locks, price lists, PAY LATER, Customer Type Wholesale.

---

## 3. Trade Eligibility Model

Customer fields:

- `trade_access_status`: `ineligible` \| `pending` \| `approved` \| `rejected` \| `suspended`
- `trade_eligible` (derived: approved)
- provenance: `trade_eligible_source`, note, decided_at, decided_by

Lifecycle matches real registration + lock behaviour without inventing unused states.

---

## 4. Eligibility Ownership Level

| Resource | Eligibility source | Count | Conflicts | Canonical owner |
|---|---|---|---|---|
| Customer | SureCust_Wholesale tag | ~5,726 | — | **CUSTOMER** |
| Company | (none) | 0 | mix contacts ~2 | Not promoted |
| Company location | (none) | 3,522 locations | — | **NO_EVIDENCE** |

---

## 5. Trade Registration / Application Model

| Item | Finding |
|---|---|
| CURRENT FORM | Unique CRM create + `approval_status`; storefront quote (not a full SureCust form clone) |
| SOURCE FIELDS | email, name, StoreName/trading_name, address, registration_channel, Customer Type (metafield), referral/salesperson tags |
| REQUIRED FUTURE FIELDS | Only source-backed: contact, company/trading name, address, channel; do not invent credit questions |
| APPROVAL WORKFLOW | pending → owner/admin approve/reject → `trade_access_status` + CRM events |

---

## 6. Approval Workflow

`TRADE APPLICATION → INTERNAL REVIEW → APPROVE/REJECT → ACCESS ENABLED`

RPCs: `rpc_admin_set_trade_access`, `rpc_admin_list_trade_applications`.  
Audit via append-only `crm_events` (`trade_approved`, `trade_rejected`, `trade_suspended`, …).  
No fabricated historical approval events.

---

## 7. Commercial Access Rules

Policy engine answers: `can_view_catalogue`, `can_view_price`, `can_purchase`, `can_request_quote`, `can_use_pay_later`, `price_mode=base`.

Site setting `commercial_access_mode`:

- `catalogue_open` (default) — guests may view prices / request quote (current Unique)
- `trade_required` — quote/purchase require approved linked CRM customer

PAY LATER always requires `pay_later_eligible` (and approved trade).

---

## 8. PAY LATER Eligibility Findings

| Finding | Evidence |
|---|---|
| Distinct from wholesale | ~69 PAY LATER without SureCust; ~718 tagged vs ~5,726 SureCust |
| Order usage | ~972 orders with PAY LATER gateway names |
| Model | Explicit `pay_later_eligible` boolean + provenance |
| Credit limit | **NO_SOURCE_EVIDENCE** (`ar_accounts` empty / unset) |
| Payment terms | Independent CRM field |

---

## 9–10. B2B Pricing Forensic Findings & Price Source Matrix

| Mechanism | Source | Resource | Customers/Companies | Products | Order usage | Active | Priority |
|---|---|---|---|---|---|---|---|
| BASE PRICE | Unique catalogue | products/variants | all | published | all storefront | Yes | **P0** |
| DRAFT OVERRIDE | Shopify drafts → Unique | draft_order_line_items | staff drafts | lines | ~15,091 override lines | Yes (ops) | **P0** |
| DISCOUNT CODE | Unique coupons | coupons | — | — | 1 coupon | Yes | P2 |
| AUTOMATIC / SMART / AOV | Historical apps | not reconstructed | — | — | order discounts ~3,551 | Archive | P3 |
| FIXED B2B / PRICE LIST / CATALOGUE | Shopify Plus | **absent in UD** | 0 | 0 | — | **No** | N/A |
| QUANTITY / TIER METAFIELD | metafields | 0 values | — | — | — | **No** | N/A |

**No price_list / catalog tables created.**

---

## 11. Shopify B2B Catalogue Usage

**NO_SCHEMA_NO_USAGE** in Unique Commerce OS. Company locations exist (3,522) without catalogue assignments.

---

## 12. Product/Price Locking Findings

| Rule | Audience | Resource | Action | Source | Active evidence |
|---|---|---|---|---|---|
| SureCust wholesale gate | Tagged customers | Site/account access | Allow commerce | SureCust_Wholesale | Tags ~5,726 |
| Published products | Public | Catalogue | View | Unique products | Open under `catalogue_open` |
| Product-level SureCust lock | — | Specific SKUs | — | — | **NOT RECONSTRUCTED** |

---

## 13. Customer Type Separation

Customer Type remains descriptive (`resolve_customer_type` / column / metafields).  
Selftest A proves Wholesale type ≠ trade eligible; Retail type can be trade approved.

---

## 14. Price List/Catalog Model

**NOT REQUIRED** — not built.

---

## 15. Quantity/Volume Pricing

**NOT REQUIRED** — tier metafields = 0; no quantity-break engine.

---

## 16. Draft Pricing Findings

Draft lines support `original_unit_price` / `discounted_unit_price` overrides (~15k). Unique draft ops remain server-authoritative. Historical drafts immutable.

---

## 17. Quote Workflow Findings

| Path | Classification |
|---|---|
| Storefront quote checkout | CURRENT UNIQUE SUFFICIENT + commercial assert |
| Admin B2B drafts (~4,093) | KEEP — staff-assisted pricing |
| SA Request a Quote app | EXTERNAL DATA REQUIRED for full forensics; no Unique gap forcing rebuild |

---

## 18. Discount/Promotion Findings

Native coupons: used lightly. SMART Discounts / AOV.ai: historical order discount totals only — **do not rebuild unused promotion types**.

---

## 19. Commercial Policy Engine

- `commercial_policy_evaluate(...)` — pure core
- `rpc_commercial_policy_for_customer`
- `rpc_storefront_commercial_policy`
- `rpc_assert_storefront_commercial_action`
- `rpc_commercial_effective_price` (base only)

---

## 20. Storefront Enforcement

- Edge: `request-quote`, `create-checkout-session` call assert RPC
- Cart totals: PAY LATER option rejected without eligibility; `trade_required` rejects restricted view_price
- Frontend hide ≠ security

---

## 21. Admin CRM Integration

Customer detail panel: trade access, PAY LATER, Customer Type, payment terms, credit NO_SOURCE_EVIDENCE, policy flags, source tags, decision history.

---

## 22. Trade Review Queue

`/backend/sales` → **Trade applications** + **Trade backfill** tabs.

---

## 23. Permission Model

| Action | Who |
|---|---|
| View trade state (scoped) | Admin with sales entity access |
| Approve/reject/suspend trade or PAY LATER | **owner/admin only** (`can_decide_trade_eligibility`) |
| Sales editor | View only (default conservative) |

---

## 24. Audit Events

`trade_approved` / `trade_rejected` / `trade_suspended` / `trade_pending` / `trade_ineligible` / `pay_later_enabled` / `pay_later_disabled` via append-only `crm_events`.

---

## 25. Historical Eligibility Backfill Preview

| Class | Rule | Apply? |
|---|---|---|
| EXPLICIT trade | SureCust_Wholesale | Preview only until human Approve+apply |
| AMBIGUOUS trade | verified without SureCust | **Never auto-apply** |
| EXPLICIT pay_later | PAY LATER tag | Preview only |
| NO_EVIDENCE | neither | no proposal |

Seed via `rpc_admin_seed_trade_eligibility_backfill_preview` (owner/admin). **No automatic apply on migrate.**

---

## 26. Tests

- SQL selftest A–J PASS
- Vitest `phase4dTradeCommercial.selftest.test.ts`
- Assert Forbidden on decide RPCs without admin JWT
- PAY LATER denied for approved-without-flag

---

## 27. Migrations / Files Changed

- `supabase/migrations/076_phase4d_trade_commercial_access.sql`
- `src/admin/sales/AdminSalesHub.tsx`, `AdminTradePanels.tsx`
- `src/admin/crm/AdminCustomerDetail.tsx`
- `src/admin/lib/adminRpc.ts`
- `src/admin/crm/phase4dTradeCommercial.selftest.test.ts`
- `supabase/functions/request-quote/index.ts`
- `supabase/functions/create-checkout-session/index.ts`
- `src/integrations/supabase/database.types.ts`
- `docs/UD_COMMERCE_PHASE4D_TRADE_COMMERCIAL.md`

---

## 28. Remaining Commercial Gaps

1. Auth linking for historical customers (0 linked) — invite/link flow
2. Full SureCust Forms field parity for new applications
3. Optional flip to `commercial_access_mode=trade_required` (SureCust Lock equivalent)
4. Product-level lock reconstruction if new evidence appears
5. SMART/AOV promotion archive vs rebuild decision
6. Explicit EXPLICIT backfill apply for ~5.7k SureCust / ~718 PAY LATER (human)

---

## 29. Recommended Phase 4E

**Customer auth linkage + trade-required storefront cutover + controlled EXPLICIT eligibility apply**

Do **not** start Phase 4E automatically.  
Do **not** resume DPD, SKULabs, warehouse, or Worldpay.
