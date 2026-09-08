import { useCallback, useEffect, useState } from 'react'
import { listAdminArReceivables, type AdminArReceivableRow } from '@/admin/lib/adminRpc'
import { filtersToJson, type ArListFilters, type ArListSort } from '@/admin/lib/financeOps'
import { ArListFilters as FiltersPanel } from '@/admin/finance/ArListFilters'
import { ArListTable } from '@/admin/finance/ArListTable'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'
import { toast } from 'sonner'

const EMPTY: ArListFilters = {}

export function AdminArReceivables() {
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings).code || 'GBP'
  const [rows, setRows] = useState<AdminArReceivableRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<ArListFilters>(EMPTY)
  const [debounced, setDebounced] = useState<ArListFilters>(EMPTY)
  const [sort, setSort] = useState<ArListSort>('outstanding_desc')
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
      const result = await listAdminArReceivables({
        limit: pagination.pageSize,
        offset: pagination.start,
        sort,
        filters: filtersToJson(debounced),
      })
      setRows(result.items)
      setTotal(result.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load receivables')
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
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Receivables</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Open AR (SOURCE outstanding snapshot) · {total.toLocaleString()} matching · aging retains
          NO_DUE_DATE where payment_due_on is absent
        </p>
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
          setSort('outstanding_desc')
          pagination.resetPage()
        }}
      />
      {loading ? <AdminLoadingState /> : <ArListTable rows={rows} currencyFallback={currency} />}
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
