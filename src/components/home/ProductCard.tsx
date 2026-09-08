import type { Product } from '@/data/static-cms'
import { stripHtml } from '@/lib/stripHtml'
import { Badge } from '@/components/ui/badge'
import { ProductPrice } from '@/components/product/ProductPrice'
import { AddToCartButton } from '@/components/ecommerce/AddToCartButton'
import { WishlistButton } from '@/components/ecommerce/WishlistButton'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { productMetaChips } from '@/lib/storefront/wholesaleCopy'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'
import { commercialPriceLabel } from '@/lib/storefront/commercialSession'
import { resolveProductImageUrl } from '@/lib/cms/mapProduct'

function ProductCardImage({ product }: { product: Product }) {
  const src = resolveProductImageUrl(product)
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <span className="absolute inset-0 flex items-center justify-center text-xs text-muted">No image</span>
  }

  return (
    <img
      src={src}
      alt={product.name}
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-[250ms] ease-out group-hover:scale-[1.04]"
    />
  )
}

export function ProductCard({ product }: { product: Product }) {
  const overviewText = stripHtml(product.overview ?? '')
  const chips = productMetaChips(product)
  const { data: session } = useCommercialSession()
  const restrictedLabel = commercialPriceLabel(session, product.priceRestricted)
  const needsOptions = Boolean(product.variants && product.variants.length > 0)

  return (
    <article className="product-card min-w-0 max-w-full">
      <div className="group relative aspect-[1/0.82] overflow-hidden rounded-[10px] bg-gradient-to-b from-[#f8f8f6] to-[#eeeeea]">
        <Link to="/product/$slug" params={{ slug: product.slug }} className="block h-full w-full">
          <ProductCardImage product={product} />
        </Link>
        <WishlistButton
          productId={product.id}
          variant="icon"
          className="absolute right-2.5 top-2.5 z-10"
        />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <ProductPrice
            price={product.price}
            compareAtPrice={product.compareAtPrice}
            priceRestricted={product.priceRestricted}
            restrictedLabel={restrictedLabel}
            size="sm"
          />
          {product.badge && <Badge>{product.badge}</Badge>}
        </div>
        {product.vendor ? <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{product.vendor}</p> : null}
        <Link to="/product/$slug" params={{ slug: product.slug }}>
          <h3 className="line-clamp-2 text-sm font-extrabold leading-snug text-text-brown">{product.name}</h3>
        </Link>
        {chips.length > 0 ? (
          <p className="line-clamp-1 text-xs text-muted">
            {chips.map((chip) => chip.value).join(' · ')}
          </p>
        ) : overviewText ? (
          <p className="line-clamp-1 text-xs leading-5 text-muted">{overviewText}</p>
        ) : null}
        <p className="text-[11px] text-muted">
          {product.inventoryCount > 0 ? 'In stock' : 'Unavailable'}
        </p>
        <div className="flex min-w-0 items-stretch gap-2 pt-1">
          {needsOptions ? (
            <Link
              to="/product/$slug"
              params={{ slug: product.slug }}
              className="inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-md border border-brand-border bg-white px-3 text-xs font-bold text-text-brown"
            >
              Choose options
            </Link>
          ) : (
            <AddToCartButton product={product} className="min-w-0 flex-1" />
          )}
          <Link
            to="/product/$slug"
            params={{ slug: product.slug }}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-cta-brown px-3 text-xs font-bold leading-none text-white"
          >
            View
          </Link>
        </div>
      </div>
    </article>
  )
}
