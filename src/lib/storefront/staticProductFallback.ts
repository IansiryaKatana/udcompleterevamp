import type { CmsSnapshot, Product } from '@/data/static-cms'
import { staticCmsSnapshot } from '@/data/static-cms'
import { getCategoryBySlug, getCategoryTreeIds } from '@/lib/cms/loadCmsSnapshot'
import { searchProducts } from '@/lib/searchProducts'

export type StorefrontListFilter =
  | 'all'
  | 'new'
  | 'best'
  | 'deals'
  | 'category'
  | 'collection'
  | 'brand'

export type StorefrontListParams = {
  filter: StorefrontListFilter
  slug?: string
  minPrice?: number | null
  maxPrice?: number | null
  inStockOnly?: boolean
  sort?: 'default' | 'price_asc' | 'price_desc' | 'name'
  vendor?: string | null
  productType?: string | null
  strength?: string | null
}

export function resolveStorefrontListParams(
  slug: string,
  snapshot: CmsSnapshot,
): StorefrontListParams | null {
  if (slug === 'all') return { filter: 'all' }
  if (slug === 'new') return { filter: 'new' }
  if (slug === 'best') return { filter: 'best' }
  if (slug === 'deals' || slug === 'summer' || slug === 'offers') return { filter: 'deals' }

  const category = getCategoryBySlug(snapshot, slug)
  if (category) return { filter: 'category', slug }

  const collection = snapshot.collections.find((c) => c.slug === slug)
  if (collection) return { filter: 'collection', slug }

  return null
}

function filterStaticProducts(params: StorefrontListParams, snapshot: CmsSnapshot): Product[] {
  let products = snapshot.products

  switch (params.filter) {
    case 'all':
      break
    case 'new':
      products = products.filter((p) => p.isNew)
      break
    case 'best':
      products = products.filter((p) => p.isFeatured)
      break
    case 'deals':
      products = products.filter((p) => p.isSummer)
      break
    case 'category': {
      const category = getCategoryBySlug(snapshot, params.slug ?? '')
      if (!category) return []
      const ids = getCategoryTreeIds(snapshot, category.id)
      products = products.filter((p) => p.categoryId && ids.includes(p.categoryId))
      break
    }
    case 'collection': {
      const collection = snapshot.collections.find((c) => c.slug === params.slug)
      if (!collection) return []
      products = products.filter((p) => p.collectionId === collection.id)
      break
    }
    default:
      break
  }

  if (params.minPrice != null) products = products.filter((p) => p.price >= params.minPrice!)
  if (params.maxPrice != null) products = products.filter((p) => p.price <= params.maxPrice!)
  if (params.inStockOnly) products = products.filter((p) => p.inventoryCount > 0)

  switch (params.sort) {
    case 'price_asc':
      products = [...products].sort((a, b) => a.price - b.price)
      break
    case 'price_desc':
      products = [...products].sort((a, b) => b.price - a.price)
      break
    case 'name':
      products = [...products].sort((a, b) => a.name.localeCompare(b.name))
      break
    default:
      products = [...products].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  return products
}

export function listStaticStorefrontProducts(
  params: StorefrontListParams,
  snapshot: CmsSnapshot,
  limit: number,
  offset: number,
): { items: Product[]; total: number } {
  const filtered = filterStaticProducts(params, snapshot)
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
  }
}

export function searchStaticStorefrontProducts(
  query: string,
  limit: number,
  offset: number,
): { items: Product[]; total: number } {
  const filtered = searchProducts(staticCmsSnapshot.products, query)
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
  }
}

export function getStaticStorefrontProduct(slug: string): Product | null {
  return staticCmsSnapshot.products.find((p) => p.slug === slug) ?? null
}

export function getStaticHomepageProducts(sectionKey: 'newly_dropped' | 'summer_collections'): Product[] {
  if (sectionKey === 'newly_dropped') {
    return staticCmsSnapshot.products.filter((p) => p.isNew).slice(0, 8)
  }
  return staticCmsSnapshot.products.filter((p) => p.isSummer).slice(0, 8)
}

/** Prefer parent category so sibling products appear. */
export function buildRelatedProductFilters(
  product: Product,
  snapshot: CmsSnapshot,
): StorefrontListParams[] {
  const filters: StorefrontListParams[] = []
  const category = snapshot.categories.find((c) => c.id === product.categoryId)

  if (category?.parentId) {
    const parent = snapshot.categories.find((c) => c.id === category.parentId)
    if (parent) filters.push({ filter: 'category', slug: parent.slug })
  } else if (category) {
    filters.push({ filter: 'category', slug: category.slug })
  }

  if (product.collectionId) {
    const collection = snapshot.collections.find((c) => c.id === product.collectionId)
    if (collection) filters.push({ filter: 'collection', slug: collection.slug })
  }

  filters.push({ filter: 'all' })
  return filters
}

export async function resolveRelatedProducts(
  product: Product,
  snapshot: CmsSnapshot,
  limit: number,
  fromDatabase: boolean,
  fetchPage: (params: StorefrontListParams, fetchLimit: number) => Promise<Product[]>,
): Promise<Product[]> {
  const seen = new Set<string>([product.id])
  const results: Product[] = []

  for (const params of buildRelatedProductFilters(product, snapshot)) {
    if (results.length >= limit) break

    const items = fromDatabase
      ? await fetchPage(params, limit + 8)
      : filterStaticProducts(params, snapshot).filter((p) => p.published !== false)

    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      results.push(item)
      if (results.length >= limit) break
    }
  }

  return results
}

export function getRelatedStaticProducts(
  product: Product,
  snapshot: CmsSnapshot,
  limit = 4,
): Product[] {
  const products = snapshot.products
  const others = products.filter((p) => p.id !== product.id && p.published !== false)

  if (product.categoryId) {
    const ids = getCategoryTreeIds(snapshot, product.categoryId)
    const parent = snapshot.categories.find((c) => c.id === product.categoryId)?.parentId
    if (parent) ids.push(...getCategoryTreeIds(snapshot, parent))

    const related = others.filter((p) => p.categoryId && ids.includes(p.categoryId))
    if (related.length > 0) return related.slice(0, limit)
  }

  if (product.collectionId) {
    const related = others.filter((p) => p.collectionId === product.collectionId)
    if (related.length > 0) return related.slice(0, limit)
  }

  return others.slice(0, limit)
}
