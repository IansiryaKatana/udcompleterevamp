import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { STOREFRONT_PAGE_SIZE_OPTIONS } from '@/lib/storefrontPagination'

type ProductGridPaginationProps = {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  hasPrev: boolean
  hasNext: boolean
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
}

export function ProductGridPagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  hasPrev,
  hasNext,
  onPageChange,
  onPageSizeChange,
}: ProductGridPaginationProps) {
  if (totalItems === 0) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalItems)

  return (
    <div className="mt-10 flex flex-col gap-4 border-t border-brand-border pt-8 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted">
        Showing {start}–{end} of {totalItems} products
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSizeChange ? (
          <label className="flex items-center gap-2 text-sm text-muted">
            Per page
            <BrandedSelect
              variant="storefront"
              aria-label="Products per page"
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
              options={STOREFRONT_PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: String(size) }))}
            />
          </label>
        ) : null}
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!hasPrev} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="min-w-[4rem] text-center text-sm text-muted">{page} / {totalPages}</span>
          <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={() => onPageChange(page + 1)}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
