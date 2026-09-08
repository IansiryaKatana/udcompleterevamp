/**
 * Finance / AR helpers — filters, aging labels, money, badges, permissions.
 */
import { formatCurrency } from '@/lib/currency'

export type FinanceAgingBucket =
  | 'current'
  | '1_30'
  | '31_60'
  | '61_90'
  | '91_plus'
  | 'no_due_date'

export type ArListFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  due_preset?: 'overdue' | 'due_today' | 'due_this_week' | 'custom' | ''
  due_from?: string
  due_to?: string
  aging_buckets?: FinanceAgingBucket[]
  financial_statuses?: string[]
  source_systems?: string[]
  source_group?: 'shopify' | 'unique' | ''
  customer_id?: string
  company_id?: string
  salesperson_id?: string
  cg_assigned_id?: string
  referrer_id?: string
  /** Server expands to current admin staff_member_id */
  mine_salesperson?: boolean
  /**
   * AR ownership basis:
   * - current_crm (default): company/customer current salesperson
   * - order_snapshot: historical order salesperson
   */
  ownership_basis?: 'current_crm' | 'order_snapshot' | ''
  payment_terms?: string
  min_outstanding?: string
  max_outstanding?: string
  has_invoice?: boolean | null
  overdue_only?: boolean
}

export type ArListSort =
  | 'outstanding_desc'
  | 'outstanding_asc'
  | 'due_asc'
  | 'due_desc'
  | 'date_desc'
  | 'date_asc'
  | 'order_asc'
  | 'aging_desc'

export type PaymentListFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  kinds?: string[]
  statuses?: string[]
  gateways?: string[]
  payment_methods?: string[]
  source_systems?: string[]
  source_group?: 'shopify' | 'unique' | ''
  order_id?: string
  customer_id?: string
  company_id?: string
  min_amount?: string
  max_amount?: string
  unique_native_only?: boolean
  reversals_only?: boolean
}

export type PaymentListSort =
  | 'date_desc'
  | 'date_asc'
  | 'amount_desc'
  | 'amount_asc'
  | 'processed_desc'

export type RefundListFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  order_id?: string
  customer_id?: string
  company_id?: string
  source_systems?: string[]
  min_amount?: string
  max_amount?: string
}

export type InvoiceListFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  statuses?: string[]
  provenance?: string[]
  customer_id?: string
  company_id?: string
  order_id?: string
  source_systems?: string[]
}

export type StatementListFilters = {
  search?: string
  customer_id?: string
  company_id?: string
  date_from?: string
  date_to?: string
}

export type FinanceDashboardFilters = {
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  source_group?: 'shopify' | 'unique' | ''
}

export type ManualPaymentMethod = 'bank_transfer' | 'bank_deposit' | 'cash' | 'other'

export const MANUAL_PAYMENT_METHODS: { value: ManualPaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'bank_deposit', label: 'Bank deposit' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
]

export const FINANCE_DATE_PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['custom', 'Custom'],
] as const

export const AGING_BUCKET_LABELS: Record<FinanceAgingBucket, string> = {
  current: 'Current / not due',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  '91_plus': '91+ days',
  no_due_date: 'No due date',
}

export const FINANCE_SUBNAV: { to: string; label: string; exact?: boolean }[] = [
  { to: '/backend/finance', label: 'Dashboard', exact: true },
  { to: '/backend/finance/receivables', label: 'Receivables' },
  { to: '/backend/finance/payments', label: 'Payments' },
  { to: '/backend/finance/refunds', label: 'Refunds' },
  { to: '/backend/finance/invoices', label: 'Invoices' },
  { to: '/backend/finance/statements', label: 'Statements' },
  { to: '/backend/finance/reconciliation', label: 'Reconciliation' },
]

/** Owner/admin may mutate finance; editors/viewers are view-only on the client. */
export function canMutateFinance(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export function agingBucketLabel(bucket: string | null | undefined) {
  if (!bucket) return '—'
  return AGING_BUCKET_LABELS[bucket as FinanceAgingBucket] ?? formatFinanceLabel(bucket)
}

export function agingBucketBadgeClass(bucket: string | null | undefined) {
  const b = (bucket || '').toLowerCase()
  if (b === 'current') return 'bg-emerald-100 text-emerald-800'
  if (b === '1_30') return 'bg-amber-100 text-amber-900'
  if (b === '31_60') return 'bg-orange-100 text-orange-900'
  if (b === '61_90' || b === '91_plus') return 'bg-rose-100 text-rose-800'
  if (b === 'no_due_date') return 'bg-slate-200 text-slate-700'
  return 'bg-slate-100 text-slate-700'
}

export function financialStatusBadgeClass(status: string | null | undefined) {
  const s = (status || '').toUpperCase()
  if (s === 'PAID') return 'bg-emerald-100 text-emerald-800'
  if (s === 'PARTIALLY_PAID' || s === 'PENDING' || s === 'AUTHORIZED') return 'bg-amber-100 text-amber-900'
  if (s === 'PARTIALLY_REFUNDED' || s === 'REFUNDED') return 'bg-sky-100 text-sky-900'
  if (s === 'VOIDED' || s === 'FAILED') return 'bg-rose-100 text-rose-800'
  return 'bg-slate-100 text-slate-700'
}

export function paymentKindBadgeClass(kind: string | null | undefined) {
  const k = (kind || '').toUpperCase()
  if (k === 'SALE' || k === 'CAPTURE' || k === 'PAYMENT') return 'bg-emerald-100 text-emerald-800'
  if (k === 'REFUND') return 'bg-sky-100 text-sky-900'
  if (k === 'VOID' || k === 'AUTHORIZATION') return 'bg-amber-100 text-amber-900'
  return 'bg-slate-100 text-slate-700'
}

export function paymentStatusBadgeClass(status: string | null | undefined) {
  const s = (status || '').toLowerCase()
  if (s === 'success' || s === 'successful' || s === 'completed') return 'bg-emerald-100 text-emerald-800'
  if (s === 'pending' || s === 'processing') return 'bg-amber-100 text-amber-900'
  if (s === 'failure' || s === 'failed' || s === 'error') return 'bg-rose-100 text-rose-800'
  if (s === 'reversed') return 'bg-slate-200 text-slate-700'
  return 'bg-slate-100 text-slate-700'
}

export function invoiceStatusBadgeClass(status: string | null | undefined) {
  const s = (status || '').toLowerCase()
  if (s === 'paid') return 'bg-emerald-100 text-emerald-800'
  if (s === 'partial' || s === 'issued') return 'bg-amber-100 text-amber-900'
  if (s === 'void' || s === 'cancelled') return 'bg-rose-100 text-rose-800'
  if (s === 'draft') return 'bg-slate-200 text-slate-700'
  return 'bg-slate-100 text-slate-700'
}

export function provenanceBadgeClass(provenance: string | null | undefined) {
  const p = (provenance || '').toLowerCase()
  if (p === 'unique_native') return 'bg-[var(--admin-primary)]/10 text-[var(--admin-primary)]'
  if (p === 'reconstructed_from_order') return 'bg-amber-100 text-amber-900'
  if (p === 'imported_original') return 'bg-violet-100 text-violet-900'
  return 'bg-slate-100 text-slate-700'
}

export function reconciliationFlagBadgeClass(severity: string | null | undefined) {
  const s = (severity || '').toLowerCase()
  if (s === 'high' || s === 'critical') return 'bg-rose-100 text-rose-800'
  if (s === 'medium' || s === 'warn') return 'bg-amber-100 text-amber-900'
  return 'bg-slate-100 text-slate-700'
}

export function formatFinanceLabel(value: string | null | undefined) {
  if (!value) return '—'
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatPaymentMethodLabel(method: string | null | undefined) {
  const hit = MANUAL_PAYMENT_METHODS.find((m) => m.value === method)
  if (hit) return hit.label
  return formatFinanceLabel(method)
}

export function financeMoney(amount: unknown, currencyCode = 'GBP', locale = 'en-GB') {
  return formatCurrency(Number(amount ?? 0), {
    code: (currencyCode || 'GBP').trim().toUpperCase() || 'GBP',
    locale,
  })
}

export function fmtFinanceDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    const d = iso.length <= 10 ? new Date(`${iso}T12:00:00`) : new Date(iso)
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function fmtFinanceWhen(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function filtersToJson(
  filters:
    | ArListFilters
    | PaymentListFilters
    | RefundListFilters
    | InvoiceListFilters
    | StatementListFilters
    | FinanceDashboardFilters,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

export function isFinanceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg === 'conflict' ||
    msg.includes('stale') ||
    msg.includes('outstanding changed') ||
    msg.includes('expected_outstanding')
  )
}

export function isOverpaymentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return msg.includes('overpayment') || msg.includes('exceeds outstanding') || msg.includes('greater than outstanding')
}

export function newIdempotencyKey(prefix = 'fin') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** Phase 2E: live Worldpay actions blocked client-side regardless of DB gate. */
export const GATEWAY_LIVE_ACTIONS_DISABLED = true

export const WORLDPAY_DISABLED_MESSAGE =
  'Worldpay gateway is disabled (gateway_mode=disabled). Production gateway calls are blocked in Phase 2E — use manual payment posting for bank/cash.'

export type ReconciliationStatus =
  | 'MATCHED'
  | 'MISMATCHED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'REVIEWED_ACCEPTED'
  | 'REVIEWED_CORRECTED_BY_UNIQUE_EVENT'

export type LedgerBoundary = {
  ok?: boolean
  money_ledger_mode?: string | null
  reconciliation_status?: ReconciliationStatus | string | null
  imported?: {
    total?: number | null
    received?: number | null
    outstanding?: number | null
    financial_status?: string | null
  }
  calculated?: {
    received?: number | null
    refunded?: number | null
    net_received?: number | null
    outstanding?: number | null
    financial_status?: string | null
    pending_external?: number | null
    authorized_available?: number | null
  }
  variance?: {
    received?: number | null
    outstanding?: number | null
  }
  rule?: string | null
}

export type GatewayGate = {
  ok?: boolean
  mode?: string
  allowed?: boolean
  error?: string
  environment?: string
  note?: string
}

export function formatReconciliationStatus(status: string | null | undefined): string {
  if (!status) return '—'
  const labels: Record<string, string> = {
    MATCHED: 'Matched',
    MISMATCHED: 'Mismatched',
    INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
    REVIEWED_ACCEPTED: 'Reviewed — accepted',
    REVIEWED_CORRECTED_BY_UNIQUE_EVENT: 'Reviewed — corrected by Unique event',
  }
  return labels[status] ?? formatFinanceLabel(status)
}

export function reconciliationStatusBadgeClass(status: string | null | undefined): string {
  const s = (status || '').toUpperCase()
  if (s === 'MATCHED' || s === 'REVIEWED_ACCEPTED') return 'bg-emerald-100 text-emerald-800'
  if (s === 'MISMATCHED') return 'bg-amber-100 text-amber-900'
  if (s === 'INSUFFICIENT_EVIDENCE') return 'bg-slate-200 text-slate-700'
  if (s === 'REVIEWED_CORRECTED_BY_UNIQUE_EVENT') return 'bg-sky-100 text-sky-900'
  return 'bg-slate-100 text-slate-700'
}

export function ledgerBoundaryLabel(mode: string | null | undefined): string {
  if (mode === 'imported_snapshot') return 'Imported snapshot (Shopify historical)'
  if (mode === 'unique_ledger') return 'Unique ledger (payment transactions)'
  return formatFinanceLabel(mode)
}

export function formatGatewayGateMessage(gate: GatewayGate | null | undefined): string {
  if (!gate) return WORLDPAY_DISABLED_MESSAGE
  if (gate.error === 'gateway_disabled') {
    return 'Gateway mode is disabled — outbound capture/void/refund blocked.'
  }
  if (gate.error === 'production_gateway_blocked_phase_2e') {
    return 'Production gateway blocked in Phase 2E.'
  }
  if (gate.allowed) {
    return `Gateway test mode permitted (${gate.environment ?? 'test'}). Adapter may still return not_configured.`
  }
  return gate.error ? formatFinanceLabel(gate.error) : WORLDPAY_DISABLED_MESSAGE
}
