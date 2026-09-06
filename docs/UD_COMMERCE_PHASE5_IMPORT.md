# UD Commerce Phase 5a — Shopify import tooling

Import forensic JSONL (`shopify-forensic-audit/raw/**`) into UD commerce tables.

## What shipped

| Artifact | Purpose |
|---|---|
| `supabase/migrations/047_widen_money_columns.sql` | `orders` / `order_items` money → `numeric(14,2)` |
| `supabase/migrations/048_abandoned_checkouts.sql` | Abandoned checkout archive table |
| `shopify-forensic-audit/import/plan.mjs` | **Dry-run** (default path) — counts, staff list, samples |
| `shopify-forensic-audit/import/run.mjs` | **Apply** only with `--apply` + service role |
| `shopify-forensic-audit/import/out/` | Reports (gitignored if under `raw` patterns; see repo ignore) |

## Safety defaults

1. `plan.mjs` never talks to Supabase.
2. `run.mjs` exits unless `--apply` is present.
3. Line items set `product_id = null` (no catalog overwrite).
4. Order numbers use `SH-{legacyResourceId}` so they do not collide with native UD numbers.
5. Idempotent on Shopify GIDs (`shopify_order_gid`, `external_system_refs`, etc.).

## Prerequisites before `--apply`

1. Resolve remote migration drift (see `supabase/remote-snapshot/alignment.json`).
2. Apply local migrations `036`–`048` to a **staging** project (or carefully to production after review).
3. Set env:
   - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY` (never ship to the browser)
4. Confirm forensic caches exist under `shopify-forensic-audit/raw/`.

## Recommended apply order

```bash
# 1) Dry-run against local JSONL
node shopify-forensic-audit/import/plan.mjs

# 2) Prefer batched importer
node shopify-forensic-audit/import/run-fast.mjs --apply --phase staff
node shopify-forensic-audit/import/run-fast.mjs --apply --phase customers
node shopify-forensic-audit/import/run-fast.mjs --apply --phase companies
node shopify-forensic-audit/import/run-fast.mjs --apply --phase orders --limit 100   # smoke
node shopify-forensic-audit/import/run-fast.mjs --apply --phase orders              # full (~22k)
node shopify-forensic-audit/import/run-fast.mjs --apply --phase drafts
node shopify-forensic-audit/import/run-fast.mjs --apply --phase abandoned
```

Put `SUPABASE_SERVICE_ROLE_KEY` in **`.env` only** (never commit real keys in `.env.example`).

Migrations `036`–`049` were applied to project `oelolusdbaoyiqkgukib` via `supabase db query` (remote history uses timestamp versions for `001`–`035`; do not `db push --include-all`).

## Entity mapping (summary)

| Shopify | UD |
|---|---|
| Salesperson / referrer / CG names | `staff_members` (+ FKs on customers/companies/orders) |
| Customer | `customers`, `customer_addresses`, tags, metafields, `external_system_refs` |
| Company / location / contact | `companies`, `company_locations`, `company_contacts` |
| Order + money + ship | `orders`, `order_items`, `payment_transactions`, `refunds`, `fulfillments`, tax/shipping lines, events/comments |
| DraftOrder | `draft_orders`, `draft_order_line_items` |
| AbandonedCheckout | `abandoned_checkouts` |
| Product | **Not imported** — separate SKU linking pass later |

## Placeholder staff names

Values like `No Salesperson` / `No Referrer` are **not** inserted into `staff_members`. They remain on metafields/tags.

## After import

- Link `customers.auth_user_id` where emails match `auth.users` (optional script / admin tool).
- SKU-match `order_items` → `products` without losing snapshots.
- Build Phase 5b admin UI for CRM / AR / fulfilment / drafts.
- Grant missing Shopify app scopes only if re-fetching payment terms / discounts / files.

## Intentionally not in 5a

- Production data write without explicit `--apply`
- Admin UI
- Inventory movement ledger / SKULabs sync
- Overwriting storefront products
