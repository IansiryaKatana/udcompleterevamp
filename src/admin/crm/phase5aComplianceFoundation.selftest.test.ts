/**
 * Phase 5A — compliance foundation (observe mode; no invented legal enforcement).
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

describe('Phase 5A compliance foundation', () => {
  it.skipIf(!configured)('selftest PASS + locked gates', async () => {
    const { data, error } = await service().rpc('rpc_phase5a_compliance_foundation_selftest')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.commercial_access_mode).toBe('catalogue_open')
    expect(data.trade_required_cutover_approved).toBe('false')
    expect(data.pilot_send_authorized).toBe('false')
    expect(data.compliance_enforcement_mode).toBe('observe')
    expect(data.PHASE4I_PILOT).toBe('NOT_SENT')
    expect(data.cases.C_trade_vs_compliance_observe.ok).toBe(true)
    expect(data.cases.F_price_security_regression.ok).toBe(true)
  }, 120_000)

  it.skipIf(!configured)('trade approved is not age verified', async () => {
    const { data: trade } = await service().rpc('commercial_policy_evaluate', {
      p_trade_access_status: 'approved',
      p_pay_later_eligible: false,
      p_customer_status: 'active',
      p_access_mode: 'catalogue_open',
      p_has_crm_customer: true,
      p_customer_type: null,
      p_payment_terms: null,
    })
    const { data: comp } = await service().rpc('compliance_policy_evaluate', {
      p_trade_policy: trade,
      p_compliance_status: 'NOT_RECORDED',
      p_product_regulated: true,
      p_enforcement_mode: 'observe',
      p_destination_country: null,
    })
    expect(comp.trade_is_not_age_verified).toBe(true)
    expect(comp.can_purchase_product).toBe(true)
    expect(comp.observe_only_denial).toBe(true)
  })

  it.skipIf(!configured)('enforce mode would require compliance for regulated product', async () => {
    const { data: trade } = await service().rpc('commercial_policy_evaluate', {
      p_trade_access_status: 'approved',
      p_pay_later_eligible: false,
      p_customer_status: 'active',
      p_access_mode: 'catalogue_open',
      p_has_crm_customer: true,
      p_customer_type: null,
      p_payment_terms: null,
    })
    const { data: comp } = await service().rpc('compliance_policy_evaluate', {
      p_trade_policy: trade,
      p_compliance_status: 'NOT_RECORDED',
      p_product_regulated: true,
      p_enforcement_mode: 'enforce',
      p_destination_country: null,
    })
    expect(comp.can_purchase_product).toBe(false)
    expect(comp.reason_codes).toContain('COMPLIANCE_REQUIRED')
  })

  it.skipIf(!configured)('age gate display config is not verification', async () => {
    const { data, error } = await service().rpc('rpc_get_age_gate_display_config')
    expect(error).toBeNull()
    expect(data.is_verification).toBe(false)
    expect(data.is_purchase_control).toBe(false)
    expect(data.enabled).toBe(true)
  })

  it.skipIf(!configured)('product inventory + classify do not invent name rules', async () => {
    const inv = await service().rpc('rpc_admin_compliance_product_inventory')
    expect(inv.error).toBeNull()
    expect(inv.data.ok).toBe(true)
    const classify = await service().rpc('rpc_admin_classify_regulated_products_from_evidence')
    expect(classify.error).toBeNull()
    expect(classify.data.ok).toBe(true)
    expect(String(classify.data.method)).toContain('nicotine_strength')
  })

  it.skipIf(!configured)('pilot remains unsent', async () => {
    const { data } = await service()
      .from('site_settings')
      .select('key,value')
      .in('key', ['pilot_send_authorized', 'commercial_access_mode', 'trade_required_cutover_approved'])
    const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]))
    expect(map.pilot_send_authorized).toBe('false')
    expect(map.commercial_access_mode).toBe('catalogue_open')
    expect(map.trade_required_cutover_approved).toBe('false')
  })
})
