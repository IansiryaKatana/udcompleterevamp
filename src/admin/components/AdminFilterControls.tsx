import { SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { adminBadge, adminBtnGhost, adminBtnSecondary, adminInput } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { cn } from '@/lib/utils'

export function countActiveListFilters(
  filters: Record<string, unknown>,
  ignoreKeys: string[] = ['search'],
): number {
  return Object.entries(filters).filter(([key, value]) => {
    if (ignoreKeys.includes(key)) return false
    if (value == null || value === '') return false
    if (Array.isArray(value) && value.length === 0) return false
    return true
  }).length
}

export function toggleInList(list: string[] | undefined, value: string) {
  const cur = list ?? []
  return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value]
}

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-[var(--admin-primary)] bg-[var(--admin-primary)]/10 text-[var(--admin-primary)]'
          : 'border-[var(--admin-border)] bg-white text-[var(--admin-muted)] hover:border-[var(--admin-primary)]/40',
      )}
    >
      {children}
    </button>
  )
}

export function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{title}</p>
      {children}
    </section>
  )
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>
}

type SortOption = { value: string; label: string }

export function AdminListFilterToolbar({
  searchPlaceholder,
  searchAriaLabel,
  searchValue,
  onSearchChange,
  sort,
  sortOptions,
  onSortChange,
  activeCount,
  onOpenFilters,
  onReset,
}: {
  searchPlaceholder: string
  searchAriaLabel: string
  searchValue: string
  onSearchChange: (value: string) => void
  sort: string
  sortOptions: SortOption[]
  onSortChange: (value: string) => void
  activeCount: number
  onOpenFilters: () => void
  onReset: () => void
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <input
          aria-label={searchAriaLabel}
          className={adminInput}
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-48">
          <BrandedSelect
            aria-label="Sort"
            value={sort}
            onValueChange={onSortChange}
            options={sortOptions}
          />
        </div>
        <button type="button" className={adminBtnSecondary} onClick={onOpenFilters}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters
          {activeCount > 0 ? <span className={adminBadge}>{activeCount}</span> : null}
        </button>
        {activeCount > 0 ? (
          <button type="button" className={adminBtnGhost} onClick={onReset}>
            Reset
          </button>
        ) : null}
      </div>
    </div>
  )
}
