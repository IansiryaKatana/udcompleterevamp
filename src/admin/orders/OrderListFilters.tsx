import { useState } from 'react'
import { adminInput, adminLabel } from '@/admin/adminClassNames'
import { AdminSheet } from '@/admin/components/AdminSheet'
import {
  AdminListFilterToolbar,
  ChipRow,
  FilterChip,
  FilterSection,
  countActiveListFilters,
  toggleInList,
} from '@/admin/components/AdminFilterControls'
import type { OrderListFilters, OrderSort } from '@/admin/lib/orderOps'
import { BrandedSelect } from '@/components/ui/BrandedSelect'

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

const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'date_asc', label: 'Date (oldest)' },
  { value: 'total_desc', label: 'Total (high)' },
  { value: 'total_asc', label: 'Total (low)' },
  { value: 'outstanding_desc', label: 'Outstanding' },
  { value: 'number_asc', label: 'Order number' },
]

export function OrderListFilters({ filters, sort, facets, onChange, onSortChange, onReset }: Props) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<OrderListFilters>) => onChange({ ...filters, ...patch })
  const activeCount = countActiveListFilters(filters as Record<string, unknown>)

  return (
    <>
      <AdminListFilterToolbar
        searchPlaceholder="Order #, customer, company, StoreName, SKU, tracking, staff, tags…"
        searchAriaLabel="Search orders"
        searchValue={filters.search ?? ''}
        onSearchChange={(v) => set({ search: v })}
        sort={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={(v) => onSortChange(v as OrderSort)}
        activeCount={activeCount}
        onOpenFilters={() => setOpen(true)}
        onReset={onReset}
      />
      <AdminSheet
        open={open}
        onOpenChange={setOpen}
        title="Filters"
        description="Narrow the order list. Changes apply as you go."
        footer="filters"
        onReset={onReset}
        size="xl"
      >
        <div className="space-y-6">
          <FilterSection title="Date">
            <ChipRow>
              {(
                [
                  ['today', 'Today'],
                  ['yesterday', 'Yesterday'],
                  ['this_week', 'This week'],
                  ['this_month', 'This month'],
                  ['custom', 'Custom'],
                ] as const
              ).map(([id, label]) => (
                <FilterChip
                  key={id}
                  active={filters.date_preset === id}
                  onClick={() => set({ date_preset: filters.date_preset === id ? '' : id })}
                >
                  {label}
                </FilterChip>
              ))}
            </ChipRow>
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
          </FilterSection>

          <FilterSection title="Order source">
            <ChipRow>
              {(
                [
                  ['web', 'Web'],
                  ['draft', 'Draft'],
                  ['pos', 'POS'],
                  ['sales_portal', 'Sales portal'],
                ] as const
              ).map(([id, label]) => (
                <FilterChip
                  key={id}
                  active={filters.source_group === id}
                  onClick={() => set({ source_group: filters.source_group === id ? '' : id })}
                >
                  {label}
                </FilterChip>
              ))}
              <FilterChip
                active={filters.has_draft === true}
                onClick={() => set({ has_draft: filters.has_draft === true ? null : true })}
              >
                From draft
              </FilterChip>
            </ChipRow>
          </FilterSection>

          <FilterSection title="Payment">
            <ChipRow>
              {facets.financialStatuses.map((s) => (
                <FilterChip
                  key={s}
                  active={(filters.financial_statuses ?? []).includes(s)}
                  onClick={() => set({ financial_statuses: toggleInList(filters.financial_statuses, s) })}
                >
                  {s.replace(/_/g, ' ')}
                </FilterChip>
              ))}
              <FilterChip
                active={!!filters.outstanding_gt_0}
                onClick={() => set({ outstanding_gt_0: !filters.outstanding_gt_0 })}
              >
                Outstanding &gt; 0
              </FilterChip>
              <FilterChip active={!!filters.overdue} onClick={() => set({ overdue: !filters.overdue })}>
                Overdue
              </FilterChip>
            </ChipRow>
          </FilterSection>

          <FilterSection title="Fulfilment">
            <ChipRow>
              {facets.fulfillmentStatuses.map((s) => (
                <FilterChip
                  key={s}
                  active={(filters.fulfillment_statuses ?? []).includes(s)}
                  onClick={() => set({ fulfillment_statuses: toggleInList(filters.fulfillment_statuses, s) })}
                >
                  {s.replace(/_/g, ' ')}
                </FilterChip>
              ))}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Delivery">
            <ChipRow>
              {(
                [
                  ['tracking_present', 'Tracking'],
                  ['no_tracking', 'No tracking'],
                  ['in_transit', 'In transit'],
                  ['delivered', 'Delivered'],
                ] as const
              ).map(([id, label]) => (
                <FilterChip
                  key={id}
                  active={filters.delivery === id}
                  onClick={() => set({ delivery: filters.delivery === id ? '' : id })}
                >
                  {label}
                </FilterChip>
              ))}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Ownership">
            <ChipRow>
              <FilterChip
                active={!!filters.mine_salesperson}
                onClick={() =>
                  set({
                    mine_salesperson: !filters.mine_salesperson,
                    salesperson_id: undefined,
                  })
                }
              >
                My orders
              </FilterChip>
            </ChipRow>
            <div className="grid gap-2">
              <BrandedSelect
                value={filters.salesperson_id ?? ''}
                onValueChange={(v) => set({ salesperson_id: v || undefined, mine_salesperson: false })}
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
          </FilterSection>

          <FilterSection title="Commercial">
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
          </FilterSection>
        </div>
      </AdminSheet>
    </>
  )
}
