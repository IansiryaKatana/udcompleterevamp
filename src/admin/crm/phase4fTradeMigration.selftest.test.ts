/**
 * Phase 4F controlled trade migration, activation & shadow cutover — SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 4F trade migration shadow cutover', () => {
  it.skipIf(!configured)('rpc_phase4f_trade_migration_selftest passes A–H', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase4f_trade_migration_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      cleanup?: { ok: boolean }
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.cleanup?.ok).toBe(true)
    for (const name of [
      'A_gates_catalogue_open',
      'B_trade_required_locked_rules',
      'C_precedence_unique_over_surecust',
      'D_unique_native_not_overwritten',
      'E_activation_email_template',
      'F_shadow_no_mode_flip',
      'G_ownership_untouched',
      'H_parked_deps',
    ]) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('commercial_access_mode remains catalogue_open; cutover false', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: mode } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'commercial_access_mode')
      .maybeSingle()
    const { data: flag } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'trade_required_cutover_approved')
      .maybeSingle()
    expect(mode?.value).toBe('catalogue_open')
    expect(flag?.value).toBe('false')
  })

  it.skipIf(!configured)('PAY LATER not bulk-applied from history', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { count: payLater } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('pay_later_eligible', true)
    const { count: tradeApproved } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('trade_access_status', 'approved')
    expect((payLater ?? 0) < (tradeApproved ?? 0)).toBe(true)
    expect(payLater ?? 0).toBeLessThanOrEqual(10)
  })

  it.skipIf(!configured)('trade_required policy denies anon price; allows approved', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: anon } = await supabase.rpc('commercial_policy_evaluate', {
      p_trade_access_status: 'ineligible',
      p_pay_later_eligible: false,
      p_customer_status: 'active',
      p_access_mode: 'trade_required',
      p_has_crm_customer: false,
      p_customer_type: null,
      p_payment_terms: null,
    })
    const { data: approved } = await supabase.rpc('commercial_policy_evaluate', {
      p_trade_access_status: 'approved',
      p_pay_later_eligible: false,
      p_customer_status: 'active',
      p_access_mode: 'trade_required',
      p_has_crm_customer: true,
      p_customer_type: null,
      p_payment_terms: null,
    })
    expect(anon.can_view_catalogue).toBe(true)
    expect(anon.can_view_price).toBe(false)
    expect(anon.can_checkout).toBe(false)
    expect(anon.can_request_quote).toBe(true)
    expect(approved.can_view_price).toBe(true)
    expect(approved.can_purchase).toBe(true)
    expect(approved.can_use_pay_later).toBe(false)
  })

  it.skipIf(!configured)('source precedence unique_manual > shopify_surecust', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: u } = await supabase.rpc('commercial_source_rank', { p_source: 'unique_manual' })
    const { data: s } = await supabase.rpc('commercial_source_rank', { p_source: 'shopify_surecust' })
    expect(Number(u)).toBeGreaterThan(Number(s))
  })

  it.skipIf(!configured)('SureCust apply batch exists with provenance', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase
      .from('trade_eligibility_apply_batches')
      .select('id, batch_key, applied_count, source')
      .eq('source', 'shopify_surecust')
      .not('applied_at', 'is', null)
      .order('applied_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.applied_count).toBeGreaterThan(0)
    expect(String(data?.batch_key || '')).toMatch(/^p4f-surecust-/)
  })
})
