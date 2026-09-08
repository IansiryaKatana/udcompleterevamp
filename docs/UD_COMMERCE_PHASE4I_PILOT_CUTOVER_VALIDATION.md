# Phase 4I — Controlled pilot activation & commercial cutover validation

**Status:** COMPLETE — STOP FOR REVIEW  
**Migrations:** `20260907124158`, `20260907124230`, `20260907124310`  
**Selftest:** `rpc_phase4i_cutover_validation_selftest` **PASS**  
**Cutover precheck:** `rpc_admin_trade_required_cutover_precheck` **ok=true**, `cutover_allowed_now=false`  
**Emails sent this phase:** **0**

**Production mode:** `commercial_access_mode = catalogue_open`  
**Effective mode:** `catalogue_open` (double-gate enforced)  
**Cutover flag:** `trade_required_cutover_approved = false`  
**PILOT SEND STATUS:** **READY — OWNER APPROVAL REQUIRED**  
**Parked:** Worldpay / DPD / SKULabs / Warehouse / Phase 4C ownership (**1,353** pending)

---

## 1. Phase 4H Security Revalidation

| Gate | Result |
|---|---|
| Anon PostgREST `products.price` | **PASS** (0 rows) |
| Anon variant price | **PASS** (0 rows) |
| Bundle pricing protected | **PASS** (attack suite) |
| Wishlist / search / SSR / JSON-LD | **PASS** (prior + revalidation) |
| Force `trade_required` redaction | **PASS** (`price=null`, `price_restricted=true`) |
| Stale cart / checkout / forged IDs / PAY LATER | **PASS** (policy + prior 4G/4H) |
| `rpc_phase4h_postgrest_attack_selftest` | **PASS** |

No CRITICAL failure — pilot send remains approval-gated (not blocked by security).

---

## 2. Final PILOT Cohort

**Proposal key:** `PHASE4I_PILOT_001`  
**Count:** **12** (within 5–15)  
**Status:** proposed / draft batch prepared · **NOT SENT**

Diversified where safely available among PILOT_READY:

| Reason | Present |
|---|---|
| company_linked_owned | Yes (majority high-activity SureCust) |
| no_company_owned | Yes |
| company_linked_unowned | Yes |
| current PAY LATER eligible | Not in top PILOT_READY sample (none selected) |
| historical PAY LATER now false | Not represented in this ready set |

Ambiguous / duplicate-email / auth-linked records excluded.

---

## 3. PILOT Approval Status

```
PILOT SEND STATUS = READY — OWNER APPROVAL REQUIRED
pilot_send_authorized = false
activation_adhoc_send_enabled = false
emails_sent = 0
```

Owner must explicitly set `site_settings.pilot_send_authorized = true` (and approve the exact recipient list) before any real invitation email.

---

## 4. PILOT Batch

| Field | Value |
|---|---|
| batch_name | `PHASE4I_PILOT_001` |
| batch_id | `4698707a-c0b2-4f00-ad68-9e473f9dfb42` (draft; recreate if proposal refreshed) |
| recipient_count | 12 |
| send_status | **NOT_SENT** |
| tokens issued | false (deferred until approved send) |

Immutable conceptual batch name: **PHASE4I_PILOT_001**. Do not reuse for a later cohort.

---

## 5–14. Invitation / Redemption / Journey Results

**N/A — no owner send approval in this phase.**

Machinery ready:

- Secure invite generation (hash-only persistence, TTL, one-time, supersede)
- Edge `send-trade-activation` + RPC hard-gate `PILOT_SEND_OWNER_APPROVAL_REQUIRED`
- Admin UI Send invite disabled unless `pilot_send_authorized=true`
- Issue log table `pilot_activation_issues`

After a future approved send, validate: login → session → catalogue → price → variant/bundle → cart → quote → checkout **to payment boundary** (Worldpay stays disabled).

---

## 15–17. Pilot Issue Log / Success / Metrics

| Metric | Value |
|---|---|
| PROPOSED | 12 |
| APPROVED | 0 |
| SENT | 0 |
| ACTIVATED | 0 |
| FAILED / CONFLICT | 0 |
| SUCCESSFULLY VALIDATED | 0 |
| Issue log rows | 0 |

Success is **not** defined as “email sent”.

---

## 18–19. Merchant Feed Usage & Cutover Options

| Finding | Detail |
|---|---|
| Implementation | Service-role `rpc_merchant_feed_products` → `/feed/google-merchant.xml` |
| Price mode | `catalogue_open_only` |
| Under effective `trade_required` | **Prices omitted** |
| Usage classification | **LIKELY ACTIVE** (endpoint present for Google Merchant; no crawl logs inspected in-repo) |

**Options before production trade_required:**

| Option | Recommendation |
|---|---|
| **A. DISABLE FEED UNDER TRADE_REQUIRED** | Safest default if Merchant Center requires price |
| **B. Discovery without price** | Only if Google accepts empty price cells for this feed type |
| **C. Legitimate public MSRP** | Only if UD has a real separate public price — **do not fabricate** |
| **D. Other** | Authenticated feed / partner-only |

**Do not publish protected wholesale trade prices.**

---

## 20. SEO Cutover Playbook

Under `trade_required`:

- Keep products/collections crawlable (public catalogue)
- Keep canonical URLs + sitemap
- JSON-LD: Product entity OK; **Offer.price omitted** when restricted
- Expected SEO change: rich-result price eligibility may drop; product discovery retained

---

## 21. Final Shadow Results (`trade_required` eval)

| Persona | Price | Cart | Checkout | Quote | PAY LATER |
|---|---|---|---|---|---|
| anonymous | no | no | no | yes | no |
| auth_unlinked | no | no | no | yes | no |
| linked_pending | no | no | no | yes | no |
| approved | yes | yes | yes | yes | no |
| approved + PAY LATER false | yes | yes | yes | yes | no |
| approved + PAY LATER true | yes | yes | yes | yes | yes |
| suspended | no | no | no | yes | no |

Live remains `catalogue_open`.

---

## 22. Cutover Double-Gate Verification

`effective_commercial_access_mode()` returns `trade_required` **only if**:

1. `commercial_access_mode = trade_required` **AND**
2. `trade_required_cutover_approved = true`

Otherwise effective mode = `catalogue_open`.  
Force mode (`p_force_mode`) still allowed for shadow/tests.

**PASS** in selftest case `B_double_gate`.

---

## 23. Cutover Precheck

`rpc_admin_trade_required_cutover_precheck` — **non-cosmetic**; returns `ok=false` if mandatory PostgREST/attack gates fail.

Current: **ok=true**, **cutover_allowed_now=false** (Phase 4I never authorizes flip).

---

## 24. Production Cutover Procedure (DO NOT RUN NOW)

**T-24h**

1. Rerun `rpc_phase4h_postgrest_attack_selftest` + `rpc_admin_trade_required_cutover_precheck`
2. Resolve open pilot BLOCKER/HIGH issues
3. Confirm feed decision with marketing
4. Confirm kill switch SQL documented and staffed

**T-1h**

1. Smoke catalogue_open
2. Capture current `site_settings` values
3. Staff on watch for policy errors

**CUTOVER** (separate explicit approval phase)

1. Confirm precheck `ok=true`
2. Set `trade_required_cutover_approved = true`
3. Set `commercial_access_mode = trade_required`
4. Purge relevant caches
5. Smoke: anon price redacted; approved price visible; cart/checkout policy

**T+15m / T+1h** — control tests + denial/error review

---

## 25. Rollback Procedure

**Triggers:** price leak, broad approved-user block, auth/CRM mislink, checkout bypass, 5xx spike

```sql
UPDATE site_settings SET value = 'catalogue_open' WHERE key = 'commercial_access_mode';
UPDATE site_settings SET value = 'false' WHERE key = 'trade_required_cutover_approved';
```

**Retains:** trade statuses, auth links, activations, audit events, SureCust provenance.

---

## 26. Observability

Track aggregates: `PRICE_REDACTED`, `PURCHASE_DENIED`, `AUTH_UNLINKED`, `TRADE_PENDING`, `TRADE_SUSPENDED`, `CART_DENIED`, `CHECKOUT_DENIED`, `POLICY_ERROR`, activation failures, unexpected 5xx. Minimal PII.

---

## 27. Customer Support Playbook

| Customer says | Approved response path |
|---|---|
| Cannot log in | Reset via Auth; do not invent CRM links |
| Activation link expired | Admin: invalidate + new invite (after send authorization) |
| Cannot see prices | Check trade status + auth link + mode; do not paste SQL prices |
| Account pending | Trade approval workflow (owner/admin) |
| Wrong company | Flag for review — **no silent merge** |
| Cannot use PAY LATER | Eligibility is explicit; historical use ≠ grant |

No unsafe manual DB procedures for support.

---

## 28. Sales Team Playbook

- Salespeople see activation/commercial state for **assigned** accounts under existing RBAC
- Identity link / trade approval remain restricted
- **No** ownership candidate auto-apply (1,353 still pending review)

---

## 29. Next Activation Cohort — PREVIEW ONLY

| Tier | Preview count | Send |
|---|---|---|
| A (30d active approved, unlinked, unique email) | **697** | **NOT SENT** — requires new authorization |

---

## 30. Tests

| Suite | Result |
|---|---|
| `rpc_phase4i_cutover_validation_selftest` | PASS |
| `rpc_phase4h_postgrest_attack_selftest` | PASS |
| Cutover precheck | PASS (cutover not allowed) |
| Shadow matrix | PASS |
| Vitest Phase 4I | run with `.env` |

---

## 31. Migrations / Files Changed

- `supabase/migrations/20260907124158_phase4i_pilot_cutover_validation.sql`
- `supabase/migrations/20260907124230_phase4i_service_role_ops.sql`
- `supabase/migrations/20260907124310_phase4i_draft_batch_svc.sql`
- `supabase/functions/send-trade-activation/index.ts` (approval hard-gate)
- `src/admin/lib/adminRpc.ts`, `AdminAuthCutoverPanels.tsx`
- `src/admin/crm/phase4iPilotCutover.selftest.test.ts`
- `scripts/phase4i-verify.mjs`

---

## 32. Remaining Blockers

| Item | Status |
|---|---|
| Owner pilot-send approval | **Required** before any email |
| Real pilot journey validation | Blocked on send/redeem |
| Feed decision for trade_required | Business confirm |
| Phase 4C ownership 1,353 | Parked |
| Gateway / carrier / warehouse | Parked |

---

## 33. Exact Conditions To Authorize Production `trade_required`

All must be true:

1. Pilot invitations sent under owner approval
2. Pilot success criteria met (correct auth↔CRM↔company↔prices↔cart↔checkout boundary; no BLOCKER issues)
3. PostgREST + parity gates still PASS
4. Feed cutover option chosen and implemented
5. SEO/JSON-LD verified under restricted eval
6. Kill switch rehearsed
7. Observability live
8. Explicit dual write: `trade_required_cutover_approved=true` **and** `commercial_access_mode=trade_required`
9. Separate phase/approval (not Phase 4I)

---

## 34. Recommended Phase 4J

1. Owner-approved send of `PHASE4I_PILOT_001` (exact 12; no silent substitution)
2. Redeem + journey validation + issue log
3. Feed option lock-in
4. Only then: cutover rehearsal in staging / shadow sign-off for production flip authorization

---

## Sanitized cohort matrix (PHASE4I_PILOT_001)

| CUSTOMER REF | COMPANY | LAST ORDER | TRADE SOURCE | AUTH | SALES | PAY LATER | READY | REASON | BLOCKERS |
|---|---|---|---|---|---|---|---|---|---|
| 223d7616 | yes | 2026-09-04 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| ffb23582 | yes | 2026-09-02 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| 16201416 | yes | 2026-09-04 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| 1e4696d3 | yes | 2026-09-02 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| 0665868f | yes | 2026-09-03 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| 8a49c6b0 | yes | 2026-08-28 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| 01990816 | no | 2026-09-01 | shopify_surecust | unlinked | yes | false | yes | no_company_owned | — |
| a2552127 | yes | 2026-08-03 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| db809e8d | yes | 2026-09-01 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| e4bc0add | yes | 2026-09-03 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| ad4419c0 | yes | 2026-09-04 | shopify_surecust | unlinked | yes | false | yes | company_linked_owned | — |
| 6afaeab4 | yes | 2026-06-29 | shopify_surecust | unlinked | no | false | yes | company_linked_unowned | — |

---

## End state (mandatory)

```
commercial_access_mode = catalogue_open
trade_required_cutover_approved = false
effective_commercial_access_mode = catalogue_open
PILOT SEND STATUS = READY — OWNER APPROVAL REQUIRED
```

**STOP FOR REVIEW.**  
Do **not** activate `trade_required`.  
Do **not** send mass activation.  
Do **not** start Phase 4J automatically.  
Do **not** enable Worldpay, DPD, SKULabs, or warehouse ops.
