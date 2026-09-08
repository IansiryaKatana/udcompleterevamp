/**
 * Phase 4A CRM foundation extension — SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 4A B2B CRM foundation', () => {
  it.skipIf(!configured)('rpc_phase4a_crm_selftest passes A–I', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase4a_crm_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      cleanup?: { ok: boolean }
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.cleanup?.ok).toBe(true)
    const required = [
      'A_address_crud',
      'B_location_fixture',
      'C_contact_update',
      'D_order_snapshot_isolation',
      'E_data_quality_report',
      'F_taxonomy_report',
      'G_staff_resolution',
      'H_raw_tag_metafield_tables',
      'I_parked_dpd_skulabs_boundary',
    ]
    for (const name of required) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('address/location mutate RPCs reject without admin session', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: a } = await supabase.rpc('rpc_admin_upsert_customer_address', {
      p_customer_id: '00000000-0000-0000-0000-000000000001',
      p_address_id: null,
      p_payload: { address1: 'x' },
    })
    expect(a).toMatchObject({ ok: false, error: 'Forbidden' })
    const { data: b } = await supabase.rpc('rpc_admin_upsert_company_location', {
      p_company_id: '00000000-0000-0000-0000-000000000001',
      p_location_id: null,
      p_payload: { name: 'x' },
    })
    expect(b).toMatchObject({ ok: false, error: 'Forbidden' })
  })
})
