import { createFileRoute, notFound } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCms } from '@/contexts/CmsContext'
import { buildProductMeta, usePageMeta } from '@/lib/seo'
import { useStorefrontProduct } from '@/lib/storefront/storefrontQueries'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { JsonLd } from '@/components/seo/JsonLd'
import { getCurrencyFromSettings } from '@/lib/currency'
import { buildBreadcrumbJsonLd, buildProductJsonLd } from '@/lib/seo/jsonLd'
import { ProductDetailSections } from '@/components/product/ProductDetailSections'
import { ProductDetailHero } from '@/components/product/ProductDetailHero'
import { RelatedProductsSection } from '@/components/product/RelatedProductsSection'
import { MobileStickyBuyBar } from '@/components/product/MobileStickyBuyBar'
import { StockAlertForm } from '@/components/product/StockAlertForm'
import {
  effectiveCompareAtPrice,
  effectiveProductInventory,
  effectiveProductPrice,
} from '@/lib/cms/mapProduct'
import type { ProductVariant } from '@/data/static-cms'

export const Route = createFileRoute('/product/$slug')({
  component: ProductDetailPage,
})

function ProductDetailPage() {
  const { slug } = Route.useParams()
  const { snapshot } = useCms()
  const { data: product, isLoading } = useStorefrontProduct(slug)
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)

  const activeVariant = useMemo(() => {
    if (!product?.variants?.length) return null
    if (selectedVariant) return selectedVariant
    const inStock = product.variants.find((v) => v.inventoryCount > 0)
    return inStock ?? product.variants[0] ?? null
  }, [product, selectedVariant])

  const displayPrice = product ? effectiveProductPrice(product, activeVariant) : 0
  const displayCompareAt = product ? effectiveCompareAtPrice(product, activeVariant) : null
  const displaySku = activeVariant?.sku ?? product?.sku
  const displayInventory = product ? effectiveProductInventory(product, activeVariant) : 0
  const galleryImage = activeVariant?.imageUrl || product?.imageUrl || ''

  const category = product?.categoryId
    ? snapshot.categories.find((c) => c.id === product.categoryId)
    : null
  const parentCategory = category?.parentId
    ? snapshot.categories.find((c) => c.id === category.parentId)
    : null

  const marqueeText =
    snapshot.siteSettings.footer_tagline?.trim() ||
    `${snapshot.siteName} — UK wholesale distributor for retailers.`

  usePageMeta(
    product ? buildProductMeta(product, snapshot.siteName) : { title: 'Product | Unique Distribution' },
  )

  if (isLoading) {
    return (
      <StorefrontLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted" />
        </div>
      </StorefrontLayout>
    )
  }

  if (!product) throw notFound()

  const storeUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const currency = getCurrencyFromSettings(snapshot.siteSettings)

  return (
    <StorefrontLayout>
      <JsonLd
        data={[
          buildProductJsonLd(product, snapshot.siteName, storeUrl, currency),
          buildBreadcrumbJsonLd([
            { name: 'Home', url: storeUrl || '/' },
            { name: product.name, url: `${storeUrl}/product/${product.slug}` },
          ]),
        ]}
      />

      <ProductDetailHero
        product={product}
        heroImage={galleryImage}
        activeVariant={activeVariant}
        displayPrice={displayPrice}
        displayCompareAt={displayCompareAt}
        displaySku={displaySku}
        displayInventory={displayInventory}
        categoryName={category?.name}
        categorySlug={category?.slug}
        parentCategoryName={parentCategory?.name}
        parentCategorySlug={parentCategory?.slug}
        marqueeText={marqueeText.toUpperCase()}
        onVariantSelect={setSelectedVariant}
      />

      <ProductDetailSections
        product={product}
        imageUrl={galleryImage}
        galleryUrls={product.galleryUrls}
      />

      <RelatedProductsSection product={product} />
      <StockAlertForm productId={product.id} variantId={activeVariant?.id} disabled={displayInventory <= 0} />
      <MobileStickyBuyBar product={product} variant={activeVariant} price={displayPrice} inventory={displayInventory} />
    </StorefrontLayout>
  )
}
