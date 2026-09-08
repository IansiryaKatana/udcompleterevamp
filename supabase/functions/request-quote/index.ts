import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { clientIp, corsHeaders, enforceRateLimit, parseShippingAddress, resolveUserIdFromRequest, validateCheckoutPayload } from '../_shared/checkoutGuard.ts'
import {
  buildNotesBlock,
  buildOrderItemsHtml,
  formatMoney,
  loadEmailBrand,
  sendTemplateEmail,
} from '../_shared/emailTemplates.ts'

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

    const rate = await enforceRateLimit(supabase, 'request_quote', clientIp(req), 6, 3600)
    if (!rate.ok) {
      return new Response(JSON.stringify({ error: rate.error }), { status: 429, headers: corsHeaders })
    }

    const { email, items } = validated
    const { name, notes } = body
    const shipping = parseShippingAddress(body, false)
    if (!shipping.ok) {
      return new Response(JSON.stringify({ error: shipping.error }), { status: 400, headers: corsHeaders })
    }
    const userId = await resolveUserIdFromRequest(req)

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
      p_action: 'quote',
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

    const { data: modeRow } = await supabase.from('site_settings').select('value').eq('key', 'checkout_mode').maybeSingle()
    if (modeRow?.value !== 'quote') {
      return new Response(JSON.stringify({ error: 'Quote checkout is not enabled' }), { status: 400, headers: corsHeaders })
    }

    const { data: emailRow } = await supabase.from('site_settings').select('value').eq('key', 'quote_notification_email').maybeSingle()
    const notifyEmail = emailRow?.value?.trim()
    if (!notifyEmail) {
      return new Response(JSON.stringify({ error: 'Quote notification email not configured in admin' }), { status: 400, headers: corsHeaders })
    }

    const { data: totals, error: totalsError } = await supabase.rpc('rpc_get_cart_totals', {
      p_items: items,
      p_shipping_country: shipping.shipping_address?.country ?? null,
      p_coupon_code: body.coupon_code ?? null,
    })
    if (totalsError || !totals?.ok) {
      return new Response(JSON.stringify({ error: totals?.error ?? totalsError?.message }), { status: 400, headers: corsHeaders })
    }

    const orderNumber = `AST-Q-${Date.now()}`
    const customerEmail = String(email).trim()
    const customerName = String(name ?? '').trim() || customerEmail.split('@')[0] || 'Customer'
    const customerNotes = String(notes ?? '').trim()
    const currency = String(totals.currency)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        email: customerEmail,
        user_id: userId,
        status: 'quote_requested',
        currency,
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
      return new Response(JSON.stringify({ error: orderError?.message ?? 'Quote create failed' }), { status: 500, headers: corsHeaders })
    }

    const { data: bind, error: bindError } = await supabase.rpc('rpc_storefront_bind_order_commercial_context', {
      p_order_id: order.id,
      p_payment_option: body.payment_option ?? null,
      p_client_customer_id: body.customer_id ?? null,
      p_client_company_id: body.company_id ?? null,
    })
    if (bindError || bind?.ok === false) {
      return new Response(
        JSON.stringify({
          error: bind?.message ?? bind?.error ?? bindError?.message ?? 'Commercial bind failed',
          code: bind?.error ?? 'COMMERCIAL_BIND_FAILED',
        }),
        { status: 403, headers: corsHeaders },
      )
    }

    const cartItems = totals.items as Array<Record<string, unknown>>
    for (const line of cartItems) {
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

    await supabase.rpc('rpc_reserve_inventory_for_order', { p_order_id: order.id, p_ttl_minutes: 60 })

    const orderItemsHtml = buildOrderItemsHtml(
      cartItems.map((line) => ({
        name: String(line.name),
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        line_total: Number(line.line_total),
        image_url: line.image_url ? String(line.image_url) : null,
      })),
      currency,
    )

    const brand = await loadEmailBrand(supabase)

    const emailVars = {
      order_number: orderNumber,
      customer_name: customerName,
      customer_email: customerEmail,
      order_total: formatMoney(Number(totals.total), currency),
      order_subtotal: formatMoney(Number(totals.subtotal), currency),
      order_date: new Date().toLocaleDateString('en-US', { dateStyle: 'long' }),
      order_items_html: orderItemsHtml,
      notes_block: buildNotesBlock(customerNotes),
      account_url: `${brand.storeUrl}/account`,
      store_url: brand.storeUrl,
    }

    const adminEmail = await sendTemplateEmail(supabase, 'quote_request_admin', notifyEmail, emailVars, {
      replyTo: customerEmail,
    })

    const customerEmailResult = await sendTemplateEmail(supabase, 'quote_request_customer', customerEmail, emailVars)

    return new Response(
      JSON.stringify({
        ok: true,
        order_number: orderNumber,
        email_sent: adminEmail.sent,
        customer_email_sent: customerEmailResult.sent,
        email_note: adminEmail.sent ? undefined : adminEmail.reason,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
