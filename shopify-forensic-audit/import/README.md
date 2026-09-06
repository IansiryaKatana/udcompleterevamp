# Shopify → UD import

## Commands

```bash
# Dry-run (safe, local JSONL only)
node shopify-forensic-audit/import/plan.mjs

# Fast apply (batched — preferred)
node shopify-forensic-audit/import/run-fast.mjs --apply --phase staff
node shopify-forensic-audit/import/run-fast.mjs --apply --phase customers
node shopify-forensic-audit/import/run-fast.mjs --apply --phase companies
node shopify-forensic-audit/import/run-fast.mjs --apply --phase orders
node shopify-forensic-audit/import/run-fast.mjs --apply --phase drafts
node shopify-forensic-audit/import/run-fast.mjs --apply --phase abandoned

# Legacy row-by-row apply (slower)
node shopify-forensic-audit/import/run.mjs --apply --phase staff
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env` (never commit real keys; `.env.example` is placeholders only).

See `docs/UD_COMMERCE_PHASE5_IMPORT.md`.

## Output

- `import/out/dry-run-report.json`
- `import/out/staff-names.json`
- `import/out/last-apply-summary.json` (after `--apply`)
