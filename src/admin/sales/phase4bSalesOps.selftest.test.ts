/**
 * Phase 4B sales ops — SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 4B sales operations', () => {
  it.skipIf(!configured)('rpc_phase4b_sales_ops_selftest passes A–I', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase4b_sales_ops_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      cleanup?: { ok: boolean }
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.cleanup?.ok).toBe(true)
    const required = [
      'A_staff_admin_link',
      'B_alias_resolution',
      'C_ownership_snapshot_isolation',
      'D_mine_filter_helper',
      'E_sales_rbac_column',
      'F_customer_type_preserve_metafield',
      'G_duplicate_review_no_merge',
      'H_reports',
      'I_parked_dpd_skulabs',
    ]
    for (const name of required) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('reassign ownership RPC rejects without admin session', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await supabase.rpc('rpc_admin_reassign_ownership', {
      p_entity_type: 'company',
      p_entity_id: '00000000-0000-0000-0000-000000000001',
      p_assignment_type: 'salesperson',
      p_new_staff_id: null,
      p_reason: 'test',
      p_expected_version: null,
    })
    expect(data).toMatchObject({ ok: false, error: 'Forbidden' })
  })
})
