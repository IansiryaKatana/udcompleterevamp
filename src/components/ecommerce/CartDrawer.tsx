import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ShoppingBag, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useCartStore } from '@/lib/stores/cart-store'
import { CartLineMeta } from '@/components/ecommerce/CartLineMeta'
import { useFormatPrice } from '@/lib/currency'
import { cartItemDetailPath } from '@/lib/cart/cartPayload'
import { Button } from '@/components/ui/button'
import { QuantityStepper } from '@/components/ecommerce/QuantityStepper'
import { ScrollProgressBar } from '@/components/layout/ScrollProgressBar'
import { useElementScrollProgress } from '@/hooks/useScrollProgress'

export function CartDrawer() {
  const formatPrice = useFormatPrice()
  const cartOpen = useCartStore((s) => s.cartOpen)
  const closeCart = useCartStore((s) => s.closeCart)
  const items = useCartStore((s) => s.items)
  const updateQuantity = useCartStore((s) => s.updateQuantity)
  const removeItem = useCartStore((s) => s.removeItem)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { progress, scrollable } = useElementScrollProgress(scrollRef, cartOpen, [items.length])

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)

  useEffect(() => {
    if (cartOpen && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [cartOpen])

  if (!cartOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close cart" className="absolute inset-0 bg-black/40" onClick={closeCart} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-content-bg shadow-xl">
        <div className="shrink-0 border-b border-brand-border">
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" />
              <h2 className="font-display text-lg font-extrabold">Your Cart</h2>
            </div>
            <button type="button" aria-label="Close" onClick={closeCart} className="rounded-full p-2 hover:bg-soft-beige">
              <X className="h-5 w-5" />
            </button>
          </div>
          <ScrollProgressBar progress={progress} visible={scrollable} label="Cart scroll progress" />
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.length === 0 ? (
            <p className="text-sm text-muted">Your cart is empty.</p>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={item.lineKey} className="flex gap-3">
                  <img src={item.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg bg-[#f3f1ec] object-cover object-center" />
                  <div className="flex-1">
                    <Link
                      to={cartItemDetailPath(item)}
                      params={{ slug: item.slug }}
                      onClick={closeCart}
                      className="text-sm font-bold"
                    >
                      {item.name}
                    </Link>
                    <CartLineMeta item={item} />
                    <p className="text-sm font-extrabold">{formatPrice(item.price)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <QuantityStepper
                        value={item.quantity}
                        max={item.inventoryCount}
                        onChange={(qty) => {
                          const result = updateQuantity(item.lineKey, qty)
                          if (!result.ok) toast.error(result.error)
                        }}
                      />
                      <Button
                        type="button"
                        variant="destructive-ghost"
                        size="sm"
                        className="ml-auto h-8 px-2 text-xs"
                        onClick={() => removeItem(item.lineKey)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-brand-border p-5">
          <div className="mb-4 flex justify-between text-sm font-bold">
            <span>Subtotal</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <Button asChild className="w-full" disabled={items.length === 0}>
            <Link to="/cart" onClick={closeCart}>
              View cart
            </Link>
          </Button>
          <Button asChild variant="outline" className="mt-2 w-full" disabled={items.length === 0}>
            <Link to="/checkout" onClick={closeCart}>
              Request a quote
            </Link>
          </Button>
        </div>
      </aside>
    </div>
  )
}
