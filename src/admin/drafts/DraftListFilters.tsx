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
import type { DraftListFilters, DraftSort } from '@/admin/lib/draftOps'
import { DRAFT_DATE_PRESETS } from '@/admin/lib/draftOps'
import { BrandedSelect } from '@/components/ui/BrandedSelect'

export type DraftFacets = {
  statuses: string[]
  sourceSystems: string[]
  customerTypes: string[]
  paymentTerms: string[]
  staff: { id: string; name: string }[]
}

type Props = {
  filters: DraftListFilters
  sort: DraftSort
  facets: DraftFacets
  onChange: (next: DraftListFilters) => void
  onSortChange: (sort: DraftSort) => void
  onReset: () => void
}

const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Date (newest)' },
  { value: 'date_asc', label: 'Date (oldest)' },
  { value: 'updated_desc', label: 'Updated' },
  { value: 'total_desc', label: 'Total (high)' },
  { value: 'total_asc', label: 'Total (low)' },
  { value: 'name_asc', label: 'Name A–Z' },
]

export function DraftListFilters({ filters, sort, facets, onChange, onSortChange, onReset }: Props) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<DraftListFilters>) => onChange({ ...filters, ...patch })
  const activeCount = countActiveListFilters(filters as Record<string, unknown>)

  return (
    <>
      <AdminListFilterToolbar
        searchPlaceholder="Draft name, customer, company, StoreName, SKU, staff, PO, tags…"
        searchAriaLabel="Search drafts"
        searchValue={filters.search ?? ''}
        onSearchChange={(v) => set({ search: v })}
        sort={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={(v) => onSortChange(v as DraftSort)}
        activeCount={activeCount}
        onOpenFilters={() => setOpen(true)}
        onReset={onReset}
      />
      <AdminSheet
        open={open}
        onOpenChange={setOpen}
        title="Filters"
        description="Narrow the draft list. Changes apply as you go."
        footer="filters"
        onReset={onReset}
        size="xl"
      >
        <div className="space-y-6">
          <FilterSection title="Date">
            <ChipRow>
              {DRAFT_DATE_PRESETS.map(([id, label]) => (
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

          <FilterSection title="Status">
            <ChipRow>
              {facets.statuses.map((s) => (
                <FilterChip
                  key={s}
                  active={(filters.statuses ?? []).includes(s)}
                  onClick={() => set({ statuses: toggleInList(filters.statuses, s) })}
                >
                  {s.replace(/_/g, ' ')}
                </FilterChip>
              ))}
              {facets.statuses.length === 0 && (
                <span className="text-xs text-[var(--admin-muted)]">No status facets yet</span>
              )}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Source">
            <ChipRow>
              {(
                [
                  ['shopify', 'Shopify'],
                  ['unique', 'Unique'],
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
              {facets.sourceSystems
                .filter((s) => s !== 'shopify' && s !== 'unique')
                .map((s) => (
                  <FilterChip
                    key={s}
                    active={(filters.source_systems ?? []).includes(s)}
                    onClick={() => set({ source_systems: toggleInList(filters.source_systems, s) })}
                  >
                    {s}
                  </FilterChip>
                ))}
            </ChipRow>
          </FilterSection>

          <FilterSection title="Conversion">
            <ChipRow>
              <FilterChip
                active={filters.converted === true}
                onClick={() => set({ converted: filters.converted === true ? null : true })}
              >
                Converted
              </FilterChip>
              <FilterChip
                active={filters.converted === false}
                onClick={() => set({ converted: filters.converted === false ? null : false })}
              >
                Not converted
              </FilterChip>
              <FilterChip active={!!filters.overdue} onClick={() => set({ overdue: !filters.overdue })}>
                Overdue open
              </FilterChip>
            </ChipRow>
          </FilterSection>

          <FilterSection title="Customer">
            <div className="grid gap-2">
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
            </div>
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
                My drafts
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
            {facets.paymentTerms.length > 0 && (
              <BrandedSelect
                value={filters.payment_terms ?? ''}
                onValueChange={(v) => set({ payment_terms: v || undefined })}
                allowEmpty
                emptyLabel="Payment terms — any"
                options={facets.paymentTerms.map((t) => ({ value: t, label: t }))}
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
