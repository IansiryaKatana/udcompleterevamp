/**
 * Phase 3A fulfilment / shipping helpers — filters, badges, permissions, packing slip.
 * Inventory is NOT mutated by fulfilment ops (deduction remains on payment).
 */

export type FulfilmentWorkspaceFilters = {
  search?: string
  date_preset?: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom' | ''
  date_from?: string
  date_to?: string
  fulfillment_statuses?: string[]
  delivery?:
    | 'tracking_missing'
    | 'tracking_present'
    | 'not_dispatched'
    | 'in_transit'
    | 'out_for_delivery'
    | 'delivered'
    | 'failed'
    | 'returned'
    | ''
  carrier?: string
  location_id?: string
  include_test?: boolean
  salesperson_id?: string
  company_id?: string
  customer_id?: string
}

export type FulfilmentWorkspaceSort = 'date_desc' | 'date_asc' | 'order_asc' | 'status_asc'

export type ManualFulfilmentLineInput = {
  order_item_id: string
  quantity: number
}

export function fulfilmentFiltersToJson(filters: FulfilmentWorkspaceFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

export function newFulfilmentIdempotencyKey(prefix = 'ff') {
  return `${prefix}-${crypto.randomUUID()}`
}

/** Client-side role gate only — server RPCs enforce capabilities. */
export function canMutateFulfilment(role: string | null | undefined) {
  return role === 'owner' || role === 'admin' || role === 'editor'
}

export function deliveryStatusBadgeClass(status: string | null | undefined) {
  const s = (status || '').toUpperCase()
  if (s === 'DELIVERED') return 'bg-emerald-100 text-emerald-800'
  if (s === 'OUT_FOR_DELIVERY' || s === 'IN_TRANSIT' || s === 'TRACKING_ADDED') return 'bg-sky-100 text-sky-900'
  if (s === 'FAILED' || s === 'RETURNED' || s === 'NOT_DELIVERED') return 'bg-rose-100 text-rose-800'
  if (s === 'UNKNOWN') return 'bg-amber-100 text-amber-900'
  return 'bg-slate-100 text-slate-700'
}

export function formatFulfilmentLabel(status: string | null | undefined) {
  if (!status) return '—'
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function inventoryBoundaryNote() {
  return 'Inventory is reserved at checkout and deducted on payment. Creating a fulfilment does not decrement stock again.'
}

export const WORLDPAY_UNCHANGED_NOTE =
  'Worldpay gateway_mode is unchanged by fulfilment ops (Phase 2F product gate still applies).'

export function buildPackingSlipPrintHtml(args: {
  orderNumber: string
  customerLabel: string
  shippingAddress: string
  lines: { sku: string; name: string; qty: number; fulfilledQty?: number }[]
  fulfilmentRef?: string
  siteName?: string
}) {
  const escape = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const rows = args.lines
    .map(
      (l) => `<tr>
      <td>${escape(l.sku || '—')}</td>
      <td>${escape(l.name)}</td>
      <td style="text-align:right">${l.qty}</td>
      <td style="text-align:right">${l.fulfilledQty ?? '—'}</td>
    </tr>`,
    )
    .join('')
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<title>Packing slip ${escape(args.orderNumber)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:32px;color:#111}
  h1{font-size:22px;margin:0 0 8px}
  .meta{color:#555;font-size:13px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{border-bottom:1px solid #ddd;padding:8px;font-size:13px;text-align:left}
  th{font-size:11px;text-transform:uppercase;color:#666}
  address{white-space:pre-line;font-style:normal}
</style></head><body>
  <h1>Packing slip</h1>
  <p class="meta">${escape(args.siteName || 'Unique Distribution')} · Order ${escape(args.orderNumber)}
  ${args.fulfilmentRef ? ` · Fulfilment ${escape(args.fulfilmentRef)}` : ''}</p>
  <p><strong>Customer:</strong> ${escape(args.customerLabel || '—')}</p>
  ${args.shippingAddress ? `<p><strong>Ship to:</strong><br /><address>${escape(args.shippingAddress)}</address></p>` : ''}
  <table>
    <thead><tr><th>SKU</th><th>Item</th><th style="text-align:right">Ordered</th><th style="text-align:right">This fulfilment</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="meta" style="margin-top:24px">Operational document — no pricing.</p>
</body></html>`
}

export function openHtmlDocument(html: string, title: string) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.document.title = title
  return true
}
