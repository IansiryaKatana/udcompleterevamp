/**
 * Phase 5D — cutover simulation selftest (locked gates; no cutover).
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

describe('Phase 5D cutover simulation', () => {
  it.skipIf(!configured)('master selftest PASS + locked gates', async () => {
    const { data, error } = await service().rpc('rpc_phase5d_cutover_simulation_selftest')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.PHASE4I_PILOT).toBe('NOT_SENT')
    expect(data.cutover_executed).toBe(false)
    expect(data.cases.A_locked_gates.ok).toBe(true)
    expect(data.cases.B_control_centre.ok).toBe(true)
    expect(data.cases.F_wms_shadow.ok).toBe(true)
    expect(data.cases.L_security_regression.ok).toBe(true)
    expect(data.cases.M_ownership_untouched.pending).toBe(1353)
  })

  it.skipIf(!configured)('control centre returns real domain statuses', async () => {
    const { data, error } = await service().rpc('rpc_admin_cutover_control_centre')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.locked.pilot_send_authorized).toBe('false')
    expect(data.locked.commercial_access_mode).toBe('catalogue_open')
    expect(data.locked.wms_enabled).toBe('false')
    expect(data.locked.gateway_mode).toBe('disabled')
    expect(data.locked.carrier_mode).toBe('disabled')
    const domains = data.domains as Array<{ domain: string; status: string }>
    expect(domains.length).toBeGreaterThanOrEqual(15)
    expect(domains.find((d) => d.domain === 'PAYMENTS')?.status).toBe('BLOCKED')
    expect(domains.find((d) => d.domain === 'CARRIER')?.status).toBe('BLOCKED')
    expect(domains.find((d) => d.domain === 'INVENTORY/WMS')?.status).toBe('DISABLED')
  })

  it.skipIf(!configured)('data reconciliation flags catalogue DATA_GAP', async () => {
    const { data, error } = await service().rpc('rpc_phase5d_data_reconciliation')
    expect(error).toBeNull()
    const products = (data.rows as Array<{ entity: string; status: string }>).find((r) => r.entity === 'products')
    expect(products?.status).toBe('DATA_GAP')
    expect(data.full_parity_ok ?? data.ok).toBe(false)
  })

  it.skipIf(!configured)('WMS shadow reconciles ledger; wms stays disabled', async () => {
    const { data, error } = await service().rpc('rpc_phase5d_wms_shadow_validate')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.cases.on_hand_expected_97.ok).toBe(true)
    expect(data.cases.ledger_matches_balance.ok).toBe(true)
    const { data: settings } = await service()
      .from('site_settings')
      .select('value')
      .eq('key', 'wms_enabled')
      .single()
    expect(settings?.value).toBe('false')
  })

  it.skipIf(!configured)('opening stock preview does not write balances', async () => {
    const { data, error } = await service().rpc('rpc_phase5d_opening_stock_preview', { p_limit: 5 })
    expect(error).toBeNull()
    expect(data.wrote_opening_balances).toBe(false)
  })

  it.skipIf(!configured)('automation dry-run executes no actions', async () => {
    const { data, error } = await service().rpc('rpc_phase5d_automation_dry_run')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    for (const row of data.dry_run as Array<{ actions_executed: boolean; enabled: boolean }>) {
      expect(row.actions_executed).toBe(false)
      expect(row.enabled).toBe(false)
    }
  })
})
