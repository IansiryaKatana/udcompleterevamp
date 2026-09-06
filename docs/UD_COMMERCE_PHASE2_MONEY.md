# UD Commerce Phase 2 — Money & AR

Builds on Phase 1 (`docs/UD_COMMERCE_FOUNDATION.md`) and the Shopify forensic audit.

**Status:** schema only — no Shopify import, no deploy, Stripe checkout unchanged.

## Why this slice

Audit facts that required a money model before fulfilment/drafts:

- Dual payment rails: **Worldpay** (volume) vs **Bank Deposit / manual / PAY LATER** (value)
- ~**£1.11M** open outstanding
- Sale-captured transactions (SALE / VOID / REFUND), not auth/capture
- Refunds on ~2,959 orders; native Returns almost unused
- Credit notes via `custom.credit_note` / PT2, not Shopify Returns
- GB VAT 20% tax lines needed for invoice reconstruction

## Tables added

| Table | Role |
|---|---|
| `payment_transactions` | Canonical ledger (kind, status, gateway, amount, Shopify ids) |
| `ar_accounts` | Trade credit account (company-preferred) |
| `ar_entries` | AR movements (invoice_open, payment_applied, …) |
| `order_tax_lines` | VAT lines (order and optional line allocation) |
| `refunds` | Refund headers |
| `refund_line_items` | Refund line snapshots + restock_type |
| `credit_notes` | Finance credit notes (flag + amount) |

## Orders columns added

- `payment_due_on`
- `payment_gateway_names text[]`
- `ar_account_id`

Existing `total_received` / `total_outstanding` remain the order-level cache.

## Compatibility

- Does **not** change `orders.status`, Stripe session/PI columns, or checkout RPCs
- Stripe can later write `payment_transactions` with `gateway = 'stripe'` without replacing current flow
- No card PANs / Worldpay tokens — only masked hints if ever present
- Authenticated users cannot DELETE `payment_transactions` or `refunds` (service_role for import repair)

## Migrations

- `041_payment_transactions.sql`
- `042_accounts_receivable.sql`
- `043_refunds_credit_notes_tax.sql`

Verify: `supabase/tests/042_phase2_money_verify.sql`

## Intentionally deferred

- Full payment-schedule / terms engine (`read_payment_terms` still blocked on Shopify install)
- Invoice/statement PDF engine (PT2 remains external)
- Fulfilment / DPD / SKULabs entities
- Draft orders
- Automatic AR balance triggers (balances updated by application/import for now)
- Widening legacy `numeric(10,2)` on `orders.total`

## Next recommended slice

**Phase 3 — Fulfilment & delivery** — implemented: `docs/UD_COMMERCE_PHASE3_FULFILLMENT.md`.

**Phase 4 — Draft orders** — implemented: `docs/UD_COMMERCE_PHASE4_DRAFT_ORDERS.md` (migration 046).
