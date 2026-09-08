import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Product, ProductBundle, ProductVariant } from '@/data/static-cms'
import {
  cartLineKey,
  effectiveCompareAtPrice,
  effectiveProductInventory,
  effectiveProductPrice,
  productRequiresVariant,
} from '@/lib/cms/mapProduct'
import { bundleLineKey } from '@/lib/bundles/mapBundle'
import {
  buildBundleComponentSummary,
  computeStaticBundleAvailableQuantity,
  type BundleSelection,
  validateBundleSelections,
} from '@/lib/bundles/staticBundleFallback'

export type { BundleSelection }

type CartItemBase = {
  lineKey: string
  slug: string
  name: string
  price: number
  imageUrl: string
  quantity: number
  inventoryCount: number
}

export type ProductCartItem = CartItemBase & {
  kind: 'product'
  productId: string
  variantId: string | null
  variantName: string | null
  sku: string | null
  packQuantity: string | null
}

export type BundleCartItem = CartItemBase & {
  kind: 'bundle'
  bundleId: string
  bundleSelections: BundleSelection[]
  componentSummary: string
}

export type CartItem = ProductCartItem | BundleCartItem

export type CartProductSelection = {
  product: Product
  variant?: ProductVariant | null
}

export type CartBundleSelection = {
  bundle: ProductBundle
  selections?: BundleSelection[]
}

type AddItemResult = { ok: true } | { ok: false; error: string }

type CartState = {
  cartOpen: boolean
  items: CartItem[]
  openCart: () => void
  closeCart: () => void
  toggleCart: () => void
  addItem: (selection: CartProductSelection, quantity?: number) => AddItemResult
  addBundleItem: (selection: CartBundleSelection, quantity?: number) => AddItemResult
  removeItem: (lineKey: string) => void
  updateQuantity: (lineKey: string, quantity: number) => AddItemResult
  clearCart: () => void
  itemCount: () => number
}

function buildProductCartItem(selection: CartProductSelection, quantity: number): ProductCartItem {
  const { product, variant } = selection
  const variantId = variant?.id ?? null
  const displayName = variant ? `${product.name} — ${variant.name}` : product.name

  return {
    kind: 'product',
    lineKey: cartLineKey(product.id, variantId),
    productId: product.id,
    variantId,
    variantName: variant?.name ?? null,
    sku: variant?.sku ?? product.sku ?? null,
    packQuantity: product.packQuantity ?? null,
    slug: product.slug,
    name: displayName,
    price: effectiveProductPrice(product, variant),
    imageUrl: variant?.imageUrl || product.imageUrl,
    quantity,
    inventoryCount: effectiveProductInventory(product, variant),
  }
}

function buildBundleCartItem(selection: CartBundleSelection, quantity: number): BundleCartItem {
  const { bundle, selections = [] } = selection
  return {
    kind: 'bundle',
    lineKey: bundleLineKey(bundle.id, selections),
    bundleId: bundle.id,
    bundleSelections: selections,
    componentSummary: buildBundleComponentSummary(bundle),
    slug: bundle.slug,
    name: bundle.name,
    price: bundle.price,
    imageUrl: bundle.imageUrl,
    quantity,
    inventoryCount: computeStaticBundleAvailableQuantity(bundle, selections),
  }
}

function clampQuantity(inventoryCount: number, quantity: number): AddItemResult {
  const maxForLine = Math.max(0, inventoryCount)
  if (quantity > maxForLine) {
    return { ok: false, error: `Only ${maxForLine} available in stock` }
  }
  if (quantity < 1) {
    return { ok: false, error: 'Invalid quantity' }
  }
  return { ok: true }
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cartOpen: false,
      items: [],
      openCart: () => set({ cartOpen: true }),
      closeCart: () => set({ cartOpen: false }),
      toggleCart: () => set((s) => ({ cartOpen: !s.cartOpen })),
      addItem: (selection, quantity = 1) => {
        const { product, variant } = selection
        if (productRequiresVariant(product) && !variant) {
          return { ok: false, error: 'Please select a variant' }
        }

        const nextItem = buildProductCartItem(selection, quantity)
        const state = get()
        const existing = state.items.find((i) => i.lineKey === nextItem.lineKey)
        const nextQty = (existing?.quantity ?? 0) + quantity
        const check = clampQuantity(nextItem.inventoryCount, nextQty)
        if (!check.ok) return check

        set((s) => {
          const found = s.items.find((i) => i.lineKey === nextItem.lineKey)
          if (found) {
            return {
              items: s.items.map((i) =>
                i.lineKey === nextItem.lineKey
                  ? { ...nextItem, quantity: nextQty }
                  : i,
              ),
              cartOpen: true,
            }
          }
          return {
            items: [...s.items, { ...nextItem, quantity }],
            cartOpen: true,
          }
        })
        return { ok: true }
      },
      addBundleItem: (selection, quantity = 1) => {
        const validationError = validateBundleSelections(selection.bundle, selection.selections ?? [])
        if (validationError) return { ok: false, error: validationError }

        const nextItem = buildBundleCartItem(selection, quantity)
        const state = get()
        const existing = state.items.find((i) => i.lineKey === nextItem.lineKey)
        const nextQty = (existing?.quantity ?? 0) + quantity
        const check = clampQuantity(nextItem.inventoryCount, nextQty)
        if (!check.ok) return check

        set((s) => {
          const found = s.items.find((i) => i.lineKey === nextItem.lineKey)
          if (found) {
            return {
              items: s.items.map((i) =>
                i.lineKey === nextItem.lineKey
                  ? { ...nextItem, quantity: nextQty }
                  : i,
              ),
              cartOpen: true,
            }
          }
          return {
            items: [...s.items, { ...nextItem, quantity }],
            cartOpen: true,
          }
        })
        return { ok: true }
      },
      removeItem: (lineKey) => set((s) => ({ items: s.items.filter((i) => i.lineKey !== lineKey) })),
      updateQuantity: (lineKey, quantity) => {
        if (quantity <= 0) {
          get().removeItem(lineKey)
          return { ok: true }
        }
        const item = get().items.find((i) => i.lineKey === lineKey)
        if (!item) return { ok: false, error: 'Item not in cart' }
        const check = clampQuantity(item.inventoryCount, quantity)
        if (!check.ok) return check
        set((s) => ({
          items: s.items.map((i) => (i.lineKey === lineKey ? { ...i, quantity } : i)),
        }))
        return { ok: true }
      },
      clearCart: () => set({ items: [] }),
      itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    {
      name: 'unique-cart',
      version: 3,
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== 'object' || !('items' in persisted)) {
          return persisted as CartState
        }

        const state = persisted as { items: Array<Record<string, unknown>>; cartOpen?: boolean }
        const items = state.items.map((item) => {
          if (item.kind === 'bundle') {
            return item as unknown as BundleCartItem
          }

          const productId = String(item.productId ?? '')
          const variantId = (item.variantId as string | null | undefined) ?? null
          return {
            kind: 'product' as const,
            lineKey: String(item.lineKey ?? cartLineKey(productId, variantId)),
            productId,
            variantId,
            variantName: (item.variantName as string | null | undefined) ?? null,
            sku: (item.sku as string | null | undefined) ?? null,
            packQuantity: (item.packQuantity as string | null | undefined) ?? null,
            slug: String(item.slug ?? ''),
            name: String(item.name ?? ''),
            price: Number(item.price ?? 0),
            imageUrl: String(item.imageUrl ?? ''),
            quantity: Number(item.quantity ?? 1),
            inventoryCount: Number(item.inventoryCount ?? 0),
          }
        })

        void version
        return { ...state, items } as CartState
      },
    },
  ),
)

export function selectionFromCartItem(product: Product, item: ProductCartItem): CartProductSelection {
  const variant = product.variants?.find((v) => v.id === item.variantId) ?? null
  return { product, variant }
}

export function isProductCartItem(item: CartItem): item is ProductCartItem {
  return item.kind === 'product'
}

export function isBundleCartItem(item: CartItem): item is BundleCartItem {
  return item.kind === 'bundle'
}

export { effectiveCompareAtPrice, effectiveProductInventory, effectiveProductPrice, productRequiresVariant }
