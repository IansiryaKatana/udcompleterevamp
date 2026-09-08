# Phase 4E — Auth linkage, eligibility activation & trade cutover gate

**Status:** COMPLETE — STOP FOR REVIEW  
**Migration:** `077_phase4e_auth_cutover_gate.sql`  
**Selftest:** `rpc_phase4e_auth_cutover_selftest` A–J PASS  

**Production mode:** `commercial_access_mode = catalogue_open` (enforced; NOT flipped)  
**Bulk trade backfill:** NOT executed  
**PAY LATER from history:** NOT auto-enabled (`NO_SAFE_AUTOMATIC_PAY_LATER_BACKFILL`)  
**Phase 4C ownership:** NOT applied (~1,353 still pending)

Parked unchanged: DPD · SKULabs · warehouse · Worldpay.

---

## 1. Auth ↔ CRM Linkage Audit

| Metric | Live |
|---|---|
| TOTAL CRM CUSTOMERS | ~6,225 |
| AUTH USERS | 1 |
| AUTH-LINKED | **0** |
| NOT LINKED | ~6,225 |
| VERIFIED UNIQUE EMAIL candidates | 1 (hello@iankatana.com) |
| AMBIGUOUS (dup CRM emails) | 0 |
| CONFLICTING (orphaned auth_user_id) | 0 |

Admin users: 3 (2 with staff). Email is candidate evidence only — not permanent identity.

## 2. Auth Link Model

Durable link: `customers.auth_user_id` (unique). Unlink clears auth only; CRM retained. Provenance via `auth_linked` / `auth_unlinked` crm_events.

## 3. Existing Account Activation Flow

Admin issues hashed activation token (`customer_auth_activations`) → out-of-band delivery → customer signs up/in → `rpc_storefront_redeem_auth_activation` → link. No Shopify password import. Invalid tokens return uniform `INVALID_TOKEN` (no email enumeration).

## 4. New Registration Flow

| Case | Behavior |
|---|---|
| New email + apply | Auth user + pending CRM customer (`rpc_storefront_submit_trade_application`) |
| Existing CRM email | `EXISTING_CUSTOMER_REQUIRES_ACTIVATION` — no duplicate |
| Already linked | Re-submit bumps to pending if ineligible/rejected |

## 5. Company Commercial Context

Eligibility remains **CUSTOMER-level** (Phase 4D). Session resolves primary `company_contacts` for context/snapshots only — no multi-account switcher.

## 6–8. Trade Eligibility Source / Policy / Preview

| Class | Rule | Apply? |
|---|---|---|
| EXPLICIT / EXPLICIT_SOURCE | SureCust_Wholesale → propose `approved` | Preview only |
| AMBIGUOUS | verified without SureCust | Never auto |
| Historical orders alone | NO_EVIDENCE for current access | Never |

`rpc_admin_preview_explicit_trade_backfill_apply` returns counts/sample.  
`rpc_admin_apply_explicit_trade_backfill` requires confirm string and returns **NOT_EXECUTED_IN_PHASE_4E**.

## 9–11. PAY LATER Evidence / Policy / Backfill

| Class | Meaning |
|---|---|
| HISTORICAL_USAGE_ONLY | Tag / ~972 gateway orders — **not** current permission |
| EXPLICIT_CURRENT_PERMISSION | Unique manual (or future proven source) only |

**Recommendation:** `NO_SAFE_AUTOMATIC_PAY_LATER_BACKFILL`  
`can_use_pay_later` requires approved trade + `pay_later_eligible` current flag.

## 12–13. Trade Application / Linkage

Reuse Phase 4D statuses + events `application_submitted` / `application_reviewed`. Company approval not promoted without evidence.

## 14–16. Session / Enforcement / catalogue_open

`rpc_storefront_commercial_session` — server resolves auth→CRM→company→policy→`ux_state`.  
Quote edge binds via `rpc_storefront_bind_order_commercial_context` (rejects client ID spoof).  
**catalogue_open** preserved; guests still browse/quote; PAY LATER still gated.

## 17. trade_required Test Results

Evaluate with forced mode in selftest **without** mutating settings. Production stays open.  
Anonymous / non-linked / ineligible / approved / PAY LATER deny covered in policy + assert tests.

## 18. Product/Price Visibility Decisions

Under `trade_required`, exact anonymous browse/price rules = **BUSINESS_DECISION_REQUIRED** (SureCust Lock implies gated site; not fully reconstructed). Do not activate until decided.

## 19–20. Checkout Binding / Snapshots

Unique-native orders snapshot: trade status, pay_later flags, payment_terms, customer_type, trading_name, salesperson/CG/referrer, auth_user_id. Drafts: bind RPC for Unique-native only (historical immutable).

## 21–23. Admin UX / Permissions / Audit

CRM panel: auth link, activation invite, trade/PAY LATER, sources, history.  
Sales tabs: Auth linkage · Cutover readiness.  
Owner/admin for mutations; sales view scoped.  
Events: `auth_linked`, `auth_unlinked`, `trade_*`, `pay_later_*`, `application_*`.

## 24–25. Data Quality / Security Tests

DQ RPC + selftest A–J (catalogue_open, trade_required test no flip, PAY LATER deny, activation hash, historical PAY LATER, bulk apply gated, ownership untouched, parked deps, anonymous session).

## 26. Cutover Readiness Matrix

See `/backend/sales?tab=cutover` / `rpc_admin_trade_cutover_readiness`.  
Blocked: migration/backfill apply. Business decisions: product/price visibility under trade_required.

## 27. Migrations / Files Changed

- `supabase/migrations/077_phase4e_auth_cutover_gate.sql`
- `src/admin/sales/AdminSalesHub.tsx`, `AdminAuthCutoverPanels.tsx`
- `src/admin/crm/AdminCustomerDetail.tsx`, `phase4eAuthCutover.selftest.test.ts`
- `src/admin/lib/adminRpc.ts`
- `src/lib/storefront/commercialSession.ts`, `src/routes/account.tsx`
- `supabase/functions/request-quote/index.ts`
- `docs/UD_COMMERCE_PHASE4E_AUTH_CUTOVER.md`

## 28. Exact Business Decisions Still Required

1. Anonymous product browse under `trade_required` — allow / hide / teaser?
2. Anonymous price visibility under `trade_required`?
3. Non-approved registered users — browse prices? cart? quote only?
4. Approve EXPLICIT SureCust trade backfill (~5.7k)?
5. Email delivery channel for activation tokens?

## 29. Exact Actions Before trade_required Activation

1. Explicit approval of visibility rules (28)
2. Seed + human-apply auth unique-email links / activations for active buyers
3. Optional: approve EXPLICIT trade backfill (separate confirm)
4. Manual PAY LATER enables only where currently required
5. Set `trade_required_cutover_approved=true` + flip mode (separate change — not Phase 4E)
6. Security retest in staging with `trade_required`

## 30. Recommended Phase 4F

**Controlled EXPLICIT trade backfill apply + auth activation rollout + staged trade_required shadow testing** (still no Worldpay/DPD/SKULabs/warehouse).

---

**STOP FOR REVIEW.**  
`commercial_access_mode` remains **catalogue_open**.  
Do **not** start Phase 4F automatically.
