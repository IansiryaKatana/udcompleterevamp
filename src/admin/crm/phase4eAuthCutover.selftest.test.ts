/**
 * Phase 4E auth linkage & cutover gate — SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 4E auth cutover gate', () => {
  it.skipIf(!configured)('rpc_phase4e_auth_cutover_selftest passes A–J', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase4e_auth_cutover_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      cleanup?: { ok: boolean }
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.cleanup?.ok).toBe(true)
    for (const name of [
      'A_catalogue_open_preserved',
      'B_trade_required_test_no_flip',
      'C_pay_later_denied',
      'D_bind_ignores_unauthenticated_client_id',
      'E_activation_token_stored_hashed',
      'F_pay_later_historical_only',
      'G_bulk_trade_apply_gated',
      'H_ownership_untouched',
      'I_parked_deps',
      'J_anonymous_session',
    ]) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('commercial_access_mode remains catalogue_open', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await supabase.from('site_settings').select('value').eq('key', 'commercial_access_mode').maybeSingle()
    expect(data?.value).toBe('catalogue_open')
  })

  it.skipIf(!configured)('auth link / trade decide RPCs reject without admin session', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const id = '00000000-0000-0000-0000-000000000001'
    for (const [fn, args] of [
      ['rpc_admin_link_customer_auth', { p_customer_id: id, p_auth_user_id: id, p_note: null, p_source: 'test' }],
      ['rpc_admin_unlink_customer_auth', { p_customer_id: id, p_note: null }],
      ['rpc_admin_apply_explicit_trade_backfill', { p_confirm: 'APPLY_EXPLICIT_TRADE_BACKFILL' }],
    ] as const) {
      const { data } = await supabase.rpc(fn, args as never)
      expect(data).toMatchObject({ ok: false })
      expect(['Forbidden', 'NOT_EXECUTED_IN_PHASE_4E', 'CONFIRMATION_REQUIRED']).toContain(
        (data as { error?: string })?.error,
      )
    }
  })
})
