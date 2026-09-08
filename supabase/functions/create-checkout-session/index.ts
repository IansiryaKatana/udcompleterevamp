import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'
import { clientIp, corsHeaders, enforceRateLimit, parseShippingAddress, resolveUserIdFromRequest, validateCheckoutPayload } from '../_shared/checkoutGuard.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const validated = validateCheckoutPayload(body)
    if (!validated.ok) {
      return new Response(JSON.stringify({ error: validated.error }), { status: 400, headers: corsHeaders })
    }

    const rate = await enforceRateLimit(supabase, 'create_checkout_session', clientIp(req), 8, 3600)
    if (!rate.ok) {
      return new Response(JSON.stringify({ error: rate.error }), { status: 429, headers: corsHeaders })
    }

    const { email, items } = validated
    const shipping = parseShippingAddress(body, true)
    if (!shipping.ok) {
      return new Response(JSON.stringify({ error: shipping.error }), { status: 400, headers: corsHeaders })
    }
    const userId = await resolveUserIdFromRequest(req)
    const { success_url, cancel_url, coupon_code } = body
    const shippingCountry = shipping.shipping_address?.country ?? null

    let customerId: string | null = null
    if (userId) {
      const { data: linked } = await supabase
        .from('customers')
        .select('id')
        .eq('auth_user_id', userId)
        .limit(1)
        .maybeSingle()
      customerId = linked?.id ?? null
    }

    const { data: access, error: accessError } = await supabase.rpc('rpc_assert_storefront_commercial_action', {
      p_action: 'purchase',
      p_payment_option: body.payment_option ?? null,
      p_customer_id: customerId,
    })
    if (accessError || access?.ok === false) {
      return new Response(
        JSON.stringify({
          error: access?.message ?? access?.error ?? accessError?.message ?? 'Commercial access denied',
          code: access?.error ?? 'COMMERCIAL_ACCESS_DENIED',
        }),
        { status: 403, headers: corsHeaders },
      )
    }

    const { data: enabled } = await supabase.from('site_settings').select('value').eq('key', 'stripe_enabled').maybeSingle()
    if (enabled?.value !== 'true') {
      return new Response(JSON.stringify({ error: 'Stripe checkout is not enabled' }), { status: 400, headers: corsHeaders })
    }

    const { data: secretRow } = await supabase.from('private_settings').select('value').eq('key', 'stripe_secret_key').maybeSingle()
    if (!secretRow?.value) {
      return new Response(JSON.stringify({ error: 'Stripe secret key not configured in admin' }), { status: 400, headers: corsHeaders })
    }

    const { data: totals, error: totalsError } = await supabase.rpc('rpc_get_cart_totals', {
      p_items: items,
      p_shipping_country: shippingCountry,
      p_coupon_code: coupon_code ?? null,
    })
    if (totalsError || !totals?.ok) {
      return new Response(JSON.stringify({ error: totals?.error ?? totalsError?.message }), { status: 400, headers: corsHeaders })
    }

    const stripe = new Stripe(secretRow.value, { apiVersion: '2024-11-20.acacia' })
    const orderNumber = `AST-${Date.now()}`
    const subtotal = Number(totals.subtotal)
    const discount = Number(totals.discount ?? 0)
    const discountRatio = subtotal > 0 ? discount / subtotal : 0

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        email,
        user_id: userId,
        status: 'pending',
        currency: totals.currency,
        subtotal: totals.subtotal,
        shipping_total: totals.shipping ?? 0,
        tax_total: totals.tax ?? 0,
        discount_total: totals.discount ?? 0,
        coupon_code: totals.coupon_code ?? null,
        total: totals.total,
        shipping_address: shipping.shipping_address,
      })
      .select('id')
      .single()

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: orderError?.message ?? 'Order create failed' }), { status: 500, headers: corsHeaders })
    }

    for (const line of totals.items as Array<Record<string, unknown>>) {
      await supabase.from('order_items').insert({
        order_id: order.id,
        product_id: line.product_id ?? null,
        bundle_id: line.bundle_id ?? null,
        variant_id: line.variant_id ?? null,
        variant_name: line.variant_name ?? null,
        product_name: line.name,
        product_slug: line.slug,
        image_url: line.image_url,
        unit_price: line.unit_price,
        quantity: line.quantity,
        line_total: line.line_total,
        metadata: line.is_bundle ? { components: line.components ?? [] } : {},
      })
    }

    const reserve = await supabase.rpc('rpc_reserve_inventory_for_order', { p_order_id: order.id, p_ttl_minutes: 30 })
    if (reserve.error || !(reserve.data as { ok?: boolean })?.ok) {
      await supabase.from('orders').delete().eq('id', order.id)
      return new Response(JSON.stringify({ error: (reserve.data as { error?: string })?.error ?? 'Could not reserve inventory' }), { status: 400, headers: corsHeaders })
    }

    const currency = (totals.currency as string).toLowerCase()
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = (totals.items as Array<Record<string, unknown>>).map((line) => {
      const unitPrice = Number(line.unit_price) * (1 - discountRatio)
      return {
        quantity: line.quantity as number,
        price_data: {
          currency,
          unit_amount: Math.max(0, Math.round(unitPrice * 100)),
          product_data: {
            name: line.name as string,
            images: line.image_url ? [line.image_url as string] : undefined,
          },
        },
      }
    })

    if (Number(totals.shipping) > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: Math.round(Number(totals.shipping) * 100),
          product_data: { name: 'Shipping' },
        },
      })
    }
    if (Number(totals.tax) > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: Math.round(Number(totals.tax) * 100),
          product_data: { name: 'Tax' },
        },
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url,
      line_items: lineItems,
      metadata: { order_id: order.id, order_number: orderNumber },
    })

    await supabase.from('orders').update({ stripe_session_id: session.id }).eq('id', order.id)

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
