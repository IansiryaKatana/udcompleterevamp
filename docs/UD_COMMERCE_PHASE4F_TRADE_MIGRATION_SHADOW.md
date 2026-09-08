# Phase 4F — Controlled trade migration, auth activation & shadow cutover

**Status:** COMPLETE — STOP FOR REVIEW  
**Migrations:** `078_phase4f_trade_migration_shadow.sql`, `079_phase4f_activation_workspace.sql`  
**Selftest:** `rpc_phase4f_trade_migration_selftest` A–H PASS · Vitest `phase4fTradeMigration.selftest.test.ts`  
**Edge:** `send-trade-activation` (single recipient; no mass blast)

**Production mode:** `commercial_access_mode = catalogue_open` (enforced)  
**Cutover flag:** `trade_required_cutover_approved = false`  
**PAY LATER bulk:** NOT applied  
**Phase 4C ownership:** NOT applied (**1,353** still pending)  
**Parked unchanged:** Worldpay disabled · DPD disabled · SKULabs DIRECT ACCESS REQUIRED · Warehouse NOT STARTED

---

## 1. Explicit SureCust Backfill Preflight

Preflight (at apply time):

| Metric | Count |
|---|---|
| EXPLICIT_CANDIDATES | **5,726** |
| ALREADY_IN_TARGET_STATE | 0 |
| CONFLICTING_CURRENT_STATE | 0 |
| MISSING_CUSTOMER | 0 |
| DUPLICATE_AMBIGUOUS_CUSTOMER | 0 |
| SAFE_TO_APPLY | **5,726** |

Post-apply preflight: SAFE_TO_APPLY ≈ 0; ALREADY_IN_TARGET_STATE ≈ 5,726.

Excluded by design: Unique-native higher-rank decisions, rejected/suspended, ambiguous duplicate emails.

---

## 2. Explicit Trade Backfill Applied Results

| Field | Value |
|---|---|
| batch_id | `bca38d50-833b-4741-ac5f-25d3a4be2610` |
| batch_key | `p4f-surecust-20260907111031` |
| PREVIEW_EXPLICIT | 5,726 |
| APPLIED | **5,726** |
| SKIPPED_ALREADY_MATCHED | 0 |
| SKIPPED_CONFLICT | 0 |
| SKIPPED_AMBIGUOUS | 0 |
| FAILED | 0 |

Provenance per customer: `trade_access_status=approved`, `trade_eligible_source=shopify_surecust`, `trade_eligibility_batch_id`, `crm_events.trade_approved`.  
SureCust tags/metafields **not** removed. Historical orders/drafts **not** rewritten.

Reversibility: identify via `customers.trade_eligibility_batch_id`; correct via new `unique_manual` decision + crm_event (no destructive rollback).

---

## 3. Commercial-State Precedence Rule

Coded in `commercial_source_rank`:

1. **UNIQUE MANUAL / UNIQUE NATIVE** (rank 100)  
2. **VERIFIED EXPLICIT SOURCE IMPORT** `shopify_surecust` (50)  
3. **APPROVED INFERENCE** (30)  
4. **UNKNOWN / NO EVIDENCE** (0)

Unique-native decisions outrank imported SureCust evidence.

---

## 4. PAY LATER Status

| Metric | Value |
|---|---|
| PAY_LATER_ELIGIBLE COUNT | **1** |
| Historical usage classification | HISTORICAL_USAGE_ONLY (unchanged) |
| Bulk enable from orders/tags | **NOT APPLIED** |

---

## 5. Auth Linkage Coverage

| Metric | Live |
|---|---|
| TOTAL CRM CUSTOMERS | 6,225 |
| EXPLICIT TRADE ELIGIBLE (approved) | 5,728 |
| AUTH LINKED | **0** |
| AUTH ACTIVATED | 0 |
| PENDING ACTIVATION | 0 |
| ACTIVATION EXPIRED | 0 |
| TRADE ELIGIBLE + AUTH LINKED | **0** |
| TRADE ELIGIBLE + NOT AUTH LINKED | **5,728** |
| Company-linked trade | 3,456 |
| Salesperson-owned trade | 5,601 |
| Unowned trade | 127 |

---

## 6. Activation Architecture

CRM customer → admin issues invite → cryptographically secure token → **hash only** stored → email → customer signs up/in → `rpc_storefront_redeem_auth_activation` → CRM link → commercial session.

Supports cohorts: `INTERNAL_TEST` / `PILOT` / `BATCH`. **FULL** blocked without separate approval. No auto mass send.

---

## 7. Activation Email

Template key: `trade_account_activation` (editable in admin email templates).  
Explains platform move; **does not** claim password migration. Edge: `send-trade-activation` (admin auth, rate-limited).

---

## 8. Activation Cohort Analysis

| Tier | Count | Guidance |
|---|---|---|
| TIER A — ordered last 30d | **697** | Pilot first |
| TIER B — 30–90d | 392 | Next |
| TIER B — 90–180d | 327 | Later |
| TIER C — 180–365d | 376 | Low priority |
| TIER C — older / inactive | **3,936** | Do not require 100% auth |

Do **not** send automatically.

---

## 9. Activation Admin Workspace

Sales hub tabs: **Activation**, **Shadow / cutover**. Filters: trade eligible, not linked, last order, search. Actions (owner/admin): generate, send, invalidate. Salespeople: **view** activation status on assigned customers only (`rpc_admin_customer_activation_status`).

---

## 10. Commercial Session Validation

`rpc_storefront_commercial_session` resolves server-side: auth → CRM → company context → trade → price/purchase/quote/PAY LATER. Client CRM IDs are not trusted for authority (`rpc_storefront_bind_order_commercial_context` spoof rejection from 4E).

---

## 11. Final Commercial Policy Rules (`trade_required` shadow / future)

| Actor | Catalogue | Product | Protected price | Purchase / checkout | PAY LATER | Quote |
|---|---|---|---|---|---|---|
| Anonymous | yes | yes | no | no | no | yes (lead) |
| Pending / non-approved linked | yes | yes | no | no | no | yes |
| Approved trade | yes | yes | yes | yes | only if `pay_later_eligible` | yes |
| Suspended / rejected | yes | yes | no | no | no | yes |

**AUTH alone is insufficient** under `trade_required`: requires AUTH + CRM linked + trade approved.

Production today remains **catalogue_open** (prices still visible by design).

---

## 12. Shadow `trade_required` Implementation

Setting `commercial_shadow_trade_required=true`. `commercial_shadow_log` + `rpc_assert_storefront_commercial_action` record actual vs shadow without mutating responses. Baseline via `rpc_admin_run_shadow_baseline` / seeded diagnostic rows.

---

## 13. Shadow Difference Report (baseline personas)

| REQUEST_TYPE | TOTAL | CURRENT ALLOWED | SHADOW ALLOWED | SHADOW DENIED | DIFFERENCE |
|---|---|---|---|---|---|
| baseline_view_price | 7 | 7 | 3 | 4 | **4** |
| baseline_checkout | 7 | 5 | 3 | 4 | **2** |
| baseline_quote | 7 | 7 | 7 | 0 | 0 |
| baseline_pay_later | 7 | 1 | 1 | 6 | 0 |

Account-class diffs (expected under cutover): anonymous 2, unlinked_auth 2, linked_pending 1, suspended 1, approved_trade 0, pay_later variants 0.

---

## 14. Protected Price Leak Audit

Under `trade_required` policy evaluation:

| ENDPOINT | ANONYMOUS | NON_APPROVED | APPROVED | RESULT |
|---|---|---|---|---|
| commercial_policy_evaluate/view_price | false | false | true | PASS |
| commercial_policy_evaluate/checkout | false | false | true | PASS |
| rpc_commercial_effective_price | gated when trade_required | gated | allowed | READY |
| Cart totals (catalogue_open) | open by design | open | open | CATALOGUE_OPEN_OK |

**Blocker before flipping mode:** ensure all product/list/search/cart paths call server price gate (React hide alone is insufficient). Catalogue_open still exposes prices intentionally.

---

## 15–18. Cart / Checkout / Quote / PAY LATER Policy

- Cart: stale browser prices must not bypass; `rpc_commercial_effective_price` + assert win when mode flips.  
- Checkout: `create-checkout-session` calls `rpc_assert_storefront_commercial_action`; Worldpay remains disabled.  
- Quote: lead path allowed; no protected price leak / no implicit approval.  
- PAY LATER: requires approved + current `pay_later_eligible` (historical usage alone never enables).

---

## 19. Registration / Application Validation

Existing CRM email → activation path (no duplicate). New email → pending CRM + admin review. Age/compliance remains separate from trade eligibility.

---

## 20. Trade Cutover Coverage

Trade eligible not auth-linked: **5,728** — primary operational gap before cutover. Do not require 100% historical CRM linkage.

---

## 21. Cutover Readiness Matrix

| Capability | Status |
|---|---|
| AUTH_LINKING_READY | NOT_READY / PARTIAL (0 linked) |
| ACTIVATION_READY | READY |
| EXPLICIT_ELIGIBILITY_MIGRATED | READY |
| PRICE_LEAK_TEST_PASS | READY_FOR_TRADE_REQUIRED_POLICY |
| CART_POLICY_PASS | PARTIAL |
| CHECKOUT_POLICY_PASS | PARTIAL |
| QUOTE_POLICY_PASS | READY |
| PAY_LATER_POLICY_PASS | READY |
| ADMIN_REVIEW_READY | READY |
| AUDIT_READY | READY |
| ROLLBACK_READY | READY |
| SHADOW_RESULTS_ACCEPTABLE | MONITOR (diffs expected) |
| BUSINESS_UX_DECISIONS_LOCKED | READY |

**Do not flip** `commercial_access_mode` until AUTH linkage coverage for Tier A is operationally acceptable and cart/list price paths are fully gated.

---

## 22. Rollback / Kill Switch

1. Set `site_settings.commercial_access_mode = catalogue_open`  
2. Keep `trade_required_cutover_approved = false`  
3. CRM trade/PAY LATER/auth links remain intact — **no data wipe**

---

## 23. Tests

- SQL selftest A–H PASS  
- Vitest Phase 4F suite (gates, policy, precedence, PAY LATER not bulk, batch provenance)  
- Phase 4D/4E selftests remain valid (catalogue_open)

---

## 24. Migrations / Files Changed

- `supabase/migrations/078_phase4f_trade_migration_shadow.sql`  
- `supabase/migrations/079_phase4f_activation_workspace.sql`  
- `supabase/functions/send-trade-activation/index.ts`  
- `src/admin/lib/adminRpc.ts`  
- `src/admin/sales/AdminSalesHub.tsx`  
- `src/admin/sales/AdminAuthCutoverPanels.tsx`  
- `src/admin/crm/AdminCustomerDetail.tsx`  
- `src/lib/storefront/commercialSession.ts`  
- `src/admin/crm/phase4fTradeMigration.selftest.test.ts`  
- `docs/UD_COMMERCE_PHASE4F_TRADE_MIGRATION_SHADOW.md`

---

## 25. Remaining Blockers (before production `trade_required`)

1. Auth linkage ≈ 0 — run INTERNAL_TEST then PILOT activation (Tier A)  
2. Wire/verify all storefront product/search/cart responses through price gate under trade_required  
3. Acceptable shadow monitoring on live traffic  
4. Explicit business approval of `trade_required_cutover_approved`  
5. Phase 4C ownership still pending (orthogonal; do not auto-apply)

---

## 26. Exact Recommended Cutover Procedure (later — NOT Phase 4F)

1. Pilot activate Tier A accounts; confirm commercial session for approved + pending + anon  
2. Re-run price leak + checkout assert matrix  
3. Confirm Worldpay/DPD still parked as desired  
4. Set `trade_required_cutover_approved = true` (owner)  
5. Flip `commercial_access_mode = trade_required`  
6. Monitor shadow/diff + support volume  
7. Kill switch: revert mode to `catalogue_open` if needed

---

## 27. Recommended Phase 4G

**Auth activation pilot execution & storefront price-gate hardening** — send INTERNAL_TEST/PILOT cohorts (explicit selection only), measure redeem rates, harden list/search/cart price redaction under forced trade_required test harness, expand live shadow monitoring. Still do **not** auto-enable Worldpay/DPD/warehouse or flip production mode without a separate gate.

---

**STOP.** Do not start Phase 4G automatically.  
`commercial_access_mode` must remain `catalogue_open`.  
`trade_required_cutover_approved` must remain `false`.  
No mass customer activation campaign was sent.
