import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  fetchAdminCarrierConfig,
  fetchAdminFulfilmentMetrics,
  listAdminFulfilmentWorkspace,
  type AdminCarrierConfig,
  type AdminFulfilmentMetrics,
  type AdminFulfilmentWorkspaceRow,
} from '@/admin/lib/adminRpc'
import {
  deliveryStatusBadgeClass,
  formatFulfilmentLabel,
  fulfilmentFiltersToJson,
  inventoryBoundaryNote,
  type FulfilmentWorkspaceFilters,
} from '@/admin/lib/fulfilmentOps'
import { fulfillmentBadgeClass, formatStatusLabel } from '@/admin/lib/orderOps'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { cn } from '@/lib/utils'

const EMPTY: FulfilmentWorkspaceFilters = {}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--admin-text)]">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--admin-muted)]">{hint}</p> : null}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-2 py-1 text-xs font-medium',
        active
          ? 'bg-[var(--admin-primary)] text-white'
          : 'border border-[var(--admin-border)] bg-white text-[var(--admin-text)] hover:bg-[var(--admin-surface)]',
      )}
    >
      {children}
    </button>
  )
}

export function AdminFulfilmentOperations() {
  const [filters, setFilters] = useState<FulfilmentWorkspaceFilters>(EMPTY)
  const [debounced, setDebounced] = useState<FulfilmentWorkspaceFilters>(EMPTY)
  const [rows, setRows] = useState<AdminFulfilmentWorkspaceRow[]>([])
  const [total, setTotal] = useState(0)
  const [metrics, setMetrics] = useState<AdminFulfilmentMetrics | null>(null)
  const [carrierCfg, setCarrierCfg] = useState<AdminCarrierConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const pagination = useAdminTablePagination(total, 25)

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
      const f = fulfilmentFiltersToJson(debounced)
      const [list, m, cfg] = await Promise.all([
        listAdminFulfilmentWorkspace({
          limit: pagination.pageSize,
          offset: pagination.start,
          filters: f,
        }),
        fetchAdminFulfilmentMetrics(f),
        fetchAdminCarrierConfig().catch(() => null),
      ])
      setRows(list.items)
      setTotal(list.total)
      setMetrics(m)
      setCarrierCfg(cfg)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load fulfilment workspace')
    } finally {
      setLoading(false)
    }
  }, [pagination.pageSize, pagination.start, debounced])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function toggleStatus(status: string) {
    const cur = filters.fulfillment_statuses ?? []
    const next = cur.includes(status) ? cur.filter((s) => s !== status) : [...cur, status]
    setFilters({ ...filters, fulfillment_statuses: next })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Fulfilment</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Operations workspace — fulfilment status is separate from delivery. {inventoryBoundaryNote()}
          </p>
          {carrierCfg ? (
            <p className="mt-2 text-xs text-[var(--admin-muted)]">
              Carrier: <span className="font-semibold uppercase">{String(carrierCfg.carrier_mode)}</span>
              {' · '}
              DPD product: <span className="font-semibold">{String(carrierCfg.product_status)}</span>
              {carrierCfg.carrier_mode === 'test' ? (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                  TEST DPD
                </span>
              ) : null}
              {' · '}
              Live blocked: {carrierCfg.phase_3b_live_blocked === false ? 'no' : 'yes'}
            </p>
          ) : null}
        </div>
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Metric label="Unfulfilled" value={metrics?.unfulfilled ?? '—'} />
        <Metric label="Partially fulfilled" value={metrics?.partially_fulfilled ?? '—'} />
        <Metric label="Fulfilled today" value={metrics?.fulfilled_today ?? '—'} hint="≠ delivered" />
        <Metric label="Tracking missing" value={metrics?.tracking_missing ?? '—'} />
        <Metric label="In transit" value={metrics?.in_transit ?? '—'} />
        <Metric label="Delivered" value={metrics?.delivered ?? '—'} />
        <Metric label="Failed delivery" value={metrics?.failed ?? '—'} />
      </div>

      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className={adminLabel}>Search</span>
            <input
              className={adminInput}
              value={filters.search ?? ''}
              placeholder="Order #, email, tracking…"
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </label>
          <label className="block">
            <span className={adminLabel}>Carrier</span>
            <input
              className={adminInput}
              value={filters.carrier ?? ''}
              placeholder="DPD, DX, UPS…"
              onChange={(e) => setFilters({ ...filters, carrier: e.target.value })}
            />
          </label>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={Boolean(filters.include_test)}
              onChange={(e) => setFilters({ ...filters, include_test: e.target.checked })}
            />
            <span className="text-sm text-[var(--admin-text)]">Include TEST orders</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-semibold uppercase text-[var(--admin-muted)] self-center">Fulfilment</span>
          {['UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'ON_HOLD'].map((s) => (
            <Chip key={s} active={(filters.fulfillment_statuses ?? []).includes(s)} onClick={() => toggleStatus(s)}>
              {formatStatusLabel(s)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-semibold uppercase text-[var(--admin-muted)] self-center">Delivery</span>
          {(
            [
              ['', 'Any'],
              ['tracking_missing', 'Tracking missing'],
              ['tracking_present', 'Has tracking'],
              ['in_transit', 'In transit'],
              ['out_for_delivery', 'Out for delivery'],
              ['delivered', 'Delivered'],
              ['failed', 'Failed'],
            ] as const
          ).map(([val, label]) => (
            <Chip
              key={val || 'any'}
              active={(filters.delivery ?? '') === val}
              onClick={() => setFilters({ ...filters, delivery: val })}
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>

      {loading ? (
        <AdminLoadingState />
      ) : (
        <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Fulfilment</th>
                <th className="px-3 py-2 text-left">Delivery</th>
                <th className="px-3 py-2 text-left">Carrier / tracking</th>
                <th className="px-3 py-2 text-right">Shipments</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[var(--admin-muted)]">
                    No orders match these filters.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--admin-border)] hover:bg-[var(--admin-surface)]/60">
                  <td className="px-3 py-2">
                    <Link
                      to="/backend/orders/$orderId"
                      params={{ orderId: row.id }}
                      className="font-medium text-[var(--admin-primary)] hover:underline"
                    >
                      {row.order_number || row.id.slice(0, 8)}
                    </Link>
                    {row.is_test ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                        TEST
                      </span>
                    ) : null}
                    <div className="text-xs text-[var(--admin-muted)]">{row.trading_name || row.email || '—'}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        fulfillmentBadgeClass(row.commerce_fulfillment_status),
                      )}
                    >
                      {formatFulfilmentLabel(row.commerce_fulfillment_status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        deliveryStatusBadgeClass(row.delivery_status || row.primary_display_status),
                      )}
                    >
                      {formatFulfilmentLabel(row.delivery_status || row.primary_display_status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>{row.primary_carrier || row.carrier || '—'}</div>
                    <div className="text-[var(--admin-muted)]">{row.primary_tracking || row.tracking_number || 'No tracking'}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.active_fulfillment_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-[var(--admin-border)] px-3 py-2">
            <AdminTablePagination pagination={pagination} total={total} />
          </div>
        </div>
      )}
    </div>
  )
}
