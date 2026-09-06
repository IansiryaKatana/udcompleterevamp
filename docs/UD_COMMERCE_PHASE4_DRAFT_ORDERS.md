# UD Commerce Phase 4 — Draft orders

Sales-assisted / credit / phone-order path from the Shopify forensic audit (~4,093 drafts).

**Status:** schema only — no Shopify import, no deploy.

## Compatibility

| Existing | Decision |
|---|---|
| Storefront `orders.status = quote_requested` | **Unchanged** — consumer quote checkout |
| Stripe checkout | **Unchanged** |
| New wholesale drafts | `draft_orders` + `draft_order_line_items` |

Do not conflate CMS quote mode with B2B draft orders.

## Tables added

| Table | Role |
|---|---|
| `draft_orders` | Wholesale draft header (status, invoice, company/customer, salesperson) |
| `draft_order_line_items` | Line snapshots (`deleted_product` supported) |

## Orders column added

- `draft_order_id` — back-link when converted (`FromDraft` / `shopify_draft_order`)

## Draft ↔ order conversion

```
draft_orders.converted_order_id → orders.id
orders.draft_order_id → draft_orders.id
```

Typical flow from audit:

1. Draft with `PurchasingCompany` + salesperson + trading name  
2. Tags like `Awaiting payment*` (preserve via `entity_tags`)  
3. Complete → live order (`Bank Deposit` / `manual` / `PAY LATER`)  
4. Order tags `FromDraft`

Metafields/tags still use Phase 1 generic tables (`owner_type = 'draft_order'`).

## Shopify mapping

| Shopify | UD |
|---|---|
| DraftOrder | `draft_orders` |
| `status` OPEN/COMPLETED/INVOICE_SENT | `status` |
| `purchasingEntity` | `purchasing_entity_type` + company/customer FKs |
| `custom.salesperson` / `custom.referrer` | `salesperson_id` / `referrer_id` (+ raw metafields) |
| `storename.tradingname` | `trading_name_snapshot` |
| `custom.draft_customer_type` | `customer_type_snapshot` |
| `order` (completed) | `converted_order_id` |
| Line items | `draft_order_line_items` |

## Migration

- `046_draft_orders.sql`

Verify: `supabase/tests/044_phase4_draft_orders_verify.sql`

## Deferred

- Native payment-terms objects on drafts (Shopify scope still denied)
- Admin UI for drafting / converting
- Auto-inventory reservation on drafts
- Shopify import of the 4,093 drafts

## Commerce schema progress (Phases 1–4)

| Phase | Scope | Migrations |
|---|---|---|
| 1 | CRM, companies, staff, tags, metafields, order foundation, events | 036–040 |
| 2 | Payments, AR, refunds, tax lines, credit notes | 041–043 |
| 3 | Fulfilments, DPD/shipment events, locations | 044–045 |
| 4 | Draft orders | 046 |

## Next recommended slice

**Phase 5 — Shopify import tooling (read-only archive → UD)**  
or **Phase 5b — Admin CRM/AR/fulfilment UI** — choose based on whether data load or ops UI is the priority.
