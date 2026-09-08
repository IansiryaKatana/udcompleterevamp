/** Unique live IA routes mapped onto Unique OS `/collection/$slug` handles. */

export type CatalogueNavItem = {
  label: string
  slug: string
  highlight?: boolean
}

export type CatalogueHrefItem = {
  label: string
  href: string
  highlight?: boolean
}

/** Primary header categories from uniquedistribution.com, using imported collection handles. */
export const UNIQUE_HEADER_CATEGORIES: CatalogueNavItem[] = [
  { label: 'Vapes', slug: 'vapes' },
  { label: 'Nic Salts', slug: '10ml-nic-salt' },
  { label: 'Nic Pouches', slug: 'nicotine-pouches' },
  { label: 'Confectionery', slug: 'confectionery' },
  { label: 'Drinks', slug: 'drinks' },
  { label: 'Smoking Accessories', slug: 'smoking-accessories' },
  { label: 'Essentials', slug: 'essentials' },
  { label: 'Offers', slug: 'deals', highlight: true },
  { label: 'CBD', slug: 'haze-cbd' },
]

/** Homepage Shop by Category tiles — Unique live labels, Unique OS collection slugs. */
export const UNIQUE_SHOP_BY_CATEGORY: CatalogueNavItem[] = [
  { label: '10ml Nic Salt', slug: '10ml-nic-salt' },
  { label: 'Legal Big Puff', slug: 'legal-big-puff-device' },
  { label: 'Legal Big Puff Pods', slug: 'legal-big-puff-pods' },
  { label: 'Nicotine Pouches', slug: 'nicotine-pouches' },
  { label: 'Shortfills & Nic Shots', slug: 'shortfills-nic-shots' },
  { label: 'Vape coils/pods', slug: 'vape-coils-pods' },
  { label: 'Vape Pod Kits', slug: 'wholesale-vape-pod-kits' },
  { label: 'Smoking Accessories', slug: 'smoking-accessories' },
  { label: 'Shop Essentials', slug: 'essentials' },
  { label: 'CBD', slug: 'haze-cbd' },
  { label: 'Confectionery', slug: 'confectionery' },
  { label: 'Drinks', slug: 'drinks' },
]

export const UNIQUE_OTHERS_NAV: CatalogueHrefItem[] = [
  { label: 'Brands', href: '/brands' },
  { label: 'New arrivals', href: '/collection/new' },
  { label: 'Legal Big Puff', href: '/collection/legal-big-puff-device' },
  { label: 'Shortfills & Nic Shots', href: '/collection/shortfills-nic-shots' },
  { label: 'Vape coils/pods', href: '/collection/vape-coils-pods' },
  { label: 'Vape Pod Kits', href: '/collection/wholesale-vape-pod-kits' },
  { label: 'All products', href: '/collection/all' },
]

export function collectionHref(slug: string) {
  return `/collection/${slug}`
}

export function headerCategoryLinks(items = UNIQUE_HEADER_CATEGORIES): CatalogueHrefItem[] {
  return items.map((item) => ({
    label: item.label,
    href: collectionHref(item.slug),
    highlight: item.highlight,
  }))
}

export function shopByCategoryLinks(items = UNIQUE_SHOP_BY_CATEGORY): CatalogueHrefItem[] {
  return items.map((item) => ({
    label: item.label,
    href: collectionHref(item.slug),
  }))
}
