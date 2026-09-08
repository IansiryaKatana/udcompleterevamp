/**
 * Phase 5B — app dependency register (locked gates; no Shopify mutations).
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

describe('Phase 5B app dependency closure', () => {
  it.skipIf(!configured)('selftest PASS + locked gates', async () => {
    const { data, error } = await service().rpc('rpc_phase5b_dependency_selftest')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.PHASE4I_PILOT).toBe('NOT_SENT')
    expect(data.cases.A_locked_gates.ok).toBe(true)
    expect(data.cases.B_register_seeded.ok).toBe(true)
    expect(data.cases.C_critical_rows.ok).toBe(true)
  })

  it.skipIf(!configured)('register lists blockers including SKULabs and Flow', async () => {
    const { data, error } = await service().rpc('rpc_admin_list_app_dependency_register', {
      p_blocker_only: true,
    })
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.blocker_count).toBeGreaterThanOrEqual(3)
    const keys = (data.items as Array<{ app_key: string }>).map((i) => i.app_key)
    expect(keys).toContain('skulabs')
    expect(keys).toContain('shopify_flow')
    expect(keys).toContain('dpd_wsa')
    expect(keys).toContain('worldpay_ecommerce')
    expect(data.locked.pilot_send_authorized).toBe('false')
    expect(data.locked.commercial_access_mode).toBe('catalogue_open')
    expect(data.locked.compliance_enforcement_mode).toBe('observe')
  })

  it.skipIf(!configured)('UD Sales Portal is not obsolete', async () => {
    const { data } = await service().from('app_dependency_register').select('*').eq('app_key', 'ud_sales_portal').single()
    expect(data.classification).toBe('PARTIALLY_REPLACED')
    expect(data.cutover_blocker).toBe(false)
    expect(String(data.active_evidence)).toMatch(/ACTIVE|IN USE|Live/i)
  })
})
