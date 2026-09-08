# Phase 5H — Storefront UX, Navigation & Content Alignment

**Status:** COMPLETE — STOP FOR REVIEW  
**Not a cutover. No emails. No `trade_required`. No gateway/WMS/DPD enablement.**  
**Gap close:** live Unique TPD / Modern Slavery / Medical pages, leftover electronics collection copy, Unique published delivery fallback. KYC form not migrated.

Frontend **displays** server commercial policy. It does **not** decide trade approval, price permission, PAY LATER, checkout eligibility, or compliance.

## Locked state (unchanged)

| Gate | Value |
|---|---|
| PHASE4I_PILOT_001 | NOT_SENT |
| pilot_send_authorized | false |
| commercial_access_mode | catalogue_open |
| trade_required_cutover_approved | false |
| compliance_mode / compliance_enforcement_mode | observe |
| Worldpay / payment_gateway_mode | disabled |
| DPD / WMS | disabled |
| catalogue_readiness | READY |

`rpc_phase5h_storefront_selftest`: **ok / locks_ok = true**. Catalogue provenance unchanged: **2,213** Shopify-sourced products, **12,677** variants, **368** collections.

Published storefront list (filter `all`) currently returns **724** products — unpublished / not-on-storefront SKUs are a catalogue fact, not a 5H mutation.

---

## 1. Unique UI KEEP / REFINE / RESTRUCTURE / REMOVE

| Decision | Surfaces |
|---|---|
| KEEP | Fraunces / Inter Tight, `#66a441`, ProductCard, header/footer chrome, drawers, CMP, age-gate **display** architecture |
| REFINE | Spacing, B2B copy, wholesale chips, commercial price labels |
| RESTRUCTURE | Header IA (Shop mega + Brands/New/Offers/Trade), footer Shop/Trade/Company/Support/Legal, `/account` dashboard |
| REMOVE | Electronics DTC hero (“Tech That Powers…”), “Premium electronics…” footer, Stripe-as-live checkout CTA, Gantry/Help as primary nav |
| BUILD | `/trade`, `/brands`, account quotes/invoices/addresses/company, shop nav RPC, wholesale filters |

## 2. Live uniquedistribution.com IA inventory (reference only)

Live Unique is **content/IA reference**, not a visual clone. Used: shop-by-category, brands, trade account, wholesale cards (brand/type/strength/pack), about/contact company details (`15678913`, City Road).  
**Not copied:** consumer “Best Online Vape Store UK”, awards, unverified Unique-OS dispatch guarantees, Gantry as primary nav.

## 3. Design system

No second frontend. No new CMS. Admin nav locations extended only (`footer_shop`, `footer_trade`, `footer_company`, `footer_support`).

## 4. Header IA

Primary: Unique live category routes (Vapes, Nic Salts, Nic Pouches, Confectionery, Drinks, Smoking Accessories, Essentials, Offers, CBD, Others).  
Utility: phone / email / Trade login / Trade registration / Help / Contact. **Gantry not copied.**  
Logged-in: Search / My Account dropdown / Cart.  
Best Sellers **omitted** from default nav (no order-velocity merchandising flag). Featured collections remain available via CMS / `is_featured` only.

## 5. Shop mega

Paginated/cached collection tree via `rpc_storefront_shop_nav` (8 items at selftest). Never hydrates the full 2,213-product catalogue.

## 6. Account utility

Dropdown only shows routes the session can use. Unlinked accounts see Overview / Orders / Trade. Quotes, invoices, addresses require `auth_linked`. Company requires `company_id`.

## 7. Footer IA

Unique OS chrome kept (dark footer, newsletter, cookie settings). Unique live columns and contact facts:

- Contact: 24/7, WhatsApp `+44 7340 676909`, `info@uniquedistribution.com`, registered office / 18+ line
- Shop / Service / Legal / Vape News (Trade and Support columns deactivated)
- Cookie Policy stays in CMP, not a Legal column duplicate


## 8. Homepage positioning

Hero: “Wholesale products built for retail.” Supporting copy from `hero_supporting_copy`. CTAs: Shop wholesale → `/collection/all`, Open a trade account → `/trade`.

## 9. Trust strip

`TradeProofStrip` uses **published catalogue counts** (products, brands) plus non-claim copy (trade pricing / quotes). No awards, ratings, or Unique-OS dispatch guarantees.

## 10. Electronics leftover copy

Removed/rewritten from CMS seeds, hero slides, feature cards, lifestyle cards, footer tagline, newsletter heading, legal fallbacks.

## 11. Routes added (SEO-safe)

| Route | Purpose |
|---|---|
| `/trade` | Trade landing + `trade_application_fields` form |
| `/brands` | Brand index |
| `/brands/$handle` | Brand PLP |
| `/account/quotes` | Native quote list |
| `/account/invoices` | Provenance-safe invoices/statements |
| `/account/addresses` | Linked-customer addresses |
| `/account/company` | Linked company only |

Phase 5E collection/product handles preserved. Virtual PLP slugs: `all`, `new`, `deals`/`offers`.

## 12. Best Sellers policy

Do **not** fake sales rank. Offers/New used instead. `is_featured` remains the only merchandising flag consumed.

## 13. Product cards

Vendor, type, strength, pack chips when populated. Availability. Actions: View / Choose options / Add (gated by `gateStorefrontPurchase`). Empty labels hidden.

## 14. Commercial price states

Consume `ux_state` from `rpc_storefront_commercial_session`. Production remains `catalogue_open` (prices visible). Components ready for `trade_required` restricted copy via `priceRestricted` + `commercialPriceLabel`. PDP `ProductBuyBox` now receives `priceRestricted`.

## 15. Collection pages

Retailer intro above grid (`wholesaleCollectionIntro`). Filters, sort, count, paginated grid. Long SEO copy below. Consumer phrases rewritten.

## 16. PDP

Brand, title, SKU, trade attributes, variant, price/commercial state, qty, add to cart, Request a Quote. Below: description, specifications (safe populated metafields only), pack/case if present, delivery (site default / verified), related products. No raw `custom.*` dump.

## 17. Filters / search

Brand, type, nicotine strength, price, stock, sort — populated facets only (`rpc_storefront_product_facets`). Search: title, slug, SKU, vendor, type, variant SKU. Paginated RPCs only.

## 18. 18+ display UX

Existing `AgeGateDisplayNotice` — **display UX, not verification, not a purchase block**. Enabled (`age_gate_display_enabled=true`) with Unique OS branding.

## 19. Brands

A–Z index + handle PLP. Counts from published catalogue vendors.

## 20. Offers / New

Backed by existing merchandising flags (`is_new`, `is_summer` / deals collection). Not invented.

## 21. `/trade` landing

Hero, benefits, how it works, application, existing-customer login. Explicit: this site **does not send** Phase 4I invitations.

## 22. Trade application

Replaced `{ email }` stub with `trade_application_fields` + `rpc_storefront_submit_trade_application`. States: not signed in / apply / pending / approved / blocked (customer-safe copy, no internal notes).

## 23. Auth

Sign-in / create / reset retained. Activation redeem on `/account?activate=` still works; **does not send** invites.

## 24. Account dashboard

B2B home: trade status, company, quotes count, wishlist, orders, activation token. Apply CTA routes to `/trade`.

## 25. Orders

Customer-safe list + detail (existing). Fulfilment/tracking only when data exists.

## 26. Quotes

Native commercial-request lifecycle via `rpc_list_my_quotes`. Hidden if unlinked.

## 27. Invoices / statements

`rpc_list_my_invoices` / `rpc_list_my_statements`. Unique-native documents labelled **account records, not official production invoices** (Phase 5G numbering still REVIEW).

## 28. Company / addresses

`rpc_get_my_company`, `rpc_list_my_addresses`, `rpc_upsert_my_address`. No sales notes, ownership review, or other contacts. Server remains checkout-context authority.

## 29. Cart

Variant, SKU, pack if present, qty stepper, unit price, quote path. Case/MOQ steps **not invented**.

## 30. Checkout rules

Renders **active** `rpc_evaluate_checkout_rules` (required fields, messages, block). Does not auto-activate inferred Phase 5C rules.

## 31. PAY LATER

Shown only when `pay_later_eligible === true` **and** `policy.can_use_pay_later`. Historical tags do not grant access. Browser check on a non-eligible account: PAY LATER hidden.

## 32. Worldpay / card

`rpc_payment_gateway_public_status`. While `gateway_mode=disabled`, card/Worldpay are **not shown as operational**. Quote remains the default CTA.

## 33. Order confirmation

Quote: received, no dispatch implied. Paid: payment recorded; fulfilment only when data exists.

## 34. Support paths

Help page + contact form cover order / account / trade / delivery / payment / general. No second form engine.

## 35. Delivery copy

Business-sourced live Unique weekday 16:00 / Saturday AM terms, labelled as published Unique business terms. **No Unique DPD tracking** while carrier disabled.

## 36. About / Contact

B2B wholesale. Company details from **site settings** (`contact_company_legal_name`, `contact_company_number` 15678913, City Road, hours) — not stale Shopify.

## 37. Legal inventory

| Page | Classification |
|---|---|
| Privacy | REWRITE-FORMAT-ONLY (electronics/Stripe phrasing removed; duties not rewritten) |
| Terms | REWRITE-FORMAT-ONLY (wholesale positioning; no new legal obligations invented) |
| Cookies | KEEP (CMP unchanged) |
| Shipping / Delivery | COPY-FROM-LIVE (business-sourced, labelled) |
| About / Help / Contact | NEW / REWRITE (marketing, not legal) |
| TPD | COPY-FROM-LIVE (`/pages/tpd-compliance`) — Unique published HTML, not rewritten |
| Modern Slavery | COPY-FROM-LIVE (`/pages/modern-slavery-statement`) — Unique published HTML, not rewritten |
| Medical disclaimer | COPY-FROM-LIVE (`/pages/medical-info-disclaimer`) — Unique published HTML, not rewritten. Live Unique text includes “nicotine-free alternatives”; that claim was not rewritten. |
| KYC | **NOT MIGRATED** — live page is a form + PDFs; 5H does not add a second form engine |

Unique electronics legal drafts are not live Unique law.

## 38. Cookie CMP

Existing `CookieConsentBanner` / `CookiePreferencesDialog` only. Footer **Cookie settings** opens it. No second CMP.

## 39. Copy audit (selected)

| Surface | Class |
|---|---|
| Homepage hero / features / lifestyle / final CTA | REWRITE |
| Footer tagline / newsletter | REWRITE |
| Product cards | REFINE |
| Collection intros | REWRITE |
| Trade / brands / account | NEW |
| Checkout quote-default + gateway disabled | REWRITE |
| Search / empty / 404 | KEEP/REFINE |
| SEO titles/handles | KEEP (Phase 5E) |

Brand voice: direct, professional, retailer-focused. No “favourite vape”.

## 40. SEO

Handles, canonicals, collection/product URLs preserved. New routes added; no Shopify-era URL breakage. Redirects not required for removed electronics nav (those were Unique-OS CMS, not live Unique URLs).

## 41. Mobile / a11y

Mega menu, filters, trade form, checkout extra fields reuse existing focus/labels/dialogs. Keyboard BrandedSelect used with `allowEmpty` (no empty-string Radix values).

## 42. Performance

Shop nav / brands / facets / lists are paginated RPCs. No unbounded catalogue hydration.

## 43. Persona tests (synthetic)

`commercial_policy_evaluate` A–G (anonymous/unlinked/pending/approved/suspended/PAY LATER yes/no) in `phase5hStorefront.selftest.test.ts`. No real gateway transaction. No real customer contact. Browser session used existing test login `hello@iankatana.com` only.

## 44. Journey tests (browser)

Verified: home → `/collection/all` → PDP (Cheetos) → add to cart → `/checkout` (quote default, card/Worldpay not live) → `/trade` form fields → `/brands` → `/pages/about` → `/pages/contact` (company number) → `/pages/shipping` → `/account` dashboard. PAY LATER hidden for that account.

## 45. Security regression

Phase 4H PostgREST lockdown Vitest **passed**. Anon still cannot `select products.price`. Catalogue RPCs remain gated. Frontend does not spoof commercial policy.

## 46. Catalogue regression

Shopify-sourced counts unchanged (2,213 / 12,677 / 368). Frontend does not mutate catalogue provenance.

## 47. Build / typecheck / tests

| Check | Result |
|---|---|
| `rpc_phase5h_storefront_selftest` | PASS, locks_ok |
| Vitest 5H helpers + SQL selftest + 4H | 16 passed |
| `vite build` | PASS |
| `tsc` | Pre-existing `database.types.ts` staleness (`rpc` args `undefined`); 5H route/search issues fixed |
| Route gen | `/trade`, `/brands`, account children registered |

## 48. Admin CMS gaps closed

Nav locations, trade page, homepage copy, storefront wholesale copy + company details in Admin Site Settings. **No new CMS product.**

## 49. Small backend allowed

Read-only / thin RPCs: shop nav, brands, facets, catalogue stats, customer-safe quotes/invoices/addresses/company, payment gateway public status, list/search facet params.  
Not rewritten: CRM, finance, orders, commercial policy, catalogue, WMS, fulfilment.

## 50. STOP FOR REVIEW

Do **not** start the next phase. Do **not** cut over. Do **not** send emails. Do **not** enable `trade_required`. Do **not** enable Worldpay, DPD, or WMS.

---

## Sitemap (storefront)

| Path | Status |
|---|---|
| `/` | KEEP/REWRITE copy |
| `/collection/$slug` | KEEP handles; wholesale intro |
| `/product/$slug` | KEEP handles; wholesale buy box |
| `/search` | KEEP paginated RPC |
| `/bundles` | KEEP (hidden from primary nav) |
| `/cart` | REFINE B2B |
| `/checkout` | REFINE quote-default |
| `/checkout/success` | REFINE no shipment claims |
| `/account` | RESTRUCTURE dashboard |
| `/account/orders/$orderId` | KEEP |
| `/account/quotes` | NEW |
| `/account/invoices` | NEW |
| `/account/addresses` | NEW |
| `/account/company` | NEW |
| `/trade` | NEW |
| `/brands`, `/brands/$handle` | NEW |
| `/pages/about`, `/help`, `/contact`, `/shipping`, `/privacy`, `/terms`, `/cookies` | KEEP/REWRITE |
| `/pages/tpd-compliance`, `/modern-slavery-statement`, `/medical-info-disclaimer` | COPY-FROM-LIVE |

## Before / after page matrix

| Page | Before | After |
|---|---|---|
| Home | Electronics DTC | B2B wholesale, verified counts only |
| Header | Home + electronics categories | Shop mega + Brands/New/Offers/Trade |
| Footer | Categories + help mash | Shop / Trade / Company / Support / Legal |
| PLP | Price/stock/sort | + brand/type/strength, wholesale intro |
| PDP | Risk of £0 if restricted | `priceRestricted` + quote CTA |
| Trade apply | `{ email }` on `/account` | `/trade` + configured fields |
| Checkout | Stripe or quote from CMS | Quote default; card hidden while disabled |
| Legal | Electronics + Stripe | Format-only wholesale; TPD / Modern Slavery / Medical COPY-FROM-LIVE |

## Copy CMS locations

| Copy | Location |
|---|---|
| Hero headlines / CTAs | `hero_slides` |
| Hero supporting + secondary CTA | `site_settings.hero_supporting_copy`, `hero_secondary_cta_*` |
| Feature / lifestyle / homepage sections | CMS tables + `static-cms.ts` fallback |
| Footer tagline / newsletter | `site_settings` |
| Nav | `nav_links` (locations above) |
| About / Help / Contact / Shipping / Privacy / Terms / Cookies / TPD / Modern Slavery / Medical | `marketing_pages` |
| Company number / address / hours | `site_settings.contact_*` |
| Delivery on PDP | `site_settings.default_delivery_info` (product override still wins) |
| Trade form fields | `trade_application_fields` |

## Open review items

1. **Legal pages closed:** TPD, Modern Slavery, and Medical disclaimer are COPY-FROM-LIVE Unique HTML. KYC form/PDFs remain unpublished by design.
2. **Published vs imported counts:** 724 published vs 2,213 Shopify-sourced — confirm which should appear on the storefront before cutover.
3. **PDP delivery fallback** now uses Unique’s published weekday 16:00 / Saturday AM terms, labelled as Unique business copy — not Unique-OS DPD tracking. Confirm before treating as Unique-OS fulfilment policy.
4. Invoice numbering remains Phase 5G **REVIEW_REQUIRED**; storefront labels Unique-native docs as non-official.
5. Electronics demo products have been removed from the static CMS fallback. Live catalogue is the imported Unique range.
