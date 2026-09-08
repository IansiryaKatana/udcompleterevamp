import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { useCartStore } from '@/lib/stores/cart-store'
import { useFormatPrice } from '@/lib/currency'
import { cartItemsToRpcPayload } from '@/lib/cart/cartPayload'
import { useCartTotals } from '@/lib/cart/useCartTotals'
import { useCartServerSync } from '@/lib/cart/useCartServerSync'
import { tryGetSupabase } from '@/integrations/supabase/client'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'
import { useCheckoutRules, usePaymentGatewayPublicStatus } from '@/lib/storefront/storefrontQueries'
import { assertStorefrontCommercialAction, canUsePayLater, gateStorefrontPurchase } from '@/lib/storefront/commercialSession'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { PageHero } from '@/components/layout/PageHero'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { shippingAddressSchema, type ShippingAddressValues } from '@/lib/validators/shipping.schema'

const emptyShipping = (): ShippingAddressValues => ({
  line1: '',
  line2: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
})

export const Route = createFileRoute('/checkout')({
  component: CheckoutPage,
  head: () => ({ meta: [{ title: 'Checkout | Unique Distribution' }] }),
})

function CheckoutPage() {
  const items = useCartStore((s) => s.items)
  const clearCart = useCartStore((s) => s.clearCart)
  const formatPrice = useFormatPrice()
  const navigate = useNavigate()
  const { user } = useStorefrontAuth()
  const { snapshot } = useCms()
  const checkoutMode = snapshot.siteSettings.checkout_mode === 'stripe' ? 'stripe' : 'quote'
  const stripeEnabled = snapshot.siteSettings.stripe_enabled === 'true'
  const { data: commercial } = useCommercialSession()
  const { data: gateway } = usePaymentGatewayPublicStatus()
  const { data: checkoutRules } = useCheckoutRules({})
  const cardOperational = Boolean(gateway?.card_operational) && checkoutMode === 'stripe' && stripeEnabled
  const payLaterOk = canUsePayLater(commercial ?? null)
  const requiredFields = new Set((checkoutRules?.fields ?? []).filter((f) => f.required).map((f) => f.field))

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [deliveryInstructions, setDeliveryInstructions] = useState('')
  const [shipping, setShipping] = useState<ShippingAddressValues>(emptyShipping())
  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null)
  const [couponApplying, setCouponApplying] = useState(false)
  const [loading, setLoading] = useState(false)
  const isCouponApplied = appliedCoupon !== null

  const shippingCountry = shipping.country.trim() || null
  const { data: totals, error: totalsError } = useCartTotals(items, shippingCountry, appliedCoupon, items.length > 0)
  useCartServerSync(email, appliedCoupon)

  useEffect(() => {
    if (user?.email && !email) setEmail(user.email)
  }, [user?.email, email])

  async function handleApplyCoupon() {
    const code = couponCode.trim().toUpperCase()
    if (!code) {
      toast.error('Enter a promo code')
      return
    }
    const sb = tryGetSupabase()
    if (!sb) {
      toast.error('Checkout requires Supabase configuration')
      return
    }

    setCouponApplying(true)
    const { data, error } = await sb.rpc('rpc_get_cart_totals', {
      p_items: cartItemsToRpcPayload(items),
      p_shipping_country: shippingCountry,
      p_coupon_code: code,
    })
    setCouponApplying(false)

    if (error || !(data as { ok?: boolean })?.ok) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? 'Invalid promo code')
      return
    }

    setAppliedCoupon(code)
    setCouponCode(code)
    toast.success(`Promo code ${code} applied`)
  }

  function handleRemoveCoupon() {
    setAppliedCoupon(null)
    setCouponCode('')
  }

  function buildShippingPayload() {
    const parsed = shippingAddressSchema.safeParse(shipping)
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid shipping address' }
    const value = parsed.data
    return {
      ok: true as const,
      shipping_address: {
        line1: value.line1,
        line2: value.line2 || undefined,
        city: value.city,
        state: value.state || undefined,
        postal_code: value.postal_code,
        country: value.country,
      },
    }
  }

  async function handleStripeCheckout() {
    if (!cardOperational) {
      toast.error('Card checkout is not operational.')
      return
    }
    if (!email.trim() || items.length === 0) {
      toast.error('Email and cart items required')
      return
    }
    const shippingPayload = buildShippingPayload()
    if (!shippingPayload.ok) {
      toast.error(shippingPayload.error)
      return
    }
    const sb = tryGetSupabase()
    if (!sb) {
      toast.error('Checkout requires Supabase configuration')
      return
    }

    setLoading(true)
    const rpcItems = cartItemsToRpcPayload(items)
    const { data: rpcTotals, error } = await sb.rpc('rpc_get_cart_totals', {
      p_items: rpcItems,
      p_shipping_country: shippingCountry,
      p_coupon_code: appliedCoupon,
    })
    if (error || !(rpcTotals as { ok?: boolean })?.ok) {
      toast.error((rpcTotals as { error?: string })?.error ?? error?.message ?? 'Cart validation failed')
      setLoading(false)
      return
    }

    const { data: session } = await sb.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        email: email.trim(),
        shipping_address: shippingPayload.shipping_address,
        coupon_code: appliedCoupon ?? undefined,
        items: rpcItems,
        success_url: `${window.location.origin}/checkout/success`,
        cancel_url: `${window.location.origin}/cart`,
      }),
    })

    setLoading(false)
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.url) {
      toast.error(body.error ?? 'Could not start checkout')
      return
    }
    window.location.href = body.url as string
  }

  async function handleQuoteRequest(paymentOption?: 'pay_later' | null) {
    if (!email.trim() || items.length === 0) {
      toast.error('Email and cart items required')
      return
    }
    if (requiredFields.has('purchase_order') && !poNumber.trim()) {
      toast.error('Purchase order number is required')
      return
    }
    if (requiredFields.has('delivery_instructions') && !deliveryInstructions.trim()) {
      toast.error('Delivery instructions are required')
      return
    }
    const gate = await gateStorefrontPurchase(paymentOption === 'pay_later' ? 'pay_later' : 'quote')
    if (!gate.ok) {
      toast.error(gate.message)
      return
    }
    if (paymentOption === 'pay_later') {
      if (!payLaterOk) {
        toast.error('PAY LATER is not available on this account.')
        return
      }
      const payLaterGate = await assertStorefrontCommercialAction('pay_later', 'pay_later')
      if (!payLaterGate?.ok) {
        toast.error(payLaterGate?.message ?? 'PAY LATER is not available')
        return
      }
    }
    const sb = tryGetSupabase()
    if (!sb) {
      toast.error('Checkout requires Supabase configuration')
      return
    }

    setLoading(true)
    const shippingPayload = shipping.line1.trim()
      ? buildShippingPayload()
      : { ok: true as const, shipping_address: undefined }

    if (shipping.line1.trim() && !shippingPayload.ok) {
      toast.error(shippingPayload.error)
      setLoading(false)
      return
    }

    const rpcItems = cartItemsToRpcPayload(items)
    const { data: rpcTotals, error } = await sb.rpc('rpc_get_cart_totals', {
      p_items: rpcItems,
      p_shipping_country: shippingCountry,
      p_coupon_code: appliedCoupon,
    })
    if (error || !(rpcTotals as { ok?: boolean })?.ok) {
      toast.error((rpcTotals as { error?: string })?.error ?? error?.message ?? 'Cart validation failed')
      setLoading(false)
      return
    }

    const { data: session } = await sb.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        email: email.trim(),
        name: name.trim(),
        notes: [
          notes.trim(),
          poNumber.trim() ? `PO: ${poNumber.trim()}` : '',
          deliveryInstructions.trim() ? `Delivery: ${deliveryInstructions.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        purchase_order: poNumber.trim() || undefined,
        delivery_instructions: deliveryInstructions.trim() || undefined,
        payment_option: paymentOption ?? undefined,
        shipping_address: shippingPayload.ok ? shippingPayload.shipping_address : undefined,
        coupon_code: appliedCoupon ?? undefined,
        items: rpcItems,
      }),
    })

    setLoading(false)
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) {
      toast.error(body.error ?? 'Could not submit quote request')
      return
    }

    clearCart()
    toast.success('Quote request submitted — we will be in touch shortly.')
    void navigate({
      to: '/checkout/success',
      search: { session_id: undefined, quote: body.order_number as string },
    })
  }

  if (items.length === 0) {
    return (
      <StorefrontLayout>
        <PageHero title="Checkout" backLabel="Continue Shopping" backTo="/" contained />
        <SectionContainer className="flex flex-1 flex-col items-center justify-center py-20 text-center">
          <p className="text-muted">Your cart is empty.</p>
          <Button asChild className="mt-4 w-fit">
            <Link to="/">Continue shopping</Link>
          </Button>
        </SectionContainer>
      </StorefrontLayout>
    )
  }

  return (
    <StorefrontLayout>
      <PageHero title="Checkout" backLabel="Back to Cart" backTo="/cart" contained />

      <SectionContainer className="grid gap-10 py-10 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="mt-1" />
          </div>
          <div>
            <label className="block text-sm font-semibold">Name (optional)</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1" />
          </div>
          <div>
            <label className="block text-sm font-semibold">
              Purchase order{requiredFields.has('purchase_order') ? ' *' : ' (optional)'}
            </label>
            <Input
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="PO number"
              className="mt-1"
              required={requiredFields.has('purchase_order')}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">
              Delivery instructions{requiredFields.has('delivery_instructions') ? ' *' : ' (optional)'}
            </label>
            <Input
              value={deliveryInstructions}
              onChange={(e) => setDeliveryInstructions(e.target.value)}
              placeholder="Delivery notes for Unique"
              className="mt-1"
              required={requiredFields.has('delivery_instructions')}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">Notes (optional)</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything Unique should know about this order" className="mt-1" />
          </div>

          <div className="rounded-xl border border-brand-border p-4">
            <h3 className="text-sm font-semibold">Promo code</h3>
            {isCouponApplied ? (
              <div className="mt-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      value={appliedCoupon}
                      readOnly
                      disabled
                      aria-readonly
                      className="border-green-600/40 bg-green-50/60 pr-[5.5rem] font-medium text-green-900 disabled:cursor-default disabled:opacity-100"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs font-semibold text-green-700">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Applied
                    </span>
                  </div>
                  <Button type="button" variant="outline" onClick={handleRemoveCoupon}>
                    Remove
                  </Button>
                </div>
                {(totals?.discount ?? 0) > 0 ? (
                  <p className="mt-2 text-xs text-green-700">
                    You save {formatPrice(totals?.discount ?? 0)} with this code.
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleApplyCoupon()
                      }
                    }}
                    placeholder="Enter code"
                    className="flex-1"
                    disabled={couponApplying}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={couponApplying || !couponCode.trim()}
                    onClick={() => void handleApplyCoupon()}
                  >
                    {couponApplying ? 'Applying…' : 'Apply'}
                  </Button>
                </div>
                {totalsError ? <p className="mt-2 text-xs text-red-600">{(totalsError as Error).message}</p> : null}
              </>
            )}
          </div>

          <div className="rounded-xl border border-brand-border p-4">
            <h3 className="text-sm font-semibold">Shipping address{cardOperational ? '' : ' (optional for quotes)'}</h3>
            <div className="mt-3 flex flex-col gap-3">
              <Input
                value={shipping.line1}
                onChange={(e) => setShipping((s) => ({ ...s, line1: e.target.value }))}
                placeholder="Street address"
              />
              <Input
                value={shipping.line2 ?? ''}
                onChange={(e) => setShipping((s) => ({ ...s, line2: e.target.value }))}
                placeholder="Apt, suite (optional)"
              />
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={shipping.city}
                  onChange={(e) => setShipping((s) => ({ ...s, city: e.target.value }))}
                  placeholder="City"
                  className="flex-1"
                />
                <Input
                  value={shipping.state ?? ''}
                  onChange={(e) => setShipping((s) => ({ ...s, state: e.target.value }))}
                  placeholder="State / region"
                  className="flex-1"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={shipping.postal_code}
                  onChange={(e) => setShipping((s) => ({ ...s, postal_code: e.target.value }))}
                  placeholder="Postal code"
                  className="flex-1"
                />
                <Input
                  value={shipping.country}
                  onChange={(e) => setShipping((s) => ({ ...s, country: e.target.value }))}
                  placeholder="Country"
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          {(checkoutRules?.messages ?? []).length > 0 ? (
            <ul className="space-y-1 text-xs text-muted">
              {checkoutRules?.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
          {checkoutRules?.blocked ? (
            <p className="text-sm text-red-700">Checkout is currently blocked by Unique checkout rules.</p>
          ) : null}
          <p className="text-xs text-muted">
            Quote checkout is the default. Card and Worldpay are not shown as live while the payment gateway is
            disabled. PAY LATER appears only when Unique marks this account eligible.
          </p>
        </div>

        <aside className="h-fit rounded-xl border border-brand-border p-6">
          <h2 className="font-display text-xl font-extrabold">Order summary</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {items.map((i) => (
              <li key={i.lineKey} className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden">
                  <span
                    className="min-w-0 max-w-[7.25rem] shrink cursor-help truncate sm:max-w-[8rem]"
                    title={`${i.name} × ${i.quantity}`}
                  >
                    {i.name}
                  </span>
                  <span className="shrink-0 whitespace-nowrap">× {i.quantity}</span>
                </div>
                <span className="shrink-0 tabular-nums">{formatPrice(i.price * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2 border-t border-brand-border pt-4 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatPrice(totals?.subtotal ?? 0)}</span>
            </div>
            {(totals?.discount ?? 0) > 0 ? (
              <div className="flex justify-between text-green-700">
                <span>Discount</span>
                <span>-{formatPrice(totals?.discount ?? 0)}</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span>Shipping</span>
              <span>{formatPrice(totals?.shipping ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span>{formatPrice(totals?.tax ?? 0)}</span>
            </div>
            <div className="flex justify-between border-t border-brand-border pt-2 font-bold">
              <span>{cardOperational ? 'Total' : 'Estimated total'}</span>
              <span>{formatPrice(totals?.total ?? 0)}</span>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            disabled={loading || Boolean(checkoutRules?.blocked)}
            onClick={() => void handleQuoteRequest()}
          >
            {loading ? 'Submitting…' : 'Request a quote'}
          </Button>
          {payLaterOk ? (
            <Button
              variant="outline"
              className="mt-2 w-full"
              disabled={loading || Boolean(checkoutRules?.blocked)}
              onClick={() => void handleQuoteRequest('pay_later')}
            >
              Place PAY LATER order
            </Button>
          ) : null}
          {cardOperational ? (
            <Button
              variant="outline"
              className="mt-2 w-full"
              disabled={loading || Boolean(checkoutRules?.blocked)}
              onClick={() => void handleStripeCheckout()}
            >
              Pay by card
            </Button>
          ) : (
            <p className="mt-3 text-xs text-muted">Card and Worldpay checkout are not operational.</p>
          )}
          <Button variant="cream" className="mt-2 w-full rounded-md hover:bg-white" onClick={() => navigate({ to: '/cart' })}>
            Back to cart
          </Button>
        </aside>
      </SectionContainer>
    </StorefrontLayout>
  )
}
