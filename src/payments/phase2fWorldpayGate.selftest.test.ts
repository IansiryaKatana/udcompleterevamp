/**
 * Phase 2F — Worldpay product identity gate + test isolation checks.
 * Worldpay PRODUCT is UNCONFIRMED → no network Worldpay calls in this suite.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { PaymentService } from '@/payments/gateway/PaymentService'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 2F Worldpay product gate', () => {
  it('refuses live and disabled modes without network', async () => {
    const disabled = new PaymentService({ mode: 'disabled', phase2eLiveBlocked: true })
    const disabledResult = await disabled.capture({ amount: 1, currency: 'GBP', idempotencyKey: 'p2f-d' })
    expect(disabledResult.ok).toBe(false)

    const live = new PaymentService({ mode: 'live', phase2eLiveBlocked: true })
    const liveResult = await live.capture({ amount: 1, currency: 'GBP', idempotencyKey: 'p2f-l' })
    expect(liveResult.ok).toBe(false)
    if (!liveResult.ok) {
      expect(liveResult.error).toBe('production_gateway_blocked_phase_2e')
    }
  })

  it.skipIf(!configured)('rpc_phase2f_worldpay_test_selftest passes with product UNCONFIRMED', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase2f_worldpay_test_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      worldpay_product?: string
      pass?: number
      total?: number
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.worldpay_product).toBe('UNCONFIRMED')
    expect(result.ok, JSON.stringify(result.cases)).toBe(true)
    expect(result.pass).toBe(result.total)
    for (const [name, c] of Object.entries(result.cases)) {
      expect(c.ok, `${name}: ${c.detail}`).toBe(true)
    }
  }, 120_000)
})
