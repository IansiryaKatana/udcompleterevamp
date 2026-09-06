# Unique Distribution — Shopify forensic audit

Read-only Admin GraphQL audit of `c906ff-0a.myshopify.com` (primary domain `uniquedistribution.com`) to plan replacing Shopify with the UD commerce/ops platform.

- **API:** Admin GraphQL `2026-07`
- **App used:** existing **UD Sales Portal** (`client_id` `73722df23b9961b28c25bfcea5299104`). No new app was installed. No mutations were sent.
- **Fetched:** 2026-09-05
- **Cache:** `shopify-forensic-audit/raw/` (PII; gitignored)
- **Analysis:** `shopify-forensic-audit/analysis/`
- **Scripts:** `scripts/fetch-all.mjs`, `scripts/shopify-exec.mjs`, `scripts/analyze-jsonl.mjs`
- **Queries:** `shopify-forensic-audit/queries/*.graphql`

**Metafield rule:** every metafield definition and every live metafield instance is **PRESERVE**. Zero-count definitions are still required in the archive and in the new platform’s generic metafield store. None are classified as unused/deletable.

---

## A. Executive summary

Unique Distribution is a **UK B2B wholesale vape/convenience distributor** running on **Shopify Plus** (GBP). The live store is not a simple DTC shop: most customers are tagged wholesale, **3,518 Shopify Companies** are linked, and money is split between **Worldpay card checkout** (high order count) and **Bank Deposit / manual / PAY LATER** (high value, sales-assisted).

Shopify is the **order, customer, catalogue, and payment-status system of record**. **SKULabs** writes fulfilment events on almost every order. **DPD Integration by WSA** writes tracking and a `DPD Delivery Status` cart attribute. **Dollarback** writes cashback metafields. Sales ownership is encoded three ways at once: **metafields** (`custom.salesperson`, `custom.referrer`, `custom.salesperson_assigned`), **tags** (`SP_*`, `REF:*`, `sales_rep_*`), and a **CSS Sales Team** app namespace with thousands of unique keys.

The current UD schema can host a storefront catalogue and Stripe checkout. It cannot run this business. The first migrations must add **CRM + companies**, **salesperson/CG**, **a transaction ledger**, **tax lines**, **fulfilments/tracking**, **draft orders / credit accounts**, **tags**, and a **generic metafield archive**.

App config for UD Sales Portal now requests extra read scopes, but the **live installation has not granted them**. Files, discount codes, publications, payment terms objects, and fulfilment orders were denied. Those gaps are listed in **X/Y**. Staff comment authors (`read_users`) require Shopify Plus support and were not requested.

---

## B. Store statistics

| Field | Value |
|---|---|
| Shop name | Unique Distribution |
| myshopify domain | c906ff-0a.myshopify.com |
| Primary domain | https://uniquedistribution.com |
| Plan | Shopify Plus |
| Currency | GBP |
| Timezone | Asia/Muscat |
| Legal address | London, England, EC1V 2NP, GB |
| Fulfilment location | **UD WH 1** — Unit 2, Hollins Business Park, Darwen BB3 1HN |
| Markets | 1 — United Kingdom (primary) |
| Shop created | 2024-06-24 |
| Oldest order | #1001 — 2024-07-10 (`gid://shopify/Order/6132365001030`) |
| Newest order | #UD22832 — 2026-09-04 (`gid://shopify/Order/13307307458886`) |
| `read_all_orders` | **granted** (history is not truncated to 60 days) |

API `ordersCount` caps at 10,000. Paginated fetch found **21,767** orders.

---

## C. Object inventory

| Object | Count | Cache | Notes |
|---|---:|---|---|
| Products | 2,213 | `raw/products/products.jsonl` | 1,430 archived, 723 active, 58 draft, 2 unlisted |
| Variants | 12,677 | nested on products | 100% inventory-tracked; 12,398 with SKU; 8,689 with barcode |
| Collections | 368 | `raw/products/collections.jsonl` | |
| Inventory items | 13,247 | `raw/inventory/inventory-items.jsonl` | all at UD WH 1 |
| Customers | 6,219 | `raw/customers/customers.jsonl` | 3,518 with company profiles |
| Companies | 3,518 | `raw/customers/companies.jsonl` | 3,496 with contacts; all have locations |
| Orders | 21,767 | `raw/orders/orders.jsonl` | current value £24,796,280 |
| Draft orders | 4,093 | `raw/draft_orders/draft-orders.jsonl` | 3,884 completed → 3,876 converted orders |
| Abandoned checkouts | 173 | `raw/abandoned_checkouts/abandoned-checkouts.jsonl` | £37,901 listed value |
| Locations | 1 | `raw/shop/locations-markets.json` | UD WH 1 |
| Metaobject definitions | 0 | `raw/metaobjects/definitions.json` | Shopify standard product taxonomy refs exist as product metafields |
| Files | **denied** | | needs `read_files` on the installation |
| Discount nodes | **denied** | | needs `read_discounts` on the installation |
| Metafield definitions | 123 | `raw/metafield_definitions/by-owner.json` | all preserve |

---

## D. Field usage matrix

### Orders (populated and operationally relevant)

Always or almost always populated: `id`, `legacyResourceId`, `name`, `createdAt`, `displayFinancialStatus`, `displayFulfillmentStatus`, `sourceName`, `currencyCode`, price sets, `taxLines` (GB VAT 20% on 21,664 orders), `lineItems`, `customer`, `app`, tags, metafields `custom.salesperson` / `custom.referrer` / `storename.tradingname`.

High usage: `fulfillments` (21,177), `transactions`, `paymentGatewayNames`, `shippingLines` (Standard Delivery 18,387), `events` (comment events on 11,705 orders), custom attribute `DPD Delivery Status` (7,527).

Selective: `poNumber` (133), refunds (2,959 orders have refund records), `custom.draft_customer_type` (599), `custom.cg_assigned` (124), `custom.credit_note` (80), `order.payment_due_date` (61), returns (5).

Denied nested objects: `paymentTerms`, `fulfillmentOrders`. Fulfilment **shipments** were still captured via `Order.fulfillments` (`read_fulfillments` is granted).

### Customers

Email 6,199 / 6,219; phone 5,545; notes 5,916; company link 3,518. Lifetime spend in Shopify **£24,971,608**. 3,996 customers have zero orders (registered wholesale accounts). Registration metafield present on **every** customer.

### Products

Vendor + productType are the catalogue axes (vape hardware, nic salts, disposables, confectionery, drinks, POS). Tags encode channel and warehouse workflows (`ActiveShopify`, `UD-POS`, `Archived`, pack sizes). Cost is present on `inventoryItem.unitCost` where Shopify has it.

---

## E. Complete metafield catalogue

**123 definitions** by owner:

| Owner | Definitions |
|---|---:|
| PRODUCT | 46 |
| PRODUCTVARIANT | 25 |
| CUSTOMER | 20 |
| ORDER | 14 |
| COLLECTION | 6 |
| COMPANY | 5 |
| DRAFTORDER | 5 |
| SHOP | 1 |
| VALIDATION | 1 |

Full dump: `analysis/metafield-definitions.json` and live instance stats in `analysis/metafield-catalogue.json` (3,209 distinct `namespace.key` combinations including app-generated keys).

### Business-critical (pinned / high count)

| Definition | Namespace.key | Owner | Shopify count / live | Meaning |
|---|---|---|---|---|
| Salesperson | `custom.salesperson` | ORDER + DRAFTORDER | 10,001 def cap / **21,767 + 3,677** live | Salesperson on the order |
| ReferredBy | `custom.referrer` | ORDER + DRAFTORDER | 10,001 / **21,763 + 3,570** | Referrer (usually same sales team) |
| StoreName | `storename.tradingname` | ORDER + DRAFTORDER | 10,001 / **19,053 + 2,007** | Trading-as on the order |
| SP_Assigned | `custom.salesperson_assigned` | CUSTOMER + COMPANY | 5,948 + 40 | Account owner |
| Referredby | `custom.referredby` | CUSTOMER | 5,957 | Who brought the account |
| StoreName | `store_name.trading_as` | CUSTOMER | 5,446 | Customer trading name |
| Registration Channel | `registration.channel` | CUSTOMER | **6,219** | Website vs POS vs manual |
| ud_customer id | `udcustom.customer_id` | CUSTOMER | 4,091 | External/legacy customer id |
| CG_Assigned | `custom.cg_assigned` | ORDER | 124 | Credit/collections owner |
| CG_Assigned | `custom.sg_assigned` | CUSTOMER | 101 | Same concept, different key |
| Customer Type | `custom.draft_customer_type` | ORDER + DRAFT | 599 + 310 | Always `Wholesale` when set |
| Credit Note | `custom.credit_note` | ORDER | 80 | Yes/No |
| Payment Due date | `order.payment_due_date` | ORDER | 61 | Sparse; May 2025 cluster |
| Shop Name | `skulabs.shopname` | CUSTOMER | 1,462 | SKULabs store label |
| Customer Segments | `dollar-segments.customer-segments` | CUSTOMER | 5,626 | Dollarback |
| No Credit Reason | `dollar-cashback.no-credit-reason` | ORDER | 8,688 | Loyalty engine output |
| BOGOS custom_data | `secomapp.freegifts_custom_data` | SHOP | 1 | AOV.ai / BOGOS |

Zero-count definitions (still preserve): `custom.cart_data`, `customer.tiered_price_segment`, `b2b.customer_data`, `b2b.order_data`, `dollar-cashback.customer-data`, draft `order.payment_due_date`, EasyScan/ScanPick bin locations, Google Shopping labels, complementary products, etc.

**App-generated keys:** namespaces `css_sales_team_order_tagging_details` (2,165 distinct keys) and `css_sales_team_tagging_details` (960 keys) must be archived as raw JSON, not normalized into columns.

---

## F. Tag taxonomy

Tags are a **workflow bus**, not merchandising.

### Customer tags (top)

| Pattern | Examples | Role |
|---|---|---|
| Wholesale gate | `SureCust_Wholesale` (5,726), `verified` (5,708) | SureCust lock + approval |
| B2B | `b2b` (3,461), `b2b_company` (3,328) | Shopify B2B company link |
| Credit | `PAY LATER` (718) | Trade credit |
| Salesperson | `SP_JohnYates`, `SP_KaranjotBassi`, … | Account assignment |
| Referrer | `REF:JohnYates`, `REF:MahendraBadsiwal`, … | Referral |
| Name tags | `John Yates`, `Karanjot Bassi`, … | Same people, third encoding |
| Segments | `LowSpendCustomers` (2,799), `loyalty_customers` (661) | Marketing/loyalty |
| Data quality | `NoSPMeta` (1,529), `No Referrer` (322), `pending` (213) | Ops queues |
| SMS | `sms_manual_sub` (2,355) | Brevo/push |

### Order tags (top)

`PAID` (20,318), `WebsiteOrder` (17,872), `WorldPayCard` (10,285), `persistent_cart` (7,579), `FromDraft` (3,742), Flow leftovers `getDraftOrderData1_item.name` + `Review_Customer_Type` (3,913 each), then the same `SP_*` / `REF:*` / `sales_rep_*` family. Credit/ops: `Awaiting payment` (multiple spellings), `CG:` / `CG_` (625).

### Product tags

`Archived`, `Online Store`, `ActiveShopify`, `ActiveShopifyItems`, `label-New`, `UD-10ml-Nic-Salt`, `UD-POS`, `UD-removed-black-friday`, pack-size tags. These are **channel + WMS** flags, not only storefront filters.

### Draft tags

`Awaiting payment` (four spellings, ~3,590 combined), `REF:*`, `⚠️ Out of stock item` (112), `persistent_cart` (51), `WebsiteOrder` (48).

**New platform:** store tags as a first-class `tags(owner_type, owner_id, tag)` table. Do not collapse spellings until a cleanup job; preserve raw strings.

---

## G. Customer / B2B model discovered

True model is **Person + Company + Location + Sales assignment**, not a DTC customer.

1. **Website registration** (6,049) creates a customer with SureCust wholesale tags, trading name, store type, weekly spend, number of stores, company name/reg number.
2. **Shopify Company** (3,518) is the B2B legal/trade entity. Almost every company has contacts and locations. Native B2B payment-term templates are **not used** (1 location `Due on fulfillment`). Credit lives in tags (`PAY LATER`) and gateways (`Bank Deposit`, `manual`), not Shopify Payment Terms (also API-denied).
3. **Salesperson** is assigned on the customer (`custom.salesperson_assigned`) and copied onto every order (`custom.salesperson` + tags). Referrer is parallel and usually the same person.
4. **CG_Assigned** is a separate collections/credit owner (Sam Hussain, Kal Joshi, Muaaz Raja, Haseeb Ali) — sparse (124 orders, 101 customers).
5. **3,996 customers have never ordered.** They are still operational (verified wholesale accounts).

UD must not treat `auth.users` as the customer master. Guest vs account is the wrong split; **trade account vs contact vs company** is the right one.

---

## H. Order model discovered

| Source | Orders | App name |
|---|---:|---|
| Online Store / `web` | 17,883 | Online Store |
| Draft order | 3,876 | Draft Orders |
| POS | 8 | Point of Sale |

Financial: 20,543 PAID, 726 PENDING, 245 VOIDED, 157 PARTIALLY_REFUNDED, 79 PARTIALLY_PAID, 17 REFUNDED.

Fulfilment: 21,052 FULFILLED, 585 UNFULFILLED, 89 PARTIAL, 41 ON_HOLD.

Current totals: **£24,796,280** goods, **£4,126,944** tax, **£17,135** refunded, **£1,107,160** outstanding, 531,738 line items, 819 lines whose product GID is missing (deleted products — keep the line snapshot).

PO numbers exist but are rare (133). Notes on  many orders. Test orders: none counted in `test` flag (0). Cancelled: 551.

---

## I. Draft order workflows

4,093 drafts from 2024-11-20 to 2026-09-04. Status: 3,884 COMPLETED, 205 OPEN, 4 INVOICE_SENT. Converted `draft.order` count 3,876 matches `sourceName=shopify_draft_order`.

Purchasing entity: **2,436 PurchasingCompany**, 1,584 Customer, 73 none. Invoice URL present on all 4,093 (Shopify always issues one).

This is the **sales-assisted / credit / phone-order** path: salesperson + referrer metafields + `Awaiting payment` tags → complete into an order tagged `FromDraft`. Native `paymentTerms` on drafts was not readable (`read_payment_terms` denied). Due dates sometimes appear as the order metafield `order.payment_due_date` (only 61 populated — not the real credit system). **Tags + Bank Deposit/manual/PAY LATER are the credit system.**

---

## J. Payment model

`paymentGatewayNames` (order may list more than one; value column attributes the **full order current total** to each listed gateway, so £ sums exceed £24.8M):

| Gateway | Orders | Attributed £ | First/last in sample | Active? |
|---|---:|---:|---|---|
| Worldpay eCommerce | 10,294 | 6,010,550 | throughout | **yes** |
| Bank Deposit | 9,709 | 16,608,392 | throughout | **yes** |
| manual | 2,828 | 8,794,465 | throughout | **yes** |
| PAY LATER | 970 | 674,666 | throughout | **yes** |
| Pay By Cash | 38 | 316,168 | | rare |
| shopify_store_credit | 25 | 31,602 | | Dollarback |
| shopify_payments | 3 | 121 | | unused |
| Worldpay Payments | 2 | 908 | | legacy name |
| Order Now, Pay Later | 2 | 238 | | unused |

Transactions: 32,989 SALE, 1,248 VOID, 189 REFUND, 2 AUTHORIZATION, 2 CAPTURE. This is **sale-captured**, not auth/capture.

**Ledger fields to persist:** Shopify tx id, kind, status, gateway, amount+currency, processedAt, paymentId, authorizationCode, errorCode, parent order id, manual vs card vs bank vs store credit.

Outstanding £1.11M is real credit-account risk and must migrate as open AR, not as “paid Shopify orders”.

---

## K. VAT / tax model

- Currency GBP, market United Kingdom only.
- Tax title **GB VAT** at **20%** on 21,664 orders; 5% on 7 (reduced-rate experiment or confectionery).
- `taxesIncluded` is true on **3** orders — prices are **VAT-exclusive** in Shopify.
- Customer tax exempt: 1 customer, 4 orders.
- Reconstruct invoices from: line `taxLines[]` + order `taxLines[]` + `totalTaxSet` + `taxesIncluded=false` + shipping tax if present on shipping lines.
- Product `taxable` / `taxCode` exist on variants and must be copied.

---

## L. Inventory model

- Single location **UD WH 1** (Darwen). Every inventory item (13,247) and every variant (12,677) is tracked there.
- Shopify is **not** a multi-warehouse SoR. Fulfilment service on the location is null; fulfilments are **Manual**.
- **SKULabs** emits 20,588 order events — it is the operational WMS/pick engine writing status back into Shopify.
- Bin location metafields (`my_fields.bin_location`, `mas.binloc`, `scanpacker.storage_location`, `custom.ProductLocation`, `custom.VariantLocation`) are defined but **zero live values** in this pull. They are still preserve (may be written only inside SKULabs).
- 310 inventory items have blank SKU; 819 historical line items reference deleted products.

---

## M. Fulfilment / delivery model

- Shopify fulfilments: 21,177 orders have at least one fulfilment. Service name always **Manual**.
- Tracking company labels: Other 14,212, **DPD** 12,660, DPD UK 2,404, DPD Local 222, DX 197, UPS 32.
- `Order.events` appTitle **DPD Integration by WSA** appears **55,700** times. Custom attribute **DPD Delivery Status** on 7,527 orders.
- Shipping titles: Standard Delivery 18,387, Saturday delivery ~939, Free / Next Day rare.
- `fulfillmentOrders` (Shopify Fulfillment Order API) **denied**. Delivery events inside Shopify are DPD app attributes + trackingInfo, not native FulfillmentEvent pagination.

Carrier truth is **DPD via WSA + SKULabs**, with Shopify holding the shipment header and tracking numbers.

---

## N. Refund / return model

- 2,959 orders have refund objects; only 17 display REFUNDED and 157 PARTIALLY_REFUNDED (many refund records are £0 adjustments or tax-only).
- Refund transactions: 189 of kind REFUND.
- Native `returns` connection: **5** records. Returns are not a mature Shopify Returns workflow.
- Credit notes: metafield `custom.credit_note=Yes` on 80 orders — likely PT2/statement printer or finance, not Shopify Returns.
- Persist refund header, refund line items, restockType, refund transactions, and the credit-note metafield. Do not assume Shopify Return objects cover credit notes.

---

## O. Audit / event history

`Order.events` (first 50 per order) is populated. Comment events (`CommentEvent.rawMessage`) on **11,705** orders. **Staff author is not available** without `read_users` (Plus special scope; Shopify Support). `attributeToUser` / `attributeToApp` / `appTitle` / `message` are present.

Event apps: DPD WSA 55,700; Shopify Web 46,296; SKULabs 20,588; mobile/POS negligible.

Timeline must be archived as an immutable event log. 50-event cap per order means **high-chatter orders are truncated** in this pull; a follow-up should paginate `events` for the busiest orders.

---

## P. Abandoned checkout model

173 checkouts, £37,901 listed, 1 completed. Email was stored on `customer.email`, not a top-level email field (analyzer `withEmail=0` is a field-path miss, not missing data). Recovery URL is in `abandonedCheckoutUrl`. Volume is small versus 21k orders — migrate for completeness, not as a growth system.

---

## Q. Discount model

**Not accessible.** `discountNodes` requires `read_discounts` on the **installation** (requested on the app config, not granted on the shop). Order-level `discountApplications` and `discountCode` **were** pulled on each order and should be used until discount definitions can be read.

Evidence of discount apps: shop metafield `secomapp.freegifts_custom_data` (BOGOS / AOV.ai), product tags, and order discount applications. SMART Discounts / AOV.ai cannot be reconstructed from definitions until the scope is granted.

---

## R. Third-party app footprints

| App | Evidence | Class |
|---|---|---|
| **UD Sales Portal** | This audit’s API client; write scopes present on install | WRITES DATA BACK (ops app) |
| **SKULabs** | 20,588 events; `skulabs.shopname` on 1,462 customers | WRITES DATA BACK; **LIKELY HOLDS EXTERNAL DATA** (WMS, bins, stock history) |
| **DPD Integration by WSA** | 55,700 events; tracking; `DPD Delivery Status` | WRITES DATA BACK; tracking SoR may be DPD |
| **Worldpay eCommerce** | 10,294 orders | PAYMENT — tokens stay at Worldpay |
| **SureCust** | `SureCust_Wholesale` 5,726 customers | WRITES TAGS; lock/forms likely external |
| **Dollarback Loyalty** | `dollar-*` metafields; store credit txs | WRITES DATA BACK; **LIKELY HOLDS EXTERNAL DATA** |
| **Magefan Persistent Cart** | `persistent_cart` on 7,579 orders | WRITES TAGS |
| **CSS Sales Team** (tagging) | 3,125 unique metafield keys | WRITES DATA BACK |
| **AOV.ai / BOGOS / secomapp** | shop metafield `secomapp.freegifts_custom_data` | WRITES SHOP METAFIELD |
| **Checkout Blocks** | validation definition `checkoutblocks.order-limits` | SHOPIFY DATA (checkout validation) |
| **PT2 Statement Printer** | credit note metafield + finance workflow | LIKELY HOLDS EXTERNAL DATA (PDF statements) |
| **Xero / Synder** | not visible in GraphQL objects | UNKNOWN — investigate outside Shopify |
| **datafetchodoo / Odoo** | `udcustom.customer_id` 4,091 | LIKELY HOLDS EXTERNAL DATA |
| **RangeMe** | no metafield namespace found | UNKNOWN |
| **Veeqo** | no namespace found (SKULabs is the WMS fingerprint) | UNKNOWN / probably unused |
| **Shopify Flow** | tags `getDraftOrderData1_item.name`, `Review_Customer_Type` | WRITES TAGS |
| **Brevo / PushOwl** | `sms_manual_sub` | LIKELY HOLDS EXTERNAL DATA |
| **Search & Discovery** | `shopify--discovery--*` product metafields | SHOPIFY DATA ONLY |
| **Theme Access / Order Printer** | no object footprint | UNKNOWN |
| **Avada SEO** | no namespace in this pull | UNKNOWN |
| **mm-google-shopping** | product/variant metafields defined, mostly empty | SHOPIFY DATA (feed) |

Do not assume this API exposes an app’s private database.

---

## S. Historical workflow changes

- **2024-07 to 2024-12:** shop exists; almost no volume (2, 0, 1, 3, 13 orders).
- **2025-02 onward:** real wholesale volume; draft-order sales process appears (first draft 2024-11-20).
- **2025-05:** only cluster of `order.payment_due_date` metafields (61 rows) — short-lived experiment, not the ongoing credit model.
- **2026:** ~1,500–1,850 orders/month; 310 in 2026-09 through Sep 4.
- Product archive is large (1,430 / 2,213) — catalogue was cleaned while history kept.
- Dual Worldpay vs Bank Deposit has been stable across the populated history.
- Flow tags `getDraftOrderData1_item.name` are leftover automation, not customer-facing.

---

## T. Inferred business workflows

### 1. Website wholesale checkout (majority)

**WebsiteOrder** + **Online Store** + **WorldPayCard** / Worldpay eCommerce + **PAID** + Standard Delivery + DPD + SKULabs events.

Evidence: 17,872 `WebsiteOrder` tags, 10,285 `WorldPayCard`, 17,883 `sourceName=web`.

### 2. Sales-assisted draft → credit / bank

Draft order with `custom.salesperson` + `custom.referrer` + `storename.tradingname` + `Awaiting payment*` → completed order `FromDraft` + **Bank Deposit** or **manual** or **PAY LATER**.

Evidence: 3,876 draft-sourced orders; 2,436 drafts with `PurchasingCompany`; Bank Deposit £16.6M attributed.

### 3. Account ownership

Customer metafield `custom.salesperson_assigned` + tags `SP_*` / `REF:*` copied onto orders as `custom.salesperson` / `custom.referrer`.

Top order salespeople: Karanjot Bassi 4,513, Adam Fysal 3,305, Simon Hartshorn 3,067, Adam Yousuf 2,403, Mahendra Badsiwal 2,374, John Yates 2,297, Jake Dodd 1,732, Tom Cook 1,156.

### 4. Collections / CG

Sparse `custom.cg_assigned` + tags `CG:` / `CG_`. Owners: Sam Hussain, Kal Joshi, Muaaz Raja, Haseeb Ali.

### 5. Warehouse pick/pack/ship

Manual Shopify fulfilment + SKULabs events + DPD WSA tracking. Single warehouse UD WH 1.

### 6. Loyalty (partial)

Dollarback metafields on most orders explaining **zero** cashback. Store credit gateway used 25 times. Not core to revenue.

### 7. Credit note / finance

`custom.credit_note` + PT2 (external). Native Shopify Returns unused (5).

---

## U. Shopify → new UD field mapping

| Shopify source | Business meaning | New entity | New field | Normalized / raw | Priority |
|---|---|---|---|---|---|
| Order.id / legacyResourceId | Immutable Shopify identity | orders | shopify_gid, shopify_legacy_id | both | critical |
| Order.name | Visible order number | orders | order_number | normalized | critical |
| Order.metafield custom.salesperson | Salesperson on order | orders + staff | salesperson_id | normalized + raw | critical |
| Order.metafield custom.referrer | Referrer | orders + staff | referrer_id | normalized + raw | critical |
| Order.metafield storename.tradingname | Trading name on order | orders | trading_name | normalized + raw | critical |
| Order.metafield custom.cg_assigned | CG / collections | orders + staff | cg_assigned_id | normalized + raw | high |
| Order.metafield custom.credit_note | Credit-note flag | credit_notes | flag + raw | both | high |
| Order.metafield order.payment_due_date | Due date (sparse) | invoices | due_on | both | medium |
| Order.tags | Workflow bus | tags | tag | raw | critical |
| Order.paymentGatewayNames + transactions | Money movement | payment_transactions | kind, gateway, amount, status | normalized | critical |
| Order.taxLines | VAT | order_tax_lines | title, rate, amount | normalized | critical |
| Order.fulfillments + trackingInfo | Shipments | fulfillments | carrier, tracking, qty | normalized | critical |
| Order.customAttributes DPD Delivery Status | Carrier status | fulfillments | carrier_status | raw | high |
| Order.events | Audit timeline | order_events | message, app, at | raw | critical |
| Order.lineItems (incl. missing product) | Lines | order_items | sku, title, qty, snapshot | both | critical |
| Customer.* + addresses | CRM person | customers + addresses | … | both | critical |
| Customer.metafield salesperson_assigned | Account owner | customers | salesperson_id | both | critical |
| Customer.metafield store_name.trading_as | Trading as | customers | trading_as | both | critical |
| Customer.metafield udcustom.customer_id | Legacy/Odoo id | customers | external_ids | raw | high |
| Customer.tags SureCust / PAY LATER / b2b | Access + credit | customers | flags + tags | raw | critical |
| Company.* | Trade account | companies | name, locations, contacts | normalized | critical |
| DraftOrder.* | Quotes / sales orders | draft_orders | status, converted_order_id | both | critical |
| Product/variant + inventoryItem | Catalogue + stock snapshot | products / variants / inventory_balances | sku, barcode, cost, qty | both | critical |
| All other metafields | Unknown or app | metafields | namespace, key, type, value | **raw always** | critical |
| css_sales_team_* keys | App tagging dump | metafields | raw JSON | raw | high |

---

## V. Shopify → existing platform gap matrix

Existing UD tables: products, product_variants, categories, collections, product_bundles, orders (Stripe-shaped), order_items, shipping_zones, coupons, inventory_reservations, storefront_carts, CMS, email_templates, cms_media, admin_users.

| Domain | Verdict |
|---|---|
| Catalogue (title, slug, media, SEO, variants, collections) | **EXTEND** — add vendor, productType, tags, barcodes, cost, taxable, archive status, Shopify GIDs |
| Storefront cart / Stripe checkout | **KEEP** for consumer; **NEW** B2B checkout (Worldpay + bank + pay later) |
| Coupons | **EXTEND** after discount definitions readable |
| Customer auth | **KEEP** login; **NEW TABLE** customers CRM (not auth.users) |
| Companies / B2B | **NEW TABLE** |
| Addresses | **NEW TABLE** |
| Salesperson / CG | **NEW TABLE** staff + assignment history |
| Tags | **NEW TABLE** |
| Metafields | **NEW TABLE** generic EAV + archive |
| Payment transactions | **NEW TABLE** |
| Tax lines | **NEW TABLE** |
| Refunds / credit notes | **NEW TABLE** |
| Returns | **MIGRATE ONLY** (5 records) + archive |
| Fulfilments / tracking / DPD status | **NEW TABLE** |
| Draft orders | **NEW TABLE** |
| Order events / comments | **NEW TABLE** |
| Inventory locations / movements | **NEW TABLE** snapshot; **EXTERNAL APP INVESTIGATION** SKULabs for history |
| Invoices / statements | **EXTERNAL APP INVESTIGATION** PT2; **NEW** if replacing |
| Abandoned checkouts | **EXTEND** abandoned cart email (already have template) from Shopify abandoned list |
| Files / CMS media | **ARCHIVE RAW** once `read_files` granted |
| Quote mode | **EXTEND** toward draft-order feature set |

---

## W. Migration risk register

| ID | Risk | Level |
|---|---|---|
| R1 | SKULabs holds pick/pack/bin/stock history not in Shopify | **BLOCKER** |
| R2 | Worldpay tokens / card vault cannot be copied | **BLOCKER** for card-on-file |
| R3 | Customer passwords are Shopify-hosted; must force reset / SSO | **BLOCKER** |
| R4 | Open AR £1.11M + PAY LATER / Bank Deposit not modelled in UD | **BLOCKER** |
| R5 | Discount definitions unread (`read_discounts`) | **HIGH** |
| R6 | Payment Terms API unread; credit encoded in tags/gateways | **HIGH** |
| R7 | Event log truncated at 50/order; staff author missing | **HIGH** |
| R8 | 819 line items with deleted products | **HIGH** |
| R9 | Files/themes unread | **MEDIUM** |
| R10 | Publications/channels unread | **MEDIUM** |
| R11 | Fulfilment Orders API unread (shipments still via fulfillments) | **MEDIUM** |
| R12 | Dollarback / SureCust / DPD / PT2 / Odoo external DBs | **HIGH** |
| R13 | Duplicate JSONL from concurrent fetch; 12 corrupt lines (unique 21,767 recovered) | **LOW** (re-pull those 12 if needed) |
| R14 | Historical invoices as PDFs live in Order Printer / PT2 | **HIGH** |
| R15 | Metaobject definitions empty but product taxonomy metafields reference metaobjects | **MEDIUM** |
| R16 | Single warehouse assumption may hide SKULabs locations | **HIGH** |

---

## X. Information not accessible through Shopify API

- Payment card PANs / Worldpay tokens
- Customer passwords
- Staff member list and comment authors (`read_users`)
- Shopify Payment Terms objects and schedules (`read_payment_terms` not on installation)
- FulfillmentOrder records (`read_assigned_fulfillment_orders` / merchant / third-party)
- Publications / sales-channel product availability (`read_publications`)
- Files / images library (`read_files`)
- Discount code and automatic discount definitions (`read_discounts`)
- App-private databases (SKULabs, DPD, Dollarback, Xero, Odoo, PT2)
- Events beyond the first 50 per order in this pull
- Deleted products’ full records (only snapshots on line items)

---

## Y. Additional read scopes required

These are **already on the UD Sales Portal app config** (confirmed via `shopify app config pull`) but **not granted on the live installation** (`currentAppInstallation.accessScopes` = 60 handles, none of the following). The merchant must open **Apps → UD Sales Portal → Update** (or re-approve permissions). That is not a new app install.

| Scope | Why |
|---|---|
| `read_discounts` | Discount definitions, BXGY, app discounts |
| `read_files` (or `read_images` / `read_themes`) | File library / CMS media |
| `read_publications` | Channel publishing, `resourcePublications` |
| `read_payment_terms` | Native payment terms on orders/drafts/companies |
| `read_assigned_fulfillment_orders` | FulfillmentOrder objects |
| `read_merchant_managed_fulfillment_orders` | same |
| `read_third_party_fulfillment_orders` | same |
| `read_companies` | already readable in practice; add for completeness |
| `read_users` | **Plus special** — staff identities / comment authors. Needs Shopify Support. Optional. |

Do not add extra **write** scopes for the audit.

---

## Z. Recommended next database migrations

1. **`customers` CRM** (profile, notes, tax, Shopify GIDs, external ids) separate from `auth.users`.
2. **`customer_addresses`**.
3. **`companies`, `company_locations`, `company_contacts`**.
4. **`staff` + `assignments`** (salesperson, referrer, CG) with history.
5. **`tags`** polymorphic.
6. **`metafields`** generic (owner_type, owner_gid, namespace, key, type, value, json_value).
7. **Replace `orders` Stripe shape** with wholesale order header: financial status, fulfilment status, source, PO, outstanding, trading_name, company_id, salesperson_id.
8. **`order_items`** snapshot columns (sku, title, variant, tax, deleted-product flag).
9. **`payment_transactions`** ledger.
10. **`order_tax_lines`**.
11. **`fulfillments`, `fulfillment_items`, `shipment_events`** (DPD status).
12. **`refunds`, `refund_items`, `credit_notes`**.
13. **`order_events`** (Shopify timeline).
14. **`draft_orders`** (+ line items, converted_order_id).
15. **`inventory_balances`** per location (start with UD WH 1) + Shopify inventory_item id.
16. After scopes are granted: ingest discounts, files, publications, payment terms; paginate remaining order events.

Do **not** write these into production until a migration run is explicitly approved. This audit wrote only local cache + analysis files.

---

## Reproducibility

```
node shopify-forensic-audit/scripts/fetch-all.mjs --phase bootstrap
node shopify-forensic-audit/scripts/complete-remaining.mjs
node shopify-forensic-audit/scripts/analyze-jsonl.mjs
node shopify-forensic-audit/scripts/extract-definitions.mjs
```

Token: client-credentials grant against the already-installed UD Sales Portal (see `scripts/get-session-token.mjs`). Never commit `raw/.session-token.json`.

Archive layout already matches the requested `raw_shopify/` plan under `shopify-forensic-audit/raw/{shop,products,customers,orders,draft_orders,abandoned_checkouts,inventory,metafield_definitions,metaobjects}/`. After `read_files` / `read_discounts`, add `files/` and `discounts/`. Transactions, refunds, and fulfilments are nested on each order JSON and can be exploded into those folders in a later normalize job without re-hitting Shopify.
