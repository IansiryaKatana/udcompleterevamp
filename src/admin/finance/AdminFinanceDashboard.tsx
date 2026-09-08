import { useCallback, useEffect, useState } from 'react'
import { AdminRelatedLink } from '@/admin/components/AdminRelatedLink'
import { toast } from 'sonner'
import {
  fetchAdminArAgingSummary,
  fetchAdminFinanceDashboard,
  type AdminFinanceDashboard,
} from '@/admin/lib/adminRpc'
import {
  AGING_BUCKET_LABELS,
  agingBucketBadgeClass,
  financeMoney,
  filtersToJson,
  FINANCE_DATE_PRESETS,
  type FinanceAgingBucket,
  type FinanceDashboardFilters,
} from '@/admin/lib/financeOps'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'
import { cn } from '@/lib/utils'

const EMPTY: FinanceDashboardFilters = { date_preset: 'this_month' }

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--admin-text)]">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--admin-muted)]">{hint}</p> : null}
    </div>
  )
}

export function AdminFinanceDashboard() {
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings).code || 'GBP'
  const [filters, setFilters] = useState<FinanceDashboardFilters>(EMPTY)
  const [dash, setDash] = useState<AdminFinanceDashboard | null>(null)
  const [aging, setAging] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const f = filtersToJson(filters)
      const [d, a] = await Promise.all([
        fetchAdminFinanceDashboard(f),
        fetchAdminArAgingSummary(f),
      ])
      setDash(d)
      setAging((a.buckets as Record<string, number>) || (d.aging as Record<string, number>) || {})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load finance dashboard')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const money = (n: unknown) => financeMoney(n, currency)
  const top = (dash?.top_outstanding as Record<string, unknown>[]) || []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Finance</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Accounts receivable · payments · invoices · statements
          </p>
        </div>
        <AdminRelatedLink to="/backend/finance/receivables">Open receivables</AdminRelatedLink>
      </div>

      <FinanceSubNav />

      <div className="flex flex-wrap items-end gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] p-4">
        <div className="w-full sm:w-48">
          <label className={adminLabel}>Period</label>
          <BrandedSelect
            value={filters.date_preset || 'this_month'}
            onValueChange={(v) => setFilters((f) => ({ ...f, date_preset: v as FinanceDashboardFilters['date_preset'] }))}
            options={FINANCE_DATE_PRESETS.map(([value, label]) => ({ value, label }))}
          />
        </div>
        {filters.date_preset === 'custom' && (
          <>
            <div>
              <label className={adminLabel}>From</label>
              <input
                type="date"
                className={adminInput}
                value={filters.date_from || ''}
                onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
              />
            </div>
            <div>
              <label className={adminLabel}>To</label>
              <input
                type="date"
                className={adminInput}
                value={filters.date_to || ''}
                onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
              />
            </div>
          </>
        )}
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {loading && !dash ? (
        <AdminLoadingState />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Metric label="Total outstanding" value={money(dash?.total_outstanding)} hint="Open AR balance" />
            <Metric label="Overdue outstanding" value={money(dash?.overdue_outstanding)} hint="Past due date" />
            <Metric label="Due today" value={money(dash?.due_today)} />
            <Metric label="Due this week" value={money(dash?.due_this_week)} />
            <Metric label="Current / not overdue" value={money(dash?.current_ar)} />
            <Metric label="Unpaid orders" value={Number(dash?.unpaid_order_count ?? 0).toLocaleString()} />
            <Metric
              label="Partially paid orders"
              value={Number(dash?.partially_paid_order_count ?? 0).toLocaleString()}
            />
            <Metric label="Paid orders" value={Number(dash?.paid_order_count ?? 0).toLocaleString()} />
            <Metric
              label="Payments received (period)"
              value={money(dash?.payments_received_period)}
              hint={`${Number(dash?.payments_count_period ?? 0).toLocaleString()} txs`}
            />
            <Metric
              label="Refunds (period)"
              value={money(dash?.refunds_total)}
              hint={`${Number(dash?.refunds_count ?? 0).toLocaleString()} refunds`}
            />
            <Metric
              label="Invoices issued (period)"
              value={Number(dash?.invoices_issued_period ?? 0).toLocaleString()}
            />
          </div>

          <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text)]">
              AR aging
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(Object.keys(AGING_BUCKET_LABELS) as FinanceAgingBucket[]).map((bucket) => (
                <div
                  key={bucket}
                  className="min-w-[140px] rounded border border-[var(--admin-border)] px-3 py-2"
                >
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      agingBucketBadgeClass(bucket),
                    )}
                  >
                    {AGING_BUCKET_LABELS[bucket]}
                  </span>
                  <p className="mt-1.5 text-sm font-semibold tabular-nums">
                    {money(aging[bucket] ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text)]">
                Highest outstanding
              </h2>
              <Link
                to="/backend/finance/receivables"
                className="text-xs font-medium text-[var(--admin-primary)] hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--admin-muted)]">
                  <tr>
                    <th className="px-2 py-2">Customer / company</th>
                    <th className="px-2 py-2 text-right">Outstanding</th>
                    <th className="px-2 py-2 text-right">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((row, i) => (
                    <tr key={String(row.id || row.company_id || row.customer_id || i)} className="border-t border-[var(--admin-border)]">
                      <td className="px-2 py-2">
                        <div className="font-medium">
                          {String(row.company_name || row.customer_name || row.name || '—')}
                        </div>
                        <div className="text-xs text-[var(--admin-muted)]">
                          {String(row.email || row.trading_name || '')}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-amber-800">
                        {money(row.total_outstanding ?? row.outstanding)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {Number(row.open_count ?? row.open_receivable_count ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {top.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-8 text-center text-[var(--admin-muted)]">
                        No outstanding balances in this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
