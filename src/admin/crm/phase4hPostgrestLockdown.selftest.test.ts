/**
 * Phase 4H — PostgREST lockdown & commerce parity.
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

describe('Phase 4H PostgREST lockdown', () => {
  it.skipIf(!configured)('rpc_phase4h_postgrest_attack_selftest A–I PASS', async () => {
    const { data, error } = await service().rpc('rpc_phase4h_postgrest_attack_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      commercial_access_mode: string
      trade_required_cutover_approved: string
      pilot_send_status: string
      cases: Record<string, { ok: boolean }>
    }
    expect(result.ok).toBe(true)
    expect(result.commercial_access_mode).toBe('catalogue_open')
    expect(result.trade_required_cutover_approved).toBe('false')
    expect(result.pilot_send_status).toContain('OWNER APPROVAL REQUIRED')
    for (const name of [
      'A_gates',
      'B_public_read_dropped',
      'C_admin_policy_intact',
      'D_catalogue_open_rpc_prices',
      'E_trade_required_variant_redacted',
      'F_bundle_redacted',
      'G_wishlist_rpc_exists',
      'H_ownership_untouched',
      'I_pilot_not_auto_authorized',
    ]) {
      expect(result.cases[name]?.ok, name).toBe(true)
    }
  }, 120_000)

  it.skipIf(!configured || !anonKey)('anon PostgREST cannot select products.price', async () => {
    const { data, error } = await anon().from('products').select('id,price').eq('published', true).limit(3)
    // RLS: no public_read → empty or error; never return priced rows to anon
    const rows = data ?? []
    expect(error || rows.length === 0).toBeTruthy()
    if (rows.length > 0) {
      // If somehow rows return, price column must be inaccessible (should not happen)
      expect(rows.every((r) => r.price === undefined || r.price === null)).toBe(true)
    }
  })

  it.skipIf(!configured || !anonKey)('anon PostgREST cannot select variant prices', async () => {
    const { data, error } = await anon()
      .from('product_variants')
      .select('id,price,compare_at_price')
      .eq('is_active', true)
      .limit(3)
    const rows = data ?? []
    expect(error || rows.length === 0).toBeTruthy()
  })

  it.skipIf(!configured || !anonKey)('anon still gets catalogue prices via gated RPC', async () => {
    const { data, error } = await anon().rpc('rpc_list_storefront_products', {
      p_filter: 'all',
      p_slug: null,
      p_limit: 2,
      p_offset: 0,
      p_min_price: null,
      p_max_price: null,
      p_in_stock_only: false,
      p_sort: 'default',
      p_force_mode: null,
    })
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.price_visible).toBe(true)
    if ((data.items?.length ?? 0) > 0) {
      expect(data.items[0].price).not.toBeNull()
    }
  })

  it.skipIf(!configured)('pilot_send_authorized remains false', async () => {
    const { data } = await service()
      .from('site_settings')
      .select('value')
      .eq('key', 'pilot_send_authorized')
      .maybeSingle()
    expect(data?.value).toBe('false')
  })
})
