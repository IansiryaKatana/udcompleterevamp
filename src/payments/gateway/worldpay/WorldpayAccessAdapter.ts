/**
 * Worldpay Access adapter stub — Phase 2E foundation only.
 *
 * UNCONFIRMED product: Shopify historical label "Worldpay eCommerce"; likely Access Worldpay
 * if merchant confirms. Official Access Worldpay docs require Implementation Manager credentials
 * (merchant entity, API username/password, webhook secret, try vs live base URLs).
 *
 * Do NOT invent API endpoints or perform live HTTP calls in Phase 2E.
 */
import type {
  AuthorizeInput,
  CaptureInput,
  GatewayActionResult,
  GetPaymentInput,
  PaymentGateway,
  RefundInput,
  VoidInput,
  WebhookParseResult,
  WebhookVerifyInput,
  WebhookVerifyResult,
} from '../types'

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

function notConfigured(): GatewayActionResult {
  return { ok: false, error: 'worldpay_not_configured' }
}

export class WorldpayAccessAdapter implements PaymentGateway {
  readonly provider = 'worldpay_access_unconfirmed'

  async authorize(_input: AuthorizeInput): Promise<GatewayActionResult> {
    return notConfigured()
  }

  async capture(_input: CaptureInput): Promise<GatewayActionResult> {
    return notConfigured()
  }

  async void(_input: VoidInput): Promise<GatewayActionResult> {
    return notConfigured()
  }

  async refund(_input: RefundInput): Promise<GatewayActionResult> {
    return notConfigured()
  }

  async getPayment(_input: GetPaymentInput): Promise<GatewayActionResult> {
    return notConfigured()
  }

  parseWebhook(rawBody: string): WebhookParseResult {
    let parsed: Record<string, unknown> = {}
    try {
      const json = JSON.parse(rawBody) as unknown
      parsed = (redactPayload(json) as Record<string, unknown>) ?? {}
    } catch {
      parsed = { raw: '[unparseable]' }
    }

    const eventType =
      (typeof parsed.eventType === 'string' && parsed.eventType) ||
      (typeof parsed.type === 'string' && parsed.type) ||
      null
    const externalEventId =
      (typeof parsed.eventId === 'string' && parsed.eventId) ||
      (typeof parsed.id === 'string' && parsed.id) ||
      null

    return { eventType, externalEventId, payload: parsed }
  }

  verifyWebhook(input: WebhookVerifyInput): WebhookVerifyResult {
    if (!input.secret?.trim()) {
      return { valid: false, reason: 'webhook_secret_not_configured' }
    }
    // Phase 2E: no invented crypto — authenticity requires merchant-provided secret + official algo.
    return { valid: false, reason: 'verification_not_implemented_phase_2e' }
  }
}

/** Block live mode at adapter level when Phase 2E gate is active. */
export function worldpayLiveBlockedResult(): GatewayActionResult {
  return { ok: false, error: 'production_gateway_blocked_phase_2e' }
}
