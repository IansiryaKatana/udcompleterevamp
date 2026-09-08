/**
 * Phase 4C sales scope hardening — SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 4C sales scope hardening', () => {
  it.skipIf(!configured)('rpc_phase4c_sales_hardening_selftest passes A–H', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase4c_sales_hardening_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      cleanup?: { ok: boolean }
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.cleanup?.ok).toBe(true)
    for (const name of [
      'A_assigned_scope_matrix',
      'B_owner_all_bypass',
      'C_order_dual_policy',
      'D_backfill_snapshot_safe',
      'E_duplicate_no_merge',
      'F_cg_not_justified',
      'G_parked_deps',
      'H_security_matrix_rpc',
    ]) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('detail workspace RPCs reject without admin session', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const id = '00000000-0000-0000-0000-000000000001'
    for (const [fn, args] of [
      ['rpc_get_admin_customer_workspace', { p_customer_id: id }],
      ['rpc_get_admin_company_workspace', { p_company_id: id }],
      ['rpc_get_admin_order_workspace', { p_order_id: id }],
      ['rpc_get_admin_draft_workspace', { p_draft_id: id }],
      ['rpc_admin_decide_ownership_candidate', {
        p_review_id: id,
        p_decision: 'APPROVE',
        p_manual_owner_id: null,
        p_note: null,
        p_apply_now: false,
      }],
    ] as const) {
      const { data } = await supabase.rpc(fn, args as never)
      expect(data).toMatchObject({ ok: false, error: 'Forbidden' })
    }
  })
})
