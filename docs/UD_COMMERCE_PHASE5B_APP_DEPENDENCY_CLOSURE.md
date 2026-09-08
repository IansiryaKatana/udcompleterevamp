# Phase 5B — Shopify app replacement & dependency closure

**Status:** COMPLETE — STOP FOR REVIEW  
**Nature:** Read / audit / design only — **no Shopify app mutations**  
**Migration:** `20260907134115_phase5b_app_dependency_register.sql`  
**Register table:** `app_dependency_register` + `rpc_admin_list_app_dependency_register`

Evidence sources: `shopify-forensic-audit/FORENSIC-AUDIT.md` §R/W/Y, analysis JSON (events/metafields), Phases 2–5A docs, Unique code.  
**Not UK legal advice. Not an instruction to disconnect apps.**

---

## Locked end state (confirmed)

```
PHASE4I_PILOT_001 = NOT_SENT
pilot_send_authorized = false

commercial_access_mode = catalogue_open
trade_required_cutover_approved = false

compliance_enforcement_mode = observe

Worldpay gateway_mode = disabled
DPD carrier_mode = disabled
SKULabs = DIRECT ACCESS REQUIRED
Warehouse = NOT STARTED
Phase 4C ownership = 1,353 pending
```

---

## 1. Master App Inventory

| APP | CLASSIFICATION | CUTOVER BLOCKER? | EXTERNAL ACCESS? |
|---|---|---|---|
| UD Sales Portal | PARTIALLY_REPLACED | No (HIGH) | Scopes update recommended |
| SKULabs | EXTERNAL_ACCESS_REQUIRED | **YES** | **YES** |
| DPD Integration by WSA | EXTERNAL_ACCESS_REQUIRED | **YES** | **YES** |
| Worldpay eCommerce | INTEGRATION_REQUIRED | **YES** | **YES** |
| SureCust Forms, Lock | PARTIALLY_REPLACED | No (HIGH) | Config review |
| Shopify Flow | EXTERNAL_ACCESS_REQUIRED | **YES** | Workflow export |
| Dollarback Loyalty | ARCHIVE_ONLY | No | If balances needed |
| Magefan Persistent Cart | REPLACED_BY_UNIQUE | No | No |
| AOV.ai / BOGOS | ARCHIVE_ONLY | No | Discount export |
| SMART Discounts | UNKNOWN | No (HIGH gap) | `read_discounts` / export |
| Checkout Blocks | EXTERNAL_ACCESS_REQUIRED | No (HIGH) | Rule export |
| PT2 Statement Printer | PARTIALLY_REPLACED | No (HIGH) | PDF export |
| Order Printer | UNKNOWN | No (HIGH) | Confirm + PDF |
| Order Printer Pro | UNKNOWN | No | Confirm install |
| Xero | INTEGRATION_REQUIRED | No (HIGH) | Read-only org |
| Synder | UNKNOWN | No (HIGH) | Finance interview |
| datafetchodoo | DATA_MIGRATION_REQUIRED | No | Confirm Odoo live |
| SA Request a Quote | REPLACED_BY_UNIQUE | No | Optional history |
| UD SpecialRequestForm | UNKNOWN | No | Confirm purpose |
| Report Pundit | UNKNOWN | No | Confirm + export |
| Brevo / PushOwl | EXTERNAL_ACCESS_REQUIRED | No (HIGH) | Lists/consents |
| Search & Discovery | PARTIALLY_REPLACED | No | Merch config review |
| Avada SEO | UNKNOWN | No | Confirm |
| RangeMe | UNKNOWN / NON_BLOCKING | No | Confirm |
| Veeqo | LIKELY_RETIRED | No | Reconfirm |
| xtimcatlogx | UNKNOWN | No (HIGH) | Developer interview |
| Shopify GraphQL App | UNKNOWN | No | Distinguish from Portal |
| Theme Access | LIKELY_RETIRED | No | Keep until theme freeze |
| Messaging | UNKNOWN | No | Conversation export? |
| CSS Sales Team | PARTIALLY_REPLACED | No | Ownership pending |
| Google Shopping (mm-) | PARTIALLY_REPLACED | No | — |
| EasyScan / ScanPick / scanpacker | LIKELY_RETIRED | No | — |
| zenvio | ARCHIVE_ONLY | No | — |

Additional discovered: Shopify Web/Mobile/POS (native), DX/UPS tracking labels, `app-3890849--eligibility` tobacco eligibility metafields.

---

## 2. App Activity / Footprint Matrix (highlights)

| APP | FIRST/LAST OBSERVED | EVENT / OBJECT COUNT | NAMESPACE / TAGS |
|---|---|---|---|
| DPD WSA | through 2026 | **55,700** events; attr **7,527** | tracking + `DPD Delivery Status` |
| SKULabs | 2025-11-25 → **2026-09-04** | **20,588** events; **10,143** orders | `skulabs.shopname` **1,462** |
| Shopify Web | — | **46,296** events | native |
| Worldpay | throughout | **10,294** orders | `WorldPayCard` **10,285** |
| SureCust | — | tags **5,726** / **177** | `SureCust_*` |
| Magefan | — | tag **7,579** | `persistent_cart` |
| Dollarback | — | metafields **8,688** / **5,626** | `dollar-*` |
| Flow leftovers | — | tags **3,913** each | `getDraftOrderData1_item.name`, `Review_Customer_Type` |
| Odoo bridge | — | metafield **4,091** | `udcustom.customer_id` |
| CSS Sales | — | ~2,165 + ~960 dynamic keys | `css_sales_team_*` |

---

## 3. Business Capability Matrix

Full rows live in `app_dependency_register` (query via admin RPC). Summary: Unique already covers CRM/sales UI, drafts, finance AR, quotes, cart, transactional email, commercial policy, fulfilment headers, merchant feed. **Not** covered: WMS pick/pack, live DPD labels, live Worldpay, Flow automations, marketing lists, historical PDFs, accounting GL.

---

## 4. UD Sales Portal — CRITICAL

| Item | Finding |
|---|---|
| Status | **LINKED · ACTIVE · IN USE** (forensic client + ops app) |
| client_id | `73722df23b9961b28c25bfcea5299104` |
| Class | **PARTIALLY_REPLACED** — Unique `/backend` covers much ops UI |
| Still needed | Shopify Admin API access until cutover; missing live scopes (`read_discounts`, `read_files`, `read_publications`, `read_payment_terms`, fulfillmentOrders) |
| Private data | Scopes/config — not WMS SoR |
| Action | **Do not disconnect.** Update live scopes for final forensics. Complete Unique admin parity before staff abandon portal. |

Capability map: customer/order/draft/salesperson/CG/referrer → largely Unique CRM/sales; commercial workflows → Unique drafts/finance; **Shopify write-back during dual-run may still use portal.**

---

## 5–6. Xero / Synder

| System | Evidence in Shopify | Class | Action |
|---|---|---|---|
| **Xero** | **None** in GraphQL | INTEGRATION_REQUIRED | Unique = ops + AR ≠ statutory GL. Need read-only org access to resolve invoice SoR, credit notes, payments, VAT, contacts |
| **Synder** | **None** | UNKNOWN | May bridge Shopify/Worldpay→Xero. Do not assume dual SoR. Interview finance; decide REMAIN / replace with Unique→Xero / retire |

---

## 7–8. PT2 / Order Printer / Pro

| App | Evidence | Unique | Gap |
|---|---|---|---|
| PT2 | `custom.credit_note` ~80 | Finance statements + credit_notes | **Historical PDFs EXTERNAL** (R14 HIGH) |
| Order Printer | No GraphQL footprint; R14 groups with PT2 | ops_documents / packing slips | Confirm install + export |
| Order Printer Pro | Zero name hits | — | Confirm via Admin Apps |

---

## 9–10. SA Request a Quote / UD SpecialRequestForm

| App | Finding |
|---|---|
| SA Request a Quote | Unique quote + drafts **SUFFICIENT** (Phase 4D). Optional historical export. **REPLACED_BY_UNIQUE** (capability). |
| UD SpecialRequestForm | **No evidence** — do **not** equate to Quote. Confirm Admin Apps / forms. **UNKNOWN**. |

---

## 11. SureCust remaining gaps

| Capability | Unique status |
|---|---|
| Wholesale eligibility tags → trade_access | **REPLACED** (4D–4F) |
| Trade applications | **REPLACED** |
| Commercial / price policy | **REPLACED** (4G–4H) |
| Auth activation | **READY** (pilot unsent) |
| Registration **form fields** parity | **PARTIAL** — EXTERNAL form config review |
| **Site Lock** under trade_required | **NOT ACTIVATED** (catalogue_open live) |
| **Product-level locks** | **NOT RECONSTRUCTED** |
| POS tag semantics | Preserve; not auto trade |

→ **PARTIALLY_REPLACED** — do not claim “SureCust replaced” wholesale.

---

## 12–13. Checkout Blocks / Shopify Flow

**Checkout Blocks:** order-limits validation definition present; live rule payload **not** in pull → **manual export / Admin review REQUIRED**.

**Shopify Flow — CRITICAL:** Only leftover tags observed. Full workflows (triggers/conditions/actions/emails) **not** in archive.

→ **SHOPIFY FLOW DIRECT EXPORT / MANUAL WORKFLOW AUDIT REQUIRED** before cutover.  
→ Register row: **CUTOVER BLOCKER**.

---

## 14–18. Report Pundit · SMART · AOV · Dollarback · Brevo

| App | Decision |
|---|---|
| Report Pundit | No footprint → confirm + export saved reports if used |
| SMART Discounts | Defs unread (`read_discounts` denied) → export before classifying SUPPORTED/MISSING |
| AOV.ai BXGY | Shop metafield only; **do not build BXGY** unless quantified material usage |
| Dollarback | Mostly zero-cashback metafields; loyalty **ARCHIVE** unless business keeps it → export balances if yes |
| Brevo/PushOwl | Tag-only soft attribution; Resend = transactional; **marketing EXTERNAL** — no auto-subscribe |

---

## 19–26. Cart · Search · Avada · RangeMe · Odoo · xtim · GraphQL · Veeqo

| App | Verdict |
|---|---|
| Magefan cart | **REPLACED** by Unique carts (≠ abandoned checkout) |
| Search & Discovery | Partial; export merch boosts/synonyms if used |
| Avada | No namespace → confirm; Unique SEO/JSON-LD exists |
| RangeMe | No footprint → don’t build from install |
| datafetchodoo | Preserve `udcustom.customer_id`; confirm Odoo live |
| xtimcatlogx | **UNKNOWN — do not retire casually** |
| Shopify GraphQL App | Likely utility / overlap with Portal → confirm |
| Veeqo | **LIKELY_RETIRED** (SKULabs is WMS) |

---

## 27–29. SKULabs / DPD / Worldpay (carry-forward)

| System | Status | Blocker reason |
|---|---|---|
| SKULabs | DIRECT ACCESS REQUIRED | Pick/pack/bin/stock not in Shopify (R1) |
| DPD WSA | carrier_mode=disabled | Product/API unconfirmed; credentials missing |
| Worldpay | gateway_mode=disabled | Product/API unconfirmed; tokens non-migratable (R2) |

**Do not re-open implementation in 5B.**

---

## 30–31. Theme Access / Messaging

| App | Action |
|---|---|
| Theme Access | Likely safe after theme freeze; keep for agencies during migration |
| Messaging | Conversation history may need export; CRM notes ≠ proven replacement |

---

## 32. External Data Register

| SYSTEM | PRIVATE? | DATA NEEDED | WHY | ACCESS | CUTOVER BLOCKER? | MIGRATE? |
|---|---|---|---|---|---|---|
| SKULabs | YES | Pick/pack/bin/PO/stock/user | Warehouse SoR | Read-only API token + store ID | **YES** | Later |
| DPD/WSA | YES | Consignments/labels/service codes | Carrier | Product pack + TEST creds | **YES** | Integrate |
| Worldpay | YES | Merchant/API/TEST | Payments | Product pack | **YES** (for card live) | Integrate; no PAN migrate |
| Xero | YES | Invoices/CN/payments/VAT/contacts | GL SoR | Read-only org | HIGH | Decide SoR |
| Synder | YES | Sync mappings | Accounting bridge | Admin access | HIGH | Decide |
| PT2 / Order Printer | YES | Historical PDFs | Archive | App export | HIGH | Archive |
| SureCust | YES | Form/lock config | Parity | Admin config export | HIGH | Config |
| Flow | YES | Workflow list | Automation | Flow export | **YES** | Rewrite |
| Checkout Blocks | YES | Live rules | Checkout parity | App/Admin | HIGH | Rebuild needed rules |
| Dollarback | YES | Point balances | If loyalty kept | Export | MED | Optional |
| Brevo/PushOwl | YES | Lists/consents/templates | Marketing | Export | HIGH | Marketing phase |
| Odoo | YES | Customer ids / live sync? | Mapping | Confirm | MED | Preserve ids |
| Report Pundit | ? | Saved reports | BI | Export if used | MED | — |
| Messaging | ? | Conversations | Support | Shopify export | MED | — |
| SMART/AOV | YES | Discount rules | Promo parity | `read_discounts` / app | HIGH | Selective |

---

## 33. Data Ownership Matrix (A–E)

| Class | Examples |
|---|---|
| A Shopify-native | Orders, customers, catalogue, transactions |
| B App-written Shopify | SKULabs events, DPD attrs, SureCust tags, dollar metafields, Flow tags |
| C App-private | SKULabs WMS, PT2 PDFs, Flow defs, Checkout Blocks rules, loyalty ledger |
| D External system | Xero, Odoo, Worldpay vault, DPD network, Brevo |
| E Unknown | xtimcatlogx, SpecialRequestForm, Report Pundit, Order Printer Pro |

---

## 34. Unique Replacement Coverage

| Capability | Status |
|---|---|
| CRM / companies / sales ownership UI | PARTIALLY (ownership 1,353 pending) |
| Drafts / quotes | FULLY (capability) |
| Finance AR / statements | PARTIALLY (PDF archive external) |
| Payments foundation | PARTIALLY (gateway disabled) |
| Fulfilment headers | PARTIALLY (WMS external) |
| Trade access / auth | PARTIALLY (pilot unsent; Lock not live) |
| Compliance | OBSERVE foundation |
| Cart / checkout / coupons | FULLY / PARTIAL (promo types) |
| Search / SEO / feed | PARTIALLY |
| Transactional email | FULLY (Resend) |
| Marketing email/SMS | NOT REPLACED |
| WMS | NOT REPLACED |
| Accounting GL | INTEGRATE EXTERNALLY |
| Flow automations | NOT REPLACED |

---

## 35. Automation Replacement Register

| TRIGGER (known) | EVIDENCE | UNIQUE EQUIVALENT | STATUS | RISK |
|---|---|---|---|---|
| Flow draft/customer tags | leftover tags 3,913×2 | None | UNKNOWN full workflow | **BLOCKER until export** |
| SKULabs fulfil + email | 10k+ events | Fulfilment ops + email templates | PARTIAL | HIGH |
| DPD status updates | 55k events | Carrier adapter (disabled) | NOT LIVE | BLOCKER for carrier |
| SureCust lock/forms | tags | trade policy | PARTIAL | HIGH |
| Release-to-WMS rules | not in Shopify | — | UNKNOWN (SKULabs/Flow) | HIGH |

---

## 36. Webhook / Callback Register

| TARGET | DIRECTION | NOTES |
|---|---|---|
| `worldpay-webhook` | Worldpay → Unique | Exists; gateway disabled |
| `stripe-webhook` | Stripe → Unique | Parallel consumer path |
| Shopify → SKULabs | External | Not in Unique |
| Shopify → DPD WSA | External | Not in Unique |
| Shopify → Synder/Xero | Unknown | Confirm |
| Resend | Unique → email | Transactional |

No secrets listed.

---

## 37. API / Integration Register

| SYSTEM | AUTH | ROLE | CREDS? | PROD STATUS |
|---|---|---|---|---|
| Shopify Admin (Sales Portal) | Client credentials | Read/write ops | Yes (portal) | Live Shopify |
| Supabase | Service/anon | Unique SoR candidate | Yes | Live |
| Worldpay | TBD | Card | Incomplete | **disabled** |
| DPD | TBD | Carrier | Incomplete | **disabled** |
| SKULabs | TBD | WMS | **Missing** | Access gate |
| Resend | API key | Transactional email | Env | Live |
| Xero | TBD | GL | Unknown | External |

---

## 38. External Access Request Pack

1. **SKULabs:** read-only API token + store/account ID + docs for pick/pack/inventory endpoints.  
2. **DPD / WSA:** exact UK product name, TEST credentials, service codes, label API docs.  
3. **Worldpay:** merchant product/API identity, TEST credentials, webhook signing docs (no PAN export).  
4. **Xero:** read-only organization OAuth for invoices/CN/payments/contacts (if finance confirms).  
5. **Synder:** admin access to sync mappings (or confirmation unused).  
6. **PT2 / Order Printer:** export historical PDFs + templates.  
7. **Shopify Flow:** export/list all active workflows.  
8. **Checkout Blocks:** export live order-limit / block rules.  
9. **SMART / AOV:** grant `read_discounts` on Sales Portal **or** app rule export.  
10. **Brevo/PushOwl (or actual SMS provider):** subscriber + consent export.  
11. **SureCust:** Forms field schema + Lock configuration screenshots/export.  
12. **Report Pundit (if installed):** saved report export.  
13. **Messaging:** conversation export if used for support.

---

## 39. Cutover App Matrix (operational checklist)

| APP | TARGET | DISCONNECT BEFORE CUTOVER? | AT CUTOVER? | MUST REMAIN AFTER? | BLOCKER |
|---|---|---|---|---|---|
| UD Sales Portal | Unique admin | **NO** | After freeze | No (Shopify gone) | Scope gaps |
| SKULabs | Unique WMS or keep external | **NO** | Only if warehouse ready | Maybe external | **YES** |
| DPD WSA | Unique carrier | **NO** | When carrier live | Carrier may stay external | **YES** |
| Worldpay | Unique gateway | **NO** | When gateway live | Processor remains | **YES** |
| SureCust | Unique trade | After trade_required proven | At cutover | No | Lock/forms |
| Flow | Unique jobs | After rewrite | At cutover | No | **Export first** |
| Magefan | — | OK late | At cutover | No | — |
| Dollarback | Decide | If retired | At cutover | No | Balances? |
| PT2/Printers | Unique docs | After PDF export | At cutover | Archive | PDFs |
| Xero/Synder | Keep GL | N/A | N/A | **Likely YES** | SoR |
| Marketing apps | External | After list export | At cutover | Marketing stack | Lists |

---

## 40. Recommended Decommission Order (DO NOT EXECUTE)

1. Export Flow, discounts, Checkout Blocks, PDFs, marketing lists, SureCust config.  
2. Final SKULabs / DPD / Worldpay credential packs.  
3. Dual-run Unique ↔ Shopify (Sales Portal stays).  
4. Retire low-risk writers last: Magefan tags, discovery metafields, unused SEO apps.  
5. SureCust only after trade_required + Lock parity proven.  
6. SKULabs/DPD/Worldpay **never** before replacements live.  
7. Sales Portal last Shopify API client before store freeze.

Rollback: re-enable Shopify apps only if store still live; Unique kill switches remain catalogue_open / gateway disabled / carrier disabled.

---

## 41. Final Snapshot / Delta Requirements

| WHEN | WHAT |
|---|---|
| T-7d | Flow export; discount defs; Checkout Blocks; PT2 PDF bulk; marketing lists; SureCust config |
| T-24h | Orders/customers/companies/drafts delta; SKULabs open picks if accessible; DPD open consignments |
| T-0 | Freeze Shopify mutations; final order/payment/fulfilment delta; Sales Portal scope confirmation |

Objects with high change rate: orders, events, fulfilments, inventory, customer tags.

---

## 42. Cutover Blockers

| ID | BLOCKER | WHAT FAILS | WHY | CLOSE WITH |
|---|---|---|---|---|
| B1 | SKULabs private WMS | Warehouse ops | Not in Shopify | Direct access + warehouse design |
| B2 | DPD product/API | Live labels | Unconfirmed | Credential pack |
| B3 | Worldpay product/API | Card checkout | Unconfirmed + no token migrate | Merchant pack; vault stays Worldpay |
| B4 | Shopify Flow unknown | Hidden automation loss | Workflows not exported | Flow export/audit |
| B5 | (HIGH) Discount rules unread | Promo parity | Scope denied | read_discounts / export |
| B6 | (HIGH) PDF archive | Historical docs | PT2/Printer private | PDF export |
| B7 | (HIGH) Marketing lists | Comms continuity | External | Provider export |

---

## 43. Tests / Files Changed

| Item | Result |
|---|---|
| `rpc_phase5b_dependency_selftest` | Seeded register + locked gates |
| Vitest `phase5bAppDependency.selftest.test.ts` | Run with `.env` |
| Migration | `20260907134115_phase5b_app_dependency_register.sql` |
| `src/admin/lib/adminRpc.ts` | `listAppDependencyRegister` |
| This doc | `docs/UD_COMMERCE_PHASE5B_APP_DEPENDENCY_CLOSURE.md` |

No production external API calls. No app disconnects.

---

## 44. Recommended Phase 5C

1. Execute **access request pack** (SKULabs, DPD, Worldpay, Flow, discounts, PDFs, marketing).  
2. Complete **Flow workflow inventory** from export.  
3. Finance decision: Xero SoR + Synder fate.  
4. Confirm Admin Apps list for UNKNOWN installs (xtim, SpecialRequest, Report Pundit, Printer Pro).  
5. Only then plan warehouse / payment / carrier activation phases.  
6. Pilot send remains separate owner approval.

**Do not start Phase 5C automatically.**

---

## STOP

```
PHASE4I_PILOT_001 = NOT_SENT
pilot_send_authorized = false
commercial_access_mode = catalogue_open
trade_required_cutover_approved = false
compliance_enforcement_mode = observe
Worldpay gateway_mode = disabled
DPD carrier_mode = disabled
```

**DO NOT CONTACT CUSTOMERS. DO NOT DISCONNECT ANY SHOPIFY APP.**
