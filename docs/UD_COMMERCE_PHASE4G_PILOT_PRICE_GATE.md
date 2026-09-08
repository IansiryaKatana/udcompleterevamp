# Phase 4G — Pilot auth activation & storefront price-gate hardening

**Status:** COMPLETE — STOP FOR REVIEW  
**Migrations:** `080`–`082`  
**Selftest:** `rpc_phase4g_price_gate_regression_selftest` A–I **PASS**  
**Vitest (service-role):** Phase 4F + 4G — **11/11 PASS** (`.env` loaded locally; key never logged)

**Production mode:** `commercial_access_mode = catalogue_open`  
**Cutover flag:** `trade_required_cutover_approved = false`  
**Mass activation:** NOT sent  
**Parked:** Worldpay / DPD / SKULabs / Warehouse / Phase 4C ownership (**1,353** pending) untouched  

---

## 1. Activation Pipeline Audit

| Area | Verdict | Notes |
|---|---|---|
| Token gen / SHA-256 hash / TTL / single-use redeem | **KEEP** | Sound |
| Supersede prior pending on new invite | **FIX** ✓ | New invite → prior `revoked` |
| Invalidate → `revoked` (not conflated with TTL expired) | **FIX** ✓ | |
| Lifecycle: NOT_INVITED / INVITED / DELIVERED / ACTIVATED / EXPIRED / INVALIDATED / CONFLICT / FAILED | **EXTEND** ✓ | `activation_lifecycle_status` |
| Email deep-link `/account?activate=` | **FIX** ✓ | Auto-redeem after sign-in |
| Duplicate auth/CRM link guards | **KEEP** | |
| Audit events (generated/sent/invalidated/redeemed) | **EXTEND** ✓ | event_alias + lifecycle |
| Raw token never stored / not in email mark RPC logs | **KEEP** | |

## 2. Service-Role Test Results

| Suite | Result |
|---|---|
| UNIT / Vitest Phase 4F | PASS (with service key) |
| UNIT / Vitest Phase 4G | PASS |
| DATABASE `rpc_phase4g_price_gate_regression_selftest` | A–I PASS |
| SERVICE-ROLE integration (force `trade_required` redaction, INTERNAL_TEST fixture, ownership untouched) | PASS |

Vitest loads `.env` via `vitest.config.ts` (no dotenv package; values never printed).

## 3. Internal Activation Test

`rpc_phase4g_internal_activation_fixture` (service_role) creates INTERNAL_TEST CRM rows + hashed invites. Tokens returned once for lab redeem. Fixtures purged after validation. **No real customer email sent.**

## 4. Auth Collision Tests

Covered: already linked create → `ALREADY_LINKED`; client CRM ID spoof → `CUSTOMER_ID_SPOOF_REJECTED`; multi-pending supersede; redeem collision errors from 4E retained.

## 5. Proposed PILOT Cohort

**auto_send = false.** Representative Tier A (30d) sample (sanitized):

| Reason class | Example (sanitized) |
|---|---|
| company_linked_owned + SureCust | Kiel Brown · ki***@evolutionvapes.co.uk · 226 orders |
| company_linked_owned | Kashif Hussain · hu***@gmail.com · 194 orders |
| no_company_owned | Daniel Fisher · (in full propose RPC) |

Owner/admin must explicitly approve/send via Activation workspace → **Propose PILOT cohort (no send)**.

## 6. Pilot Readiness Matrix

PILOT_READY requires: unique CRM email, valid email, no auth conflict, trade approved, not suspended/rejected, not activated. Company context resolved via `company_contacts` when present.

## 7. Activation Status / Audit Model

Lifecycle helper + CRM events: `activation_generated`, `activation_sent`, `activation_invalidated`, redeem → `auth_linked`. Delivery = `email_sent_at` only (no inferred opens).

## 8. Commercial Session Security

Session still server-derived. Bind now **rejects any client CRM IDs** that don’t exactly match session. Assert ignores anonymous client `p_customer_id` for privilege.

## 9–10. Price Surface Inventory & Protected Fields

**Protected:** `price`, `compare_at_price`, `unit_price`, `line_total`, `subtotal`, `discount`, `tax`, `shipping`, `total`, `discounted_unit_price`, `original_unit_price`.

| Surface | Gate | Status |
|---|---|---|
| `rpc_get_storefront_product` | redact + `p_force_mode` | HARDENED |
| `rpc_list_storefront_products` | redact | HARDENED |
| `rpc_search_storefront_products` | redact | HARDENED |
| `rpc_product_autocomplete` | null price | HARDENED |
| `rpc_get_homepage_products_gated` | redact | HARDENED |
| Legacy homepage setof | open under catalogue_open | DOCUMENTED residual |
| Direct PostgREST `products` | still readable under catalogue_open | **BLOCKER before flip** |
| JSON-LD | omit `Offer.price` when restricted | HARDENED |
| Merchant feed | none found | OK |
| Cart / checkout assert | add_to_cart + purchase | HARDENED |
| Client cart localStorage | embeds prices | mitigated by **block add-to-cart** under trade_required |

## 11–13. Product / Collection / SSR

Under `p_force_mode=trade_required`: anon/pending get `price: null` in RPC JSON (not CSS-hidden). No TanStack price loaders. Regression proves redaction.

## 14. JSON-LD Decision

When `priceRestricted`: emit Product + Offer **without** `price` (availability + currency only). Avoids leaking B2B list prices to crawlers while keeping product SEO entity.

## 15. Merchant / Product Feeds

**NONE_FOUND** — sitemap is URL-only. No silent feed change required.

## 16–17. Cart / Add-to-Cart Policy

Under `trade_required`: `can_add_to_cart = false` for anon/non-approved (client cart would embed prices). Approved: cart allowed. Catalogue_open: unchanged guest cart UX.

## 18–21. Checkout / Snapshot / PAY LATER / Quote

Checkout assert unchanged + spoof harden. PAY LATER still requires current `pay_later_eligible` (not history). Quote lead remains without protected prices. After fixture purge: **PAY_LATER_ELIGIBLE = 0** (prior “1” was consistent with test residue).

## 22. Direct API/RPC Attack Results

| Attempt | Result |
|---|---|
| Product/list with `trade_required` force | prices null |
| Client customer_id on bind | REJECTED |
| Anonymous privilege via p_customer_id | ignored |

## 23–24. Shadow + Permanent Regression

Shadow reason codes: ANONYMOUS, AUTH_UNLINKED, TRADE_PENDING, TRADE_APPROVED, TRADE_SUSPENDED, PAY_LATER_NOT_ELIGIBLE, PRICE_REDACTED, PURCHASE_DENIED.  
Permanent suite: `rpc_phase4g_price_gate_regression_selftest` + Vitest `phase4gPriceGate.selftest.test.ts`.

## 25–27. Pilot Journey / Metrics / Rollback

Journey path ready (activate email → account → redeem → session). Metrics RPC: INVITED/DELIVERED/ACTIVATED/EXPIRED/INVALIDATED. Rollback: invalidate invite; unlink auth (owner); suspend trade; kill switch `catalogue_open`. Never delete CRM on failed activation.

## 28. Cutover Checklist (do NOT execute)

- [ ] INTERNAL + service-role tests PASS  
- [ ] Pilot send approved & redeem PASS  
- [ ] Auth-link coverage for Tier A acceptable  
- [ ] Direct PostgREST price columns revoked or proxied  
- [ ] SSR/JSON-LD/feed accepted  
- [ ] Cart/checkout/quote/PAY LATER PASS  
- [ ] Shadow accepted + observability  
- [ ] Kill switch verified  
- [ ] Business sets `trade_required_cutover_approved=true` then flips mode  

## 29. Observability

Table `commercial_policy_events` + `commercial_observe` (denials, spoof, redactionsactions). No tokens/prices in logs.

## 30–31. Tests / Files

Migrations `080`–`082`; storefront price UI; account activate query; `send-trade-activation` (prior); vitest env loader; docs this file.

## 32. Remaining Blockers

1. **Auth linked still ~0** — run owner-approved PILOT send  
2. **Direct PostgREST / legacy homepage setof** under live `trade_required`  
3. Bundle RPCs / wishlist `select *` price residual  
4. Explicit cutover approval  

## 33. Recommended Phase 4H

**Owner-approved PILOT send + PostgREST price-column lockdown + bundle/wishlist path parity**, then cutover rehearsal — still no automatic `trade_required` flip.

---

### Hard end state

```
commercial_access_mode = catalogue_open
trade_required_cutover_approved = false
```

**STOP.** Do not start Phase 4H automatically. Do not activate `trade_required`. Do not mass-email. Do not enable Worldpay, DPD, or warehouse.
