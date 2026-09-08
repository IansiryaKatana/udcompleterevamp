/**
 * Draft order operations helpers — badges, labels, filter JSON, money.
 */
import { formatCurrency } from '@/lib/currency'

export type DraftListFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  statuses?: string[]
  source_systems?: string[]
  source_group?: 'shopify' | 'unique' | ''
  converted?: boolean | null
  overdue?: boolean
  customer_type?: string
  trading_name?: string
  salesperson_id?: string
  cg_assigned_id?: string
  referrer_id?: string
  /** Server expands to current admin staff_member_id (draft ownership snapshot) */
  mine_salesperson?: boolean
  customer_id?: string
  company_id?: string
  min_total?: string
  max_total?: string
  payment_due_from?: string
  payment_due_to?: string
  payment_terms?: string
  tags?: string[]
}

export type DraftSort =
  | 'date_desc'
  | 'date_asc'
  | 'total_desc'
  | 'total_asc'
  | 'name_asc'
  | 'updated_desc'

export const DRAFT_DATE_PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['custom', 'Custom'],
] as const

export function draftStatusBadgeClass(status: string | null | undefined) {
  const s = (status || '').toLowerCase()
  if (s === 'open') return 'bg-emerald-100 text-emerald-800'
  if (s === 'invoice_sent') return 'bg-sky-100 text-sky-900'
  if (s === 'completed') return 'bg-slate-200 text-slate-800'
  if (s === 'canceled' || s === 'cancelled') return 'bg-rose-100 text-rose-800'
  return 'bg-slate-100 text-slate-700'
}

export function draftSourceBadgeClass(source: string | null | undefined) {
  const s = (source || '').toLowerCase()
  if (s === 'unique') return 'bg-[var(--admin-primary)]/10 text-[var(--admin-primary)]'
  if (s === 'shopify') return 'bg-violet-100 text-violet-900'
  return 'bg-slate-100 text-slate-700'
}

export function formatDraftStatusLabel(status: string | null | undefined) {
  if (!status) return '—'
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatDraftSourceLabel(source: string | null | undefined) {
  const s = (source || '').toLowerCase()
  if (s === 'unique') return 'Unique'
  if (s === 'shopify') return 'Shopify'
  if (!source) return '—'
  return formatDraftStatusLabel(source)
}

export function isShopifyDraft(source: string | null | undefined) {
  return (source || '').toLowerCase() === 'shopify'
}

export function isUniqueDraft(source: string | null | undefined) {
  return (source || '').toLowerCase() === 'unique'
}

export function filtersToJson(filters: DraftListFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

export function draftMoney(amount: unknown, currencyCode: string, locale = 'en-GB') {
  return formatCurrency(Number(amount ?? 0), {
    code: (currencyCode || 'GBP').trim().toUpperCase() || 'GBP',
    locale,
  })
}

export function fmtDraftDate(iso: string | null | undefined) {
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

export function fmtDraftWhen(iso: string | null | undefined) {
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
