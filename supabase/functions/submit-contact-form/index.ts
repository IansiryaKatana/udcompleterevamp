import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { clientIp, corsHeaders, enforceRateLimit } from '../_shared/checkoutGuard.ts'
import { loadEmailBrand, sendTemplateEmail } from '../_shared/emailTemplates.ts'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim()
    const message = String(body.message ?? '').trim()

    if (!name || !message) {
      return new Response(JSON.stringify({ error: 'Name and message are required' }), { status: 400, headers: corsHeaders })
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'Valid email is required' }), { status: 400, headers: corsHeaders })
    }

    const rate = await enforceRateLimit(supabase, 'submit_contact_form', clientIp(req), 5, 3600)
    if (!rate.ok) {
      return new Response(JSON.stringify({ error: rate.error }), { status: 429, headers: corsHeaders })
    }

    const { data, error } = await supabase.rpc('rpc_submit_contact_form', {
      p_name: name,
      p_email: email,
      p_message: message,
    })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
    }

    const result = data as { ok?: boolean; error?: string }
    if (!result?.ok) {
      return new Response(JSON.stringify({ error: result?.error ?? 'Submission failed' }), { status: 400, headers: corsHeaders })
    }

    const { data: notifyRow } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'contact_notification_email')
      .maybeSingle()

    const notifyEmail =
      notifyRow?.value?.trim() ||
      Deno.env.get('CONTACT_NOTIFICATION_EMAIL')?.trim() ||
      'info@uniquedistribution.com'

    const messageHtml = `<p style="margin:0;font-size:14px;line-height:1.6;color:#3d3428;white-space:pre-wrap;">${escapeHtml(message)}</p>`
    const emailResult = await sendTemplateEmail(supabase, 'contact_form_admin', notifyEmail, {
      customer_name: name,
      customer_email: email,
      message_body: message,
      message_html: messageHtml,
    }, { replyTo: email })

    if (!emailResult.sent) {
      console.error('Contact notification email failed:', emailResult.reason)
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders })
  }
})
