/**
 * Phase 5F finance reconciliation & cutover balance closure — service-role selftest.
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

describe('Phase 5F finance reconciliation closure', () => {
  it.skipIf(!configured)('rpc_phase5f_finance_selftest passes A–N', async () => {
    const { data, error } = await service().rpc('rpc_phase5f_finance_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      pass?: number
      total?: number
      cases: Record<string, { ok: boolean }>
    }
    expect(result.ok, JSON.stringify(result.cases)).toBe(true)
    expect(result.pass).toBe(14)
    expect(result.total).toBe(14)
    for (const [name, c] of Object.entries(result.cases)) {
      expect(c.ok, name).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('finance readiness is not blindly READY', async () => {
    const { data, error } = await service().rpc('rpc_admin_cutover_control_centre')
    expect(error).toBeNull()
    const centre = data as {
      ok: boolean
      domains: Array<{ domain: string; status: string }>
      finance_readiness?: { status?: string; mismatch?: number }
      locked?: Record<string, unknown>
    }
    expect(centre.ok).toBe(true)
    const finance = centre.domains.find((d) => d.domain === 'FINANCE')
    expect(finance).toBeTruthy()
    if (Number(centre.finance_readiness?.mismatch ?? 0) > 0) {
      expect(finance!.status).not.toBe('READY')
    }
    expect(centre.locked?.pilot_send_authorized).toBe('false')
    expect(centre.locked?.wms_enabled).toBe('false')
  }, 60_000)

  it.skipIf(!configured)('catalogue readiness remains READY', async () => {
    const { data, error } = await service().rpc('rpc_phase5e_catalogue_reconciliation')
    expect(error).toBeNull()
    const recon = data as { catalogue_readiness?: string }
    expect(recon.catalogue_readiness).toBe('READY')
  }, 60_000)
})
