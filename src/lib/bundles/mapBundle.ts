import type { Database } from '@/integrations/supabase/database.types'
import type { ProductBundle, ProductBundleItem, ProductVariant } from '@/data/static-cms'
import { mapVariantRow } from '@/lib/cms/mapProduct'

type BundleRow = Database['public']['Tables']['product_bundles']['Row']

type BundleItemRpc = {
  id: string
  bundle_id: string
  product_id: string
  variant_id: string | null
  quantity: number
  sort_order: number
  label: string | null
  product: {
    id: string
    name: string
    slug: string
    image_url: string | null
    price: number | null
    inventory_count: number
    price_restricted?: boolean
  }
  variants?: Array<Database['public']['Tables']['product_variants']['Row']>
}

function galleryFromRow(row: BundleRow): string[] {
  const urls = Array.isArray(row.gallery_urls) ? (row.gallery_urls as string[]) : []
  return urls.filter((url) => typeof url === 'string' && url.trim().length > 0)
}

function mapBundleItem(row: BundleItemRpc): ProductBundleItem {
  const variants = (row.variants ?? []).map(mapVariantRow)
  return {
    id: row.id,
    bundleId: row.bundle_id,
    productId: row.product_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    sortOrder: row.sort_order,
    label: row.label,
    product: {
      id: row.product.id,
      name: row.product.name,
      slug: row.product.slug,
      imageUrl: row.product.image_url?.trim() || variants.find((item) => item.imageUrl?.trim())?.imageUrl?.trim() || '',
      price: row.product.price == null || row.product.price_restricted ? 0 : Number(row.product.price),
      priceRestricted: Boolean(row.product.price_restricted) || row.product.price == null,
      inventoryCount: Number(row.product.inventory_count),
      variants: variants.length > 0 ? variants : undefined,
    },
  }
}

export function mapBundleRow(
  row: BundleRow & { price_restricted?: boolean },
  items: ProductBundleItem[] = [],
  availableQuantity = 0,
): ProductBundle {
  const restricted = Boolean(row.price_restricted) || row.price == null
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    overview: row.overview,
    description: row.description,
    price: restricted ? 0 : Number(row.price),
    compareAtPrice: restricted ? null : row.compare_at_price != null ? Number(row.compare_at_price) : null,
    priceRestricted: restricted,
    sku: row.sku,
    imageUrl: row.image_url ?? '',
    galleryUrls: galleryFromRow(row),
    badge: row.badge,
    published: row.published,
    sortOrder: row.sort_order,
    items,
    availableQuantity,
  }
}

export function mapBundleListRow(row: BundleRow): ProductBundle {
  return mapBundleRow(row)
}

export function mapBundleDetail(
  bundle: BundleRow,
  items: BundleItemRpc[],
  availableQuantity: number,
): ProductBundle {
  return mapBundleRow(
    bundle,
    items.map(mapBundleItem).sort((a, b) => a.sortOrder - b.sortOrder),
    availableQuantity,
  )
}

export function bundleLineKey(bundleId: string, selections: Array<{ bundleItemId: string; variantId: string }>): string {
  const suffix = [...selections]
    .sort((a, b) => a.bundleItemId.localeCompare(b.bundleItemId))
    .map((s) => `${s.bundleItemId}:${s.variantId}`)
    .join('|')
  return suffix ? `bundle:${bundleId}:${suffix}` : `bundle:${bundleId}`
}

export function bundleItemRequiresSelection(item: ProductBundleItem): boolean {
  if (item.variantId) return false
  return Boolean(item.product.variants && item.product.variants.length > 0)
}

export function bundleItemVariants(item: ProductBundleItem): ProductVariant[] {
  return item.product.variants ?? []
}
