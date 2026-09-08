import { useQuery } from '@tanstack/react-query'
import { useCms } from '@/contexts/CmsContext'
import { isSupabaseConfigured } from '@/integrations/supabase/client'
import {
  fetchCustomerOrderDetail,
  fetchCustomerOrders,
  fetchHomepageProducts,
  fetchMyAddresses,
  fetchMyCompany,
  fetchMyInvoices,
  fetchMyQuotes,
  fetchMyStatements,
  fetchShopNav,
  fetchStorefrontBrands,
  fetchStorefrontBundleBySlug,
  fetchStorefrontBundles,
  fetchStorefrontFacets,
  fetchStorefrontProductBySlug,
  fetchStorefrontProducts,
  fetchStorefrontSearch,
  fetchTradeApplicationFields,
  fetchCheckoutRules,
  fetchPaymentGatewayPublicStatus,
} from '@/lib/storefront/storefrontRpc'
import type { StorefrontListParams } from '@/lib/storefront/staticProductFallback'
import type { Product } from '@/data/static-cms'
import {
  getRelatedStaticProducts,
  getStaticHomepageProducts,
  getStaticStorefrontProduct,
  listStaticStorefrontProducts,
  resolveRelatedProducts,
  searchStaticStorefrontProducts,
} from '@/lib/storefront/staticProductFallback'
import {
  getStaticBundleBySlug,
  listStaticBundles,
} from '@/lib/bundles/staticBundleFallback'

export const storefrontKeys = {
  all: ['storefront', isSupabaseConfigured() ? 'db' : 'static'] as const,
  products: (params: StorefrontListParams, limit: number, offset: number) =>
    [...storefrontKeys.all, 'products', params, limit, offset] as const,
  search: (query: string, limit: number, offset: number) =>
    [...storefrontKeys.all, 'search', query, limit, offset] as const,
  product: (slug: string) => [...storefrontKeys.all, 'product', slug] as const,
  homepage: (section: 'newly_dropped' | 'summer_collections') =>
    [...storefrontKeys.all, 'homepage', section] as const,
  orders: () => [...storefrontKeys.all, 'orders'] as const,
  order: (id: string) => [...storefrontKeys.all, 'order', id] as const,
  related: (productId: string, filterKey: string) =>
    [...storefrontKeys.all, 'related', productId, filterKey] as const,
  bundles: (limit: number, offset: number) =>
    [...storefrontKeys.all, 'bundles', limit, offset] as const,
  bundle: (slug: string) => [...storefrontKeys.all, 'bundle', slug] as const,
  hasBundles: () => [...storefrontKeys.all, 'has-bundles'] as const,
  shopNav: () => [...storefrontKeys.all, 'shop-nav'] as const,
  brands: (query: string) => [...storefrontKeys.all, 'brands', query] as const,
  facets: () => [...storefrontKeys.all, 'facets'] as const,
  quotes: () => [...storefrontKeys.all, 'quotes'] as const,
  invoices: () => [...storefrontKeys.all, 'invoices'] as const,
  statements: () => [...storefrontKeys.all, 'statements'] as const,
  addresses: () => [...storefrontKeys.all, 'addresses'] as const,
  company: () => [...storefrontKeys.all, 'company'] as const,
  tradeFields: () => [...storefrontKeys.all, 'trade-fields'] as const,
  checkoutRules: (context: Record<string, unknown>) => [...storefrontKeys.all, 'checkout-rules', context] as const,
  paymentGateway: () => [...storefrontKeys.all, 'payment-gateway'] as const,
}

function useDatabaseCatalog() {
  return isSupabaseConfigured()
}

export function useStorefrontProductList(
  params: StorefrontListParams,
  limit: number,
  offset: number,
) {
  const { snapshot } = useCms()
  const fromDatabase = useDatabaseCatalog()

  return useQuery({
    queryKey: storefrontKeys.products(params, limit, offset),
    queryFn: async () => {
      if (fromDatabase) {
        return await fetchStorefrontProducts(params, limit, offset)
      }
      return listStaticStorefrontProducts(params, snapshot, limit, offset)
    },
    staleTime: 60_000,
  })
}

export function useStorefrontSearch(query: string, limit: number, offset: number) {
  const fromDatabase = useDatabaseCatalog()

  return useQuery({
    queryKey: storefrontKeys.search(query, limit, offset),
    queryFn: async () => {
      const q = query.trim()
      if (!q) return { items: [], total: 0 }
      if (fromDatabase) {
        return await fetchStorefrontSearch(q, limit, offset)
      }
      return searchStaticStorefrontProducts(q, limit, offset)
    },
    enabled: query.trim().length > 0,
    staleTime: 60_000,
  })
}

export function useStorefrontProduct(slug: string) {
  const { snapshot } = useCms()
  const fromDatabase = useDatabaseCatalog()

  return useQuery({
    queryKey: storefrontKeys.product(slug),
    queryFn: async () => {
      if (fromDatabase) {
        return await fetchStorefrontProductBySlug(slug)
      }
      return getStaticStorefrontProduct(slug)
    },
    staleTime: 60_000,
  })
}

export function useHomepageProducts(sectionKey: 'newly_dropped' | 'summer_collections') {
  const fromDatabase = useDatabaseCatalog()
  const section = sectionKey === 'newly_dropped' ? 'new' : 'summer'

  return useQuery({
    queryKey: storefrontKeys.homepage(sectionKey),
    queryFn: async () => {
      if (fromDatabase) {
        return await fetchHomepageProducts(section)
      }
      return getStaticHomepageProducts(sectionKey)
    },
    staleTime: 60_000,
  })
}

export function useStorefrontBundleList(limit: number, offset: number) {
  const { snapshot } = useCms()
  const fromDatabase = useDatabaseCatalog()

  return useQuery({
    queryKey: storefrontKeys.bundles(limit, offset),
    queryFn: async () => {
      if (fromDatabase) {
        return await fetchStorefrontBundles(limit, offset)
      }
      return listStaticBundles(snapshot, limit, offset)
    },
    staleTime: 60_000,
  })
}

export function useHasStorefrontBundles() {
  const { snapshot } = useCms()
  const fromDatabase = useDatabaseCatalog()

  return useQuery({
    queryKey: storefrontKeys.hasBundles(),
    queryFn: async () => {
      if (fromDatabase) {
        const result = await fetchStorefrontBundles(1, 0)
        return result.total > 0
      }
      return listStaticBundles(snapshot, 1, 0).total > 0
    },
    staleTime: 60_000,
  })
}

export function useStorefrontBundle(slug: string) {
  const { snapshot } = useCms()
  const fromDatabase = useDatabaseCatalog()

  return useQuery({
    queryKey: storefrontKeys.bundle(slug),
    queryFn: async () => {
      if (fromDatabase) {
        return await fetchStorefrontBundleBySlug(slug)
      }
      return getStaticBundleBySlug(snapshot, slug)
    },
    staleTime: 60_000,
  })
}

export function useCustomerOrders(enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.orders(),
    queryFn: fetchCustomerOrders,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
  })
}

export function useCustomerOrderDetail(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.order(orderId),
    queryFn: () => fetchCustomerOrderDetail(orderId),
    enabled: enabled && isSupabaseConfigured() && Boolean(orderId),
    staleTime: 30_000,
  })
}

export function useRelatedProducts(product: Product, limit = 4) {
  const { snapshot } = useCms()
  const fromDatabase = useDatabaseCatalog()

  const category = snapshot.categories.find((c) => c.id === product.categoryId)
  const collection = snapshot.collections.find((c) => c.id === product.collectionId)
  const parentCategory = category?.parentId
    ? snapshot.categories.find((c) => c.id === category.parentId)
    : null
  const filterKey = parentCategory?.slug ?? category?.slug ?? collection?.slug ?? 'all'

  return useQuery({
    queryKey: storefrontKeys.related(product.id, filterKey),
    queryFn: async () => {
      if (fromDatabase) {
        return resolveRelatedProducts(product, snapshot, limit, true, async (params, fetchLimit) => {
          const page = await fetchStorefrontProducts(params, fetchLimit, 0)
          return page.items
        })
      }
      return getRelatedStaticProducts(product, snapshot, limit)
    },
    staleTime: 60_000,
  })
}

export function useShopNav() {
  return useQuery({
    queryKey: storefrontKeys.shopNav(),
    queryFn: fetchShopNav,
    staleTime: 5 * 60_000,
  })
}

export function useStorefrontBrands(query = '') {
  return useQuery({
    queryKey: storefrontKeys.brands(query.trim().toLowerCase()),
    queryFn: () => fetchStorefrontBrands(query.trim() || undefined),
    staleTime: 5 * 60_000,
  })
}

export function useStorefrontFacets() {
  return useQuery({
    queryKey: storefrontKeys.facets(),
    queryFn: fetchStorefrontFacets,
    staleTime: 5 * 60_000,
  })
}

export function useMyQuotes(enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.quotes(),
    queryFn: fetchMyQuotes,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
  })
}

export function useMyInvoices(enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.invoices(),
    queryFn: fetchMyInvoices,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
  })
}

export function useMyStatements(enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.statements(),
    queryFn: fetchMyStatements,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
  })
}

export function useMyAddresses(enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.addresses(),
    queryFn: fetchMyAddresses,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
  })
}

export function useMyCompany(enabled: boolean) {
  return useQuery({
    queryKey: storefrontKeys.company(),
    queryFn: fetchMyCompany,
    enabled: enabled && isSupabaseConfigured(),
    staleTime: 30_000,
  })
}

export function useTradeApplicationFields() {
  return useQuery({
    queryKey: storefrontKeys.tradeFields(),
    queryFn: fetchTradeApplicationFields,
    staleTime: 5 * 60_000,
  })
}

export function useCheckoutRules(context: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: storefrontKeys.checkoutRules(context),
    queryFn: () => fetchCheckoutRules(context),
    staleTime: 30_000,
  })
}

export function usePaymentGatewayPublicStatus() {
  return useQuery({
    queryKey: storefrontKeys.paymentGateway(),
    queryFn: fetchPaymentGatewayPublicStatus,
    staleTime: 60_000,
  })
}
