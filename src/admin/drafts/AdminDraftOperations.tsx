import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { AdminRelatedLink } from '@/admin/components/AdminRelatedLink'
import {
  fetchDraftFilterFacets,
  listAdminDrafts,
  type AdminDraftListRow,
} from '@/admin/lib/adminRpc'
import { filtersToJson, type DraftListFilters, type DraftSort } from '@/admin/lib/draftOps'
import { DraftListFilters as FiltersPanel, type DraftFacets } from '@/admin/drafts/DraftListFilters'
import { DraftListTable } from '@/admin/drafts/DraftListTable'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { adminBtnPrimary } from '@/admin/adminClassNames'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'

const EMPTY_FILTERS: DraftListFilters = {}

export function AdminDraftOperations({ embedded = false }: { embedded?: boolean }) {
  const { canEdit } = useAdminAuth()
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings)
  const [rows, setRows] = useState<AdminDraftListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<DraftListFilters>(EMPTY_FILTERS)
  const [debouncedFilters, setDebouncedFilters] = useState<DraftListFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<DraftSort>('date_desc')
  const [facets, setFacets] = useState<DraftFacets>({
    statuses: [],
    sourceSystems: [],
    customerTypes: [],
    paymentTerms: [],
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
    void fetchDraftFilterFacets()
      .then(setFacets)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load filters'))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listAdminDrafts({
        limit: pagination.pageSize,
        offset: pagination.start,
        sort,
        filters: filtersToJson(debouncedFilters),
      })
      setRows(result.items)
      setTotal(result.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load drafts')
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
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Draft Orders</h1>
            <p className="mt-1 text-sm text-[var(--admin-muted)]">
              Unique Distribution wholesale draft operations · {total.toLocaleString()} matching
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AdminRelatedLink to="/backend/orders">Orders</AdminRelatedLink>
            {canEdit && (
              <Link to="/backend/drafts/new" className={adminBtnPrimary}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New Unique draft
              </Link>
            )}
          </div>
        </div>
      )}
      {embedded && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--admin-muted)]">{total.toLocaleString()} drafts</p>
          <AdminRelatedLink to="/backend/drafts">Open full draft workspace</AdminRelatedLink>
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
        <DraftListTable rows={rows} currencyFallback={currency.code} />
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
