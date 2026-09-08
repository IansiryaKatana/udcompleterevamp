/**
 * Phase 2D Finance & AR regression — service-role SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 2D finance & AR core', () => {
  it.skipIf(!configured)('rpc_phase2d_finance_selftest passes A–V with cleanup', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase2d_finance_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      pass?: number
      total?: number
      cleanup?: { ok: boolean; detail?: string }
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok, JSON.stringify(result.cleanup)).toBe(true)
    expect(result.cleanup?.ok).toBe(true)
    expect(result.pass).toBe(22)
    expect(result.total).toBe(22)
    for (const [name, c] of Object.entries(result.cases)) {
      expect(c.ok, `${name}: ${c.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('manual payment RPC rejects unauthenticated service calls', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await supabase.rpc('rpc_admin_post_manual_payment', {
      p_order_id: '00000000-0000-0000-0000-000000000001',
      p_amount: 1,
      p_method: 'Bank transfer',
      p_payment_date: '2026-01-01',
      p_reference: null,
      p_note: null,
      p_idempotency_key: 'PHASE2D-STAB-SHOULD-FAIL',
      p_expected_outstanding: 1,
    })
    expect(data).toMatchObject({ ok: false, error: 'Forbidden' })
  })
})
