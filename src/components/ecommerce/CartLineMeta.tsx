import type { CartItem } from '@/lib/stores/cart-store'
import { isBundleCartItem, isProductCartItem } from '@/lib/stores/cart-store'

export function CartLineMeta({ item }: { item: CartItem }) {
  if (isBundleCartItem(item)) {
    return item.componentSummary ? <p className="text-xs text-muted">{item.componentSummary}</p> : null
  }
  if (!isProductCartItem(item)) return null
  const bits = [
    item.variantName,
    item.sku ? `SKU ${item.sku}` : null,
    item.packQuantity ? `Pack ${item.packQuantity}` : null,
  ].filter(Boolean)
  if (bits.length === 0) return null
  return <p className="text-xs text-muted">{bits.join(' · ')}</p>
}
