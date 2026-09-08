import { Link } from '@tanstack/react-router'
import type { AdminCrmCustomerListRow } from '@/admin/lib/adminRpc'
import {
  crmApprovalBadgeClass,
  crmMoney,
  crmSourceBadgeClass,
  crmStatusBadgeClass,
  formatCrmLabel,
  formatCrmSourceLabel,
  fmtCrmDate,
} from '@/admin/lib/crmOps'
import { cn } from '@/lib/utils'

type Props = {
  rows: AdminCrmCustomerListRow[]
  currencyFallback: string
}

export function CustomerListTable({ rows, currencyFallback }: Props) {
  return (
    <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
      <table className="min-w-[1200px] w-full border-collapse text-left text-sm">
        <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Customer</th>
            <th className="px-3 py-2.5 font-semibold">StoreName</th>
            <th className="px-3 py-2.5 font-semibold">Company</th>
            <th className="px-3 py-2.5 font-semibold">Type</th>
            <th className="px-3 py-2.5 font-semibold">SP / CG / Ref</th>
            <th className="px-3 py-2.5 font-semibold">Source</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold text-right">Orders</th>
            <th className="px-3 py-2.5 font-semibold text-right">Lifetime</th>
            <th className="px-3 py-2.5 font-semibold text-right">Outstanding</th>
            <th className="px-3 py-2.5 font-semibold">Last order</th>
            <th className="px-3 py-2.5 font-semibold">Terms</th>
            <th className="px-3 py-2.5 font-semibold">Tags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-t border-[var(--admin-border)] hover:bg-[var(--admin-primary)]/[0.04]"
            >
              <td className="px-3 py-2 align-top">
                <Link
                  to="/backend/customers/$customerId"
                  params={{ customerId: row.id }}
                  className="font-semibold text-[var(--admin-primary)] hover:underline"
                >
                  {row.display_name ||
                    [row.first_name, row.last_name].filter(Boolean).join(' ') ||
                    row.email ||
                    'Customer'}
                </Link>
                <div className="mt-0.5 max-w-[160px] truncate text-xs text-[var(--admin-muted)]">
                  {row.email || row.phone || '—'}
                </div>
              </td>
              <td className="px-3 py-2 align-top">
                <div className="max-w-[120px] truncate text-[var(--admin-muted)]">
                  {row.trading_name || '—'}
                </div>
              </td>
              <td className="px-3 py-2 align-top">
                {(() => {
                  const companies = Array.isArray(row.companies) ? row.companies : []
                  const first = companies[0]
                  const companyId = row.primary_company_id || first?.id
                  const companyName = row.primary_company_name || first?.name
                  if (!companyId) {
                    return <span className="text-[var(--admin-muted)]">—</span>
                  }
                  return (
                    <Link
                      to="/backend/companies/$companyId"
                      params={{ companyId: String(companyId) }}
                      className="max-w-[120px] truncate text-[var(--admin-primary)] hover:underline"
                    >
                      {companyName || 'Company'}
                      {companies.length > 1 ? ` +${companies.length - 1}` : ''}
                    </Link>
                  )
                })()}
              </td>
              <td className="px-3 py-2 align-top text-xs">{row.customer_type || '—'}</td>
              <td className="px-3 py-2 align-top text-xs leading-snug">
                <div>{row.salesperson_name || '—'}</div>
                <div className="text-[var(--admin-muted)]">CG: {row.cg_name || '—'}</div>
                <div className="text-[var(--admin-muted)]">Ref: {row.referrer_name || '—'}</div>
              </td>
              <td className="px-3 py-2 align-top">
                <span
                  className={cn(
                    'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    crmSourceBadgeClass(row.source_system),
                  )}
                >
                  {formatCrmSourceLabel(row.source_system)}
                </span>
              </td>
              <td className="px-3 py-2 align-top">
                <div className="flex flex-col gap-0.5">
                  <span
                    className={cn(
                      'inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      crmStatusBadgeClass(row.status),
                    )}
                  >
                    {formatCrmLabel(row.status)}
                  </span>
                  {row.approval_status && (
                    <span
                      className={cn(
                        'inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        crmApprovalBadgeClass(row.approval_status),
                      )}
                    >
                      {formatCrmLabel(row.approval_status)}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 align-top text-right tabular-nums">{row.order_count ?? 0}</td>
              <td className="px-3 py-2 align-top text-right font-medium tabular-nums">
                {crmMoney(row.lifetime_total, currencyFallback)}
              </td>
              <td className="px-3 py-2 align-top text-right tabular-nums">
                <span className={Number(row.total_outstanding) > 0 ? 'font-semibold text-amber-800' : ''}>
                  {crmMoney(row.total_outstanding, currencyFallback)}
                </span>
              </td>
              <td className="px-3 py-2 align-top whitespace-nowrap text-xs">
                {fmtCrmDate(row.last_order_at)}
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
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={13} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                No customers match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
