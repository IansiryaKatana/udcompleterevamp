import { Star } from 'lucide-react'
import type { Product, ProductVariant } from '@/data/static-cms'
import { Badge } from '@/components/ui/badge'
import { CmsLink } from '@/components/layout/CmsLink'
import { RichTextContent } from '@/components/content/RichTextContent'
import { ProductPrice } from '@/components/product/ProductPrice'
import { ProductVariantSelector } from '@/components/product/ProductVariantSelector'
import { ProductPurchaseActions } from '@/components/product/ProductPurchaseActions'
import { WishlistButton } from '@/components/ecommerce/WishlistButton'
import { RequestQuoteButton } from '@/components/storefront/RequestQuoteButton'
import { productMetaChips } from '@/lib/storefront/wholesaleCopy'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'
import { commercialPriceLabel } from '@/lib/storefront/commercialSession'
import { cn } from '@/lib/utils'

type ProductBuyBoxProps = {
  product: Product
  activeVariant: ProductVariant | null
  displayPrice: number
  displayCompareAt: number | null
  displaySku: string | null | undefined
  displayInventory: number
  categoryName?: string | null
  categorySlug?: string | null
  parentCategoryName?: string | null
  parentCategorySlug?: string | null
  onVariantSelect: (variant: ProductVariant) => void
  className?: string
}

export function ProductBuyBox({
  product,
  activeVariant,
  displayPrice,
  displayCompareAt,
  displaySku,
  displayInventory,
  categoryName,
  categorySlug,
  parentCategoryName,
  parentCategorySlug,
  onVariantSelect,
  className,
}: ProductBuyBoxProps) {
  const chips = productMetaChips(product)
  const { data: session } = useCommercialSession()
  const restrictedLabel = commercialPriceLabel(session, product.priceRestricted)
  const optionPack = activeVariant
    ? Object.entries(activeVariant.optionValues)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => `${key}: ${value}`)
        .join(' · ')
    : ''

  return (
    <div className={cn('rounded-2xl bg-white p-5 text-text-brown shadow-2xl md:p-7', className)}>
      {(parentCategoryName && parentCategorySlug) || (categoryName && categorySlug) ? (
        <nav className="mb-3 text-xs text-muted" aria-label="Breadcrumb">
          {parentCategoryName && parentCategorySlug ? (
            <>
              <CmsLink href={`/collection/${parentCategorySlug}`} className="transition hover:text-cta-brown">
                {parentCategoryName}
              </CmsLink>
              <span className="mx-1.5">/</span>
            </>
          ) : null}
          {categoryName && categorySlug ? (
            <CmsLink href={`/collection/${categorySlug}`} className="transition hover:text-cta-brown">
              {categoryName}
            </CmsLink>
          ) : null}
        </nav>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {product.vendor ? (
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{product.vendor}</p>
          ) : null}
          <h1 className="font-display text-2xl font-extrabold leading-tight md:text-3xl">{product.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {product.badge ? <Badge>{product.badge}</Badge> : null}
            <ProductPrice
              price={displayPrice}
              compareAtPrice={displayCompareAt}
              priceRestricted={product.priceRestricted}
              restrictedLabel={restrictedLabel}
              size="lg"
            />
          </div>
          {product.reviews && product.reviews.count > 0 ? (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted">
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    className={cn(
                      'h-4 w-4',
                      i < Math.round(product.reviews!.averageRating)
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-border',
                    )}
                  />
                ))}
              </div>
              <span>
                {product.reviews.averageRating.toFixed(1)} ({product.reviews.count})
              </span>
            </div>
          ) : null}
        </div>
        <WishlistButton productId={product.id} />
      </div>

      {displaySku ? <p className="mt-2 text-xs text-muted">SKU: {displaySku}</p> : null}
      {chips.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          {chips.map((chip) => (
            <li key={chip.label} className="rounded-full bg-content-bg px-2.5 py-1">
              <span className="font-semibold text-text-brown">{chip.label}:</span> {chip.value}
            </li>
          ))}
        </ul>
      ) : null}
      {optionPack ? <p className="mt-2 text-xs text-muted">{optionPack}</p> : null}

      {product.description?.trim() ? (
        <RichTextContent html={product.description} className="mt-4 line-clamp-4 text-sm text-muted" />
      ) : null}

      {product.variants && product.variants.length > 0 ? (
        <ProductVariantSelector
          variants={product.variants}
          selectedId={activeVariant?.id ?? null}
          onSelect={onVariantSelect}
        />
      ) : null}

      <p className="mt-4 text-xs text-muted">
        {displayInventory > 0 ? `${displayInventory} in stock` : 'Currently unavailable'}
      </p>

      {product.nicotineStrength ? (
        <p className="mt-3 rounded-md bg-soft-beige px-3 py-2 text-xs text-muted">
          This product has a recorded nicotine strength of {product.nicotineStrength}. This notice is informational
          only — it is not age verification or a purchase block.
        </p>
      ) : null}

      <ProductPurchaseActions
        product={product}
        variant={activeVariant}
        className="mt-6 [&>div]:max-w-none"
      />
      <RequestQuoteButton className="mt-3 w-full" />
    </div>
  )
}
