import { describe, expect, it } from 'vitest'
import { PaymentService } from './PaymentService'

describe('PaymentService', () => {
  it('disabled mode blocks capture', async () => {
    const svc = new PaymentService({ mode: 'disabled', provider: 'worldpay' })
    const result = await svc.capture({
      amount: 10,
      currency: 'GBP',
      idempotencyKey: 'test-1',
    })
    expect(result).toEqual({ ok: false, error: 'gateway_disabled' })
  })

  it('live mode blocked in Phase 2E', async () => {
    const svc = new PaymentService({
      mode: 'live',
      provider: 'worldpay',
      phase2eLiveBlocked: true,
    })
    const result = await svc.capture({
      amount: 10,
      currency: 'GBP',
      idempotencyKey: 'test-2',
    })
    expect(result).toEqual({ ok: false, error: 'production_gateway_blocked_phase_2e' })
  })

  it('manual method does not use worldpay adapter', async () => {
    const svc = new PaymentService({ mode: 'test', provider: 'worldpay' })
    const result = await svc.capture({
      amount: 10,
      currency: 'GBP',
      idempotencyKey: 'test-3',
      method: 'bank_transfer',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('manual_method_no_gateway')
    }
  })

  it('rejects invalid amount before adapter', async () => {
    const svc = new PaymentService({ mode: 'test', provider: 'worldpay' })
    const result = await svc.capture({
      amount: 0,
      currency: 'GBP',
      idempotencyKey: 'test-4',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('invalid_amount')
    }
  })
})
