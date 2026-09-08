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
  FINANCE_DATE_PRESETS,
  MANUAL_PAYMENT_METHODS,
  type PaymentListFilters,
  type PaymentListSort,
} from '@/admin/lib/financeOps'
import { cn } from '@/lib/utils'

type Props = {
  filters: PaymentListFilters
  sort: PaymentListSort
  onChange: (next: PaymentListFilters) => void
  onSortChange: (sort: PaymentListSort) => void
  onReset: () => void
}

const KINDS = ['SALE', 'CAPTURE', 'PAYMENT', 'REFUND', 'VOID', 'AUTHORIZATION']
const STATUSES = ['success', 'pending', 'failure', 'error', 'reversed']

const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'date_asc', label: 'Date (oldest)' },
  { value: 'amount_desc', label: 'Amount (high)' },
  { value: 'amount_asc', label: 'Amount (low)' },
  { value: 'processed_desc', label: 'Processed' },
]

export function PaymentListFilters({ filters, sort, onChange, onSortChange, onReset }: Props) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<PaymentListFilters>) => onChange({ ...filters, ...patch })
  const activeCount = countActiveListFilters(filters as Record<string, unknown>)

  return (
    <>
      <AdminListFilterToolbar
        searchPlaceholder="Order #, reference, gateway, customer…"
        searchAriaLabel="Search payments"
        searchValue={filters.search ?? ''}
        onSearchChange={(v) => set({ search: v })}
        sort={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={(v) => onSortChange(v as PaymentListSort)}
        activeCount={activeCount}
        onOpenFilters={() => setOpen(true)}
        onReset={onReset}
      />
      <AdminSheet
        open={open}
        onOpenChange={setOpen}
        title="Filters"
        description="Narrow the payment list. Changes apply as you go."
        footer="filters"
        onReset={onReset}
        size="lg"
      >
        <div className="space-y-6">
          <FilterSection title="Date">
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

          <FilterSection title="Kind">
            <ChipRow>
              {KINDS.map((k) => (
                <FilterChip
                  key={k}
                  active={(filters.kinds ?? []).includes(k)}
                  onClick={() => set({ kinds: toggleInList(filters.kinds, k) })}
                >
                  {k}
                </FilterChip>
              ))}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Status">
            <ChipRow>
              {STATUSES.map((s) => (
                <FilterChip
                  key={s}
                  active={(filters.statuses ?? []).includes(s)}
                  onClick={() => set({ statuses: toggleInList(filters.statuses, s) })}
                >
                  {s}
                </FilterChip>
              ))}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Manual method">
            <ChipRow>
              {MANUAL_PAYMENT_METHODS.map((m) => (
                <FilterChip
                  key={m.value}
                  active={(filters.payment_methods ?? []).includes(m.value)}
                  onClick={() => set({ payment_methods: toggleInList(filters.payment_methods, m.value) })}
                >
                  {m.label}
                </FilterChip>
              ))}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Source">
            <ChipRow>
              <FilterChip
                active={(filters.source_group || '') === 'unique'}
                onClick={() => set({ source_group: filters.source_group === 'unique' ? '' : 'unique' })}
              >
                Unique native
              </FilterChip>
              <FilterChip
                active={(filters.source_group || '') === 'shopify'}
                onClick={() => set({ source_group: filters.source_group === 'shopify' ? '' : 'shopify' })}
              >
                Shopify imported
              </FilterChip>
              <FilterChip
                active={Boolean(filters.unique_native_only)}
                onClick={() => set({ unique_native_only: !filters.unique_native_only })}
              >
                Unique only
              </FilterChip>
              <FilterChip
                active={Boolean(filters.reversals_only)}
                onClick={() => set({ reversals_only: !filters.reversals_only })}
              >
                Reversals
              </FilterChip>
            </ChipRow>
          </FilterSection>
        </div>
      </AdminSheet>
    </>
  )
}
