import type { Database } from '@/integrations/supabase/database.types'
import type { Product, ProductBundle } from '@/data/static-cms'
import { mapProductRow, mapProductRows, mapReviewSummary, mapVariantRow, resolveProductImageUrl } from '@/lib/cms/mapProduct'
import { mapBundleDetail, mapBundleListRow } from '@/lib/bundles/mapBundle'
import { isSupabaseConfigured, tryGetSupabase } from '@/integrations/supabase/client'
import type { StorefrontListParams } from '@/lib/storefront/staticProductFallback'

type RpcOk<T> = { ok: true } & T
type RpcErr = { ok: false; error?: string }

export type StorefrontProductPage = {
  items: Product[]
  total: number
}

export type StorefrontBundlePage = {
  items: ProductBundle[]
  total: number
}

function getClient() {
  const supabase = tryGetSupabase()
  if (!supabase || !isSupabaseConfigured()) return null
  return supabase
}

function parseProductPage(data: unknown): StorefrontProductPage {
  const result = data as RpcOk<{ items: Database['public']['Tables']['products']['Row'][]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load products')
  return {
    items: mapProductRows(result.items ?? []),
    total: Number(result.total ?? 0),
  }
}

export async function fetchStorefrontProducts(
  params: StorefrontListParams,
  limit: number,
  offset: number,
): Promise<StorefrontProductPage> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('rpc_list_storefront_products', {
    p_filter: params.filter,
    p_slug: params.slug ?? null,
    p_limit: limit,
    p_offset: offset,
    p_min_price: params.minPrice ?? null,
    p_max_price: params.maxPrice ?? null,
    p_in_stock_only: params.inStockOnly ?? false,
    p_sort: params.sort ?? 'default',
    p_force_mode: null,
    p_vendor: params.vendor ?? null,
    p_product_type: params.productType ?? null,
    p_strength: params.strength ?? null,
  } as never)
  if (error) throw new Error(error.message)
  return parseProductPage(data)
}

export async function fetchStorefrontSearch(
  query: string,
  limit: number,
  offset: number,
): Promise<StorefrontProductPage> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('rpc_search_storefront_products', {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(error.message)
  return parseProductPage(data)
}

export async function fetchStorefrontProductBySlug(slug: string): Promise<Product | null> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('rpc_get_storefront_product', { p_slug: slug })
  if (error) throw new Error(error.message)

  const result = data as RpcOk<{
    product: Database['public']['Tables']['products']['Row']
    variants?: Database['public']['Tables']['product_variants']['Row'][]
    reviews?: unknown
    delivery_text?: string | null
  }> | RpcErr
  if (!result?.ok || !result.product) return null

  const product = mapProductRow(result.product)
  product.variants = (result.variants ?? []).map(mapVariantRow)
  product.imageUrl = resolveProductImageUrl(product)
  product.reviews = mapReviewSummary(result.reviews)
  product.deliveryText = result.delivery_text ?? null
  return product
}

export async function fetchHomepageProducts(section: 'new' | 'summer'): Promise<Product[]> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  // Prefer gated RPC when available (price redaction under trade_required eval)
  const gated = await (
    supabase as unknown as {
      rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_get_homepage_products_gated', { p_section: section, p_force_mode: null })

  if (!gated.error && gated.data) {
    const result = gated.data as RpcOk<{ items: Database['public']['Tables']['products']['Row'][] }> | RpcErr
    if (result && 'ok' in result && result.ok) {
      return mapProductRows(result.items ?? [])
    }
  }

  const { data, error } = await supabase.rpc('rpc_get_homepage_products', { p_section: section })
  if (error) throw new Error(error.message)
  return mapProductRows(data ?? [])
}

export type CustomerOrderSummary = {
  id: string
  order_number: string
  status: string
  fulfillment_status?: string
  total: number
  currency: string
  created_at: string
}

export type CustomerOrderDetail = CustomerOrderSummary & {
  email: string
  subtotal: number
  fulfillment_status: string
  tracking_number: string | null
  carrier: string | null
  shipped_at: string | null
  shipping_address: Database['public']['Tables']['orders']['Row']['shipping_address']
  order_items: Database['public']['Tables']['order_items']['Row'][]
}

export async function fetchCustomerOrders(): Promise<CustomerOrderSummary[]> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, status, fulfillment_status, total, currency, created_at')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    ...row,
    total: Number(row.total),
  }))
}

export async function fetchCustomerOrderDetail(orderId: string): Promise<CustomerOrderDetail | null> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_number, status, total, currency, created_at, email, subtotal, shipping_address, fulfillment_status, tracking_number, carrier, shipped_at')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) throw new Error(orderError.message)
  if (!order) return null

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  if (itemsError) throw new Error(itemsError.message)

  return {
    ...order,
    total: Number(order.total),
    subtotal: Number(order.subtotal),
    order_items: items ?? [],
  }
}

export async function toggleWishlist(productId: string): Promise<{ inWishlist: boolean }> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('rpc_toggle_wishlist', { p_product_id: productId })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ in_wishlist: boolean }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Wishlist update failed')
  return { inWishlist: Boolean(result.in_wishlist) }
}

export async function fetchWishlistProductIds(): Promise<string[]> {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await supabase.rpc('rpc_list_wishlist_product_ids')
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ product_ids: string[] }> | RpcErr
  if (!result?.ok) return []
  return (result.product_ids ?? []).map(String)
}

export async function fetchWishlistProducts(): Promise<Product[]> {
  const supabase = getClient()
  if (!supabase) return []

  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_list_wishlist_products', { p_force_mode: null })

  if (error) {
    // Fallback: IDs only then gated by-ids (never raw products.select *)
    const ids = await fetchWishlistProductIds()
    if (ids.length === 0) return []
    const batch = await (
      supabase as unknown as {
        rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
      }
    ).rpc('rpc_get_storefront_products_by_ids', { p_ids: ids, p_force_mode: null })
    if (batch.error) throw new Error(batch.error.message)
    const result = batch.data as RpcOk<{ items: Database['public']['Tables']['products']['Row'][] }> | RpcErr
    if (!result?.ok) return []
    const byId = new Map(mapProductRows(result.items ?? []).map((p) => [p.id, p]))
    return ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p))
  }

  const result = data as RpcOk<{ items: Database['public']['Tables']['products']['Row'][] }> | RpcErr
  if (!result?.ok) return []
  return mapProductRows(result.items ?? [])
}

export async function submitProductReview(input: {
  productId: string
  rating: number
  title?: string
  body: string
}): Promise<void> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('rpc_submit_product_review', {
    p_product_id: input.productId,
    p_rating: input.rating,
    p_title: input.title ?? null,
    p_body: input.body,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<Record<string, never>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to submit review')
}

export async function fetchStorefrontBundles(limit: number, offset: number): Promise<StorefrontBundlePage> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('rpc_list_storefront_bundles', {
    p_limit: limit,
    p_offset: offset,
    p_force_mode: null,
  })
  if (error) throw new Error(error.message)

  const result = data as RpcOk<{
    items: Array<Database['public']['Tables']['product_bundles']['Row'] & { price_restricted?: boolean }>
    total: number
  }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load bundles')
  return {
    items: (result.items ?? []).map(mapBundleListRow),
    total: Number(result.total ?? 0),
  }
}

export async function fetchStorefrontBundleBySlug(slug: string): Promise<ProductBundle | null> {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')

  const { data, error } = await supabase.rpc('rpc_get_storefront_bundle', {
    p_slug: slug,
    p_force_mode: null,
  })
  if (error) throw new Error(error.message)

  const result = data as RpcOk<{
    bundle: Database['public']['Tables']['product_bundles']['Row'] & { price_restricted?: boolean }
    items: Array<{
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
      variants?: Database['public']['Tables']['product_variants']['Row'][]
    }>
    available_quantity: number
  }> | RpcErr

  if (!result?.ok || !result.bundle) return null
  return mapBundleDetail(result.bundle, result.items ?? [], Number(result.available_quantity ?? 0))
}

export async function canReviewProduct(productId: string): Promise<{ canReview: boolean; reason?: string }> {
  const supabase = getClient()
  if (!supabase) return { canReview: false, reason: 'offline' }

  const { data, error } = await supabase.rpc('rpc_can_review_product', { p_product_id: productId })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ can_review: boolean; reason?: string }> | RpcErr
  if (!result?.ok) return { canReview: false }
  return { canReview: Boolean(result.can_review), reason: result.reason }
}

export type ShopNavItem = {
  label: string
  href: string
  slug?: string
  title?: string
  product_count?: number
  image_url?: string | null
  highlight?: boolean
}

export type ShopNav = {
  items: ShopNavItem[]
  header: ShopNavItem[]
  shopByCategory: ShopNavItem[]
  others: ShopNavItem[]
  viewAll: ShopNavItem
}

function mapNavItems(value: unknown): ShopNavItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ShopNavItem => Boolean(item && typeof item === 'object' && 'href' in item && 'label' in item))
}

export async function fetchShopNav(): Promise<ShopNav> {
  const supabase = getClient()
  const fallback: ShopNav = {
    items: [],
    header: [],
    shopByCategory: [],
    others: [],
    viewAll: { label: 'View all categories', href: '/collection/all' },
  }
  if (!supabase) return fallback
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_storefront_shop_nav')
  if (error || !(data as { ok?: boolean })?.ok) return fallback
  const result = data as {
    items?: unknown
    header?: unknown
    shop_by_category?: unknown
    others?: unknown
    view_all?: ShopNavItem
  }
  const shopByCategory = mapNavItems(result.shop_by_category)
  const items = mapNavItems(result.items)
  return {
    items: items.length ? items : shopByCategory,
    header: mapNavItems(result.header),
    shopByCategory,
    others: mapNavItems(result.others),
    viewAll: result.view_all ?? fallback.viewAll,
  }
}

export type StorefrontBrand = { vendor: string; handle: string; product_count: number }

export async function fetchStorefrontBrands(query?: string): Promise<StorefrontBrand[]> {
  const supabase = getClient()
  if (!supabase) return []
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_storefront_brands', { p_query: query ?? null })
  if (error || !(data as { ok?: boolean })?.ok) return []
  return ((data as { items?: StorefrontBrand[] }).items ?? []).filter((b) => b.vendor && b.handle)
}

export type FacetOption = { value: string; count: number }

export type StorefrontFacets = {
  vendors: FacetOption[]
  productTypes: FacetOption[]
  nicotineStrengths: FacetOption[]
  featuredAvailable: boolean
  newAvailable: boolean
  offersAvailable: boolean
}

export async function fetchStorefrontFacets(): Promise<StorefrontFacets> {
  const empty: StorefrontFacets = {
    vendors: [],
    productTypes: [],
    nicotineStrengths: [],
    featuredAvailable: false,
    newAvailable: false,
    offersAvailable: false,
  }
  const supabase = getClient()
  if (!supabase) return empty
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_storefront_product_facets', { p_slug: null, p_filter: 'all' })
  if (error || !(data as { ok?: boolean })?.ok) return empty
  const result = data as Record<string, unknown>
  return {
    vendors: (result.vendors as FacetOption[]) ?? [],
    productTypes: (result.product_types as FacetOption[]) ?? [],
    nicotineStrengths: (result.nicotine_strengths as FacetOption[]) ?? [],
    featuredAvailable: Boolean(result.featured_available),
    newAvailable: Boolean(result.new_available),
    offersAvailable: Boolean(result.offers_available),
  }
}

export async function fetchCatalogueStats() {
  const supabase = getClient()
  if (!supabase) return null
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_storefront_catalogue_stats')
  if (error || !(data as { ok?: boolean })?.ok) return null
  return data as {
    published_products: number
    shopify_sourced_products: number
    published_collections: number
    vendors: number
  }
}

export async function fetchPaymentGatewayPublicStatus() {
  const supabase = getClient()
  if (!supabase) return { gateway_mode: 'disabled', card_operational: false }
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_payment_gateway_public_status')
  if (error || !(data as { ok?: boolean })?.ok) return { gateway_mode: 'disabled', card_operational: false }
  const result = data as { gateway_mode?: string; card_operational?: boolean }
  return {
    gateway_mode: result.gateway_mode ?? 'disabled',
    card_operational: Boolean(result.card_operational),
  }
}

export type TradeApplicationField = {
  field_key: string
  label: string
  field_type: string
  required: boolean
  sort_order: number
  options: unknown
}

export async function fetchTradeApplicationFields(): Promise<TradeApplicationField[]> {
  const supabase = getClient()
  if (!supabase) return []
  const { data, error } = await supabase
    .from('trade_application_fields')
    .select('field_key, label, field_type, required, sort_order, options')
    .eq('enabled', true)
    .order('sort_order')
  if (error) return []
  return (data ?? []) as TradeApplicationField[]
}

export async function fetchMyQuotes() {
  const supabase = getClient()
  if (!supabase) return []
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_list_my_quotes')
  if (error || !(data as { ok?: boolean })?.ok) return []
  return ((data as { items?: Array<Record<string, unknown>> }).items ?? []) as Array<{
    id: string
    order_number: string
    status: string
    total: number
    currency: string
    created_at: string
  }>
}

export async function fetchMyInvoices() {
  const supabase = getClient()
  if (!supabase) return []
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_list_my_invoices')
  if (error || !(data as { ok?: boolean })?.ok) return []
  return ((data as { items?: Array<Record<string, unknown>> }).items ?? []) as Array<{
    id: string
    invoice_number: string
    invoice_date: string
    due_date: string | null
    total: number
    outstanding: number
    status: string
    currency: string
    provenance: string
    display_kind: string
  }>
}

export async function fetchMyStatements() {
  const supabase = getClient()
  if (!supabase) return []
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_list_my_statements')
  if (error || !(data as { ok?: boolean })?.ok) return []
  return ((data as { items?: Array<Record<string, unknown>> }).items ?? []) as Array<{
    id: string
    period_from: string
    period_to: string
    opening_balance: number
    closing_balance: number
    currency: string
    display_kind: string
  }>
}

export async function fetchMyAddresses() {
  const supabase = getClient()
  if (!supabase) return []
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_list_my_addresses')
  if (error || !(data as { ok?: boolean })?.ok) return []
  return ((data as { items?: Array<Record<string, unknown>> }).items ?? []) as Array<{
    id: string
    address_type: string
    is_default: boolean
    first_name: string | null
    last_name: string | null
    company: string | null
    address1: string | null
    address2: string | null
    city: string | null
    province: string | null
    postal_code: string | null
    country: string | null
    phone: string | null
  }>
}

export async function upsertMyAddress(payload: Record<string, unknown>) {
  const supabase = getClient()
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_upsert_my_address', { p_payload: payload })
  if (error) throw new Error(error.message)
  const result = data as { ok?: boolean; error?: string; id?: string }
  if (!result?.ok) throw new Error(result.error ?? 'Could not save address')
  return result
}

export async function fetchMyCompany() {
  const supabase = getClient()
  if (!supabase) return null
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_get_my_company')
  if (error || !(data as { ok?: boolean })?.ok) return null
  return ((data as { company?: Record<string, unknown> | null }).company ?? null) as {
    id: string
    name: string
    trading_name: string | null
    status: string
  } | null
}

export async function fetchCheckoutRules(context: Record<string, unknown> = {}) {
  const supabase = getClient()
  if (!supabase) return { fields: [] as Array<{ field: string; required?: boolean }>, messages: [] as string[], blocked: false }
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc('rpc_evaluate_checkout_rules', { p_context: context })
  if (error || !(data as { ok?: boolean })?.ok) {
    return { fields: [] as Array<{ field: string; required?: boolean }>, messages: [] as string[], blocked: false }
  }
  const result = data as { fields?: Array<{ field: string; required?: boolean }>; messages?: string[]; blocked?: boolean }
  return {
    fields: result.fields ?? [],
    messages: result.messages ?? [],
    blocked: Boolean(result.blocked),
  }
}
