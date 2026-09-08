import { describe, expect, it } from 'vitest'
import {
  assertAffectsReceived,
  assertVoidNotRefund,
  classifyPaymentTransaction,
  pendingDoesNotEqualReceived,
} from './semantics'

describe('payment semantics classifier', () => {
  it('pending bank deposit does not count as received', () => {
    const result = classifyPaymentTransaction({
      gateway: 'Bank Deposit',
      kind: 'SALE',
      status: 'PENDING',
      sourceSystem: 'shopify',
    })
    expect(result.meaning).toBe('PENDING_EXTERNAL_PAYMENT')
    expect(result.affects_received).toBe(false)
    expect(pendingDoesNotEqualReceived(result)).toBe(true)
    expect(assertAffectsReceived(result, false)).toBe(true)
  })

  it('worldpay SALE SUCCESS counts as received', () => {
    const result = classifyPaymentTransaction({
      gateway: 'Worldpay eCommerce',
      kind: 'SALE',
      status: 'SUCCESS',
      sourceSystem: 'shopify',
    })
    expect(result.meaning).toBe('SETTLED_SALE')
    expect(result.affects_received).toBe(true)
    expect(assertAffectsReceived(result, true)).toBe(true)
  })

  it('pay later pending is not cash received', () => {
    const result = classifyPaymentTransaction({
      gateway: 'PAY LATER',
      kind: 'SALE',
      status: 'PENDING',
      sourceSystem: 'shopify',
    })
    expect(result.affects_received).toBe(false)
    expect(result.meaning).toBe('PENDING_EXTERNAL_PAYMENT')
    expect(pendingDoesNotEqualReceived(result)).toBe(true)
  })

  it('void is not a refund', () => {
    const result = classifyPaymentTransaction({
      gateway: 'Bank Deposit',
      kind: 'VOID',
      status: 'SUCCESS',
      sourceSystem: 'shopify',
    })
    expect(result.meaning).toBe('VOIDED')
    expect(result.affects_refunded).toBe(false)
    expect(result.affects_received).toBe(false)
    expect(assertVoidNotRefund(result)).toBe(true)
  })

  it('unique manual success is received', () => {
    const result = classifyPaymentTransaction({
      gateway: 'Bank transfer',
      kind: 'SALE',
      status: 'SUCCESS',
      sourceSystem: 'unique',
    })
    expect(result.meaning).toBe('MANUAL_PAYMENT_RECORDED')
    expect(result.affects_received).toBe(true)
  })
})
