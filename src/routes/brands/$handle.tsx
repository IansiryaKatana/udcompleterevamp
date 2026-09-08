import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ProductCard } from '@/components/home/ProductCard'
import { productGridClasses } from '@/components/storefront/productGridClasses'
import { PageHero } from '@/components/layout/PageHero'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { ProductGridPagination } from '@/components/storefront/ProductGridPagination'
import { CollectionFilters, type CollectionFilterState } from '@/components/storefront/CollectionFilters'
import { useStorefrontBrands, useStorefrontFacets, useStorefrontProductList } from '@/lib/storefront/storefrontQueries'
import { useServerStorefrontPagination } from '@/lib/storefront/useServerStorefrontPagination'
import { wholesaleCollectionIntro } from '@/lib/storefront/wholesaleCopy'

export const Route = createFileRoute('/brands/$handle')({
  component: BrandPage,
})

function BrandPage() {
  const { handle } = Route.useParams()
  const { data: brands = [] } = useStorefrontBrands()
  const brand = brands.find((item) => item.handle === handle)
  const title = brand?.vendor ?? handle.replace(/-/g, ' ')
  const { intro } = wholesaleCollectionIntro(title)
  const { data: facets } = useStorefrontFacets()
  const [filters, setFilters] = useState<CollectionFilterState>({
    minPrice: '',
    maxPrice: '',
    inStockOnly: false,
    sort: 'default',
    vendor: '',
    productType: '',
    strength: '',
  })
  const pagination = useServerStorefrontPagination()
  const { data, isLoading, isFetching } = useStorefrontProductList(
    {
      filter: 'brand',
      slug: handle,
      minPrice: filters.minPrice ? Number(filters.minPrice) : null,
      maxPrice: filters.maxPrice ? Number(filters.maxPrice) : null,
      inStockOnly: filters.inStockOnly,
      sort: filters.sort as 'default' | 'price_asc' | 'price_desc' | 'name',
      productType: filters.productType || null,
      strength: filters.strength || null,
    },
    pagination.pageSize,
    pagination.offset,
  )
  const total = data?.total ?? 0
  const products = data?.items ?? []
  const paging = pagination.view(total)
  const loading = isLoading || (isFetching && products.length === 0)

  useEffect(() => {
    pagination.resetPage()
  }, [handle, filters.minPrice, filters.maxPrice, filters.inStockOnly, filters.sort, filters.productType, filters.strength])

  return (
    <StorefrontLayout>
      <PageHero title={title} subtitle={intro} />
      <div className="px-6 py-12 md:px-14">
        <CollectionFilters
          value={filters}
          onChange={setFilters}
          productTypes={facets?.productTypes}
          strengths={facets?.nicotineStrengths}
        />
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted" />
          </div>
        ) : products.length === 0 ? (
          <p className="text-center text-muted">No published products for this brand yet.</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">{total.toLocaleString('en-GB')} products</p>
            <div className={productGridClasses}>
              {products.map((product) => (
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
