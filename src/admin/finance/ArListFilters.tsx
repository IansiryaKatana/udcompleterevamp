import { useState } from 'react'
import { adminInput } from '@/admin/adminClassNames'
import { AdminSheet } from '@/admin/components/AdminSheet'
import {
  AdminListFilterToolbar,
  ChipRow,
  FilterChip,
  FilterSection,
  countActiveListFilters,
  toggleInList,
} from '@/admin/components/AdminFilterControls'
import {
  AGING_BUCKET_LABELS,
  FINANCE_DATE_PRESETS,
  type ArListFilters,
  type ArListSort,
  type FinanceAgingBucket,
} from '@/admin/lib/financeOps'
import { cn } from '@/lib/utils'

type Props = {
  filters: ArListFilters
  sort: ArListSort
  onChange: (next: ArListFilters) => void
  onSortChange: (sort: ArListSort) => void
  onReset: () => void
}

const FINANCIAL = ['PENDING', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED']
const BUCKETS = Object.keys(AGING_BUCKET_LABELS) as FinanceAgingBucket[]

const SORT_OPTIONS = [
  { value: 'outstanding_desc', label: 'Outstanding (high)' },
  { value: 'outstanding_asc', label: 'Outstanding (low)' },
  { value: 'due_asc', label: 'Due (soonest)' },
  { value: 'due_desc', label: 'Due (latest)' },
  { value: 'date_desc', label: 'Order date (newest)' },
  { value: 'date_asc', label: 'Order date (oldest)' },
  { value: 'order_asc', label: 'Order number' },
  { value: 'aging_desc', label: 'Aging' },
]

export function ArListFilters({ filters, sort, onChange, onSortChange, onReset }: Props) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<ArListFilters>) => onChange({ ...filters, ...patch })
  const activeCount = countActiveListFilters(filters as Record<string, unknown>)

  return (
    <>
      <AdminListFilterToolbar
        searchPlaceholder="Order #, invoice #, customer, company, StoreName…"
        searchAriaLabel="Search receivables"
        searchValue={filters.search ?? ''}
        onSearchChange={(v) => set({ search: v })}
        sort={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={(v) => onSortChange(v as ArListSort)}
        activeCount={activeCount}
        onOpenFilters={() => setOpen(true)}
        onReset={onReset}
      />
      <AdminSheet
        open={open}
        onOpenChange={setOpen}
        title="Filters"
        description="Narrow the receivables list. Changes apply as you go."
        footer="filters"
        onReset={onReset}
        size="lg"
      >
        <div className="space-y-6">
          <FilterSection title="Order date">
            <ChipRow>
              {FINANCE_DATE_PRESETS.map(([id, label]) => (
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
              <div className="flex flex-wrap gap-2">
                <input
                  type="date"
                  className={cn(adminInput, 'w-auto')}
                  value={filters.date_from || ''}
                  onChange={(e) => set({ date_from: e.target.value })}
                />
                <input
                  type="date"
                  className={cn(adminInput, 'w-auto')}
                  value={filters.date_to || ''}
                  onChange={(e) => set({ date_to: e.target.value })}
                />
              </div>
            )}
          </FilterSection>

          <FilterSection title="Aging">
            <ChipRow>
              {BUCKETS.map((b) => (
                <FilterChip
                  key={b}
                  active={(filters.aging_buckets ?? []).includes(b)}
                  onClick={() => set({ aging_buckets: toggleInList(filters.aging_buckets, b) })}
                >
                  {AGING_BUCKET_LABELS[b]}
                </FilterChip>
              ))}
              <FilterChip active={Boolean(filters.overdue_only)} onClick={() => set({ overdue_only: !filters.overdue_only })}>
                Overdue only
              </FilterChip>
            </ChipRow>
          </FilterSection>

          <FilterSection title="Financial status">
            <ChipRow>
              {FINANCIAL.map((s) => (
                <FilterChip
                  key={s}
                  active={(filters.financial_statuses ?? []).includes(s)}
                  onClick={() => set({ financial_statuses: toggleInList(filters.financial_statuses, s) })}
                >
                  {s.replace(/_/g, ' ')}
                </FilterChip>
              ))}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Source">
            <ChipRow>
              {(
                [
                  ['', 'All'],
                  ['shopify', 'Shopify'],
                  ['unique', 'Unique'],
                ] as const
              ).map(([id, label]) => (
                <FilterChip
                  key={id || 'all'}
                  active={(filters.source_group || '') === id}
                  onClick={() => set({ source_group: id })}
                >
                  {label}
                </FilterChip>
              ))}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Ownership">
            <p className="mb-2 text-xs text-[var(--admin-muted)]">
              Default basis: current CRM account owner (company/customer salesperson). Not historical order SP.
            </p>
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
                My accounts
              </FilterChip>
              <FilterChip
                active={(filters.ownership_basis || 'current_crm') === 'current_crm'}
                onClick={() => set({ ownership_basis: 'current_crm' })}
              >
                Current CRM owner
              </FilterChip>
              <FilterChip
                active={filters.ownership_basis === 'order_snapshot'}
                onClick={() => set({ ownership_basis: 'order_snapshot' })}
              >
                Order snapshot SP
              </FilterChip>
            </ChipRow>
            <div className="mt-2 grid gap-2">
              <input
                className={adminInput}
                placeholder="Salesperson UUID (optional)"
                value={filters.salesperson_id ?? ''}
                onChange={(e) =>
                  set({
                    salesperson_id: e.target.value || undefined,
                    mine_salesperson: false,
                  })
                }
              />
              <input
                className={adminInput}
                placeholder="CG assigned UUID (optional)"
                value={filters.cg_assigned_id ?? ''}
                onChange={(e) => set({ cg_assigned_id: e.target.value || undefined })}
              />
            </div>
          </FilterSection>
        </div>
      </AdminSheet>
    </>
  )
}
