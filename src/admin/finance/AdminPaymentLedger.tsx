import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { listAdminPaymentTransactions, type AdminPaymentTxRow } from '@/admin/lib/adminRpc'
import {
  canMutateFinance,
  filtersToJson,
  financeMoney,
  formatFinanceLabel,
  formatPaymentMethodLabel,
  fmtFinanceWhen,
  paymentKindBadgeClass,
  paymentStatusBadgeClass,
  type PaymentListFilters,
  type PaymentListSort,
} from '@/admin/lib/financeOps'
import { PaymentListFilters as FiltersPanel } from '@/admin/finance/PaymentListFilters'
import { AdminManualPaymentForm } from '@/admin/finance/AdminManualPaymentForm'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { adminBtnPrimary } from '@/admin/adminClassNames'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'
import { cn } from '@/lib/utils'

const EMPTY: PaymentListFilters = {}

export function AdminPaymentLedger() {
  const { role } = useAdminAuth()
  const canMutate = canMutateFinance(role)
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings).code || 'GBP'
  const [rows, setRows] = useState<AdminPaymentTxRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<PaymentListFilters>(EMPTY)
  const [debounced, setDebounced] = useState<PaymentListFilters>(EMPTY)
  const [sort, setSort] = useState<PaymentListSort>('date_desc')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualOrderId, setManualOrderId] = useState('')
  const [manualOutstanding, setManualOutstanding] = useState(0)
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
      const result = await listAdminPaymentTransactions({
        limit: pagination.pageSize,
        offset: pagination.start,
        sort,
        filters: filtersToJson(debounced),
      })
      setRows(result.items)
      setTotal(result.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load payments')
    } finally {
      setLoading(false)
    }
  }, [pagination.pageSize, pagination.start, sort, debounced])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Payments</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Transaction ledger · {total.toLocaleString()} matching
          </p>
        </div>
        {canMutate && (
          <button
            type="button"
            className={adminBtnPrimary}
            onClick={() => {
              const oid = window.prompt('Order UUID to post against:')
              if (!oid?.trim()) return
              const outstandingRaw = window.prompt('Current outstanding (for concurrency check):', '0')
              const outstanding = Number(outstandingRaw)
              if (!Number.isFinite(outstanding) || outstanding < 0) {
                toast.error('Invalid outstanding amount')
                return
              }
              setManualOrderId(oid.trim())
              setManualOutstanding(outstanding)
              setManualOpen(true)
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Post manual payment
          </button>
        )}
      </div>

      <FinanceSubNav />

      <FiltersPanel
        filters={filters}
        sort={sort}
        onChange={setFilters}
        onSortChange={(s) => {
          setSort(s)
          pagination.resetPage()
        }}
        onReset={() => {
          setFilters(EMPTY)
          setSort('date_desc')
          pagination.resetPage()
        }}
      />

      {loading ? (
        <AdminLoadingState />
      ) : (
        <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
          <table className="min-w-[1200px] w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Payment</th>
                <th className="px-3 py-2.5 font-semibold">Order</th>
                <th className="px-3 py-2.5 font-semibold">Customer / company</th>
                <th className="px-3 py-2.5 font-semibold">Kind</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Gateway / method</th>
                <th className="px-3 py-2.5 font-semibold text-right">Amount</th>
                <th className="px-3 py-2.5 font-semibold">When</th>
                <th className="px-3 py-2.5 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cur = String(row.currency || currency)
                return (
                  <tr key={row.id} className="border-t border-[var(--admin-border)] hover:bg-[var(--admin-primary)]/[0.04]">
                    <td className="px-3 py-2 align-top">
                      <Link
                        to="/backend/finance/payments/$paymentId"
                        params={{ paymentId: row.id }}
                        className="font-semibold text-[var(--admin-primary)] hover:underline"
                      >
                        {row.id.slice(0, 8)}…
                      </Link>
                      {row.payment_id && (
                        <div className="mt-0.5 max-w-[140px] truncate text-[10px] text-[var(--admin-muted)]">
                          ref {String(row.payment_id)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {row.order_id ? (
                        <Link
                          to="/backend/orders/$orderId"
                          params={{ orderId: String(row.order_id) }}
                          className="text-[var(--admin-primary)] hover:underline"
                        >
                          {String(row.order_number || row.order_id.slice(0, 8))}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="max-w-[140px] truncate">{String(row.customer_name || '—')}</div>
                      <div className="max-w-[140px] truncate text-xs text-[var(--admin-muted)]">
                        {String(row.company_name || '')}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={cn(
                          'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          paymentKindBadgeClass(String(row.kind || '')),
                        )}
                      >
                        {String(row.kind || '—')}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={cn(
                          'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          paymentStatusBadgeClass(String(row.status || '')),
                        )}
                      >
                        {formatFinanceLabel(String(row.status || ''))}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      <div>{String(row.formatted_gateway || row.gateway || '—')}</div>
                      {row.payment_method && (
                        <div className="text-[var(--admin-muted)]">
                          {formatPaymentMethodLabel(String(row.payment_method))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-semibold tabular-nums">
                      {financeMoney(row.amount, cur)}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-[var(--admin-muted)]">
                      {fmtFinanceWhen(String(row.processed_at || row.payment_date || row.created_at || ''))}
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      {formatFinanceLabel(String(row.source_system || ''))}
                      {row.reversal_of_id && (
                        <div className="text-[var(--admin-muted)]">Reversal</div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    No payment transactions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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

      {manualOrderId && (
        <AdminManualPaymentForm
          open={manualOpen}
          onOpenChange={setManualOpen}
          orderId={manualOrderId}
          outstanding={manualOutstanding}
          currency={currency}
          onPosted={() => void refresh()}
        />
      )}
    </div>
  )
}
