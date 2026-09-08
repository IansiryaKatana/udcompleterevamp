/**
 * Phase 3A fulfilment ops regression — service-role SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 * No external DPD / Worldpay calls.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { DisabledCarrierProvider, getActiveCarrierProvider } from '@/admin/lib/carrierProvider'
import { inventoryBoundaryNote } from '@/admin/lib/fulfilmentOps'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 3A fulfilment foundation', () => {
  it.skipIf(!configured)('rpc_phase3a_fulfilment_selftest passes A–L', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase3a_fulfilment_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      cases: Array<Record<string, { ok: boolean; detail?: string }>>
      inventory_boundary?: string
    }
    expect(result.ok, JSON.stringify(result.cases)).toBe(true)
    const flat = Object.assign({}, ...result.cases)
    for (const [name, c] of Object.entries(flat)) {
      expect(c.ok, `${name}: ${c.detail}`).toBe(true)
    }
    expect(result.inventory_boundary || inventoryBoundaryNote()).toMatch(/not decrement/i)
  }, 180_000)

  it.skipIf(!configured)('gateway_mode remains disabled', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('payment_gateway_mode')
    expect(error).toBeNull()
    expect(data).toBe('disabled')
  })

  it.skipIf(!configured)('create fulfilment RPC rejects unauthenticated service calls', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await supabase.rpc('rpc_admin_create_manual_fulfilment', {
      p_order_id: '00000000-0000-0000-0000-000000000001',
      p_lines: [{ order_item_id: '00000000-0000-0000-0000-000000000002', quantity: 1 }],
      p_inventory_location_id: null,
      p_tracking_company: null,
      p_tracking_number: null,
      p_tracking_url: null,
      p_note: null,
      p_idempotency_key: 'PHASE3A-STAB-SHOULD-FAIL',
    })
    expect(data).toMatchObject({ ok: false, error: 'Forbidden' })
  })

  it('carrier provider is disabled (no live DPD)', async () => {
    const provider = getActiveCarrierProvider()
    expect(provider).toBeInstanceOf(DisabledCarrierProvider)
    expect(provider.environment).toBe('disabled')
    const created = await provider.createShipment({
      orderId: 'x',
      fulfillmentId: 'y',
      recipientName: 'Test',
      addressLines: ['1 Test St'],
      parcels: [{}],
    })
    expect(created.ok).toBe(false)
    expect(created.error).toBe('carrier_disabled')
  })
})
