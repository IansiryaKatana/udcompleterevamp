/**
 * Phase 2B draft-ops regression — calls the service-role SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL (or SUPABASE_URL) in env.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const configured = Boolean(url && serviceKey)

describe('Phase 2B draft order operations', () => {
  it.skipIf(!configured)('rpc_phase2b_draft_ops_selftest passes all cases A–K', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await supabase.rpc('rpc_phase2b_draft_ops_selftest')
    expect(error).toBeNull()
    expect(data).toBeTruthy()

    const result = data as {
      ok: boolean
      rate?: number
      cleanup?: { ok: boolean }
      cases: Record<string, { ok: boolean; detail?: string }>
    }

    expect(result.ok).toBe(true)
    expect(result.cleanup?.ok).toBe(true)

    const required = [
      'A_create_unique_draft',
      'B_server_money',
      'C_snapshots',
      'D_concurrency',
      'E_permissions',
      'F_historical_safety',
      'G_conversion',
      'H_payment_safety',
      'I_duplicate_conversion',
      'J_transactional_failure',
      'K_large_line_guard',
    ]

    for (const name of required) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 120_000)

  it.skipIf(!configured)('admin mutation RPCs reject unauthenticated service calls', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_admin_create_unique_draft', {
      p_payload: { name: 'PHASE2B-STAB-SHOULD-FAIL' },
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ok: false, error: 'Forbidden' })
  })
})
