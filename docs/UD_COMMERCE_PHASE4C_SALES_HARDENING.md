# Phase 4C — Sales scope hardening, ownership approval & CRM linking

**Status:** COMPLETE — STOP FOR REVIEW  
**Migration:** `075_phase4c_sales_hardening.sql`  
**Selftest:** `rpc_phase4c_sales_hardening_selftest` A–H PASS  
**Approved backfills applied:** **NONE — APPROVAL REQUIRED**

Parked: DPD `carrier_mode=disabled` · SKULabs DIRECT ACCESS REQUIRED · warehouse not started · Worldpay disabled.

## 1. Assigned-scope security audit

Server enforcement added via wrappers around detail/nested/mutation RPCs. List RPCs already used `enforce_sales_scope_filters` (4B).

**Policies (explicit):**

| Entity | Assigned access |
|---|---|
| Customer / Company | current `salesperson_id` |
| Order / Draft | **historical snapshot SP OR current CRM customer/company SP** (`ORDER_ACCESS_POLICY`) |
| AR | list forced to current staff when `sales_visibility=assigned`; default basis `current_crm` |
| Sales overview | assigned users scoped to own staff id |

Client filters are not security.

## 2. RPC security matrix

Available live via `rpc_admin_sales_security_matrix`. Summary: customer/company/order/draft workspaces, nested order/draft/CRM/finance reads, CRM mutations, AR list, sales overview → **SECURED**. Ownership reassignment → owner/admin only. No UNKNOWN entries for reviewed RPCs.

## 3–4. Detail route / mutation results

Direct ID access goes through workspace RPCs → Forbidden when unowned under assigned. Mutations of unowned CRM → Forbidden. Ownership fields in update payloads blocked for non-reassign roles.

## 5. Staff/admin link UX

`/backend/sales` → **Staff ↔ admin**: link/unlink with `staff_admin_link_events` audit. Lists staff without login and admins without staff.

## 6. Alias review

Unresolved UNKNOWN/AMBIGUOUS review UI: RESOLVE / LEGACY / NON_STAFF_REFERRER / KEEP UNKNOWN.

## 7–9. Ownership candidates & rules

Confidence: **EXPLICIT / HIGH / MEDIUM / LOW / CONFLICTING / NO_EVIDENCE**.  
HIGH requires unanimous SP + ≥3 orders + recency; 60/40 never HIGH.  
Live preview seed (companies): pending **1353** · HIGH **626** · MEDIUM **588** · CONFLICTING **139** · EXPLICIT **0**.

## 10–11. Approval workflow & execution

`ownership_backfill_reviews` + decide/apply RPCs. Apply writes **current CRM owner only** + `ownership_backfill_approved` event. Snapshots/metafields/tags untouched. Bulk apply only selected APPROVED/MANUAL rows.

## 12. CG current-state

**NOT JUSTIFIED** — ~124 historical order CG vs 0 current customer CG. Do not invent current CG.

## 13–15. Referrer / type / SureCust

Referrer stays separate. Type promotion mechanics retained. SureCust remains wholesale access/eligibility gate ≠ Customer Type.

## 16–19. Linking & duplicates

Customer↔company link reviews (no auto-create). Company dupes review-only. Customer dupes = exact email only. No merges.

## 20–23. Quality hub / coverage / AR / dashboard

Quality hub + coverage report RPCs. AR + sales overview server-scoped for assigned.

## 24–25. Snapshot immutability / lineage

Selftest D proves order snapshot unchanged after current ownership change. Approved inference stores evidence JSON + actor + source `approved_inference`.

## 26. No automatic merge — confirmed.

## 27. Any actual approved assignments applied

**NONE — APPROVAL REQUIRED**

## 28. Remaining risks

- HIGH candidates still need human review before apply
- Assigned-scope for every exotic finance RPC (statements/refunds) should be re-checked if those surfaces grow
- Link create-company-from-reviewed-data UI deferred (decision path supports LINK / NO_COMPANY / DEFER)

## 29. Recommended Phase 4D

1. Execute approved HIGH/EXPLICIT ownership applies in batches  
2. Optional company merge after duplicate review  
3. CREATE COMPANY from link review with address approval  
4. Still do **not** resume DPD/SKULabs/Worldpay/warehouse  

**STOP FOR REVIEW. Do not start Phase 4D automatically.**
