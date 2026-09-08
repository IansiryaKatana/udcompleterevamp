import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useCartStore } from '@/lib/stores/cart-store'
import { CartLineMeta } from '@/components/ecommerce/CartLineMeta'
import { useFormatPrice } from '@/lib/currency'
import { cartItemDetailPath } from '@/lib/cart/cartPayload'
import { Button } from '@/components/ui/button'
import { QuantityStepper } from '@/components/ecommerce/QuantityStepper'
import { PageHero } from '@/components/layout/PageHero'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'

export const Route = createFileRoute('/cart')({
  component: CartPage,
  head: () => ({ meta: [{ title: 'Your Cart | Unique Distribution' }] }),
})

function CartPage() {
  const items = useCartStore((s) => s.items)
  const formatPrice = useFormatPrice()
  const updateQuantity = useCartStore((s) => s.updateQuantity)
  const removeItem = useCartStore((s) => s.removeItem)
  const clearCart = useCartStore((s) => s.clearCart)
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)

  return (
    <StorefrontLayout>
      <PageHero
            title="Your Cart"
        subtitle={`${items.length} wholesale line(s)`}
        backLabel="Continue Shopping"
      />

      <div className="px-6 py-10 md:px-14">
        {items.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-brand-border p-10 text-center">
            <p className="text-muted">Your cart is empty.</p>
            <Button asChild className="mt-4 w-fit">
              <Link to="/">Shop wholesale</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={item.lineKey} className="flex flex-col gap-4 rounded-xl border border-brand-border p-4 sm:flex-row">
                  <img src={item.imageUrl} alt="" className="h-28 w-28 shrink-0 rounded-lg bg-[#f3f1ec] object-cover object-center" />
                  <div className="flex-1">
                    <Link to={cartItemDetailPath(item)} params={{ slug: item.slug }} className="font-display text-lg font-extrabold">
                      {item.name}
                    </Link>
                    <CartLineMeta item={item} />
                    <p className="mt-1 font-extrabold">{formatPrice(item.price)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted">Qty</span>
                          <QuantityStepper
                            value={item.quantity}
                            max={item.inventoryCount}
                            onChange={(qty) => {
                              const result = updateQuantity(item.lineKey, qty)
                              if (!result.ok) toast.error(result.error)
                            }}
                          />
                      </div>
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => removeItem(item.lineKey)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <aside className="h-fit rounded-xl border border-brand-border p-6">
              <h2 className="font-display text-xl font-extrabold">Order Summary</h2>
              <div className="mt-4 flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="font-bold">{formatPrice(subtotal)}</span>
              </div>
              <p className="mt-2 text-xs text-muted">
                Unit prices shown when Unique commercial policy allows. Case quantities are only used when the product
                record includes them.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link to="/checkout">Checkout / request a quote</Link>
              </Button>
              <Button variant="destructive" className="mt-2 w-full" onClick={clearCart}>
                Clear Cart
              </Button>
            </aside>
          </div>
        )}
      </div>
    </StorefrontLayout>
  )
}
