/**
 * Payment gateway adapter contracts — no PAN/CVV fields anywhere.
 */

export type GatewayMode = 'disabled' | 'test' | 'live'

export type PaymentIntentState =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'AUTHORIZED'
  | 'PARTIALLY_CAPTURED'
  | 'CAPTURED'
  | 'FAILED'
  | 'VOIDED'
  | 'CANCELLED'

export type GatewayActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; message?: string }

export type AuthorizeInput = {
  orderId: string
  amount: number
  currency: string
  idempotencyKey: string
  /** Tokenized or external reference — never raw card data */
  paymentMethodRef?: string | null
}

export type CaptureInput = {
  paymentId?: string | null
  externalPaymentId?: string | null
  amount: number
  currency: string
  idempotencyKey: string
}

export type VoidInput = {
  paymentId?: string | null
  externalPaymentId?: string | null
  reason?: string | null
  idempotencyKey: string
}

export type RefundInput = {
  paymentId?: string | null
  externalPaymentId?: string | null
  amount: number
  currency: string
  reason?: string | null
  idempotencyKey: string
}

export type GetPaymentInput = {
  paymentId?: string | null
  externalPaymentId?: string | null
}

export type WebhookVerifyInput = {
  rawBody: string
  signatureHeader?: string | null
  secret?: string | null
}

export type WebhookParseResult = {
  eventType: string | null
  externalEventId: string | null
  payload: Record<string, unknown>
}

export type WebhookVerifyResult =
  | { valid: true }
  | { valid: false; reason: string }

export interface PaymentGateway {
  readonly provider: string

  authorize(input: AuthorizeInput): Promise<GatewayActionResult>
  capture(input: CaptureInput): Promise<GatewayActionResult>
  void(input: VoidInput): Promise<GatewayActionResult>
  refund(input: RefundInput): Promise<GatewayActionResult>
  getPayment(input: GetPaymentInput): Promise<GatewayActionResult>
  parseWebhook(rawBody: string): WebhookParseResult
  verifyWebhook(input: WebhookVerifyInput): WebhookVerifyResult
}

export type PaymentServiceConfig = {
  mode: GatewayMode
  provider: string
  phase2eLiveBlocked?: boolean
  credentials?: {
    merchantEntity?: string | null
    apiUsername?: string | null
    apiPassword?: string | null
    webhookSecret?: string | null
    environment?: 'try' | 'live' | null
  }
}
