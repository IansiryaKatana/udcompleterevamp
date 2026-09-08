# Phase 4A — B2B customer, company & sales ownership foundation

**Status:** COMPLETE — STOP FOR REVIEW  
**DPD / SKULabs:** parked (unchanged)  
**Migration:** `073_phase4a_crm_foundation.sql`  
**Selftest:** `rpc_phase4a_crm_selftest` A–I PASS · Vitest 2/2

## 1. Existing CRM capability audit (KEEP / EXTEND / BUILD)

| Capability | Decision | Basis |
|---|---|---|
| Customer / company masters | **KEEP** | 037 + 057 + `/backend/customers*` `/companies*` |
| Contacts link/unlink | **KEEP** | `rpc_admin_add/remove_company_contact` |
| Salesperson / CG / referrer (separate) | **KEEP** | columns + `entity_assignments` + list filters |
| StoreName / customer type / payment_terms | **KEEP** | columns + resolvers; metafields preserved |
| Notes / activity | **KEEP** | `crm_notes` / `crm_events` |
| Order/draft ownership snapshots | **KEEP** | 039/046/050/053; selftest T + 4A D |
| Address / location CRUD | **EXTEND** | schema existed; RPCs + UI added in 4A |
| Contact field edit | **EXTEND** | `rpc_admin_update_company_contact` |
| Staff resolution / DQ / taxonomy reports | **BUILD** | read-only admin RPCs |
| Credit-limit engine | **NOT REQUIRED** | no source evidence |
| Warehouse / DPD | **PARKED** | out of scope |

## 2. Live counts (Unique DB)

| Entity | Count |
|---|---|
| customers | 6,219 |
| companies | 3,518 |
| company_locations | 3,522 |
| company_contacts | 3,518 |
| customer_addresses | 6,054 |
| staff_members | 53 |
| orders | 21,767 |
| draft_orders | 4,093 |
| metafields | 146,690 |
| entity_tags | 186,352 |

## 3–7. Models

Unchanged core models from Phase 1/2C. Phase 4A adds server RPCs:

- `rpc_admin_upsert/delete_customer_address`
- `rpc_admin_upsert/delete_company_location`
- `rpc_admin_update_company_contact`

CRM addresses remain separate from immutable order billing/shipping snapshots.

## 8–11. Sales / StoreName / type

- Salesperson vs CG vs referrer remain **three fields** (not collapsed).
- StoreName lives primarily on **customers.trading_name** (~5,829); companies.trading_name ≈ 0; order snapshots ~19,053.
- Customer type columns largely blank; metafields `custom.customer_type` / `draft_customer_type` hold values (mostly Wholesale on orders).
- Staff directory: 53 resolved names (Adam Fysal … Tom Cook, UD LEADS, etc.).

## 12–14. Referral / terms / credit

- Referral maps to `referrer_id` → `staff_members` when resolvable; raw tags/metafields kept.
- Payment terms: free-text on customer/company/draft; **no due-date backfill**.
- Credit: PAY LATER tag links ~732; SureCust_Wholesale ~5,726.  
  **credit_limit_source = NO_SOURCE_EVIDENCE**

## 15–20. Drafts / orders / PO / tags / metafields

- Drafts already carry ownership + StoreName + type + payment_terms snapshots.
- Orders: salesperson on ~21,733; trading_name_snapshot ~19,053; customer_type_snapshot sparse (~138).
- Customer PO: `orders.purchase_order_number` **133**; `draft_orders.po_number` **2**. Not supplier POs.
- Tags + metafields tables untouched; structured fields coexist.

## 21–23. Activity / notes / permissions

- Notes/events extended to allow `company_location` entity_type.
- Permissions unchanged: `can_mutate_crm()` ≡ admin/editor; viewers read-only. All mutations server-side.

## 24–27. Workspaces / sales filtering / snapshots

- Extended detail UIs: add/remove CRM addresses; add/remove company locations.
- List filters already support salesperson / CG.
- **Snapshot policy proven:** changing customer salesperson/trading_name does **not** rewrite order snapshots (selftest D).

## 28. Data quality (flag only — no merges)

| Metric | Approx |
|---|---|
| Customers without company | ~2,701 |
| Companies without salesperson | ~3,478 |
| Customers without salesperson | ~394 |
| Duplicate email groups | (see analysis JSON) |
| Duplicate company name groups | (see analysis JSON) |
| Addresses missing core fields | non-zero |

No automatic merges performed.

## 29–30. Tests / files

- Migration `073_phase4a_crm_foundation.sql`
- `src/admin/lib/adminRpc.ts` (Phase 4A RPC wrappers)
- `AdminCustomerDetail.tsx` / `AdminCompanyDetail.tsx` address/location CRUD
- `phase4aCrm.selftest.test.ts`
- Analysis: `shopify-forensic-audit/analysis/phase4a-*.json`

## 31. Remaining B2B gaps → Phase 4B candidates

1. Promote Customer Type from metafields into structured columns where confident  
2. Company-level salesperson backfill from primary contact (business approval)  
3. Duplicate candidate review UI (no auto-merge)  
4. Contact role/primary edit UI polish  
5. Salesperson-scoped “my book” visibility (RBAC)  
6. Staff directory admin page  
7. Tag attach/detach on CRM entities  

## Explicit non-actions

DPD disabled · SKULabs parked · no warehouse schema · no Worldpay · no due-date invention · no Shopify mutations · no historical order rewrites.
