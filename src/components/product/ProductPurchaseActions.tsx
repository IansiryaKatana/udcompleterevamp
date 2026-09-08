import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { Product, ProductVariant } from '@/data/static-cms'
import type { CartProductSelection } from '@/lib/stores/cart-store'
import {
  effectiveProductInventory,
  productRequiresVariant,
} from '@/lib/cms/mapProduct'
import { useCartStore } from '@/lib/stores/cart-store'
import { Button } from '@/components/ui/button'
import { gateStorefrontPurchase } from '@/lib/storefront/commercialSession'

type ProductPurchaseActionsProps = {
  product: Product
  variant: ProductVariant | null
  className?: string
}

export function ProductPurchaseActions({ product, variant, className }: ProductPurchaseActionsProps) {
  const addItem = useCartStore((s) => s.addItem)
  const navigate = useNavigate()
  const inventory = effectiveProductInventory(product, variant)
  const needsVariant = productRequiresVariant(product)
  const disabled = inventory <= 0 || (needsVariant && !variant)

  const selection: CartProductSelection = useMemo(() => ({ product, variant }), [product, variant])

  return (
    <div className={className}>
      <div className="flex max-w-sm gap-3">
        <Button
          type="button"
          variant="secondary"
          size="product"
          className="min-w-0 flex-1"
          disabled={disabled || product.priceRestricted}
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
                const result = addItem(selection)
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
          {needsVariant && !variant ? 'Select an option' : inventory <= 0 ? 'Out of stock' : 'Add to Cart'}
        </Button>
        <Button
          type="button"
          variant="default"
          size="product"
          className="min-w-0 flex-1"
          disabled={disabled || product.priceRestricted}
          onClick={() => {
            void (async () => {
              try {
                const gate = await gateStorefrontPurchase('add_to_cart')
                if (!gate.ok) {
                  toast.error(gate.message)
                  return
                }
                const result = addItem(selection, 1)
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
          Buy Now
        </Button>
      </div>
    </div>
  )
}
