/**
 * CRM operations helpers — filters, badges, money, version conflict.
 */
import { formatCurrency } from '@/lib/currency'

export type CrmCustomerListFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  last_order_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  last_order_from?: string
  last_order_to?: string
  customer_types?: string[]
  statuses?: string[]
  approval_statuses?: string[]
  source_systems?: string[]
  source_group?: 'shopify' | 'unique' | ''
  salesperson_id?: string
  cg_assigned_id?: string
  referrer_id?: string
  /** Server expands to current admin staff_member_id */
  mine_salesperson?: boolean
  unassigned_salesperson?: boolean
  company_id?: string
  has_company?: boolean | null
  has_orders?: boolean | null
  has_open_drafts?: boolean | null
  has_outstanding?: boolean
  min_lifetime?: string
  max_lifetime?: string
  payment_terms?: string
  tags?: string[]
  inactive_since?: string
}

export type CrmCompanyListFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  last_order_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  last_order_from?: string
  last_order_to?: string
  customer_types?: string[]
  statuses?: string[]
  source_systems?: string[]
  source_group?: 'shopify' | 'unique' | ''
  salesperson_id?: string
  cg_assigned_id?: string
  referrer_id?: string
  /** Server expands to current admin staff_member_id */
  mine_salesperson?: boolean
  unassigned_salesperson?: boolean
  has_contacts?: boolean | null
  has_orders?: boolean | null
  has_open_drafts?: boolean | null
  has_outstanding?: boolean
  min_lifetime?: string
  max_lifetime?: string
  payment_terms?: string
  tags?: string[]
  inactive_since?: string
}

export type CrmCustomerSort =
  | 'name_asc'
  | 'name_desc'
  | 'created_desc'
  | 'created_asc'
  | 'lifetime_desc'
  | 'lifetime_asc'
  | 'outstanding_desc'
  | 'last_order_desc'
  | 'updated_desc'

export type CrmCompanySort =
  | 'name_asc'
  | 'name_desc'
  | 'created_desc'
  | 'created_asc'
  | 'lifetime_desc'
  | 'lifetime_asc'
  | 'outstanding_desc'
  | 'last_order_desc'
  | 'updated_desc'

export const CRM_DATE_PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['custom', 'Custom'],
] as const

export function crmStatusBadgeClass(status: string | null | undefined) {
  const s = (status || '').toLowerCase()
  if (s === 'active') return 'bg-emerald-100 text-emerald-800'
  if (s === 'inactive' || s === 'disabled') return 'bg-slate-200 text-slate-700'
  if (s === 'blocked' || s === 'suspended') return 'bg-rose-100 text-rose-800'
  return 'bg-slate-100 text-slate-700'
}

export function crmApprovalBadgeClass(status: string | null | undefined) {
  const s = (status || '').toLowerCase()
  if (s === 'approved') return 'bg-emerald-100 text-emerald-800'
  if (s === 'pending') return 'bg-amber-100 text-amber-900'
  if (s === 'rejected' || s === 'declined') return 'bg-rose-100 text-rose-800'
  return 'bg-slate-100 text-slate-700'
}

export function crmSourceBadgeClass(source: string | null | undefined) {
  const s = (source || '').toLowerCase()
  if (s === 'unique') return 'bg-[var(--admin-primary)]/10 text-[var(--admin-primary)]'
  if (s === 'shopify') return 'bg-violet-100 text-violet-900'
  return 'bg-slate-100 text-slate-700'
}

export function formatCrmLabel(value: string | null | undefined) {
  if (!value) return '—'
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatCrmSourceLabel(source: string | null | undefined) {
  const s = (source || '').toLowerCase()
  if (s === 'unique') return 'Unique'
  if (s === 'shopify') return 'Shopify'
  if (!source) return '—'
  return formatCrmLabel(source)
}

export function isShopifyCrm(source: string | null | undefined) {
  return (source || '').toLowerCase() === 'shopify'
}

export function isUniqueCrm(source: string | null | undefined) {
  return (source || '').toLowerCase() === 'unique'
}

export function filtersToJson(
  filters: CrmCustomerListFilters | CrmCompanyListFilters,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

export function crmMoney(amount: unknown, currencyCode = 'GBP', locale = 'en-GB') {
  return formatCurrency(Number(amount ?? 0), {
    code: (currencyCode || 'GBP').trim().toUpperCase() || 'GBP',
    locale,
  })
}

export function fmtCrmDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function fmtCrmWhen(iso: string | null | undefined) {
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

export function isVersionConflict(error: unknown): boolean {
  return error instanceof Error && error.message === 'conflict'
}

export async function copyText(label: string, value: string) {
  await navigator.clipboard.writeText(value)
  return label
}
