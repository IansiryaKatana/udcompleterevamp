import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { getAdminCrmFinanceSummary } from '@/admin/lib/adminRpc'
import {
  agingBucketBadgeClass,
  agingBucketLabel,
  financeMoney,
  fmtFinanceWhen,
} from '@/admin/lib/financeOps'
import { cn } from '@/lib/utils'

type Props = {
  entityType: 'customer' | 'company'
  entityId: string
  currency?: string
}

export function CrmFinanceSummary({ entityType, entityId, currency = 'GBP' }: Props) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getAdminCrmFinanceSummary>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getAdminCrmFinanceSummary(entityType, entityId)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Finance summary unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [entityType, entityId])

  if (error) {
    return (
      <p className="text-sm text-[var(--admin-muted)]">
        Finance summary unavailable ({error}).{' '}
        <Link to="/backend/finance" className="text-[var(--admin-primary)] hover:underline">
          Open Finance →
        </Link>
      </p>
    )
  }

  if (!data) {
    return <p className="text-sm text-[var(--admin-muted)]">Loading finance summary…</p>
  }

  const aging = (data.aging as Record<string, number>) || {}
  const invoices = data.recent_invoices || []
  const payments = data.recent_payments || []

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Outstanding</p>
          <p className="font-semibold tabular-nums text-amber-800">
            {financeMoney(data.total_outstanding, currency)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Overdue</p>
          <p className="font-semibold tabular-nums text-rose-800">
            {financeMoney(data.overdue_amount, currency)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Open receivables</p>
          <p className="font-semibold tabular-nums">{Number(data.open_receivable_count ?? 0)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Last payment</p>
          <p className="text-sm">
            {data.last_payment_at
              ? `${financeMoney(data.last_payment_amount, currency)} · ${fmtFinanceWhen(data.last_payment_at)}`
              : '—'}
          </p>
        </div>
      </div>

      {Object.keys(aging).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(aging).map(([bucket, amount]) => (
            <span
              key={bucket}
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                agingBucketBadgeClass(bucket),
              )}
            >
              {agingBucketLabel(bucket)} {financeMoney(amount, currency)}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          to="/backend/finance/receivables"
          className="font-medium text-[var(--admin-primary)] hover:underline"
        >
          Receivables →
        </Link>
        <Link
          to="/backend/finance/payments"
          className="font-medium text-[var(--admin-primary)] hover:underline"
        >
          Payments →
        </Link>
        <Link
          to="/backend/finance/invoices"
          className="font-medium text-[var(--admin-primary)] hover:underline"
        >
          Invoices →
        </Link>
        <Link
          to="/backend/finance/statements"
          className="font-medium text-[var(--admin-primary)] hover:underline"
        >
          Statements →
        </Link>
      </div>

      {(invoices.length > 0 || payments.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 text-xs">
          {invoices.length > 0 && (
            <div>
              <p className="mb-1 font-semibold uppercase text-[var(--admin-muted)]">Recent invoices</p>
              <ul className="space-y-1">
                {invoices.slice(0, 3).map((inv) => (
                  <li key={String(inv.id)}>
                    <Link
                      to="/backend/finance/invoices/$invoiceId"
                      params={{ invoiceId: String(inv.id) }}
                      className="text-[var(--admin-primary)] hover:underline"
                    >
                      {String(inv.invoice_number || inv.id.slice(0, 8))}
                    </Link>{' '}
                    · {financeMoney(inv.outstanding ?? inv.total, currency)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {payments.length > 0 && (
            <div>
              <p className="mb-1 font-semibold uppercase text-[var(--admin-muted)]">Recent payments</p>
              <ul className="space-y-1">
                {payments.slice(0, 3).map((pay) => (
                  <li key={String(pay.id)}>
                    <Link
                      to="/backend/finance/payments/$paymentId"
                      params={{ paymentId: String(pay.id) }}
                      className="text-[var(--admin-primary)] hover:underline"
                    >
                      {String(pay.id).slice(0, 8)}…
                    </Link>{' '}
                    · {financeMoney(pay.amount, currency)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
