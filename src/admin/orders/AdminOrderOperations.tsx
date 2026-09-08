import { useCallback, useEffect, useState } from 'react'
import { AdminRelatedLink } from '@/admin/components/AdminRelatedLink'
import { toast } from 'sonner'
import {
  fetchOrderFilterFacets,
  listAdminOrdersV2,
  type AdminOrderListRow,
} from '@/admin/lib/adminRpc'
import { filtersToJson, type OrderListFilters, type OrderSort } from '@/admin/lib/orderOps'
import { OrderListFilters as FiltersPanel, type OrderFacets } from '@/admin/orders/OrderListFilters'
import { OrderListTable } from '@/admin/orders/OrderListTable'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'

const EMPTY_FILTERS: OrderListFilters = {}

export function AdminOrderOperations({ embedded = false }: { embedded?: boolean }) {
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings)
  const [rows, setRows] = useState<AdminOrderListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<OrderListFilters>(EMPTY_FILTERS)
  const [debouncedFilters, setDebouncedFilters] = useState<OrderListFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<OrderSort>('date_desc')
  const [facets, setFacets] = useState<OrderFacets>({
    financialStatuses: [],
    fulfillmentStatuses: [],
    orderSources: [],
    customerTypes: [],
    staff: [],
  })
  const pagination = useAdminTablePagination(total, 20)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedFilters(filters)
      pagination.resetPage()
    }, 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only debounce filter text changes
  }, [filters])

  useEffect(() => {
    void fetchOrderFilterFacets()
      .then(setFacets)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load filters'))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listAdminOrdersV2({
        limit: pagination.pageSize,
        offset: pagination.start,
        sort,
        filters: filtersToJson(debouncedFilters),
      })
      setRows(result.items)
      setTotal(result.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [pagination.pageSize, pagination.start, sort, debouncedFilters])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Orders</h1>
            <p className="mt-1 text-sm text-[var(--admin-muted)]">
              Unique Distribution wholesale order operations · {total.toLocaleString()} matching
            </p>
          </div>
          <AdminRelatedLink to="/backend/customers">Customers</AdminRelatedLink>
        </div>
      )}
      {embedded && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--admin-muted)]">{total.toLocaleString()} orders</p>
          <AdminRelatedLink to="/backend/orders">Open full order workspace</AdminRelatedLink>
        </div>
      )}

      <FiltersPanel
        filters={filters}
        sort={sort}
        facets={facets}
        onChange={setFilters}
        onSortChange={(s) => {
          setSort(s)
          pagination.resetPage()
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS)
          setSort('date_desc')
          pagination.resetPage()
        }}
      />

      {loading ? (
        <AdminLoadingState />
      ) : (
        <OrderListTable rows={rows} currencyFallback={currency.code} />
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
