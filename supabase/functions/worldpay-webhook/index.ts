/**
 * Worldpay webhook ingress — Phase 2E foundation.
 * POST only, service role, redacted payload storage, idempotent via RPC.
 * Never logs raw card data. No live Worldpay verification without merchant secret.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENSITIVE_KEY = /pan|cardNumber|cvv|cvc|primaryAccountNumber/i

function redactPayload(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(redactPayload)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactPayload(val)
    }
    return out
  }
  return value
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'service_not_configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const webhookSecret = Deno.env.get('WORLDPAY_WEBHOOK_SECRET') ?? ''
  const rawBody = await req.text()
  const signatureHeader =
    req.headers.get('worldpay-signature') ??
    req.headers.get('x-worldpay-signature') ??
    req.headers.get('authorization')

  let parsed: Record<string, unknown> = {}
  try {
    parsed = (redactPayload(JSON.parse(rawBody)) as Record<string, unknown>) ?? {}
  } catch {
    parsed = { parse_error: true }
  }

  const eventType =
    (typeof parsed.eventType === 'string' && parsed.eventType) ||
    (typeof parsed.type === 'string' && parsed.type) ||
    'unknown'
  const externalEventId =
    (typeof parsed.eventId === 'string' && parsed.eventId) ||
    (typeof parsed.id === 'string' && parsed.id) ||
    null

  const signatureValid = Boolean(webhookSecret.trim())
    ? false // Phase 2E: no invented crypto — store event, mark invalid until official algo wired
    : false

  const payloadHash = await sha256Hex(rawBody)

  const { data, error } = await supabase.rpc('rpc_ingest_payment_gateway_event', {
    p_gateway: 'worldpay',
    p_external_event_id: externalEventId,
    p_event_type: eventType,
    p_payload_redacted: parsed,
    p_payload_hash: payloadHash,
    p_signature_header: signatureHeader,
    p_signature_valid: signatureValid,
    p_related_order_id: null,
    p_related_payment_id: null,
    p_idempotency_key: externalEventId,
  })

  if (error) {
    console.error('worldpay_webhook_ingest_failed', { eventType, externalEventId, message: error.message })
    return new Response(JSON.stringify({ error: 'ingest_failed' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!webhookSecret.trim()) {
    return new Response(
      JSON.stringify({
        received: true,
        signature_valid: false,
        error: 'webhook_secret_not_configured',
        duplicate: Boolean((data as { duplicate?: boolean })?.duplicate),
        event_id: (data as { event_id?: string })?.event_id ?? null,
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  return new Response(
    JSON.stringify({
      received: true,
      signature_valid: signatureValid,
      duplicate: Boolean((data as { duplicate?: boolean })?.duplicate),
      event_id: (data as { event_id?: string })?.event_id ?? null,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
})
