import type { Product } from '@/data/static-cms'
import { useCartStore } from '@/lib/stores/cart-store'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { gateStorefrontPurchase } from '@/lib/storefront/commercialSession'

export function AddToCartButton({ product, className }: { product: Product; className?: string }) {
  const addItem = useCartStore((s) => s.addItem)

  return (
    <Button
      type="button"
      variant="secondary"
      size="product"
      className={className}
      disabled={product.inventoryCount <= 0 || product.priceRestricted}
      onClick={() => {
        void (async () => {
          try {
            const gate = await gateStorefrontPurchase('add_to_cart')
            if (!gate.ok) {
              toast.error(gate.message)
              return
            }
            if (product.priceRestricted) {
              toast.error('Trade pricing requires an approved account')
              return
            }
            const result = addItem({ product, variant: null })
            if (!result.ok) {
              toast.error(result.error)
              return
            }
            toast.success(`${product.name} added to cart`)
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Unable to add to cart')
          }
        })()
      }}
    >
      {product.inventoryCount <= 0
        ? 'Out of stock'
        : product.priceRestricted
          ? 'Trade only'
          : 'Add to Cart'}
    </Button>
  )
}
