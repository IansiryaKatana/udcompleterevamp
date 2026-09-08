/**
 * Phase 5H CRM ownership & sales cutover readiness — SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 5H CRM ownership cutover readiness', () => {
  it.skipIf(!configured)('rpc_phase5h_crm_ownership_selftest passes A–H', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase5h_crm_ownership_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      locks_ok?: boolean
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.locks_ok).toBe(true)
    for (const name of [
      'A_readiness_bulk_locked',
      'B_pending_confidence_preserved',
      'C_cg_historical_only',
      'D_bulk_apply_setting_false',
      'E_cutover_centre',
      'F_locks',
      'G_no_batch_auto_apply',
      'H_enrichment_columns',
    ]) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${JSON.stringify(result.cases[name])}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('bulk apply remains unauthorized; pending stays 1353', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: centre } = await supabase.rpc('rpc_admin_cutover_control_centre')
    const locked = (centre as { locked?: Record<string, string> })?.locked
    expect(locked?.ownership_bulk_apply_authorized).toBe('false')
    expect(locked?.pilot_send_authorized).toBe('false')
    expect(locked?.commercial_access_mode).toBe('catalogue_open')
    expect(locked?.wms_enabled).toBe('false')

    const { count } = await supabase
      .from('ownership_backfill_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PENDING')
    expect(count).toBe(1353)
  }, 60_000)

  it.skipIf(!configured)('lightweight catalogue/finance/WMS regression locks hold', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await supabase.rpc('rpc_admin_cutover_control_centre')
    const centre = data as {
      catalogue_reconciliation?: { catalogue_readiness?: string }
      finance_readiness?: { status?: string }
      wms_readiness?: { status?: string }
      crm_sales_readiness?: { status?: string }
    }
    expect(centre.catalogue_reconciliation?.catalogue_readiness).toBe('READY')
    expect(centre.finance_readiness?.status).toBe('REVIEW_REQUIRED')
    expect(centre.wms_readiness?.status).toBe('SHADOW_RECONCILED')
    expect(centre.crm_sales_readiness?.status).toBe('REVIEW_REQUIRED')
  }, 120_000)
})
