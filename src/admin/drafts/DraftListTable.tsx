import { Link } from '@tanstack/react-router'
import type { AdminDraftListRow } from '@/admin/lib/adminRpc'
import {
  draftMoney,
  draftSourceBadgeClass,
  draftStatusBadgeClass,
  formatDraftSourceLabel,
  formatDraftStatusLabel,
  fmtDraftDate,
} from '@/admin/lib/draftOps'
import { cn } from '@/lib/utils'

type Props = {
  rows: AdminDraftListRow[]
  currencyFallback: string
}

export function DraftListTable({ rows, currencyFallback }: Props) {
  return (
    <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
      <table className="min-w-[1300px] w-full border-collapse text-left text-sm">
        <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Draft</th>
            <th className="px-3 py-2.5 font-semibold">Date</th>
            <th className="px-3 py-2.5 font-semibold">Customer</th>
            <th className="px-3 py-2.5 font-semibold">Company</th>
            <th className="px-3 py-2.5 font-semibold">StoreName</th>
            <th className="px-3 py-2.5 font-semibold">SP / CG / Ref</th>
            <th className="px-3 py-2.5 font-semibold">Type</th>
            <th className="px-3 py-2.5 font-semibold">Source</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Converted</th>
            <th className="px-3 py-2.5 font-semibold text-right">Total</th>
            <th className="px-3 py-2.5 font-semibold text-right">Qty</th>
            <th className="px-3 py-2.5 font-semibold">Due</th>
            <th className="px-3 py-2.5 font-semibold">Terms</th>
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
                    to="/backend/drafts/$draftId"
                    params={{ draftId: row.id }}
                    className="font-semibold text-[var(--admin-primary)] hover:underline"
                  >
                    {row.name || 'Untitled draft'}
                  </Link>
                  {row.po_number && (
                    <div className="mt-0.5 text-[10px] text-[var(--admin-muted)]">PO {row.po_number}</div>
                  )}
                </td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-[var(--admin-muted)]">
                  {fmtDraftDate(row.draft_date)}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="max-w-[140px] truncate font-medium">{row.customer_name || '—'}</div>
                  <div className="max-w-[140px] truncate text-xs text-[var(--admin-muted)]">
                    {row.customer_email || row.email || '—'}
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
                <td className="px-3 py-2 align-top">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      draftSourceBadgeClass(row.source_system),
                    )}
                  >
                    {formatDraftSourceLabel(row.source_system)}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      draftStatusBadgeClass(row.status),
                    )}
                  >
                    {formatDraftStatusLabel(row.status)}
                  </span>
                </td>
                <td className="px-3 py-2 align-top text-xs">
                  {row.converted_order_id ? (
                    <Link
                      to="/backend/orders/$orderId"
                      params={{ orderId: row.converted_order_id }}
                      className="font-medium text-[var(--admin-primary)] hover:underline"
                    >
                      {row.converted_order_number || 'Order'}
                    </Link>
                  ) : (
                    <span className="text-[var(--admin-muted)]">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-right font-medium tabular-nums">
                  {draftMoney(row.total_price, currency)}
                </td>
                <td className="px-3 py-2 align-top text-right tabular-nums">{row.item_quantity}</td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-xs">
                  {fmtDraftDate(row.payment_due_on)}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="max-w-[100px] truncate text-xs text-[var(--admin-muted)]">
                    {row.payment_terms || '—'}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex max-w-[140px] flex-wrap gap-0.5">
                    {(row.tags ?? []).slice(0, 3).map((t) => (
                      <span key={t} className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-700">
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
              <td colSpan={15} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                No drafts match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
