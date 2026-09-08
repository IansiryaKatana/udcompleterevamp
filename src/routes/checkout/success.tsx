import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCartStore } from '@/lib/stores/cart-store'
import { useFormatPrice } from '@/lib/currency'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/checkout/success')({
  validateSearch: (search: Record<string, unknown>) => ({
    session_id: typeof search.session_id === 'string' ? search.session_id : undefined,
    quote: typeof search.quote === 'string' ? search.quote : undefined,
  }),
  component: CheckoutSuccessPage,
  head: () => ({ meta: [{ title: 'Order Confirmed | Unique Distribution' }] }),
})

function CheckoutSuccessPage() {
  const { session_id, quote } = Route.useSearch()
  const clearCart = useCartStore((s) => s.clearCart)
  const formatPrice = useFormatPrice()
  const [state, setState] = useState<'loading' | 'paid' | 'quote' | 'failed'>('loading')
  const [orderNumber, setOrderNumber] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [orderTotal, setOrderTotal] = useState<number | null>(null)

  useEffect(() => {
    if (quote) {
      setState('quote')
      setOrderNumber(quote)
      return
    }

    if (!session_id) {
      setState('failed')
      return
    }

    void fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ session_id }),
    })
      .then((res) => res.json())
      .then((body: { ok?: boolean; order?: { id?: string; order_number?: string; total?: number } }) => {
        if (body.ok) {
          setState('paid')
          setOrderId(body.order?.id ?? null)
          setOrderNumber(body.order?.order_number ?? null)
          setOrderTotal(body.order?.total != null ? Number(body.order.total) : null)
          clearCart()
        } else {
          setState('failed')
        }
      })
      .catch(() => setState('failed'))
  }, [session_id, quote, clearCart])

  return (
    <StorefrontLayout>
      <SectionContainer className="flex flex-1 flex-col items-center justify-center py-24 text-center">
        {state === 'loading' ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-muted" />
            <p className="mt-4 text-muted">Confirming your payment…</p>
          </>
        ) : state === 'quote' ? (
          <>
            <h1 className="font-display text-4xl font-extrabold">Quote requested!</h1>
            {orderNumber && <p className="mt-2 text-sm font-semibold text-cta-brown">Reference {orderNumber}</p>}
            <p className="mt-3 max-w-md text-muted">
              Your quote request has been received. Unique will confirm availability and next steps. No dispatch is
              implied until fulfilment data exists on the order.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild variant="outline">
                <Link to="/account">View account</Link>
              </Button>
              <Button asChild>
                <Link to="/">Continue shopping</Link>
              </Button>
            </div>
          </>
        ) : state === 'paid' ? (
          <>
            <h1 className="font-display text-4xl font-extrabold">Thank you!</h1>
            {orderNumber && <p className="mt-2 text-sm font-semibold text-cta-brown">Order {orderNumber}</p>}
            {orderTotal != null && <p className="mt-1 font-extrabold">{formatPrice(orderTotal)}</p>}
            <p className="mt-3 max-w-md text-muted">
              Payment was recorded. Fulfilment and tracking appear on your account only when Unique has that data — this
              confirmation is not a shipment claim.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {orderId ? (
                <Button asChild>
                  <Link to="/account/orders/$orderId" params={{ orderId }}>View order details</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/account">View account</Link>
                </Button>
              )}
              <Button asChild variant="outline">
                <Link to="/">Continue shopping</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-4xl font-extrabold">Payment not confirmed</h1>
            <p className="mt-3 max-w-md text-muted">
              We could not verify your payment. If you were charged, contact support with your receipt.
            </p>
            <Button asChild className="mt-8">
              <Link to="/cart">Return to cart</Link>
            </Button>
          </>
        )}
      </SectionContainer>
    </StorefrontLayout>
  )
}
