import type { PaymentGateway } from './types'
import { WorldpayAccessAdapter } from './worldpay/WorldpayAccessAdapter'

const worldpayAdapter = new WorldpayAccessAdapter()

/** Returns gateway adapter for provider key. Worldpay variants share one stub in Phase 2E. */
export function getPaymentGateway(provider: string): PaymentGateway | null {
  const p = provider.trim().toLowerCase()
  if (p.includes('worldpay') || p === 'worldpay_access_unconfirmed') {
    return worldpayAdapter
  }
  return null
}
