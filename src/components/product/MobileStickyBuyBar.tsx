import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useFormatPrice } from '@/lib/currency'
import { useCartStore } from '@/lib/stores/cart-store'
import type { Product, ProductVariant } from '@/data/static-cms'
import { ProductPrice } from '@/components/product/ProductPrice'
import { gateStorefrontPurchase, commercialPriceLabel } from '@/lib/storefront/commercialSession'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'

type MobileStickyBuyBarProps = {
  product: Product
  variant: ProductVariant | null
  price: number
  inventory: number
}

export function MobileStickyBuyBar({ product, variant, price, inventory }: MobileStickyBuyBarProps) {
  const formatPrice = useFormatPrice()
  const addItem = useCartStore((s) => s.addItem)
  const navigate = useNavigate()
  const { data: session } = useCommercialSession()
  const restrictedLabel = commercialPriceLabel(session, product.priceRestricted)

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-border bg-white/95 p-3 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-muted">{product.name}</p>
          {product.priceRestricted ? (
            <ProductPrice price={price} priceRestricted restrictedLabel={restrictedLabel} size="sm" />
          ) : (
            <p className="font-display text-lg font-extrabold">{formatPrice(price)}</p>
          )}
        </div>
        <Button
          type="button"
          className="shrink-0"
          disabled={inventory <= 0 || product.priceRestricted}
          onClick={() => {
            void (async () => {
              try {
                const gate = await gateStorefrontPurchase('add_to_cart')
                if (!gate.ok) {
                  toast.error(gate.message)
                  return
                }
                const result = addItem({ product, variant })
                if (!result.ok) {
                  toast.error(result.error)
                  return
                }
                toast.success('Added to cart')
                void navigate({ to: '/cart' })
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Unable to add to cart')
              }
            })()
          }}
        >
          {inventory <= 0 ? 'Out of stock' : product.priceRestricted ? 'Trade only' : 'Add to Cart'}
        </Button>
      </div>
    </div>
  )
}
