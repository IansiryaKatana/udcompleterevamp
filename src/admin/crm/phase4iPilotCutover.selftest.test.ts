/**
 * Phase 4I — pilot cutover validation (no auto-send, no trade_required flip).
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const configured = Boolean(url && serviceKey)

function service() {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function anon() {
  return createClient(url, anonKey || serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe('Phase 4I pilot & cutover validation', () => {
  it.skipIf(!configured)('rpc_phase4i_cutover_validation_selftest PASS', async () => {
    const { data, error } = await service().rpc('rpc_phase4i_cutover_validation_selftest')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.commercial_access_mode).toBe('catalogue_open')
    expect(data.trade_required_cutover_approved).toBe('false')
    expect(data.pilot_send_status).toContain('OWNER APPROVAL REQUIRED')
    expect(data.cases.B_double_gate.ok).toBe(true)
    expect(data.cases.C_postgrest_revalidation.ok).toBe(true)
  }, 120_000)

  it.skipIf(!configured)('double-gate: effective mode stays catalogue_open', async () => {
    const { data: live } = await service().rpc('effective_commercial_access_mode', {
      p_force_mode: null,
    })
    const { data: forced } = await service().rpc('effective_commercial_access_mode', {
      p_force_mode: 'trade_required',
    })
    expect(live).toBe('catalogue_open')
    expect(forced).toBe('trade_required')
  })

  it.skipIf(!configured)('cutover precheck ok and cutover_allowed_now false', async () => {
    const { data, error } = await service().rpc('rpc_admin_trade_required_cutover_precheck')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.cutover_allowed_now).toBe(false)
    expect(data.gate.POSTGREST).toBe('PASS')
    expect(data.gate.DOUBLE_GATE).toBe('PASS')
  }, 120_000)

  it.skipIf(!configured)('pilot cohort finalize returns 5–15 ready recipients', async () => {
    const { data, error } = await service().rpc('rpc_admin_finalize_pilot_cohort', {
      p_limit: 12,
      p_proposal_key: 'PHASE4I_PILOT_001',
    })
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.count).toBeGreaterThanOrEqual(5)
    expect(data.count).toBeLessThanOrEqual(15)
    expect(data.PILOT_SEND_STATUS).toContain('OWNER APPROVAL REQUIRED')
    expect(Array.isArray(data.matrix)).toBe(true)
  }, 120_000)

  it.skipIf(!configured || !anonKey)('security revalidation: anon cannot read product prices', async () => {
    const { data } = await anon().from('products').select('id,price').eq('published', true).limit(3)
    expect((data ?? []).length).toBe(0)
  })

  it.skipIf(!configured)('pilot_send_authorized remains false', async () => {
    const { data } = await service()
      .from('site_settings')
      .select('value')
      .eq('key', 'pilot_send_authorized')
      .maybeSingle()
    expect(data?.value).toBe('false')
  })

  it.skipIf(!configured)('shadow matrix control personas', async () => {
    const { data, error } = await service().rpc('rpc_admin_phase4i_shadow_matrix')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    const byPersona = Object.fromEntries(
      (data.matrix as Array<{ persona: string; price: boolean; cart: boolean; pay_later: boolean }>).map(
        (r) => [r.persona, r],
      ),
    )
    expect(byPersona.anonymous.price).toBe(false)
    expect(byPersona.anonymous.cart).toBe(false)
    expect(byPersona.approved.price).toBe(true)
    expect(byPersona.approved_pay_later_false.pay_later).toBe(false)
    expect(byPersona.approved_pay_later_true.pay_later).toBe(true)
  })
})
