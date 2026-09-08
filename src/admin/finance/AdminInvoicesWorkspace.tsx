import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  createAdminInvoiceFromOrder,
  listAdminInvoices,
  type AdminInvoiceRow,
} from '@/admin/lib/adminRpc'
import {
  canMutateFinance,
  filtersToJson,
  financeMoney,
  formatFinanceLabel,
  fmtFinanceDate,
  invoiceStatusBadgeClass,
  newIdempotencyKey,
  provenanceBadgeClass,
  type InvoiceListFilters,
} from '@/admin/lib/financeOps'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'
import { cn } from '@/lib/utils'

const EMPTY: InvoiceListFilters = {}

export function AdminInvoicesWorkspace() {
  const { role } = useAdminAuth()
  const canMutate = canMutateFinance(role)
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings).code || 'GBP'
  const [rows, setRows] = useState<AdminInvoiceRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<InvoiceListFilters>(EMPTY)
  const [debounced, setDebounced] = useState<InvoiceListFilters>(EMPTY)
  const [creating, setCreating] = useState(false)
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
      const result = await listAdminInvoices({
        limit: pagination.pageSize,
        offset: pagination.start,
        filters: filtersToJson(debounced),
      })
      setRows(result.items)
      setTotal(result.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [pagination.pageSize, pagination.start, debounced])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function createFromOrder() {
    const orderId = window.prompt('Order UUID to invoice:')
    if (!orderId?.trim()) return
    const asReconstructed = window.confirm(
      'Mark as reconstructed_from_order? (OK = reconstructed for historical Shopify; Cancel = unique_native)',
    )
    setCreating(true)
    try {
      const res = await createAdminInvoiceFromOrder({
        orderId: orderId.trim(),
        idempotencyKey: newIdempotencyKey('inv'),
        asReconstructed,
      })
      toast.success(`Invoice ${res.invoice_number || res.invoice_id} created`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invoice create failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Invoices</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Finance documents · {total.toLocaleString()} matching · test numbering until production confirmed
          </p>
        </div>
        {canMutate && (
          <button type="button" className={adminBtnPrimary} disabled={creating} onClick={() => void createFromOrder()}>
            {creating ? 'Creating…' : 'Create from order'}
          </button>
        )}
      </div>
      <FinanceSubNav />

      <div className="flex flex-col gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] p-4 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <label className={adminLabel}>Search</label>
          <input
            className={adminInput}
            placeholder="Invoice #, order #, customer…"
            value={filters.search ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>
        <button
          type="button"
          className={adminBtnSecondary}
          onClick={() => {
            setFilters(EMPTY)
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
          <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Invoice</th>
                <th className="px-3 py-2.5 font-semibold">Order</th>
                <th className="px-3 py-2.5 font-semibold">Customer / company</th>
                <th className="px-3 py-2.5 font-semibold">Dates</th>
                <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                <th className="px-3 py-2.5 font-semibold text-right">Outstanding</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Provenance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cur = String(row.currency || currency)
                return (
                  <tr key={row.id} className="border-t border-[var(--admin-border)] hover:bg-[var(--admin-primary)]/[0.04]">
                    <td className="px-3 py-2">
                      <Link
                        to="/backend/finance/invoices/$invoiceId"
                        params={{ invoiceId: row.id }}
                        className="font-semibold text-[var(--admin-primary)] hover:underline"
                      >
                        {String(row.invoice_number || row.id.slice(0, 8))}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
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
                    <td className="px-3 py-2">
                      <div>{String(row.customer_name || '—')}</div>
                      <div className="text-xs text-[var(--admin-muted)]">{String(row.company_name || '')}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>Inv {fmtFinanceDate(row.invoice_date as string | null)}</div>
                      <div className="text-[var(--admin-muted)]">Due {fmtFinanceDate(row.due_date as string | null)}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{financeMoney(row.total, cur)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-800">
                      {financeMoney(row.outstanding, cur)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', invoiceStatusBadgeClass(String(row.status || '')))}>
                        {formatFinanceLabel(String(row.status || ''))}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', provenanceBadgeClass(String(row.provenance || '')))}>
                        {formatFinanceLabel(String(row.provenance || ''))}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    No invoices yet.
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
    </div>
  )
}
