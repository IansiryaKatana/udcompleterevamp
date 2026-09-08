/**
 * Phase 3B DPD carrier foundation — no live DPD network calls.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { getActiveCarrierProvider, resolveCarrierProvider } from '@/admin/lib/carrierProvider'
import { DpdCarrierAdapter } from '@/admin/lib/dpd/dpdCarrierAdapter'
import {
  DPD_REQUIREMENTS_FOR_LIVE,
  mapDpdDisplayStatusToDelivery,
  normalizeCarrierProvider,
  UnconfirmedDpdClient,
} from '@/admin/lib/dpd/dpdClient'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 3B DPD carrier foundation', () => {
  it.skipIf(!configured)('rpc_phase3b_carrier_selftest passes A–H', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase3b_carrier_selftest')
    expect(error).toBeNull()
    const result = data as { ok: boolean; cases: Array<Record<string, { ok: boolean; detail?: string }>>; live_dpd?: boolean }
    expect(result.ok, JSON.stringify(result.cases)).toBe(true)
    expect(result.live_dpd).toBe(false)
    const flat = Object.assign({}, ...result.cases)
    for (const [name, c] of Object.entries(flat)) {
      expect(c.ok, `${name}: ${c.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('carrier_mode disabled and payment gateway unchanged', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const mode = await supabase.rpc('carrier_gateway_mode')
    const pay = await supabase.rpc('payment_gateway_mode')
    expect(mode.data).toBe('disabled')
    expect(pay.data).toBe('disabled')
  })

  it.skipIf(!configured)('backfill preview does not execute inserts', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await supabase.rpc('rpc_phase3b_shipment_event_backfill_preview')
    const result = data as { ok: boolean; backfill_executed?: boolean; proposed_tracking_added?: number }
    expect(result.ok).toBe(true)
    expect(result.backfill_executed).toBe(false)
    expect(Number(result.proposed_tracking_added)).toBeGreaterThan(0)
  })

  it('active provider is disabled; DPD adapter gates unconfirmed product', async () => {
    expect(getActiveCarrierProvider().environment).toBe('disabled')
    const adapter = resolveCarrierProvider({
      mode: 'test',
      productStatus: 'unconfirmed',
      liveBlocked: true,
      testCredentialsPresent: false,
    })
    expect(adapter).toBeInstanceOf(DpdCarrierAdapter)
    const created = await adapter.createShipment({
      orderId: 'o',
      fulfillmentId: 'f',
      recipientName: 'Test',
      addressLines: ['1 Road'],
      parcels: [{}],
    })
    expect(created.ok).toBe(false)
    expect(created.error).toBe('dpd_product_unconfirmed')
  })

  it('delivery mapping separates fulfilled from delivered', () => {
    expect(mapDpdDisplayStatusToDelivery('DELIVERED')).toBe('DELIVERED')
    expect(mapDpdDisplayStatusToDelivery('FULFILLED')).toBe('DISPATCHED')
    expect(mapDpdDisplayStatusToDelivery('OUT_FOR_DELIVERY')).toBe('OUT_FOR_DELIVERY')
    expect(normalizeCarrierProvider('DPD Local')).toBe('dpd')
    expect(normalizeCarrierProvider('Other')).toBe('other')
    expect(DPD_REQUIREMENTS_FOR_LIVE.length).toBeGreaterThan(5)
  })

  it('unconfirmed client never invents success', async () => {
    const client = new UnconfirmedDpdClient()
    expect(client.productStatus).toBe('unconfirmed')
    const res = await client.createConsignment({
      fulfillmentId: 'f',
      orderId: 'o',
      parcels: [{ sequence: 1 }],
      recipient: { name: 'x', addressLines: ['y'] },
      environment: 'test',
    })
    expect(res.ok).toBe(false)
  })
})
