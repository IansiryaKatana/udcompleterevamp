/**
 * Phase 2E Payment Gateway regression — service-role SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 2E payment gateway foundation', () => {
  it.skipIf(!configured)('rpc_phase2e_payment_gateway_selftest passes A–L with cleanup', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase2e_payment_gateway_selftest')
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
    expect(result.pass).toBe(12)
    expect(result.total).toBe(12)
    for (const [name, c] of Object.entries(result.cases)) {
      expect(c.ok, `${name}: ${c.detail}`).toBe(true)
    }
  }, 180_000)
})
