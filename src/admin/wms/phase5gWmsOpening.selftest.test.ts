/**
 * Phase 5G WMS opening stock readiness — service-role selftest (fast path).
 * Full-catalogue shadow selftest (16/16) is run via SQL CLI due to statement timeout.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

function service() {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe('Phase 5G WMS opening stock readiness', () => {
  it.skipIf(!configured)('rpc_phase5g_wms_selftest_fast passes', async () => {
    const { data, error } = await service().rpc('rpc_phase5g_wms_selftest_fast')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      pass?: number
      total?: number
      cases: Record<string, { ok: boolean }>
    }
    expect(result.ok, JSON.stringify(result.cases)).toBe(true)
    expect(result.pass).toBe(result.total)
    for (const [name, c] of Object.entries(result.cases)) {
      expect(c.ok, name).toBe(true)
    }
  }, 120_000)

  it.skipIf(!configured)('wms stays disabled; readiness not READY_TO_ACTIVATE', async () => {
    const { data, error } = await service().rpc('wms_cutover_readiness_status')
    expect(error).toBeNull()
    const wms = data as { status?: string; wms_enabled?: boolean | string }
    expect(String(wms.wms_enabled)).toMatch(/false/i)
    expect(wms.status).not.toBe('READY_TO_ACTIVATE')
  }, 60_000)

  it.skipIf(!configured)('catalogue READY and finance not silently READY', async () => {
    const cat = await service().rpc('rpc_phase5e_catalogue_reconciliation')
    expect(cat.error).toBeNull()
    expect((cat.data as { catalogue_readiness?: string }).catalogue_readiness).toBe('READY')

    const fin = await service().rpc('finance_cutover_readiness_status')
    expect(fin.error).toBeNull()
    expect((fin.data as { status?: string }).status).not.toBe('READY')
  }, 60_000)
})
