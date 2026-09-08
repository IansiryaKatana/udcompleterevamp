import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { listAdminFinanceRefunds, type AdminFinanceRefundRow } from '@/admin/lib/adminRpc'
import {
  WORLDPAY_DISABLED_MESSAGE,
  filtersToJson,
  financeMoney,
  formatFinanceLabel,
  fmtFinanceWhen,
  FINANCE_DATE_PRESETS,
  type RefundListFilters,
} from '@/admin/lib/financeOps'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'
import { cn } from '@/lib/utils'

const EMPTY: RefundListFilters = {}

export function AdminRefundsWorkspace() {
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings).code || 'GBP'
  const [rows, setRows] = useState<AdminFinanceRefundRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<RefundListFilters>(EMPTY)
  const [debounced, setDebounced] = useState<RefundListFilters>(EMPTY)
  const [sort, setSort] = useState('date_desc')
  const [selected, setSelected] = useState<AdminFinanceRefundRow | null>(null)
  const pagination = useAdminTablePagination(total, 20)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(filters)
      pagination.resetPage()
    }, 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listAdminFinanceRefunds({
        limit: pagination.pageSize,
        offset: pagination.start,
        sort,
        filters: filtersToJson(debounced),
      })
      setRows(result.items)
      setTotal(result.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load refunds')
    } finally {
      setLoading(false)
    }
  }, [pagination.pageSize, pagination.start, sort, debounced])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Refunds</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Read-only historical refunds · {total.toLocaleString()} matching
        </p>
      </div>
      <FinanceSubNav />

      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Live gateway refunds are disabled. {WORLDPAY_DISABLED_MESSAGE}
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] p-4 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <label className={adminLabel}>Search</label>
          <input
            className={adminInput}
            placeholder="Order #, customer, note…"
            value={filters.search ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>
        <div className="w-full sm:w-44">
          <label className={adminLabel}>Period</label>
          <BrandedSelect
            value={filters.date_preset || ''}
            onValueChange={(v) => setFilters((f) => ({ ...f, date_preset: v as RefundListFilters['date_preset'] }))}
            options={[{ value: '', label: 'Any' }, ...FINANCE_DATE_PRESETS.map(([value, label]) => ({ value, label }))]}
          />
        </div>
        <div className="w-full sm:w-44">
          <label className={adminLabel}>Sort</label>
          <BrandedSelect
            value={sort}
            onValueChange={setSort}
            options={[
              { value: 'date_desc', label: 'Date (newest)' },
              { value: 'date_asc', label: 'Date (oldest)' },
              { value: 'amount_desc', label: 'Amount (high)' },
            ]}
          />
        </div>
        <button
          type="button"
          className={adminBtnSecondary}
          onClick={() => {
            setFilters(EMPTY)
            setSort('date_desc')
            pagination.resetPage()
          }}
        >
          Reset
        </button>
      </div>

      {loading ? (
        <AdminLoadingState />
      ) : (
        <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
          <table className="min-w-[960px] w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Refund</th>
                <th className="px-3 py-2.5 font-semibold">Order</th>
                <th className="px-3 py-2.5 font-semibold">Customer / company</th>
                <th className="px-3 py-2.5 font-semibold text-right">Amount</th>
                <th className="px-3 py-2.5 font-semibold">When</th>
                <th className="px-3 py-2.5 font-semibold">Source</th>
                <th className="px-3 py-2.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'cursor-pointer border-t border-[var(--admin-border)] hover:bg-[var(--admin-primary)]/[0.04]',
                    selected?.id === row.id && 'bg-[var(--admin-primary)]/[0.06]',
                  )}
                  onClick={() => setSelected(row)}
                >
                  <td className="px-3 py-2 font-medium">{row.id.slice(0, 8)}…</td>
                  <td className="px-3 py-2">
                    {row.order_id ? (
                      <Link
                        to="/backend/orders/$orderId"
                        params={{ orderId: String(row.order_id) }}
                        className="text-[var(--admin-primary)] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {String(row.order_number || row.order_id.slice(0, 8))}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div>{String(row.customer_name || '—')}</div>
                    <div className="text-xs text-[var(--admin-muted)]">{String(row.company_name || '')}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {financeMoney(row.total_refunded, String(row.currency || currency))}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                    {fmtFinanceWhen(String(row.source_created_at || row.created_at || ''))}
                  </td>
                  <td className="px-3 py-2 text-xs">{formatFinanceLabel(String(row.source_system || ''))}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-xs text-[var(--admin-muted)]">
                    {String(row.note || '—')}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    No refunds match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-4 text-sm">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Refund detail</h2>
            <button type="button" className={adminBtnSecondary} onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p className="mt-2 text-[var(--admin-muted)]">
            Cash refund amount and merchandise line totals are separate concepts — do not force equality.
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Amount</dt>
              <dd className="font-semibold tabular-nums">
                {financeMoney(selected.total_refunded, String(selected.currency || currency))}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Note</dt>
              <dd>{String(selected.note || '—')}</dd>
            </div>
          </dl>
          <button type="button" className={`${adminBtnSecondary} mt-4`} disabled title={WORLDPAY_DISABLED_MESSAGE}>
            Issue live refund
          </button>
        </div>
      )}

      <AdminTablePagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalItems={total}
        totalPages={pagination.totalPages}
        hasPrev={pagination.hasPrev}
        hasNext={pagination.hasNext}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
      />
    </div>
  )
}
