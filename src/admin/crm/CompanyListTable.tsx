import { Link } from '@tanstack/react-router'
import type { AdminCrmCompanyListRow } from '@/admin/lib/adminRpc'
import {
  crmMoney,
  crmSourceBadgeClass,
  crmStatusBadgeClass,
  formatCrmLabel,
  formatCrmSourceLabel,
  fmtCrmDate,
} from '@/admin/lib/crmOps'
import { cn } from '@/lib/utils'

type Props = {
  rows: AdminCrmCompanyListRow[]
  currencyFallback: string
}

export function CompanyListTable({ rows, currencyFallback }: Props) {
  return (
    <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
      <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
        <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Company</th>
            <th className="px-3 py-2.5 font-semibold">Trading</th>
            <th className="px-3 py-2.5 font-semibold">Type</th>
            <th className="px-3 py-2.5 font-semibold">SP / CG / Ref</th>
            <th className="px-3 py-2.5 font-semibold">Source</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold text-right">Contacts</th>
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
                  to="/backend/companies/$companyId"
                  params={{ companyId: row.id }}
                  className="font-semibold text-[var(--admin-primary)] hover:underline"
                >
                  {row.name}
                </Link>
                {row.legal_name && row.legal_name !== row.name && (
                  <div className="mt-0.5 max-w-[160px] truncate text-[10px] text-[var(--admin-muted)]">
                    {row.legal_name}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                <div className="max-w-[120px] truncate text-[var(--admin-muted)]">
                  {row.trading_name || '—'}
                </div>
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
                <span
                  className={cn(
                    'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    crmStatusBadgeClass(row.status),
                  )}
                >
                  {formatCrmLabel(row.status)}
                </span>
              </td>
              <td className="px-3 py-2 align-top text-right tabular-nums">{row.contact_count ?? 0}</td>
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
                No companies match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
