# UD Commerce — master index

Wholesale B2B commerce foundation for Unique Distribution, driven by the Shopify forensic audit.

## Status

| Phase | Scope | Migrations | Doc | Status |
|---|---|---|---|---|
| 1 | Identity, CRM, tags/metafields, order foundation, events | `036`–`040` | [UD_COMMERCE_FOUNDATION.md](./UD_COMMERCE_FOUNDATION.md) | Schema local |
| 2 | Payments, AR, refunds, tax, credit notes | `041`–`043` | [UD_COMMERCE_PHASE2_MONEY.md](./UD_COMMERCE_PHASE2_MONEY.md) | Schema local |
| 3 | Locations, fulfillments, DPD events | `044`–`045` | [UD_COMMERCE_PHASE3_FULFILLMENT.md](./UD_COMMERCE_PHASE3_FULFILLMENT.md) | Schema local |
| 4 | Draft orders | `046` | [UD_COMMERCE_PHASE4_DRAFT_ORDERS.md](./UD_COMMERCE_PHASE4_DRAFT_ORDERS.md) | Schema local |
| 5a | Import tooling + money widen + abandoned checkouts | `047`–`049` | [UD_COMMERCE_PHASE5_IMPORT.md](./UD_COMMERCE_PHASE5_IMPORT.md) | **Applied + imported** to `oelolusdbaoyiqkgukib` |
| 5b | Admin CRM / AR / fulfilment / draft UI | — | — | Deferred |
| **2A ops** | Order operations workspace (`/backend/orders`) | `050` | this index | **Implemented** |

> Naming note: commerce schema Phase 2A historically meant payment ledger (`041`). The product **Order Operations** phase is documented here as **2A ops** and uses migration `050`.

**Not applied to remote production by default.** Remote migration history is timestamped and drifted from local `001–048` — do not `supabase db push` blindly.

## Non-negotiables

- Preserve **all** metafields and **all** raw tag strings.
- Do not break storefront checkout, CMS, Stripe, or `quote_requested`.
- Parallel commerce columns (`financial_status`, `customer_id`, …) — do not widen legacy `orders.status` casually.
- Products: **do not** overwrite the live UD catalog from Shopify during import.
- Shopify: read-only forensic cache only; no Admin mutations from this tooling.

## Quick links

- Forensic audit: `shopify-forensic-audit/FORENSIC-AUDIT.md`
- Dry-run import: `node shopify-forensic-audit/import/plan.mjs`
- Apply import (staging only): see Phase 5 import runbook
