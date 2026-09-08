import { useNavigate } from '@tanstack/react-router'
import type { Product } from '@/data/static-cms'
import { useCartStore } from '@/lib/stores/cart-store'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { gateStorefrontPurchase } from '@/lib/storefront/commercialSession'

export function BuyNowButton({ product }: { product: Product }) {
  const addItem = useCartStore((s) => s.addItem)
  const navigate = useNavigate()

  return (
    <Button
      type="button"
      variant="default"
      size="product"
      className="min-w-0 flex-1"
      disabled={product.inventoryCount <= 0 || product.priceRestricted}
      onClick={() => {
        void (async () => {
          try {
            const gate = await gateStorefrontPurchase('add_to_cart')
            if (!gate.ok) {
              toast.error(gate.message)
              return
            }
            const result = addItem({ product, variant: null }, 1)
            if (!result.ok) {
              toast.error(result.error)
              return
            }
            void navigate({ to: '/checkout' })
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Unable to continue')
          }
        })()
      }}
    >
      {product.priceRestricted ? 'Trade only' : 'Buy Now'}
    </Button>
  )
}
