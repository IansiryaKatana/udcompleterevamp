import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { z } from 'zod'
import { useState } from 'react'
import { ProductCard } from '@/components/home/ProductCard'
import { productGridClasses } from '@/components/storefront/productGridClasses'
import { PageHero } from '@/components/layout/PageHero'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { ProductGridPagination } from '@/components/storefront/ProductGridPagination'
import { Input } from '@/components/ui/input'
import { usePageMeta } from '@/lib/seo'
import { useStorefrontSearch } from '@/lib/storefront/storefrontQueries'
import { SearchAutocomplete } from '@/components/storefront/SearchAutocomplete'
import { useServerStorefrontPagination } from '@/lib/storefront/useServerStorefrontPagination'

const searchSchema = z.object({
  q: z.string().optional().catch(''),
})

export const Route = createFileRoute('/search')({
  validateSearch: searchSchema,
  component: SearchPage,
})

function SearchPage() {
  const { q = '' } = Route.useSearch()
  const [query, setQuery] = useState(q)
  const pagination = useServerStorefrontPagination()
  const { data, isLoading, isFetching } = useStorefrontSearch(q, pagination.pageSize, pagination.offset)

  const total = data?.total ?? 0
  const results = data?.items ?? []
  const paging = pagination.view(total)

  useEffect(() => {
    pagination.resetPage()
  }, [q])

  usePageMeta({
    title: q ? `Search: ${q} | Unique Distribution` : 'Search | Unique Distribution',
    description: q ? `Search results for “${q}” at Unique Distribution.` : 'Search the Unique Distribution catalog.',
    path: q ? `/search?q=${encodeURIComponent(q)}` : '/search',
  })

  const loading = isLoading || (isFetching && results.length === 0)

  return (
    <StorefrontLayout>
      <PageHero title="Search" subtitle={q ? `${total} result(s) for “${q}”` : 'Search the wholesale catalogue by name, SKU or brand'} />

      <div className="px-6 py-10 md:px-14">
        <form method="get" action="/search" className="relative mx-auto mb-10 max-w-xl">
          <Input
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, SKUs, brands…"
            aria-label="Search products"
            className="h-12"
          />
          <SearchAutocomplete query={query} />
        </form>

        {q.trim() === '' ? (
          <p className="text-center text-muted">Enter a keyword to search the catalog.</p>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center">
            <p className="text-muted">No products match your search. Try a SKU, brand, or a shorter name.</p>
            <Link to="/" className="mt-4 inline-block text-sm font-semibold text-cta-brown underline">
              Browse all products
            </Link>
          </div>
        ) : (
          <>
            <div className={productGridClasses}>
              {results.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
            <ProductGridPagination
              page={paging.page}
              totalPages={paging.totalPages}
              totalItems={paging.totalItems}
              pageSize={paging.pageSize}
              hasPrev={paging.hasPrev}
              hasNext={paging.hasNext}
              onPageChange={(next) => pagination.setPage(next, total)}
              onPageSizeChange={pagination.setPageSize}
            />
          </>
        )}
      </div>
    </StorefrontLayout>
  )
}
