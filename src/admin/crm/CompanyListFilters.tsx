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
import type { CrmCompanyListFilters, CrmCompanySort } from '@/admin/lib/crmOps'
import { CRM_DATE_PRESETS } from '@/admin/lib/crmOps'
import { BrandedSelect } from '@/components/ui/BrandedSelect'

export type CompanyFacets = {
  customerTypes: string[]
  statuses: string[]
  sourceSystems: string[]
  paymentTerms: string[]
  staff: { id: string; name: string }[]
}

type Props = {
  filters: CrmCompanyListFilters
  sort: CrmCompanySort
  facets: CompanyFacets
  onChange: (next: CrmCompanyListFilters) => void
  onSortChange: (sort: CrmCompanySort) => void
  onReset: () => void
}

const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'created_desc', label: 'Created (newest)' },
  { value: 'created_asc', label: 'Created (oldest)' },
  { value: 'lifetime_desc', label: 'Lifetime (high)' },
  { value: 'lifetime_asc', label: 'Lifetime (low)' },
  { value: 'outstanding_desc', label: 'Outstanding' },
  { value: 'last_order_desc', label: 'Last order' },
  { value: 'updated_desc', label: 'Updated' },
]

export function CompanyListFilters({ filters, sort, facets, onChange, onSortChange, onReset }: Props) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<CrmCompanyListFilters>) => onChange({ ...filters, ...patch })
  const activeCount = countActiveListFilters(filters as Record<string, unknown>)

  return (
    <>
      <AdminListFilterToolbar
        searchPlaceholder="Name, trading, VAT, staff, tags, contact, order #…"
        searchAriaLabel="Search companies"
        searchValue={filters.search ?? ''}
        onSearchChange={(v) => set({ search: v })}
        sort={sort}
        sortOptions={SORT_OPTIONS}
        onSortChange={(v) => onSortChange(v as CrmCompanySort)}
        activeCount={activeCount}
        onOpenFilters={() => setOpen(true)}
        onReset={onReset}
      />
      <AdminSheet
        open={open}
        onOpenChange={setOpen}
        title="Filters"
        description="Narrow the company list. Changes apply as you go."
        footer="filters"
        onReset={onReset}
        size="lg"
      >
        <div className="space-y-6">
          <FilterSection title="Created">
            <ChipRow>
              {CRM_DATE_PRESETS.map(([id, label]) => (
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

          <FilterSection title="Type / status">
            <ChipRow>
              {facets.customerTypes.map((t) => (
                <FilterChip
                  key={t}
                  active={(filters.customer_types ?? []).includes(t)}
                  onClick={() => set({ customer_types: toggleInList(filters.customer_types, t) })}
                >
                  {t}
                </FilterChip>
              ))}
              {facets.statuses.map((s) => (
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
            </ChipRow>
          </FilterSection>

          <FilterSection title="Commercial">
            <ChipRow>
              <FilterChip
                active={filters.has_contacts === true}
                onClick={() => set({ has_contacts: filters.has_contacts === true ? null : true })}
              >
                Has contacts
              </FilterChip>
              <FilterChip
                active={filters.has_orders === true}
                onClick={() => set({ has_orders: filters.has_orders === true ? null : true })}
              >
                Has orders
              </FilterChip>
              <FilterChip
                active={filters.has_open_drafts === true}
                onClick={() => set({ has_open_drafts: filters.has_open_drafts === true ? null : true })}
              >
                Open drafts
              </FilterChip>
              <FilterChip
                active={!!filters.has_outstanding}
                onClick={() => set({ has_outstanding: !filters.has_outstanding })}
              >
                Outstanding
              </FilterChip>
              <FilterChip
                active={!!filters.unassigned_salesperson}
                onClick={() => set({ unassigned_salesperson: !filters.unassigned_salesperson })}
              >
                Unassigned SP
              </FilterChip>
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
                My companies
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

          <FilterSection title="Lifetime / terms">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={adminLabel}>Min lifetime</label>
                <input
                  className={adminInput}
                  inputMode="decimal"
                  value={filters.min_lifetime ?? ''}
                  onChange={(e) => set({ min_lifetime: e.target.value })}
                />
              </div>
              <div>
                <label className={adminLabel}>Max lifetime</label>
                <input
                  className={adminInput}
                  inputMode="decimal"
                  value={filters.max_lifetime ?? ''}
                  onChange={(e) => set({ max_lifetime: e.target.value })}
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
                placeholder="e.g. VIP"
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
