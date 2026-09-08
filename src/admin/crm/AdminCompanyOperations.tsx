import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { AdminRelatedLink } from '@/admin/components/AdminRelatedLink'
import {
  fetchCrmCompanyFilterFacets,
  listAdminCrmCompanies,
  type AdminCrmCompanyListRow,
} from '@/admin/lib/adminRpc'
import { filtersToJson, type CrmCompanyListFilters, type CrmCompanySort } from '@/admin/lib/crmOps'
import { CompanyListFilters as FiltersPanel, type CompanyFacets } from '@/admin/crm/CompanyListFilters'
import { CompanyListTable } from '@/admin/crm/CompanyListTable'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { adminBtnPrimary } from '@/admin/adminClassNames'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'

const EMPTY_FILTERS: CrmCompanyListFilters = {}

export function AdminCompanyOperations({ embedded = false }: { embedded?: boolean }) {
  const { canEdit } = useAdminAuth()
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings)
  const [rows, setRows] = useState<AdminCrmCompanyListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<CrmCompanyListFilters>(EMPTY_FILTERS)
  const [debouncedFilters, setDebouncedFilters] = useState<CrmCompanyListFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<CrmCompanySort>('name_asc')
  const [facets, setFacets] = useState<CompanyFacets>({
    customerTypes: [],
    statuses: [],
    sourceSystems: [],
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
    void fetchCrmCompanyFilterFacets()
      .then(setFacets)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load filters'))
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listAdminCrmCompanies({
        limit: pagination.pageSize,
        offset: pagination.start,
        sort,
        filters: filtersToJson(debouncedFilters),
      })
      setRows(result.items)
      setTotal(result.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load companies')
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
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Companies</h1>
            <p className="mt-1 text-sm text-[var(--admin-muted)]">
              Unique Distribution B2B accounts · {total.toLocaleString()} matching
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AdminRelatedLink to="/backend/customers">Customers</AdminRelatedLink>
            {canEdit && (
              <Link to="/backend/companies/new" className={adminBtnPrimary}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New company
              </Link>
            )}
          </div>
        </div>
      )}
      {embedded && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-[var(--admin-muted)]">{total.toLocaleString()} companies</p>
          <AdminRelatedLink to="/backend/companies">Open full CRM</AdminRelatedLink>
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
          setSort('name_asc')
          pagination.resetPage()
        }}
      />

      {loading ? (
        <AdminLoadingState />
      ) : (
        <CompanyListTable rows={rows} currencyFallback={currency.code} />
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
