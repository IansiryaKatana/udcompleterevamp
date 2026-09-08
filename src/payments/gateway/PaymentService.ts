import { getPaymentGateway } from './registry'
import { worldpayLiveBlockedResult } from './worldpay/WorldpayAccessAdapter'
import type {
  AuthorizeInput,
  CaptureInput,
  GatewayActionResult,
  GetPaymentInput,
  PaymentServiceConfig,
  RefundInput,
  VoidInput,
} from './types'

const MANUAL_METHODS = new Set([
  'bank_transfer',
  'bank_deposit',
  'cash',
  'other',
  'manual',
  'bank deposit',
  'pay by cash',
])

const MANUAL_GATEWAY_PREFIXES = ['manual', 'bank deposit', 'pay by cash', 'bank_transfer']

function isManualMethod(methodOrGateway: string | null | undefined): boolean {
  const v = (methodOrGateway ?? '').trim().toLowerCase()
  if (!v) return false
  if (MANUAL_METHODS.has(v)) return true
  return MANUAL_GATEWAY_PREFIXES.some((p) => v === p || v.startsWith(p))
}

function gateError(config: PaymentServiceConfig): GatewayActionResult | null {
  if (config.mode === 'disabled') {
    return { ok: false, error: 'gateway_disabled' }
  }
  if (config.mode === 'live' && config.phase2eLiveBlocked !== false) {
    return { ok: false, error: 'production_gateway_blocked_phase_2e' }
  }
  return null
}

function validateMoney(amount: number, currency: string): GatewayActionResult | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid_amount', message: 'Amount must be greater than zero' }
  }
  const cur = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(cur)) {
    return { ok: false, error: 'invalid_currency', message: 'Currency must be a 3-letter ISO code' }
  }
  return null
}

export class PaymentService {
  constructor(private readonly config: PaymentServiceConfig) {}

  get mode() {
    return this.config.mode
  }

  private resolveAdapter(methodOrGateway?: string | null) {
    if (isManualMethod(methodOrGateway)) {
      return { adapter: null as null, manual: true }
    }
    const adapter = getPaymentGateway(this.config.provider)
    return { adapter, manual: false }
  }

  async authorize(input: AuthorizeInput & { method?: string | null }): Promise<GatewayActionResult> {
    const blocked = gateError(this.config)
    if (blocked) return blocked

    const moneyErr = validateMoney(input.amount, input.currency)
    if (moneyErr) return moneyErr

    const { adapter, manual } = this.resolveAdapter(input.method ?? this.config.provider)
    if (manual) {
      return { ok: false, error: 'manual_method_no_gateway', message: 'Manual methods do not use Worldpay' }
    }
    if (!adapter) {
      return { ok: false, error: 'gateway_not_found' }
    }
    if (this.config.mode === 'live' && this.config.phase2eLiveBlocked !== false) {
      return worldpayLiveBlockedResult()
    }
    return adapter.authorize(input)
  }

  async capture(input: CaptureInput & { method?: string | null }): Promise<GatewayActionResult> {
    const blocked = gateError(this.config)
    if (blocked) return blocked

    const moneyErr = validateMoney(input.amount, input.currency)
    if (moneyErr) return moneyErr

    const { adapter, manual } = this.resolveAdapter(input.method ?? this.config.provider)
    if (manual) {
      return { ok: false, error: 'manual_method_no_gateway', message: 'Manual methods do not use Worldpay' }
    }
    if (!adapter) {
      return { ok: false, error: 'gateway_not_found' }
    }
    if (this.config.mode === 'live' && this.config.phase2eLiveBlocked !== false) {
      return worldpayLiveBlockedResult()
    }
    return adapter.capture(input)
  }

  async void(input: VoidInput & { method?: string | null }): Promise<GatewayActionResult> {
    const blocked = gateError(this.config)
    if (blocked) return blocked

    const { adapter, manual } = this.resolveAdapter(input.method ?? this.config.provider)
    if (manual) {
      return { ok: false, error: 'manual_method_no_gateway', message: 'Manual methods do not use Worldpay' }
    }
    if (!adapter) return { ok: false, error: 'gateway_not_found' }
    if (this.config.mode === 'live' && this.config.phase2eLiveBlocked !== false) {
      return worldpayLiveBlockedResult()
    }
    return adapter.void(input)
  }

  async refund(input: RefundInput & { method?: string | null }): Promise<GatewayActionResult> {
    const blocked = gateError(this.config)
    if (blocked) return blocked

    const moneyErr = validateMoney(input.amount, input.currency)
    if (moneyErr) return moneyErr

    const { adapter, manual } = this.resolveAdapter(input.method ?? this.config.provider)
    if (manual) {
      return { ok: false, error: 'manual_method_no_gateway', message: 'Manual methods do not use Worldpay' }
    }
    if (!adapter) return { ok: false, error: 'gateway_not_found' }
    if (this.config.mode === 'live' && this.config.phase2eLiveBlocked !== false) {
      return worldpayLiveBlockedResult()
    }
    return adapter.refund(input)
  }

  async getPayment(input: GetPaymentInput & { method?: string | null }): Promise<GatewayActionResult> {
    const blocked = gateError(this.config)
    if (blocked) return blocked

    const { adapter, manual } = this.resolveAdapter(input.method ?? this.config.provider)
    if (manual) {
      return { ok: false, error: 'manual_method_no_gateway', message: 'Manual methods do not use Worldpay' }
    }
    if (!adapter) return { ok: false, error: 'gateway_not_found' }
    return adapter.getPayment(input)
  }
}
