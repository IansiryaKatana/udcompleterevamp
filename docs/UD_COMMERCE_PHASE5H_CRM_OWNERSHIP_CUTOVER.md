# Phase 5H — CRM Ownership Resolution & Sales Operations Cutover Readiness

**Status:** COMPLETE — STOP FOR REVIEW  
**Scope:** INTERNAL CRM / STAFF / SALES OPERATIONS only  
**Migration:** `supabase/migrations/20260908030042_phase5h_crm_ownership_cutover_readiness.sql`  
**Selftest:** `rpc_phase5h_crm_ownership_selftest` A–H  

> Note: Storefront work previously labeled “Phase 5H” lives in `docs/UD_COMMERCE_PHASE5H_STOREFRONT.md`. This document is the **CRM/Sales ownership** Phase 5H.

**NO CUSTOMER CONTACT · NO CUTOVER · NO OWNERSHIP BATCH AUTO-APPLIED**

---

## Locked state (confirmed)

| Lock | Value |
|---|---|
| PHASE4I_PILOT_001 | NOT_SENT |
| pilot_send_authorized | false |
| commercial_access_mode | catalogue_open |
| trade_required_cutover_approved | false |
| compliance_mode | observe |
| Worldpay gateway_mode | disabled |
| DPD carrier_mode | disabled |
| wms_enabled | false |
| ownership_bulk_apply_authorized | **false** |
| ownership_auto_apply_high | **false** |
| catalogue_readiness | READY |
| finance_readiness | REVIEW_REQUIRED |
| wms_readiness | SHADOW_RECONCILED |
| crm_sales_readiness | **REVIEW_REQUIRED** |

---

## 1. Staff Directory Baseline

| Class | Count |
|---|---:|
| ACTIVE_STAFF | 58 |
| INACTIVE_STAFF | 2 |
| LEGACY_STAFF | inactive + historical provenance (see RPC) |
| staff_total | 60 |
| ADMIN_LINKED (via `admin_users.staff_member_id`) | 2 |
| ADMIN_UNLINKED | 58 |
| admins_total | 3 |
| admins_without_staff | 1 |

Do **not** delete legacy/inactive staff — historical snapshots must keep resolving.

RPC: `rpc_admin_staff_directory_baseline`

## 2. Staff/Admin Linkage

Linkage source of truth is **`admin_users.staff_member_id`**, not `staff_members.auth_user_id` (which remains 0).

Active sales users needing Unique login should be classified:

- READY — admin linked + active
- ADMIN_LINK_REQUIRED — active staff without admin link (most of directory)
- ALIAS_REVIEW — unresolved alias ties
- LEGACY_ONLY — inactive / historical-only

## 3. Alias Quality

| Status | Count |
|---|---:|
| RESOLVED | 154 |
| UNKNOWN | 3 |
| AMBIGUOUS | 0 |
| Total | 157 |

Exact/approved aliases only — no fuzzy-name guessing. Alias changes never rewrite historical source text.

## 4. Current Ownership Baseline

| Metric | Count |
|---|---:|
| Customers total | 6,257 |
| Customers with salesperson | 5,830 |
| Customers without salesperson | 427 |
| Companies total | 3,520 |
| Companies with salesperson | 42 |
| Companies without salesperson | 3,478 |
| Orders with historical SP snapshot | 21,735 |
| Drafts with historical SP snapshot | 3,679 |
| Current CRM CG (cust/co) | **0** |
| Historical order CG snapshots | **124** |
| Customer referrer coverage | 5,834 |
| Company referrer coverage | 0 |

## 5. Ownership Evidence Model

Precedence (documented on candidates):

`UNIQUE_MANUAL` > `CURRENT_EXPLICIT_SOURCE` > `CONSISTENT_HISTORICAL_EXPLICIT` > `STRONG_INFERENCE` > `WEAK_INFERENCE` > `UNKNOWN`

Confidence remains **phase4c_v1**:

- EXPLICIT / HIGH / MEDIUM / LOW / CONFLICTING / NO_EVIDENCE
- Frequency/majority alone ≠ HIGH (e.g. 60/40 never HIGH)

## 6–8. Candidate Reclassification

Enrichment ran on all **1,353 PENDING** company candidates.

| Confidence | Phase 4C | Phase 5H after enrich |
|---|---:|---:|
| HIGH | 626 | **626** |
| MEDIUM | 588 | **588** |
| CONFLICTING | 139 | **139** |
| EXPLICIT | 0 | 0 |
| LOW | 0 | 0 |
| NO_EVIDENCE | (excluded from queue) | (excluded) |

**Material shift:** none — confidence unchanged (`confidence_unchanged=true`). Phase 5H added explanation, batches, distributions, material flags — **did not invent ownership**.

### Review batches

| Batch | Meaning | Count |
|---|---|---:|
| A | EXPLICIT / near-deterministic | 0 |
| B | HIGH | 626 |
| C | MEDIUM/LOW | 588 |
| D | CONFLICTING | 139 |
| E | NO_EVIDENCE | 0 in queue |

### Resolution classes

| Class | Count |
|---|---:|
| READY_FOR_APPROVAL | 626 |
| NEEDS_BUSINESS_REVIEW | 588 |
| CONFLICTING | 139 |

## 9. Review UX

`/backend/sales` → **Ownership approval**

Shows: entity, current/proposed owner, confidence, **explanation**, order/draft distribution, open AR/order/draft flags, last activity, conflicts.

Actions: APPROVE · REJECT · DEFER · MANUAL SELECT · single-row Approve & apply · **Preview selected (no apply)** · Export review pack.

Bulk “Approve & apply selected” removed. Bulk apply RPC gated.

## 10. Customer vs Company Ownership Semantics

**Status: BUSINESS_DECISION_REQUIRED**

Evidence: customers are heavily owned (5,830); companies mostly unowned (42 owned / 3,478 unowned). Model supports **independent ownership** with optional company-primary + customer exception — do **not** silently force equality.

Customers without company: ownership stays on customer. No fake companies.

## 11. Unowned Account Findings

Null owner ≠ bad data.

Classes: `UNOWNED_VALID` · `OWNERSHIP_REQUIRED` · `REVIEW_PENDING`

- Unowned companies with open AR: **121**
- Pending candidates with open AR: **121**
- Pending with open draft: **35**
- Pending with open order (unfulfilled/processing): **0**

Companies may lack primary contact / active customer — flagged for DATA_REVIEW; not deleted.

## 12–15. Sales Visibility / Dual Scope / Draft / AR

Revalidated policy (Phase 4C matrix unchanged):

- `sales_visibility=assigned` — server enforced; filters are convenience only
- Orders/drafts: **historical snapshot SP OR current CRM account owner**
- AR: labelled `current_crm` vs `order_snapshot`; filters must not alter canonical balances
- Historical snapshots immutable on reassignment

## 16–21. Sales Hub / Unowned / New Assignment / Reassignment / Deactivation

- Overview + ops dashboard metrics (customers, companies, recent orders, open drafts, AR accounts, trade pending, ownership workload) — **no leaderboards**
- New customer/company: deterministic auditable sources only; Flow-lite inference **off**
- Reassignment: owner/admin only + audit (old/new/source/actor/reason/time)
- Inactive staff with current CRM ownership → `REASSIGNMENT_REQUIRED` (no auto-reassign)
- Aliases remain separate from canonical identity

RPC: `rpc_admin_ownership_assignment_policy`, `rpc_admin_inactive_staff_ownership_report`, `rpc_admin_sales_ops_dashboard`

## 22–23. CG / Referrer

- CG: **HISTORICAL_ONLY / CURRENT_NOT_JUSTIFIED** — no mass backfill from ~124 order snapshots
- Referrer: separate; may be staff/customer/external — not forced through salesperson identity
- StoreName / Customer Type: not used as owner signals

## 24. Ownership Snapshot Semantics

- Historical Shopify order/draft SP snapshots: immutable
- Unique draft → order conversion: order inherits **draft** salesperson/CG/referrer at conversion (not live CRM owner if draft already differed)
- Unique-native checkout: should snapshot current CRM ownership at creation where wired
- Provenance on new assignments: UNIQUE_MANUAL / IMPORTED_EXPLICIT / APPROVED_BACKFILL / OTHER_VALID_SOURCE

## 25–28. Open AR / Orders / Drafts / Material Priority

Material priority = open AR (100) + open order (50) + open draft (25) + capped order count.

Business review pack: `rpc_admin_ownership_review_pack` (operational refs, no address/phone dump).

## 29–30. Controlled Apply

- Preview: `rpc_admin_preview_apply_ownership_candidates`
- Bulk apply: **blocked** unless `ownership_bulk_apply_authorized=true` (later human auth)
- No “apply all HIGH”
- Phase 5H executed **0** batch applies

## 31. UD Sales Portal Parity

Unique supports: staff identity, customer/company ownership, historical order/draft ownership, sales scope, AR scope, ownership review.

**Remaining portal dependency:** live Shopify store + UD Sales Portal until freeze — Unique is operationally ready for **internal** sales ops review, not a disconnect. Portal stays active.

## 32. Staff UAT Plan (future — no customer contact)

| Role | Scenarios |
|---|---|
| Salesperson | Find my customer/company; view order/draft/AR; create Unique draft; denied unrelated ID |
| Sales manager/admin | Reassign with reason; review batches A–D; preview apply |
| Finance | AR My Accounts current_crm vs order_snapshot labels; balances unchanged by SP filter |
| Owner/admin | Staff link; alias resolve; bulk apply gate remains false |

## 33. Support Runbook

| Issue | Handling |
|---|---|
| Wrong salesperson | Owner/admin reassign via Sales → CRM detail / reassignment RPC + reason |
| No owner | Classify UNOWNED_VALID vs OWNERSHIP_REQUIRED; use approval queue if candidate exists |
| Cannot see customer | Check admin↔staff link + `sales_visibility` + current owner |
| Historical order shows old SP | Expected — snapshot immutable; current CRM owner may differ |
| Customer/company owners conflict | Do not auto-equalise; BUSINESS_DECISION_REQUIRED |

No direct DB edit instructions for staff.

## 34. Cutover Control Centre

`/backend/cutover` domains **CRM** and **SALES / CRM OWNERSHIP** now evidence-backed via `crm_sales_cutover_readiness_status()` → **REVIEW_REQUIRED**.

## 35. Tests / Files Changed

- `supabase/migrations/20260908030042_phase5h_crm_ownership_cutover_readiness.sql`
- `src/admin/lib/adminRpc.ts`
- `src/admin/sales/AdminSalesHub.tsx`
- `src/admin/sales/AdminSalesPanels.tsx`
- `src/admin/sales/AdminSalesPhase4cPanels.tsx`
- `src/admin/sales/phase5hCrmOwnership.selftest.test.ts`
- `src/admin/cutover/AdminCutoverControlCentre.tsx`
- `docs/UD_COMMERCE_PHASE5H_CRM_OWNERSHIP_CUTOVER.md` (this file)

## 36. Remaining Ownership Decisions

1. Customer vs company primary ownership model (business)
2. Which of 626 HIGH to approve first (prefer open-AR material)
3. Resolve 139 CONFLICTING manually
4. 588 MEDIUM business review
5. ADMIN_LINK_REQUIRED for active sales staff who need Unique login
6. 3 UNKNOWN aliases
7. Unowned open-AR companies (121) — OWNERSHIP_REQUIRED vs valid unowned

## 37. Exact Human Approval Required

- Any CRM ownership **apply** (single or batch)
- Setting `ownership_bulk_apply_authorized=true` (later phase)
- Trade required / pilot / Worldpay / DPD / WMS enable / opening stock post
- Customer contact / activation emails

## 38. Recommended Phase 5I

**Phase 5I — Ownership Approval Execution & Sales Staff UAT** (suggested):

1. Owner-led review of Batch B (HIGH) material open-AR first — approve/reject/defer only
2. Controlled apply of **selected approved** rows (still no apply-all-HIGH)
3. Staff admin-link wave for active salespeople
4. Internal UAT dry-run (no customer contact)
5. Conflict resolution playbook for Batch D
6. Still no portal disconnect, no trade_required, no WMS enable

**DO NOT start Phase 5I automatically.**

---

## Confirmations

- NO CUSTOMER CONTACT
- PHASE4I_PILOT_001 = NOT_SENT
- pilot_send_authorized = false
- commercial_access_mode = catalogue_open
- trade_required_cutover_approved = false
- compliance_mode = observe
- Worldpay gateway_mode = disabled
- DPD carrier_mode = disabled
- wms_enabled = false
- catalogue_readiness = READY
- finance_readiness = REVIEW_REQUIRED
- wms_readiness = SHADOW_RECONCILED
- **NO OWNERSHIP BATCH AUTO-APPLIED**
- STOP FOR REVIEW
- DO NOT START PHASE 5I AUTOMATICALLY
- DO NOT CUT OVER
