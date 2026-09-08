# Phase 4B — Sales operations, staff directory & scoped ownership

**Status:** COMPLETE — STOP FOR REVIEW  
**DPD / SKULabs / Worldpay:** parked (unchanged)  
**Migration:** `074_phase4b_sales_ops.sql`  
**Selftest:** `rpc_phase4b_sales_ops_selftest` A–I PASS  
**No inferred bulk ownership backfill executed.**

## 1. Existing Sales/Staff Audit (KEEP / EXTEND / BUILD)

| Capability | Decision |
|---|---|
| `staff_members` + `admin_users.staff_member_id` | **KEEP** |
| Salesperson / CG / referrer trio on CRM + snapshots | **KEEP** |
| Customer/company list SP/CG/referrer filters | **EXTEND** (`mine_salesperson`) |
| Order/draft ownership snapshot filters | **EXTEND** (`mine_salesperson`) |
| `entity_assignments` ownership audit | **KEEP** |
| Staff directory UI | **BUILD** (`/backend/sales`) |
| Staff aliases resolution matrix | **BUILD** |
| Ownership candidate preview | **BUILD** (no execute) |
| Duplicate company review UI | **BUILD** (no merge) |
| Sales-scoped RBAC (`sales_visibility`) | **BUILD** (default `all`) |
| AR salesperson filters | **EXTEND** |
| Sales overview dashboard | **BUILD** |

## 2. Staff Directory Model

Canonical table remains `staff_members` (active/inactive, staff_type, provenance, optional admin link).  
Former staff stay as inactive rows; disabling an admin account does **not** delete staff identity.

## 3. Staff Alias Resolution Matrix

Table `staff_aliases`: RAW / SOURCE / COUNT / FIRST / LAST / STAFF / STATUS / CONFIDENCE.  
Auto-status uses **exact name match only**. Near-matches are not silently merged.

Live after rebuild: **157** aliases · **154** RESOLVED · **3** UNKNOWN · **0** AMBIGUOUS.

## 4–6. Salesperson / CG / Referrer

- Salesperson remains primary current CRM owner + historical order/draft snapshot.
- CG: **124** historical orders with CG; **0** current customer CG assignments. Treat as primarily order-level until operational CG assignment is approved.
- Referrer remains separate (`referrer_id` + `REF:*` tags). Unresolved referrers stay source records.

## 7. Customer Type Taxonomy

Primarily metafield / snapshot evidence. Promotion RPC copies ACTIVE values (`Wholesale`, etc.) into structured CRM fields **without removing metafields or rewriting snapshots**.

## 8. SureCust_Wholesale

**5,726** entity tag links. Interpretation: wholesale **access/eligibility gate** (SureCust), overlapping `verified` — **not** equated to Customer Type = Wholesale.

## 9–11. Ownership models & candidates

- Current CRM owner ≠ historical snapshot owner (selftest C).
- `rpc_admin_reassign_ownership` writes CRM event + `entity_assignments`; never mutates order/draft snapshots.
- Company/customer ownership candidates are **preview only**.

## 12. Sales-scoped RBAC

| Capability | Behaviour |
|---|---|
| `VIEW_ALL_SALES` | `sales_visibility=all` or owner/admin |
| `VIEW_ASSIGNED_SALES` | `sales_visibility=assigned` forces server salesperson filter |
| `REASSIGN_OWNERSHIP` | owner/admin only |
| Client filters | not security — list RPCs call `enforce_sales_scope_filters` |

No invented manager hierarchy.

## 13–17. Workspace / filter changes

| Surface | Change |
|---|---|
| Customers | My customers chip → `mine_salesperson` |
| Companies | My companies chip |
| Orders | My orders (historical snapshot SP) |
| Drafts | My drafts |
| AR | My accounts + ownership basis (`current_crm` default / `order_snapshot`) |

**AR ownership basis (documented):** default filters by **current company/customer salesperson**. Optional `ownership_basis=order_snapshot` uses historical order SP.

## 18–21. Reassignment / bulk / dashboard / performance

- Controlled reassignment with reason + immutable CRM activity.
- Bulk inferred assignment: **not implemented** (preview only).
- Sales overview: assigned counts, hist. orders/drafts, outstanding AR, overdue with explicit due dates only.
- No commissions; attributed order value ≠ cash collected.

## 22–25. Duplicates / linkage / DQ / backfill

- Duplicate groups rebuilt: **88** (review statuses only).
- Customers without company: **~2,703** (heuristic linkage preview RPC).
- DQ report extended with Phase 4B fields.
- **Backfill candidates = PREVIEW ONLY — not applied.**

## 26. Tests

- SQL `rpc_phase4b_sales_ops_selftest` A–I
- Vitest `phase4bSalesOps.selftest.test.ts`

## 27. Migrations / files

- `supabase/migrations/074_phase4b_sales_ops.sql`
- `/backend/sales` hub (overview, staff, duplicates, ownership candidates)
- Filter + session + RPC client updates
- `docs/UD_COMMERCE_PHASE4B_SALES_OPS.md`

## 28. Remaining gaps

- Admin↔staff link UI is table-level; deeper admin picker can improve in 4C.
- Assigned-scope detail-RPC enforcement is helper-ready (`assert_sales_entity_access`) — list enforced; wire into every get-detail path in 4C if rolling out assigned editors.
- Bulk backfill still awaiting explicit approval.
- CG current CRM population still 0 — intentional until business rules approved.

## 29. Recommended Phase 4C

1. Approved ownership backfill execution (selected HIGH_CONFIDENCE only)
2. Optional company merge workflow (after duplicate review)
3. Complete assigned-scope detail/mutation gates
4. Customer↔company linkage assisted linking (still no auto-create)
5. Do **not** resume DPD / SKULabs / Worldpay here

**STOP FOR REVIEW. Do not start Phase 4C automatically.**
