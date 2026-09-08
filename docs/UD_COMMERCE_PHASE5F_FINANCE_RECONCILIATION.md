# Phase 5F — Finance Reconciliation & Cutover Balance Closure

**Status:** COMPLETE — STOP FOR REVIEW  
**Not a cutover. No customer contact.**

## Locked state (unchanged)

| Gate | Value |
|---|---|
| PHASE4I_PILOT_001 | NOT_SENT |
| pilot_send_authorized | false |
| commercial_access_mode | catalogue_open |
| trade_required_cutover_approved | false |
| compliance_mode | observe |
| Worldpay gateway_mode | disabled |
| DPD carrier_mode | disabled |
| wms_enabled | false |
| catalogue_readiness | READY |

## 1. Current finance baseline (recalculated)

| Metric | Value |
|---|---:|
| Orders | 21,772 |
| Order total | £26,332,702.98 |
| Received snapshot | £23,706,207.70 |
| Outstanding snapshot | £1,107,359.59 |
| Payment transactions | 34,430 |
| Refund headers | 3,774 |
| Refund lines | 23,918 |

## 2. Exception counts (fresh)

| Exception | Count |
|---|---:|
| OUTSTANDING_MISMATCH | 2,741 |
| NEGATIVE_OUTSTANDING | 437 |
| RECEIVED_EXCEEDS_TOTAL | 51 |
| TX_EXCEEDS_TOTAL | 51 |
| PAID_ZERO_RECEIVED | 9 |
| REFUND_MISMATCH (header without SUCCESS refund tx) | 2,785 |
| OTHER | 0 |

Review queue rows classified: **2,757** (mismatch universe + paid-zero + overlaps).

## 3–12. Findings summary

### Three views (preserved)

- **A. Imported source** — `orders.source_*` immutable  
- **B. Calculated ledger** — `finance_calculate_order_ledger` (PENDING ≠ received)  
- **C. Reconciliation** — `finance_reconciliation_reviews` + append-only notes  

### Classification distribution

| Classification | Count |
|---|---:|
| REFUND_TIMING | 917 |
| PAYMENT_TIMING | 779 |
| LEGACY_MANUAL_WORKFLOW | 551 |
| SOURCE_INCONSISTENCY | 501 |
| INSUFFICIENT_EVIDENCE | 9 |

### Patterns

| Pattern | Count |
|---|---:|
| PAIDISH_OUT0_RECV_LT_TOTAL | 1,740 |
| OUT0_RECV0_TOTAL_GT0 | 485 |
| NEG_OUT | 437 |
| OUT_NE_TOTAL_MINUS_RECV | 70 |
| RECV_GT_TOTAL | 16 |
| PAID_ZERO_RECEIVED | 9 |

### Payment semantics

Revalidated: Worldpay SALE SUCCESS = received; Bank Deposit / PAY LATER PENDING ≠ received; manual/cash SUCCESS = received. No semantic code defect required a source rewrite. Ledger now also exposes `raw_outstanding_unclamped` (negatives not silently discarded from evidence).

### Worldpay / Bank / PAY LATER / Manual

- Worldpay: 10,173 SUCCESS / 1,181 FAILURE / 148 refund SUCCESS — failures correctly non-cash.  
- Bank Deposit: 9,749 SUCCESS + 6,772 PENDING — PENDING never counted as received.  
- PAY LATER: 1,971 PENDING + 983 VOID + 10 SUCCESS — historical finance only; eligibility untouched.  
- Manual/cash: SUCCESS posts are cash; PAID-with-incomplete-tx classified, not fabricated.

### Refunds

Most mismatch rows with refund headers lack SUCCESS refund payment txs → `ZERO_CASH_RESTOCK_STYLE` (2,696). REFUND ≠ RETURN ≠ RESTOCK cash.

### Rounding

Tolerance **£0.02** (`finance_money_tolerance_gbp`). WITHIN_TOLERANCE vs MATERIAL_VARIANCE.

### Calculation / import defects

- **No Systematic Unique calculation defect** found that required rewriting historical source.  
- **No import repair batch** applied (forensic source did not yield objective missing money pages for these mismatches — they are Shopify snapshot arithmetic inconsistencies / workflow timing).  
- Test/synthetic Unique orders with bad cache arithmetic → LEGACY_MANUAL_WORKFLOW.

## 13–20. Ops artefacts

- Review queue table + RPCs: `rpc_admin_finance_review_queue`, `rpc_admin_finance_review_decision`  
- Statuses: UNREVIEWED / EXPLAINED / ACCEPTED_SOURCE_VARIANCE / REQUIRES_ACTION / RESOLVED_BY_CODE_FIX  
- Severity: INFO … CRITICAL (26 CRITICAL, 301 HIGH unreviewed)  
- Admin UI: `/backend/finance` reconciliation page uses queue filters  

## 21. Opening AR model

Per-order rule (not a global pick):

1. **REVIEWED_OUTSTANDING** if finance decision set  
2. **CALCULATED** for `unique_ledger`  
3. **SOURCE** when source arithmetic consistent  
4. Closed Shopify (PAID/VOIDED/REFUNDED, out≈0) → **SOURCE 0** — do **not** inflate collectible AR from formula gaps  
5. Else retain source open AR or calculated with **review required**

Preview sums (mismatch queue): source open ~£1.14M; calculated on mismatches ~£1.67M; opening preview ~£0.69M; unreviewed HIGH+CRITICAL = 327.

## 22. Due dates

`payment_due_on` null: **21,711** → aging bucket **NO_DUE_DATE**. No backfill.

## 23–24. Customer/company

Open source AR without company: **155** orders / **£316,856.93**. Without customer: **5**. Flagged collection risk only — no CRM merges.

## 25–26. Xero / invoices

Xero unresolved; Unique owns operational AR. Invoice prefix remains **UD-INV-TEST-** (production numbering blocker for legal invoicing).

## 27. Cutover snapshot design

Table `finance_cutover_balance_snapshots` — **T-0 not executed**.

## 28–30. Delta / manual / new Unique

- `rpc_phase5f_reconcile_order_delta(order_id)` for incremental classify  
- Unique-native manual path unchanged; selftest proves native order reconciles with **no historical-style variance**

## 31–32. Documents / AR reporting

Balance basis helper `finance_document_balance_basis`. AR list labels **Source outstanding**. Invoice detail notes operational vs recon basis.

## 33–34. Cutover FINANCE readiness

`/backend/cutover` FINANCE = **REVIEW_REQUIRED**  
Reason: Unreviewed CRITICAL=26 HIGH=301; material abs ≈ £1.17M.

Criteria: READY / READY_WITH_ACCEPTED_VARIANCES / REVIEW_REQUIRED / BLOCKED.

## 35–36. Material exposure

| Measure | Value |
|---|---:|
| Absolute formula mismatch | £1,521,183.44 |
| Net mismatch | −£1,521,183.44 |
| Unreviewed HIGH+CRITICAL abs | £1,172,746.06 |

Top sanitized exceptions include SH-12788807401798 (£55,722.72), SH-13198040957254 (£36,000), etc. — see queue (order refs only).

## 37–40. Locks

Catalogue READY; WMS/gateway/carrier disabled; pilot NOT_SENT; compliance observe.

## 41. Tests

- SQL `rpc_phase5f_finance_selftest` → **14/14 pass**  
- Vitest `phase5fFinanceReconciliation.selftest.test.ts`  
- Catalogue light check READY  

## 42. Remaining blockers / Phase 5G

**Finance blockers before cutover:**

1. Finance review of CRITICAL/HIGH queue (esp. PAID-zero-received and large OUT0 gaps)  
2. Business acceptance of SOURCE_INCONSISTENCY / restock-style refunds  
3. Opening AR freeze decision at T-0  
4. Production invoice numbering decision  
5. Xero/statutory boundary confirmation (non-blocking for operational AR)

**Recommended Phase 5G:** CRM/ownership + commercial activation readiness (still no pilot send), or fulfilment/WMS opening-stock simulation — **only after finance review accepts variances**. Do **not** auto-start 5G.

---

**STOP FOR REVIEW. DO NOT CUT OVER. NO CUSTOMER CONTACT.**
