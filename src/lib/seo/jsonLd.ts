import { stripHtml } from '@/lib/stripHtml'

export function jsonLdScript(data: Record<string, unknown> | Record<string, unknown>[]) {
  return JSON.stringify(data)
}

export function buildOrganizationJsonLd(siteName: string, storeUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteName,
    url: storeUrl,
  }
}

export function buildProductJsonLd(product: {
  name: string
  description: string
  slug: string
  sku?: string | null
  price: number
  compareAtPrice?: number | null
  priceRestricted?: boolean
  imageUrl: string
  inventoryCount: number
}, siteName: string, storeUrl: string, currency: string) {
  const base = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: stripHtml(product.description),
    image: product.imageUrl ? [product.imageUrl] : undefined,
    sku: product.sku?.trim() || product.slug,
    brand: { '@type': 'Brand', name: siteName },
  }

  // Phase 4G: under trade price restriction, do NOT leak protected B2B prices via JSON-LD.
  // SEO: Product entity remains; Offer without price (availability only).
  if (product.priceRestricted) {
    return {
      ...base,
      offers: {
        '@type': 'Offer',
        url: `${storeUrl}/product/${product.slug}`,
        priceCurrency: currency,
        availability:
          product.inventoryCount > 0
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
      },
    }
  }

  return {
    ...base,
    offers: {
      '@type': 'Offer',
      url: `${storeUrl}/product/${product.slug}`,
      priceCurrency: currency,
      price: product.price.toFixed(2),
      ...(product.compareAtPrice != null && product.compareAtPrice > product.price
        ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: product.price.toFixed(2), priceCurrency: currency } }
        : {}),
      availability:
        product.inventoryCount > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
    },
  }
}

export function buildCollectionJsonLd(title: string, description: string | undefined, slug: string, storeUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: description ?? title,
    url: `${storeUrl}/collection/${slug}`,
  }
}

export function buildBreadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}
