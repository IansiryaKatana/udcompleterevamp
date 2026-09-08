# Phase 4H — Data-surface lockdown, commerce parity & pilot activation gate

**Status:** COMPLETE — STOP FOR REVIEW  
**Migrations:** `083`–`085`  
**Selftest:** `rpc_phase4h_postgrest_attack_selftest` A–I **PASS**  
**Vitest:** Phase 4G + 4H — **10/10 PASS** (`.env` loaded; keys never logged)  
**Empirical anon PostgREST:** `products` / `product_variants` price select → **0 rows**  
**Empirical catalogue RPC:** prices visible under live `catalogue_open`  
**Empirical `p_force_mode=trade_required`:** `price=null`, `price_restricted=true`

**Production mode:** `commercial_access_mode = catalogue_open`  
**Cutover flag:** `trade_required_cutover_approved = false`  
**Pilot send:** `pilot_send_authorized = false`  
**PILOT SEND STATUS:** **READY — OWNER APPROVAL REQUIRED**  
**Mass activation:** NOT sent  
**Parked:** Worldpay / DPD / SKULabs / Warehouse / Phase 4C ownership (**1,353** pending) untouched  

---

## 1. Raw Commerce Data Exposure Audit

| TABLE | COLUMN | ANON | AUTH (non-admin) | SERVICE | STORE ADMIN | FRONTEND DEP | RISK |
|---|---|---|---|---|---|---|---|
| `products` | `price`, `compare_at_price` | DENIED (no public_read) | DENIED | FULL | `admin_all_*` / `is_admin()` | Storefront → gated RPCs; Admin CMS → table | **WAS CRITICAL → FIXED** |
| `product_variants` | `price`, `compare_at_price` | DENIED | DENIED | FULL | admin_all | RPC-embedded + redacted | **WAS CRITICAL → FIXED** |
| `product_bundles` | `price`, `compare_at_price` | DENIED | DENIED | FULL | admin_all | `rpc_list/get_storefront_bundle` | **FIXED** |
| `product_bundle_items` | (joins products) | DENIED | DENIED | FULL | admin_all | Bundle RPC only | **FIXED** |
| Wishlist | via product join | N/A | `rpc_list_wishlist_products` | FULL | N/A | No raw `products.select *` | **FIXED** |
| Cart / checkout | monetary snapshots | server recalc; client not authoritative | same | FULL | admin | Existing Phase 2/4G paths | PASS (policy) |
| Orders / finance / CRM | various | existing RLS | scoped | FULL | admin | Admin only | See §16 |

**Mechanism:** dropped `public_read_*` RLS policies; storefront catalogue RPCs are **SECURITY DEFINER** + `redact_protected_price_fields` / `storefront_can_view_protected_price`. RLS row filters alone were **not** used as the redaction mechanism.

---

## 2. Protected Column Classification

| Field | Class | Rule |
|---|---|---|
| `products.price` / `compare_at_price` | **TRADE_PROTECTED** | Visible under `catalogue_open`; redacted under `trade_required` unless approved trade session |
| `product_variants.price` / `compare_at_price` | **TRADE_PROTECTED** | Same |
| Bundle `price` / `compare_at_price` | **TRADE_PROTECTED** | Same |
| Bundle component product prices | **TRADE_PROTECTED** | Same — parent hide alone insufficient |
| Cart/checkout line totals | **TRADE_PROTECTED** | Server-authoritative recalculation |
| Cost / margin (if any later) | **INTERNAL_ONLY** | Never storefront |
| Product name/slug/image/inventory | **PUBLIC** | Catalogue browsing survives |
| Admin CMS edits | **ADMIN_ONLY** | `is_admin()` + `admin_all_*` |

---

## 3. PostgREST Lockdown Architecture

```
Browser / anon / non-admin auth
  └─ MUST NOT SELECT raw products|variants|bundles price columns
  └─ USE: rpc_get/list/search/autocomplete_storefront_*
         rpc_get_homepage_products_gated
         rpc_list/get_storefront_bundle
         rpc_list_wishlist_products / rpc_get_storefront_products_by_ids

Admin CMS (authenticated + is_admin)
  └─ Direct table CRUD via admin_all_* policies (unchanged capability)

Service role (server only)
  └─ Migrations, feeds (`rpc_merchant_feed_products`), forensics
```

Preferred principle applied: **raw commerce tables are not authoritative public storefront APIs.**

---

## 4. PostgREST Lockdown Result

| Check | Result |
|---|---|
| `public_read_products` etc. present | **0** |
| Anon `from('products').select('id,price')` | **0 rows** |
| Anon variant price select | **0 rows** |
| Anon gated list RPC (`catalogue_open`) | prices returned |
| Anon force `trade_required` | prices null / restricted |
| Attack selftest A–I | **PASS** |

**BLOCKER #1 (Phase 4G):** ELIMINATED for anon/non-admin PostgREST.

---

## 5. Admin/CMS Regression Result

| Capability | Status |
|---|---|
| Admin product list/edit with prices | **INTACT** (`admin_all_products`) |
| Variants CRUD | **INTACT** |
| Bundles CMS | **INTACT** |
| Attack case `C_admin_policy_intact` | **PASS** |

Admin price access is **not** granted via storefront RPCs; it remains admin RLS.

---

## 6–10. Policy Parity (Product / Variant / Bundle / Wishlist / Search)

| Surface | Policy layer | Anon catalogue_open | trade_required eval |
|---|---|---|---|
| Homepage / collections / PDP | gated RPCs | price OK | redacted unless approved |
| Variants in PDP payload | same RPC + redact | OK | redacted |
| Bundles list/detail/components | DEFINER RPCs + `p_force_mode` | OK | parent + child redacted |
| Wishlist | `rpc_list_wishlist_products` | N/A (auth) | redacts prices |
| Search / autocomplete | DEFINER + redact | OK | no protected price; **price sort disabled when redacted** |
| Reviews | review payload does not include product price | PASS | PASS |

**Business note — sort by price:** under restricted evaluation, `price_asc` / `price_desc` are no-ops (`sort_by_price_note = price_sort_disabled_when_redacted`) to avoid relative-price leakage.

**Bundle calculation:** totals remain server-side; browser-supplied component prices are not authoritative.

---

## 11–14. Cart / Quote / Checkout

| Area | Result |
|---|---|
| Cart persistence | Client/persisted prices never authoritative; server recalculates |
| trade_required cart | anon/non-approved **cannot** create actionable cart (`can_add_to_cart` locked from 4G) |
| Stale pre-cutover carts | cannot bypass deny |
| Quote / enquiry | lead path; no protected prices / PAY LATER for unauthorized |
| Checkout | AUTH + CRM link + trade approved under trade_required eval; server price path only |

Live mode remains **catalogue_open** — production purchase UX unchanged.

---

## 15. Storefront API Inventory (price-bearing)

| NAME | TYPE | SOURCE | DB OBJECT | RETURNS PRICE? | POLICY? | ANON | AUTH | ADMIN | STATUS |
|---|---|---|---|---|---|---|---|---|---|
| `rpc_get_storefront_product` | RPC | `storefrontRpc.ts` | same | conditional | YES | Y | Y | via RPC | HARDENED |
| `rpc_list_storefront_products` | RPC | same | same | conditional | YES | Y | Y | | HARDENED |
| `rpc_search_storefront_products` | RPC | same | same | conditional | YES | Y | Y | | HARDENED |
| `rpc_product_autocomplete` | RPC | same | same | conditional | YES | Y | Y | | HARDENED |
| `rpc_get_homepage_products_gated` | RPC | same | same | conditional | YES | Y | Y | | HARDENED |
| `rpc_list/get_storefront_bundle` | RPC | same | same | conditional | YES | Y | Y | | HARDENED |
| `rpc_list_wishlist_products` | RPC | same | same | conditional | YES | N | Y | | HARDENED |
| `rpc_get_storefront_products_by_ids` | RPC | wishlist fallback | same | conditional | YES | Y* | Y | | HARDENED |
| `rpc_merchant_feed_products` | RPC | `google-merchant.xml.ts` | same | catalogue_open_only | YES | **N** | **N** | service | LOCKED |
| PostgREST `products` | table | Admin only | products | YES | admin RLS | **N** | **N** | Y | LOCKED |
| JSON-LD Product Offer | SSR helper | `jsonLd.ts` | n/a | if not restricted | client flag from RPC | — | — | | HARDENED |

\*by-ids remains EXECUTE for anon for catalogue hydration but applies the same redaction policy.

No UNKNOWN storefront price surface remaining in the audited set.

---

## 16. Public Database Surface Audit (HIGH notes)

Phase 4H is not a full DB security rewrite. Catalogue price bypass was the critical fix.

| Area | Notes |
|---|---|
| Orders / payments / finance / drafts | Admin-scoped; not storefront catalogue |
| Customers / companies / eligibility | Admin + session RPCs; not mass-exposed |
| Inventory | Public inventory counts remain catalogue-visible (by design) |
| Staff | Admin only |

No additional CRITICAL anon price leak found after lockdown. Broader privilege audit deferred to Phase 4I if desired.

---

## 17. Merchant Feed Decision

| Question | Answer |
|---|---|
| Contains price? | Yes **only while** `catalogue_open` + `merchant_feed_price_mode=catalogue_open_only` |
| Public? | HTTP feed route is public; **data via service-role RPC**, not anon PostgREST |
| Actively used? | Google Merchant CSV endpoint present |
| trade_required conflict? | Would omit prices (or empty feed if disabled) — **must not publish wholesale prices** |
| **Recommendation** | **KEEP** `catalogue_open_only`. Before trade_required cutover: confirm with marketing whether to disable feed, switch to authenticated feed, or publish a deliberate public MSRP (not trade price). |

---

## 18–19. JSON-LD / SSR / Hydration

| Check | Result |
|---|---|
| Offer.price when `priceRestricted` | omitted (availability-only Offer) |
| Alternate structured-data price path | none found |
| Unauthorized browser receives numeric protected price | **NO** under force trade_required (RPC nulls) |
| UI-only hide | **NOT** used as security |

---

## 20. Direct PostgREST Attack Matrix

| Attack | Anon result |
|---|---|
| `select id,price from products` | 0 rows |
| `select price from product_variants` | 0 rows |
| Nested relation price via public_read | policies dropped |
| Single-ID / range | empty under RLS |
| Force trade_required via RPC | redacted PASS |
| catalogue_open RPC | prices OK (production preserved) |

Permanent regression: `rpc_phase4h_postgrest_attack_selftest` + Vitest `phase4hPostgrestLockdown.selftest.test.ts` + `scripts/phase4h-verify.mjs`.

---

## 21. Service-Role Exposure Audit

| Check | Result |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` in Vite client bundle | **must remain** server-only (feed route + Vitest) |
| Public env / hydration | not shipped as `VITE_` service key |
| Storefront does not use service role | YES |

---

## 22. RPC / Function Security Review

| Pattern | Status |
|---|---|
| Catalogue DEFINER RPCs | `set search_path = public`; redaction via policy helper |
| `rpc_merchant_feed_products` | EXECUTE **service_role only** |
| Admin gates | `is_admin()` on pilot/readiness RPCs |
| Client CRM ID spoof | rejected (Phase 4G retained) |

---

## 23. Consolidated Commercial Bypass Matrix

| SURFACE | ANON | NON-TRADE AUTH | APPROVED TRADE | RESULT | BYPASS? |
|---|---|---|---|---|---|
| Raw PostgREST products.price | deny | deny | deny (use RPC) | PASS | NO |
| Product RPC | price (open) | price (open)* | price | PASS | NO |
| Variant in product RPC | same | same | same | PASS | NO |
| Bundle RPC | same | same | same | PASS | NO |
| Wishlist RPC | — | redacts under trade_required | price | PASS | NO |
| Search | same | same | same | PASS | NO |
| Cart | open mode OK | denied under trade_required | OK | PASS | NO |
| Quote | no protected grant | no | richer | PASS | NO |
| Checkout | open mode | denied under trade_required | OK | PASS | NO |
| Feed | open prices via service | — | — | RESOLVED | NO wholesale leak design |
| JSON-LD | follows restriction | follows | price OK | PASS | NO |

\*Under live `catalogue_open`, non-trade auth still sees catalogue prices (intentional production behavior).

---

## 24–27. PILOT Cohort / Send / Activation / Issues

| Item | Status |
|---|---|
| Final proposed size | Prefer **5–15** via `proposePilotActivationCohort` |
| PILOT_READY criteria | unique email, trade approved, no auth collision, active, valid provenance |
| **PILOT SEND STATUS** | **READY — OWNER APPROVAL REQUIRED** |
| Emails sent this phase | **0** |
| Pilot activation results | N/A (not sent) |
| Issue log | Ready categories: EMAIL / TOKEN / AUTH / CRM LINK / COMPANY / TRADE / PRICE / CART / CHECKOUT / OTHER — empty until send |

---

## 28. Shadow Results After Hardening

Live remains `catalogue_open`. Shadow / force-mode evaluation now redacts at the **RPC data layer** (not UI), and raw PostgREST bypass is closed. Re-run `rpc_admin_run_shadow_baseline` / difference report in ops when preparing cutover.

---

## 29. Observability

Retained/extended from 4G: `commercial_policy_events` aggregates — `PRICE_REDACTED`, `PURCHASE_DENIED`, `AUTH_UNLINKED`, `TRADE_PENDING`, `TRADE_SUSPENDED`, `CART_DENIED`, `CHECKOUT_DENIED`, `POLICY_ERROR` (no unnecessary PII).

---

## 30. trade_required Readiness Matrix

| Gate | Status |
|---|---|
| POSTGREST PRICE LOCKDOWN | **PASS** |
| PRODUCT / VARIANT / BUNDLE / WISHLIST / SEARCH | **PASS** |
| CART / CHECKOUT / QUOTE / JSON-LD | **PASS** |
| FEED DECISION | **RESOLVED** (`catalogue_open_only`) |
| SSR/HYDRATION | **PASS** (RPC redaction) |
| DIRECT API ATTACK | **PASS** |
| AUTH ACTIVATION | **READY** |
| PILOT | **READY — OWNER APPROVAL REQUIRED** |
| KILL SWITCH | **READY** (`catalogue_open`) |
| OBSERVABILITY | **READY** |

**Even with green matrix: do NOT flip production mode in Phase 4H.**

---

## 31. Tests

| Suite | Result |
|---|---|
| `rpc_phase4h_postgrest_attack_selftest` | PASS |
| `rpc_phase4g_price_gate_regression_selftest` | PASS (prior) |
| Vitest Phase 4H + 4G | **10/10 PASS** |
| Empirical anon PostgREST + force mode | PASS |
| Bundle published fixture | optional (redaction path covered when bundles exist) |

---

## 32. Migrations / Files Changed

**Migrations:** `083_phase4h_postgrest_lockdown.sql`, `084_phase4h_drop_public_read_parity.sql`, `085_phase4h_attack_suite_pilot_gate.sql`

**App:**
- `src/lib/storefront/storefrontRpc.ts` — wishlist/bundles force-mode; no raw product price select
- `src/lib/bundles/mapBundle.ts`, `src/lib/cms/mapProduct.ts`, `src/data/static-cms.ts` — null/restricted price mapping
- `server/routes/feed/google-merchant.xml.ts` — service-role feed RPC
- `src/admin/lib/adminRpc.ts` — pilot gate + 4H readiness helpers
- `src/admin/sales/AdminAuthCutoverPanels.tsx` — pilot status + readiness display
- `src/admin/crm/phase4hPostgrestLockdown.selftest.test.ts`
- `scripts/phase4h-verify.mjs`

---

## 33. Remaining Blockers / Non-blockers

| Item | Severity |
|---|---|
| Owner pilot-send approval | **Gate** (intentional) |
| Feed strategy at trade_required cutover | Business decision |
| Phase 4C ownership 1,353 | Parked |
| Auth mass linkage | Not started (pilot first) |
| Worldpay / DPD / SKULabs / Warehouse | Parked |

No remaining **technical** PostgREST price bypass for anon storefront.

---

## 34. Recommended Phase 4I

1. Owner-approved **PILOT send** (5–15) + activation monitoring  
2. Pilot redeem validation (auth/CRM/company/trade/price/cart) — still no Worldpay  
3. Feed cutover playbook confirmation with marketing  
4. Optional broader anon GRANT audit beyond catalogue tables  
5. Explicit separate approval for `trade_required` production flip (**not** automatic)

---

## End state (mandatory)

```
commercial_access_mode = catalogue_open
trade_required_cutover_approved = false
pilot_send_authorized = false
PILOT SEND STATUS = READY — OWNER APPROVAL REQUIRED
```

**STOP FOR REVIEW.**  
Do **not** start Phase 4I automatically.  
Do **not** activate `trade_required`.  
Do **not** send mass activation.  
Do **not** enable Worldpay, DPD, SKULabs, or warehouse ops.
