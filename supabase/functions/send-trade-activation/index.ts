import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  loadEmailBrand,
  loadEmailTemplate,
  renderBrandedEmail,
  sendBrandedEmail,
} from '../_shared/emailTemplates.ts'
import { clientIp, corsHeaders, enforceRateLimit } from '../_shared/checkoutGuard.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: sessionData } = await userClient.rpc('rpc_get_admin_session')
    if (!sessionData?.ok || !sessionData.is_admin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const rate = await enforceRateLimit(supabase, 'send_trade_activation', clientIp(req), 30, 3600)
    if (!rate.ok) {
      return new Response(JSON.stringify({ error: rate.error }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const customerId = String(body.customer_id ?? '').trim()
    const ttlHours = Number(body.ttl_hours ?? 168)
    if (!customerId) {
      return new Response(JSON.stringify({ error: 'customer_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Phase 4I: hard gate — real customer sends require pilot_send_authorized
    const { data: issued, error: issueErr } = await userClient.rpc('rpc_admin_issue_activation_for_send', {
      p_customer_id: customerId,
      p_ttl_hours: ttlHours,
    })
    if (issueErr || !issued?.ok) {
      const code = String(issued?.error ?? issueErr?.message ?? 'Unable to issue activation')
      const status = code === 'PILOT_SEND_OWNER_APPROVAL_REQUIRED' ? 403 : 400
      return new Response(
        JSON.stringify({
          ok: false,
          error: code,
          PILOT_SEND_STATUS: issued?.PILOT_SEND_STATUS ?? undefined,
          message: issued?.message,
        }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const brand = await loadEmailBrand(supabase)
    const template = await loadEmailTemplate(supabase, 'trade_account_activation')
    if (!template?.enabled) {
      return new Response(JSON.stringify({ error: 'Activation email template unavailable' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const activationUrl = `${brand.storeUrl}/account?activate=${encodeURIComponent(String(issued.token))}`
    const expiresAt = issued.expires_at
      ? new Date(String(issued.expires_at)).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
      : 'soon'

    const rendered = renderBrandedEmail(
      brand,
      { subject: template.subject, bodyHtml: template.body_html },
      {
        customer_name: String(issued.customer_name || 'there'),
        activation_url: activationUrl,
        activation_token: String(issued.token),
        expires_at: expiresAt,
        account_url: `${brand.storeUrl}/account`,
        store_url: brand.storeUrl,
      },
    )

    const sendResult = await sendBrandedEmail({
      to: String(issued.email),
      brand,
      subject: rendered.subject,
      html: rendered.html,
    })

    if (!sendResult.sent) {
      return new Response(JSON.stringify({ ok: false, error: sendResult.reason ?? 'Send failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await userClient.rpc('rpc_admin_mark_activation_email_sent', {
      p_activation_id: issued.activation_id,
    })

    return new Response(
      JSON.stringify({
        ok: true,
        activation_id: issued.activation_id,
        customer_id: customerId,
        // Do not echo token or raw email unnecessarily in admin UI logs beyond confirmation
        sent: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
