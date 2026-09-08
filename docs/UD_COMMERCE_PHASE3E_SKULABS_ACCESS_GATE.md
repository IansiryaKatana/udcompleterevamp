# Phase 3E — SKULabs access gate

**Status:** STOPPED  
**Verdict:** **SKULABS ACCESS NOT AVAILABLE**

No Unique SKULabs credentials, export, or read-only token exist in this project. Extraction was **not** attempted against live Unique data.

## Evidence checked (no secrets exposed)

| Source | Result |
|---|---|
| `.env` keys | Supabase + Resend only — **no SKULABS_*** |
| `private_settings` | empty |
| Integration credential tables | none |
| `raw_skulabs/` archive | does not exist (nothing to extract) |
| Carrier config | `carrier_mode=disabled` unchanged |

## Public API reference (NOT project access)

Official docs confirm a Bearer JWT API exists (`https://api.skulabs.com`, docs v4.5.0). Object families include warehouse, location, inventory (+ history/reserved/incoming), item, kit, order, shipments, purchase_order, transfer_order, distributor, cycle_count, batch, store, tag, webhook.

This is **documentation awareness only**. Without Unique’s API key / store id, **no Unique account objects were read**.

## Exact access Unique must supply

1. **Read-only SKULabs API key** (Bearer JWT) for the Unique Distribution account  
2. Confirmation of **store / account identifier** linked to Shopify `c906ff-0a.myshopify.com`  
3. Preferred: key limited to **read** operations (inventory/orders/POs/warehouses) — no write scopes if avoidable  
4. Optional: CSV/report exports if API history retention is incomplete  
5. Written confirmation that extraction may run against production **read-only**  
6. Contact for rate-limit / Enterprise page-size if needed

Placeholders added (commented) in `.env.example`.  
`raw_skulabs/` added to `.gitignore`.

## Inventory SoT (unchanged from Phase 3D)

**INVENTORY SOURCE OF TRUTH = UNRESOLVED** (still **LIKELY HYBRID** from Shopify-only evidence).

Cannot promote to CONFIRMED SKULABS / SHOPIFY / HYBRID without direct quantities + movement comparison.

## Non-actions

- No SKULabs API calls  
- No warehouse schema migrations  
- No inventory redesign  
- No DPD enablement  
- No shipment-event backfill  

## Resume condition

Provide `SKULABS_API_TOKEN` (+ store/account id) in local `.env` (never commit), then re-run Phase 3E extraction only.
