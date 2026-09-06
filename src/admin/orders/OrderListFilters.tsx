import { adminInput, adminLabel, adminBtnSecondary } from '@/admin/adminClassNames'
import type { OrderListFilters, OrderSort } from '@/admin/lib/orderOps'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { cn } from '@/lib/utils'

export type OrderFacets = {
  financialStatuses: string[]
  fulfillmentStatuses: string[]
  orderSources: string[]
  customerTypes: string[]
  staff: { id: string; name: string }[]
}

type Props = {
  filters: OrderListFilters
  sort: OrderSort
  facets: OrderFacets
  onChange: (next: OrderListFilters) => void
  onSortChange: (sort: OrderSort) => void
  onReset: () => void
}

function toggleInList(list: string[] | undefined, value: string) {
  const cur = list ?? []
  return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]
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
        'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-[var(--admin-primary)] bg-[var(--admin-primary)]/10 text-[var(--admin-primary)]'
          : 'border-[var(--admin-border)] bg-white text-[var(--admin-muted)] hover:border-[var(--admin-primary)]/40',
      )}
    >
      {children}
    </button>
  )
}

export function OrderListFilters({ filters, sort, facets, onChange, onSortChange, onReset }: Props) {
  const set = (patch: Partial<OrderListFilters>) => onChange({ ...filters, ...patch })

  return (
    <div className="space-y-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <label className={adminLabel}>Search orders</label>
          <input
            className={adminInput}
            placeholder="Order #, customer, company, StoreName, SKU, tracking, staff, tags…"
            value={filters.search ?? ''}
            onChange={(e) => set({ search: e.target.value })}
          />
        </div>
        <div className="w-full sm:w-48">
          <label className={adminLabel}>Sort</label>
          <BrandedSelect
            value={sort}
            onValueChange={(v) => onSortChange(v as OrderSort)}
            options={[
              { value: 'date_desc', label: 'Date (newest)' },
              { value: 'date_asc', label: 'Date (oldest)' },
              { value: 'total_desc', label: 'Total (high)' },
              { value: 'total_asc', label: 'Total (low)' },
              { value: 'outstanding_desc', label: 'Outstanding' },
              { value: 'number_asc', label: 'Order number' },
            ]}
          />
        </div>
        <button type="button" className={adminBtnSecondary} onClick={onReset}>
          Reset filters
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Date</p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['today', 'Today'],
              ['yesterday', 'Yesterday'],
              ['this_week', 'This week'],
              ['this_month', 'This month'],
              ['custom', 'Custom'],
            ] as const
          ).map(([id, label]) => (
            <Chip
              key={id}
              active={filters.date_preset === id}
              onClick={() => set({ date_preset: filters.date_preset === id ? '' : id })}
            >
              {label}
            </Chip>
          ))}
        </div>
        {filters.date_preset === 'custom' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={adminLabel}>From</label>
              <input
                type="date"
                className={adminInput}
                value={(filters.date_from ?? '').slice(0, 10)}
                onChange={(e) => set({ date_from: e.target.value ? `${e.target.value}T00:00:00Z` : '' })}
              />
            </div>
            <div>
              <label className={adminLabel}>To</label>
              <input
                type="date"
                className={adminInput}
                value={(filters.date_to ?? '').slice(0, 10)}
                onChange={(e) => set({ date_to: e.target.value ? `${e.target.value}T23:59:59Z` : '' })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Order source</p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['web', 'Web'],
                ['draft', 'Draft'],
                ['pos', 'POS'],
                ['sales_portal', 'Sales portal'],
              ] as const
            ).map(([id, label]) => (
              <Chip
                key={id}
                active={filters.source_group === id}
                onClick={() => set({ source_group: filters.source_group === id ? '' : id })}
              >
                {label}
              </Chip>
            ))}
            <Chip
              active={filters.has_draft === true}
              onClick={() => set({ has_draft: filters.has_draft === true ? null : true })}
            >
              From draft
            </Chip>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Payment</p>
          <div className="flex flex-wrap gap-1.5">
            {facets.financialStatuses.map((s) => (
              <Chip
                key={s}
                active={(filters.financial_statuses ?? []).includes(s)}
                onClick={() => set({ financial_statuses: toggleInList(filters.financial_statuses, s) })}
              >
                {s.replace(/_/g, ' ')}
              </Chip>
            ))}
            <Chip
              active={!!filters.outstanding_gt_0}
              onClick={() => set({ outstanding_gt_0: !filters.outstanding_gt_0 })}
            >
              Outstanding &gt; 0
            </Chip>
            <Chip active={!!filters.overdue} onClick={() => set({ overdue: !filters.overdue })}>
              Overdue
            </Chip>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Fulfilment</p>
          <div className="flex flex-wrap gap-1.5">
            {facets.fulfillmentStatuses.map((s) => (
              <Chip
                key={s}
                active={(filters.fulfillment_statuses ?? []).includes(s)}
                onClick={() => set({ fulfillment_statuses: toggleInList(filters.fulfillment_statuses, s) })}
              >
                {s.replace(/_/g, ' ')}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Delivery</p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['tracking_present', 'Tracking'],
                ['no_tracking', 'No tracking'],
                ['in_transit', 'In transit'],
                ['delivered', 'Delivered'],
              ] as const
            ).map(([id, label]) => (
              <Chip
                key={id}
                active={filters.delivery === id}
                onClick={() => set({ delivery: filters.delivery === id ? '' : id })}
              >
                {label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Ownership</p>
          <div className="grid gap-2">
            <BrandedSelect
              value={filters.salesperson_id ?? ''}
              onValueChange={(v) => set({ salesperson_id: v || undefined })}
              allowEmpty
              emptyLabel="Salesperson — any"
              options={facets.staff.map((s) => ({ value: s.id, label: s.name }))}
            />
            <BrandedSelect
              value={filters.cg_assigned_id ?? ''}
              onValueChange={(v) => set({ cg_assigned_id: v || undefined })}
              allowEmpty
              emptyLabel="CG assigned — any"
              options={facets.staff.map((s) => ({ value: s.id, label: s.name }))}
            />
            <BrandedSelect
              value={filters.referrer_id ?? ''}
              onValueChange={(v) => set({ referrer_id: v || undefined })}
              allowEmpty
              emptyLabel="Referrer — any"
              options={facets.staff.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Commercial</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={adminLabel}>Min total</label>
              <input
                className={adminInput}
                inputMode="decimal"
                value={filters.min_total ?? ''}
                onChange={(e) => set({ min_total: e.target.value })}
              />
            </div>
            <div>
              <label className={adminLabel}>Max total</label>
              <input
                className={adminInput}
                inputMode="decimal"
                value={filters.max_total ?? ''}
                onChange={(e) => set({ max_total: e.target.value })}
              />
            </div>
            <div>
              <label className={adminLabel}>Due from</label>
              <input
                type="date"
                className={adminInput}
                value={filters.payment_due_from ?? ''}
                onChange={(e) => set({ payment_due_from: e.target.value })}
              />
            </div>
            <div>
              <label className={adminLabel}>Due to</label>
              <input
                type="date"
                className={adminInput}
                value={filters.payment_due_to ?? ''}
                onChange={(e) => set({ payment_due_to: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={adminLabel}>StoreName / trading</label>
            <input
              className={adminInput}
              value={filters.trading_name ?? ''}
              onChange={(e) => set({ trading_name: e.target.value })}
            />
          </div>
          {facets.customerTypes.length > 0 && (
            <BrandedSelect
              value={filters.customer_type ?? ''}
              onValueChange={(v) => set({ customer_type: v || undefined })}
              allowEmpty
              emptyLabel="Customer type — any"
              options={facets.customerTypes.map((t) => ({ value: t, label: t }))}
            />
          )}
          <div>
            <label className={adminLabel}>Tag (exact)</label>
            <input
              className={adminInput}
              placeholder="e.g. SP_John"
              value={(filters.tags ?? [])[0] ?? ''}
              onChange={(e) => set({ tags: e.target.value.trim() ? [e.target.value.trim()] : [] })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
