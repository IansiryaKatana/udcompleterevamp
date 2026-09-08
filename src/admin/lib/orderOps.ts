/**
 * Order operations helpers — badges, labels, limited-history copy.
 */
export type OrderListFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  financial_statuses?: string[]
  fulfillment_statuses?: string[]
  order_sources?: string[]
  source_group?: 'web' | 'draft' | 'pos' | 'sales_portal' | ''
  outstanding_gt_0?: boolean
  overdue?: boolean
  has_draft?: boolean | null
  delivery?: 'tracking_present' | 'no_tracking' | 'in_transit' | 'delivered' | ''
  customer_type?: string
  trading_name?: string
  salesperson_id?: string
  cg_assigned_id?: string
  referrer_id?: string
  /** Server expands to current admin staff_member_id (historical order snapshot) */
  mine_salesperson?: boolean
  customer_id?: string
  company_id?: string
  min_total?: string
  max_total?: string
  payment_due_from?: string
  payment_due_to?: string
  tags?: string[]
}

export type OrderSort =
  | 'date_desc'
  | 'date_asc'
  | 'total_desc'
  | 'total_asc'
  | 'outstanding_desc'
  | 'number_asc'

export function financialBadgeClass(status: string | null | undefined) {
  const s = (status || '').toUpperCase()
  if (s === 'PAID') return 'bg-emerald-100 text-emerald-800'
  if (s === 'PARTIALLY_PAID' || s === 'PENDING') return 'bg-amber-100 text-amber-900'
  if (s === 'PARTIALLY_REFUNDED' || s === 'REFUNDED') return 'bg-sky-100 text-sky-900'
  if (s === 'VOIDED' || s === 'FAILED') return 'bg-rose-100 text-rose-800'
  return 'bg-slate-100 text-slate-700'
}

export function fulfillmentBadgeClass(status: string | null | undefined) {
  const s = (status || '').toUpperCase()
  if (s === 'FULFILLED' || s === 'DELIVERED' || s === 'SHIPPED') return 'bg-emerald-100 text-emerald-800'
  if (s === 'PARTIALLY_FULFILLED' || s === 'PROCESSING' || s === 'ON_HOLD') return 'bg-amber-100 text-amber-900'
  return 'bg-slate-100 text-slate-700'
}

export function formatStatusLabel(status: string | null | undefined) {
  if (!status) return '—'
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function isCreditNoteYes(value: string | null | undefined) {
  if (!value) return false
  return value.trim().toLowerCase() === 'yes'
}

/**
 * Sparse timelines on older orders usually reflect Shopify retention limits,
 * not extraction pagination. Pagination incompleteness is a separate defect
 * (events.hasNextPage) and is repaired via raw_repairs/order_events.
 */
export function limitedHistoryMessage(eventCount: number, orderDateIso: string | null | undefined) {
  if (eventCount > 5) return null
  if (!orderDateIso) {
    return 'Older Shopify history may be limited by platform retention — this is not a pagination gap.'
  }
  const ageMs = Date.now() - new Date(orderDateIso).getTime()
  const days = ageMs / (1000 * 60 * 60 * 24)
  if (days > 90 || eventCount === 0) {
    return 'Older Shopify history may be limited by platform retention — this is not a pagination gap.'
  }
  return null
}

export function filtersToJson(filters: OrderListFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

export async function copyText(label: string, value: string) {
  await navigator.clipboard.writeText(value)
  return label
}
