import { Link } from '@tanstack/react-router'
import type { AdminOrderListRow } from '@/admin/lib/adminRpc'
import { financialBadgeClass, fulfillmentBadgeClass, formatStatusLabel } from '@/admin/lib/orderOps'
import { formatCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'

type Props = {
  rows: AdminOrderListRow[]
  currencyFallback: string
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export function OrderListTable({ rows, currencyFallback }: Props) {
  return (
    <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
      <table className="min-w-[1400px] w-full border-collapse text-left text-sm">
        <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Order</th>
            <th className="px-3 py-2.5 font-semibold">Date</th>
            <th className="px-3 py-2.5 font-semibold">Customer</th>
            <th className="px-3 py-2.5 font-semibold">Company</th>
            <th className="px-3 py-2.5 font-semibold">StoreName</th>
            <th className="px-3 py-2.5 font-semibold">SP / CG / Ref</th>
            <th className="px-3 py-2.5 font-semibold">Type</th>
            <th className="px-3 py-2.5 font-semibold">Source</th>
            <th className="px-3 py-2.5 font-semibold">Payment</th>
            <th className="px-3 py-2.5 font-semibold text-right">Outstanding</th>
            <th className="px-3 py-2.5 font-semibold">Fulfilment</th>
            <th className="px-3 py-2.5 font-semibold">Tracking</th>
            <th className="px-3 py-2.5 font-semibold text-right">Total</th>
            <th className="px-3 py-2.5 font-semibold text-right">Qty</th>
            <th className="px-3 py-2.5 font-semibold">Ship</th>
            <th className="px-3 py-2.5 font-semibold">Due</th>
            <th className="px-3 py-2.5 font-semibold">Tags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const currency = row.currency || currencyFallback
            return (
              <tr
                key={row.id}
                className="border-t border-[var(--admin-border)] hover:bg-[var(--admin-primary)]/[0.04]"
              >
                <td className="px-3 py-2 align-top">
                  <Link
                    to="/backend/orders/$orderId"
                    params={{ orderId: row.id }}
                    className="font-semibold text-[var(--admin-primary)] hover:underline"
                  >
                    {row.order_number}
                  </Link>
                  {row.from_draft && (
                    <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--admin-muted)]">
                      From draft
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-[var(--admin-muted)]">
                  {fmtDate(row.order_date)}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="max-w-[140px] truncate font-medium">{row.customer_name || '—'}</div>
                  <div className="max-w-[140px] truncate text-xs text-[var(--admin-muted)]">
                    {row.customer_email || row.email}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="max-w-[120px] truncate">{row.company_name || '—'}</div>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="max-w-[120px] truncate text-[var(--admin-muted)]">
                    {row.trading_name_snapshot || '—'}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-xs leading-snug">
                  <div>{row.salesperson_name || '—'}</div>
                  <div className="text-[var(--admin-muted)]">CG: {row.cg_name || '—'}</div>
                  <div className="text-[var(--admin-muted)]">Ref: {row.referrer_name || '—'}</div>
                </td>
                <td className="px-3 py-2 align-top text-xs">{row.customer_type_snapshot || '—'}</td>
                <td className="px-3 py-2 align-top text-xs">{row.order_source || '—'}</td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      financialBadgeClass(row.financial_status),
                    )}
                  >
                    {formatStatusLabel(row.financial_status)}
                  </span>
                </td>
                <td className="px-3 py-2 align-top text-right tabular-nums">
                  {Number(row.total_outstanding) > 0 ? (
                    <span className="font-medium text-amber-800">
                      {formatCurrency(Number(row.total_outstanding), currency)}
                    </span>
                  ) : (
                    <span className="text-[var(--admin-muted)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      fulfillmentBadgeClass(row.commerce_fulfillment_status),
                    )}
                  >
                    {formatStatusLabel(row.commerce_fulfillment_status)}
                  </span>
                </td>
                <td className="px-3 py-2 align-top text-xs">
                  {row.has_tracking ? (
                    <span className="text-emerald-700">Yes</span>
                  ) : (
                    <span className="text-[var(--admin-muted)]">No</span>
                  )}
                  {(row.dpd_delivery_status || row.delivery_status) && (
                    <div className="mt-0.5 max-w-[90px] truncate text-[var(--admin-muted)]">
                      {row.dpd_delivery_status || row.delivery_status}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-right font-medium tabular-nums">
                  {formatCurrency(Number(row.total), currency)}
                </td>
                <td className="px-3 py-2 align-top text-right tabular-nums">{row.item_quantity}</td>
                <td className="px-3 py-2 align-top">
                  <div className="max-w-[100px] truncate text-xs text-[var(--admin-muted)]">
                    {row.shipping_method || '—'}
                  </div>
                </td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-xs">{fmtDate(row.payment_due_on)}</td>
                <td className="px-3 py-2 align-top">
                  <div className="flex max-w-[140px] flex-wrap gap-0.5">
                    {(row.tags ?? []).slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700"
                      >
                        {t}
                      </span>
                    ))}
                    {(row.tags?.length ?? 0) > 3 && (
                      <span className="text-[10px] text-[var(--admin-muted)]">+{row.tags.length - 3}</span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={17} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                No orders match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
