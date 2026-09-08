/**
 * Phase 5C — native capability programme (locked gates; no customer contact).
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

describe('Phase 5C native capability programme', () => {
  it.skipIf(!configured)('capability selftest PASS + locked gates', async () => {
    const { data, error } = await service().rpc('rpc_phase5c_capability_selftest')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.PHASE4I_PILOT).toBe('NOT_SENT')
    expect(data.cases.A_locked_gates.ok).toBe(true)
    expect(data.cases.B_automation_disabled_seeds.ok).toBe(true)
    expect(data.cases.E_automation_off.ok).toBe(true)
    expect(data.cases.F_price_security.ok).toBe(true)
    expect(data.cases.H_checkout_rules.ok).toBe(true)
    expect(data.cases.K_external_adapters_disabled.ok).toBe(true)
    expect(data.cases.L_worldpay_disabled.ok).toBe(true)
    expect(data.cases.M_dpd_disabled.ok).toBe(true)
    expect(data.cases.G_ownership_untouched.pending).toBe(1353)
  })

  it.skipIf(!configured)('automation engine remains disabled; runs skip', async () => {
    const { data: settings } = await service()
      .from('site_settings')
      .select('key,value')
      .in('key', [
        'automation_engine_enabled',
        'wms_enabled',
        'pilot_send_authorized',
        'commercial_access_mode',
        'compliance_enforcement_mode',
      ])
    const map = Object.fromEntries((settings ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
    expect(map.automation_engine_enabled).toBe('false')
    expect(map.wms_enabled).toBe('false')
    expect(map.pilot_send_authorized).toBe('false')
    expect(map.commercial_access_mode).toBe('catalogue_open')
    expect(map.compliance_enforcement_mode).toBe('observe')

    const { data: run } = await service().rpc('rpc_run_automation_event', {
      p_trigger: 'ORDER_CREATED',
      p_entity_type: 'order',
      p_entity_id: null,
      p_payload: {},
      p_idempotency_key: 'phase5c-test-idem-1',
    })
    expect(run.skipped).toBe(true)
  })

  it.skipIf(!configured)('checkout rules and promotions RPCs respond', async () => {
    const checkout = await service().rpc('rpc_evaluate_checkout_rules', { p_context: {} })
    expect(checkout.error).toBeNull()
    expect(checkout.data.ok).toBe(true)
    expect(Array.isArray(checkout.data.fields)).toBe(true)

    const promo = await service().rpc('rpc_calculate_promotions', {
      p_subtotal: 100,
      p_quantity: 2,
      p_code: null,
      p_line_items: [],
    })
    expect(promo.error).toBeNull()
    expect(promo.data.ok).toBe(true)
    expect(promo.data.discount).toBe(0)
  })

  it.skipIf(!configured)('WMS foundation exists but stays disabled', async () => {
    const { data: wh } = await service().from('warehouses').select('code,name').eq('code', 'UD_WH_1').single()
    expect(wh?.code).toBe('UD_WH_1')

    const { count } = await service()
      .from('automation_rules')
      .select('*', { count: 'exact', head: true })
      .eq('enabled', true)
    expect(count).toBe(0)

    const adj = await service().rpc('rpc_admin_stock_adjustment', {
      p_warehouse_id: '00000000-0000-0000-0000-000000000001',
      p_location_id: null,
      p_product_id: null,
      p_variant_id: null,
      p_sku: 'TEST',
      p_quantity_delta: 1,
      p_reason: 'should_fail_disabled',
    })
    // service role may bypass is_admin depending on policy — expect WMS_DISABLED or Forbidden
    const err = adj.data?.error || adj.error?.message || ''
    expect(String(err)).toMatch(/WMS_DISABLED|Forbidden|permission|admin/i)
  })

  it.skipIf(!configured)('app register: Flow no longer hard blocker; SKULabs/Worldpay/DPD remain', async () => {
    const { data } = await service().rpc('rpc_admin_list_app_dependency_register', {
      p_blocker_only: true,
    })
    expect(data.ok).toBe(true)
    const keys = (data.items as Array<{ app_key: string }>).map((i) => i.app_key)
    expect(keys).toContain('skulabs')
    expect(keys).toContain('dpd_wsa')
    expect(keys).toContain('worldpay_ecommerce')
    expect(keys).not.toContain('shopify_flow')

    const { data: quote } = await service()
      .from('app_dependency_register')
      .select('classification')
      .eq('app_key', 'sa_request_a_quote')
      .single()
    expect(quote?.classification).toBe('REPLACED_BY_UNIQUE')

    const { data: cart } = await service()
      .from('app_dependency_register')
      .select('classification')
      .eq('app_key', 'magefan_persistent_cart')
      .single()
    expect(cart?.classification).toBe('REPLACED_BY_UNIQUE')
  })

  it.skipIf(!configured)('commercial request forms seeded', async () => {
    const { data } = await service()
      .from('commercial_request_forms')
      .select('form_key')
      .in('form_key', ['quote_request', 'special_product_request'])
    expect((data ?? []).length).toBe(2)
  })
})
