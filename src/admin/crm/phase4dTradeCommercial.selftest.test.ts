/**
 * Phase 4D trade eligibility & commercial policy — SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 4D trade commercial access', () => {
  it.skipIf(!configured)('rpc_phase4d_trade_commercial_selftest passes A–J', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase4d_trade_commercial_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      cleanup?: { ok: boolean }
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.cleanup?.ok).toBe(true)
    for (const name of [
      'A_trade_and_type_independent',
      'B_trade_required_gate',
      'C_pay_later_gate',
      'D_auth_crm_separation',
      'E_base_price_no_list',
      'F_historical_price_immutable',
      'G_eligibility_audit_event',
      'H_ambiguous_backfill_preserved',
      'I_no_invented_price_lists_parked',
      'J_customer_canonical_eligibility',
    ]) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('trade decide RPCs reject without admin session', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const id = '00000000-0000-0000-0000-000000000001'
    for (const [fn, args] of [
      ['rpc_admin_set_trade_access', { p_customer_id: id, p_status: 'approved', p_note: null, p_source: 'test' }],
      [
        'rpc_admin_set_pay_later_eligibility',
        { p_customer_id: id, p_eligible: true, p_note: null, p_source: 'test' },
      ],
      [
        'rpc_admin_decide_trade_eligibility_backfill',
        { p_review_id: id, p_decision: 'APPROVE', p_note: null, p_apply_now: false },
      ],
    ] as const) {
      const { data } = await supabase.rpc(fn, args as never)
      expect(data).toMatchObject({ ok: false, error: 'Forbidden' })
    }
  })

  it.skipIf(!configured)('PAY LATER denied for approved-without-pay-later via assert RPC', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const prefix = `p4d-vitest-${Date.now()}`
    const { data: cust, error } = await supabase
      .from('customers')
      .insert({
        email: `${prefix}@example.test`,
        display_name: prefix,
        source_system: 'unique',
        version: 1,
        trade_access_status: 'approved',
        pay_later_eligible: false,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const { data } = await supabase.rpc('rpc_assert_storefront_commercial_action', {
      p_action: 'purchase',
      p_payment_option: 'pay_later',
      p_customer_id: cust!.id,
    })
    expect(data).toMatchObject({ ok: false, error: 'PAY_LATER_NOT_PERMITTED' })
    await supabase
      .from('customers')
      .update({ email: `purged+${cust!.id}@example.test`, display_name: 'purged' })
      .eq('id', cust!.id)
  })
})
