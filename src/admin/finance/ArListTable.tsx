import { Link } from '@tanstack/react-router'
import type { AdminArReceivableRow } from '@/admin/lib/adminRpc'
import {
  agingBucketBadgeClass,
  agingBucketLabel,
  financeMoney,
  financialStatusBadgeClass,
  formatFinanceLabel,
  fmtFinanceDate,
} from '@/admin/lib/financeOps'
import { cn } from '@/lib/utils'

type Props = {
  rows: AdminArReceivableRow[]
  currencyFallback: string
}

export function ArListTable({ rows, currencyFallback }: Props) {
  return (
    <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
      <table className="min-w-[1400px] w-full border-collapse text-left text-sm">
        <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Order</th>
            <th className="px-3 py-2.5 font-semibold">Invoice</th>
            <th className="px-3 py-2.5 font-semibold">Date</th>
            <th className="px-3 py-2.5 font-semibold">Customer</th>
            <th className="px-3 py-2.5 font-semibold">Company</th>
            <th className="px-3 py-2.5 font-semibold">StoreName</th>
            <th className="px-3 py-2.5 font-semibold">Terms / due</th>
            <th className="px-3 py-2.5 font-semibold text-right">Original</th>
            <th className="px-3 py-2.5 font-semibold text-right">Paid</th>
            <th className="px-3 py-2.5 font-semibold text-right">Refunded</th>
            <th className="px-3 py-2.5 font-semibold text-right">Source outstanding</th>
            <th className="px-3 py-2.5 font-semibold">Aging</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">SP / CG</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const currency = String(row.currency || currencyFallback)
            const orderId = String(row.order_id || row.id)
            return (
              <tr
                key={String(row.id || orderId)}
                className="border-t border-[var(--admin-border)] hover:bg-[var(--admin-primary)]/[0.04]"
              >
                <td className="px-3 py-2 align-top">
                  <Link
                    to="/backend/orders/$orderId"
                    params={{ orderId }}
                    className="font-semibold text-[var(--admin-primary)] hover:underline"
                  >
                    {String(row.order_number || '—')}
                  </Link>
                  <div className="mt-0.5 text-[10px] text-[var(--admin-muted)]">
                    {formatFinanceLabel(String(row.source_system || ''))}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  {row.invoice_id ? (
                    <Link
                      to="/backend/finance/invoices/$invoiceId"
                      params={{ invoiceId: String(row.invoice_id) }}
                      className="text-[var(--admin-primary)] hover:underline"
                    >
                      {String(row.invoice_number || 'Invoice')}
                    </Link>
                  ) : (
                    <span className="text-[var(--admin-muted)]">{String(row.invoice_number || '—')}</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-[var(--admin-muted)]">
                  {fmtFinanceDate(row.order_date as string | null)}
                </td>
                <td className="px-3 py-2 align-top">
                  {row.customer_id ? (
                    <Link
                      to="/backend/customers/$customerId"
                      params={{ customerId: String(row.customer_id) }}
                      className="max-w-[140px] truncate font-medium text-[var(--admin-primary)] hover:underline"
                    >
                      {String(row.customer_name || '—')}
                    </Link>
                  ) : (
                    <div className="max-w-[140px] truncate font-medium">{String(row.customer_name || '—')}</div>
                  )}
                  <div className="max-w-[140px] truncate text-xs text-[var(--admin-muted)]">
                    {String(row.customer_email || '')}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  {row.company_id ? (
                    <Link
                      to="/backend/companies/$companyId"
                      params={{ companyId: String(row.company_id) }}
                      className="max-w-[120px] truncate text-[var(--admin-primary)] hover:underline"
                    >
                      {String(row.company_name || '—')}
                    </Link>
                  ) : (
                    <div className="max-w-[120px] truncate">{String(row.company_name || '—')}</div>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="max-w-[120px] truncate text-[var(--admin-muted)]">
                    {String(row.trading_name || '—')}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-xs">
                  <div>{String(row.payment_terms || '—')}</div>
                  <div className="text-[var(--admin-muted)]">Due {fmtFinanceDate(row.payment_due_on as string | null)}</div>
                  {row.days_overdue != null && Number(row.days_overdue) > 0 && (
                    <div className="font-medium text-rose-700">{Number(row.days_overdue)}d overdue</div>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-right tabular-nums">{financeMoney(row.total, currency)}</td>
                <td className="px-3 py-2 align-top text-right tabular-nums">{financeMoney(row.total_received, currency)}</td>
                <td className="px-3 py-2 align-top text-right tabular-nums">{financeMoney(row.total_refunded, currency)}</td>
                <td className="px-3 py-2 align-top text-right font-semibold tabular-nums text-amber-800">
                  {financeMoney(row.total_outstanding, currency)}
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      agingBucketBadgeClass(String(row.aging_bucket || '')),
                    )}
                  >
                    {agingBucketLabel(String(row.aging_bucket || ''))}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      financialStatusBadgeClass(String(row.financial_status || '')),
                    )}
                  >
                    {formatFinanceLabel(String(row.financial_status || ''))}
                  </span>
                </td>
                <td className="px-3 py-2 align-top text-xs leading-snug">
                  <div>{String(row.salesperson_name || '—')}</div>
                  <div className="text-[var(--admin-muted)]">CG: {String(row.cg_name || '—')}</div>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={14} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                No receivables match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
