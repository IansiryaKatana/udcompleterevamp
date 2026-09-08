import type { Database } from '@/integrations/supabase/database.types'
import type { Product, ProductReviewItem, ProductReviewSummary, ProductSpec, ProductVariant } from '@/data/static-cms'

function parseGalleryUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function resolveProductImageUrl(product: {
  imageUrl?: string | null
  galleryUrls?: string[] | null
  variants?: Array<{ imageUrl?: string | null }> | null
}): string {
  const primary = product.imageUrl?.trim() ?? ''
  if (primary) return primary
  const gallery = product.galleryUrls?.find((url) => url.trim().length > 0)?.trim()
  if (gallery) return gallery
  const variant = product.variants?.find((item) => item.imageUrl?.trim())?.imageUrl?.trim()
  return variant ?? ''
}

function parseSpecs(value: unknown): ProductSpec[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is { key?: unknown; value?: unknown } => item !== null && typeof item === 'object')
    .map((item) => ({ key: String(item.key ?? ''), value: String(item.value ?? '') }))
    .filter((item) => item.key.trim() && item.value.trim())
}

function parseOptionValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) out[key] = val.trim()
  }
  return out
}

export function mapVariantRow(
  row: Database['public']['Tables']['product_variants']['Row'] & {
    price_restricted?: boolean
  },
): ProductVariant {
  const restricted = Boolean(row.price_restricted) || row.price == null
  return {
    id: row.id,
    productId: row.product_id,
    name: row.name,
    sku: row.sku ?? null,
    price: restricted ? null : Number(row.price),
    compareAtPrice: restricted ? null : row.compare_at_price != null ? Number(row.compare_at_price) : null,
    inventoryCount: row.inventory_count,
    optionValues: parseOptionValues(row.option_values),
    imageUrl: row.image_url ?? null,
    sortOrder: row.sort_order,
  }
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function mapProductRow(
  row: Database['public']['Tables']['products']['Row'] & {
    price_restricted?: boolean
    price_visibility?: string
    vendor?: string | null
    product_type?: string | null
    nicotine_strength?: string | null
    pack_quantity?: string | null
  },
): Product {
  const extra = row as Record<string, unknown>
  const restricted =
    Boolean(row.price_restricted) ||
    row.price_visibility === 'redacted' ||
    row.price == null
  const galleryUrls = parseGalleryUrls(row.gallery_urls)
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    overview: row.overview ?? '',
    price: restricted ? 0 : Number(row.price),
    compareAtPrice: restricted ? null : row.compare_at_price != null ? Number(row.compare_at_price) : null,
    priceRestricted: restricted,
    sku: row.sku ?? null,
    weightKg: row.weight_kg != null ? Number(row.weight_kg) : null,
    specs: parseSpecs(row.specs),
    imageUrl: resolveProductImageUrl({ imageUrl: row.image_url, galleryUrls }),
    galleryUrls,
    categoryId: row.category_id,
    collectionId: row.collection_id,
    badge: row.badge,
    isFeatured: row.is_featured,
    isNew: row.is_new,
    isSummer: row.is_summer,
    inventoryCount: row.inventory_count,
    published: row.published,
    sortOrder: row.sort_order,
    vendor: readOptionalText(extra.vendor),
    productType: readOptionalText(extra.product_type ?? extra.productType),
    nicotineStrength: readOptionalText(extra.nicotine_strength ?? extra.nicotineStrength),
    packQuantity: readOptionalText(extra.pack_quantity ?? extra.packQuantity),
  }
}

export function mapProductRows(rows: Database['public']['Tables']['products']['Row'][]): Product[] {
  return rows.map(mapProductRow)
}

export function mapReviewItems(value: unknown): ProductReviewItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item) => ({
      id: String(item.id ?? ''),
      rating: Number(item.rating ?? 0),
      title: item.title != null ? String(item.title) : null,
      body: String(item.body ?? ''),
      authorLabel: String(item.author_label ?? 'Customer'),
      createdAt: String(item.created_at ?? ''),
    }))
    .filter((item) => item.id && item.body)
}

export function mapReviewSummary(value: unknown): ProductReviewSummary {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    averageRating: Number(record.average_rating ?? 0),
    count: Number(record.count ?? 0),
    items: mapReviewItems(record.items),
  }
}

export function effectiveProductInventory(product: Product, variant?: ProductVariant | null): number {
  if (product.variants && product.variants.length > 0) {
    return variant?.inventoryCount ?? 0
  }
  return product.inventoryCount
}

export function effectiveProductPrice(product: Product, variant?: ProductVariant | null): number {
  if (variant?.price != null) return variant.price
  return product.price
}

export function effectiveCompareAtPrice(product: Product, variant?: ProductVariant | null): number | null {
  if (variant?.compareAtPrice != null) return variant.compareAtPrice
  return product.compareAtPrice ?? null
}

export function productRequiresVariant(product: Product): boolean {
  return Boolean(product.variants && product.variants.length > 0)
}

export function cartLineKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}:${variantId}` : productId
}
