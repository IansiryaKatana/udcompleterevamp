import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCms } from '@/contexts/CmsContext'
import { ProductCard } from '@/components/home/ProductCard'
import { productGridClasses } from '@/components/storefront/productGridClasses'
import { PageHero } from '@/components/layout/PageHero'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { ProductGridPagination } from '@/components/storefront/ProductGridPagination'
import { getCategoryBySlug } from '@/lib/cms/loadCmsSnapshot'
import { buildCollectionMeta, usePageMeta } from '@/lib/seo'
import { resolveStorefrontListParams } from '@/lib/storefront/staticProductFallback'
import { useStorefrontFacets, useStorefrontProductList } from '@/lib/storefront/storefrontQueries'
import { useServerStorefrontPagination } from '@/lib/storefront/useServerStorefrontPagination'
import { CollectionFilters, type CollectionFilterState } from '@/components/storefront/CollectionFilters'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildCollectionJsonLd } from '@/lib/seo/jsonLd'
import { wholesaleCollectionIntro } from '@/lib/storefront/wholesaleCopy'
import { sanitizeMarketingHtml } from '@/lib/sanitizeHtml'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'

const VIRTUAL_COLLECTION_SLUGS = ['all', 'new', 'best', 'deals', 'summer', 'offers'] as const

export const Route = createFileRoute('/collection/$slug')({
  component: CollectionPage,
})

function CollectionPage() {
  const { slug } = Route.useParams()
  const { snapshot } = useCms()
  const collection = snapshot.collections.find((c) => c.slug === slug)
  const category = getCategoryBySlug(snapshot, slug)
  const listParams = resolveStorefrontListParams(slug, snapshot)
  const isVirtual = VIRTUAL_COLLECTION_SLUGS.includes(slug as (typeof VIRTUAL_COLLECTION_SLUGS)[number])
  const params = listParams ?? (isVirtual ? { filter: 'all' as const } : { filter: 'collection' as const, slug })
  const { data: session } = useCommercialSession()
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

  const listParamsWithFilters = {
    ...params,
    minPrice: filters.minPrice ? Number(filters.minPrice) : null,
    maxPrice: filters.maxPrice ? Number(filters.maxPrice) : null,
    inStockOnly: filters.inStockOnly,
    sort: filters.sort as 'default' | 'price_asc' | 'price_desc' | 'name',
    vendor: filters.vendor || null,
    productType: filters.productType || null,
    strength: filters.strength || null,
  }

  const title = collection?.title ?? category?.name ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
  const { intro, seoBody } = wholesaleCollectionIntro(title, collection?.description)
  const storeUrl = snapshot.siteSettings.store_url?.trim() || (typeof window !== 'undefined' ? window.location.origin : '')

  const pagination = useServerStorefrontPagination()
  const { data, isLoading, isFetching } = useStorefrontProductList(
    listParamsWithFilters,
    pagination.pageSize,
    pagination.offset,
  )

  const total = data?.total ?? 0
  const products = data?.items ?? []
  const paging = pagination.view(total)
  const showPrice = session?.policy?.can_view_price !== false && session?.commercial_access_mode !== 'trade_required'

  useEffect(() => {
    pagination.resetPage()
  }, [slug, filters.minPrice, filters.maxPrice, filters.inStockOnly, filters.sort, filters.vendor, filters.productType, filters.strength])

  usePageMeta(buildCollectionMeta(title, collection?.description ?? intro, slug, snapshot.siteName))

  const loading = isLoading || (isFetching && products.length === 0)

  if (!loading && !isVirtual && !collection && !category && total === 0) {
    throw notFound()
  }

  return (
    <StorefrontLayout>
      <JsonLd data={buildCollectionJsonLd(title, collection?.description ?? intro, slug, storeUrl)} />
      <PageHero title={title} subtitle={intro} />

      <div className="min-w-0 max-w-full px-6 py-12 md:px-14">
        <CollectionFilters
          value={filters}
          onChange={setFilters}
          vendors={facets?.vendors}
          productTypes={facets?.productTypes}
          strengths={facets?.nicotineStrengths}
          showPrice={showPrice !== false}
        />
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted" />
          </div>
        ) : products.length === 0 ? (
          <p className="text-center text-muted">No wholesale products match these filters yet.</p>
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

        {seoBody ? (
          <div
            className="prose prose-sm mt-16 max-w-3xl text-muted"
            dangerouslySetInnerHTML={{ __html: sanitizeMarketingHtml(seoBody) }}
          />
        ) : null}
      </div>
    </StorefrontLayout>
  )
}
