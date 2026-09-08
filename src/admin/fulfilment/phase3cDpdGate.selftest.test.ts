/**
 * Phase 3C — DPD confirmation gate. No live/test DPD network calls.
 * Product/API remains UNCONFIRMED until business supplies account docs + TEST credentials.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { getActiveCarrierProvider, resolveCarrierProvider } from '@/admin/lib/carrierProvider'
import { DPD_REQUIREMENTS_FOR_LIVE } from '@/admin/lib/dpd/dpdClient'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 3C DPD confirmation gate', () => {
  it.skipIf(!configured)('rpc_phase3c_dpd_gate_selftest passes; product UNCONFIRMED', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase3c_dpd_gate_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      dpd_product_api: string
      carrier_mode: string
      live_dpd: boolean
      test_client_implemented: boolean
      cases: Array<Record<string, { ok: boolean; detail?: string }>>
    }
    expect(result.ok, JSON.stringify(result.cases)).toBe(true)
    expect(result.dpd_product_api).toBe('UNCONFIRMED')
    expect(result.carrier_mode).toBe('disabled')
    expect(result.live_dpd).toBe(false)
    expect(result.test_client_implemented).toBe(false)
  }, 120_000)

  it('provider stays disabled; test mode without confirmation still refuses', async () => {
    expect(getActiveCarrierProvider().environment).toBe('disabled')
    const adapter = resolveCarrierProvider({
      mode: 'test',
      productStatus: 'unconfirmed',
      liveBlocked: true,
      testCredentialsPresent: false,
    })
    const res = await adapter.createShipment({
      orderId: 'o',
      fulfillmentId: 'f',
      recipientName: 'Test',
      addressLines: ['1 Road'],
      parcels: [{}],
    })
    expect(res.ok).toBe(false)
    expect(['dpd_product_unconfirmed', 'dpd_test_credentials_missing', 'carrier_disabled']).toContain(
      res.error,
    )
    expect(DPD_REQUIREMENTS_FOR_LIVE.length).toBeGreaterThan(5)
  })
})
