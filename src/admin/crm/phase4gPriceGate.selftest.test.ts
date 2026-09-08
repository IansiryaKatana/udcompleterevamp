/**
 * Phase 4G — price-gate regression + activation hardening.
 * Loads credentials via vitest.config dotenv (.env) — never commit secrets.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

function client() {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

describe('Phase 4G price-gate & activation (service-role)', () => {
  it.skipIf(!configured)('rpc_phase4g_price_gate_regression_selftest A–I PASS', async () => {
    const { data, error } = await client().rpc('rpc_phase4g_price_gate_regression_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      commercial_access_mode: string
      trade_required_cutover_approved: string
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.commercial_access_mode).toBe('catalogue_open')
    expect(result.trade_required_cutover_approved).toBe('false')
    for (const name of [
      'A_gates_catalogue_open',
      'B_anon_product_price_redacted_tr',
      'C_list_price_redacted_tr',
      'D_catalogue_open_prices_visible',
      'E_pending_policy_tr',
      'F_approved_and_pay_later',
      'G_activation_supersede_hash_only',
      'H_client_crm_spoof_rejected',
      'I_mode_and_ownership_untouched',
    ]) {
      expect(result.cases[name]?.ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('force trade_required redacts product detail prices for anon', async () => {
    const sb = client()
    const { data: products } = await sb.from('products').select('slug').eq('published', true).limit(1)
    const slug = products?.[0]?.slug
    expect(slug).toBeTruthy()
    const { data, error } = await sb.rpc('rpc_get_storefront_product', {
      p_slug: slug,
      p_force_mode: 'trade_required',
    })
    expect(error).toBeNull()
    expect(data.price_visible).toBe(false)
    expect(data.product?.price).toBeNull()
  })

  it.skipIf(!configured)('catalogue_open still exposes prices (no production flip)', async () => {
    const sb = client()
    const { data: mode } = await sb
      .from('site_settings')
      .select('value')
      .eq('key', 'commercial_access_mode')
      .maybeSingle()
    expect(mode?.value).toBe('catalogue_open')
    const { data: products } = await sb.from('products').select('slug').eq('published', true).limit(1)
    const { data } = await sb.rpc('rpc_get_storefront_product', {
      p_slug: products?.[0]?.slug,
      p_force_mode: 'catalogue_open',
    })
    expect(data.price_visible).toBe(true)
    expect(data.product?.price).not.toBeNull()
  })

  it.skipIf(!configured)('INTERNAL_TEST activation fixture creates hashed invites', async () => {
    const { data, error } = await client().rpc('rpc_phase4g_internal_activation_fixture')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.rollout_mode).toBe('INTERNAL_TEST')
    const acts = data.activations as Array<{ token: string; activation_id: string }>
    expect(acts.length).toBeGreaterThan(0)
    // Raw token must not equal stored hash
    const { data: row } = await client()
      .from('customer_auth_activations')
      .select('token_hash, status')
      .eq('id', acts[0].activation_id)
      .maybeSingle()
    expect(row?.status).toBe('pending')
    expect(row?.token_hash).toBeTruthy()
    expect(row?.token_hash).not.toBe(acts[0].token)
  }, 60_000)

  it.skipIf(!configured)('ownership candidates remain pending (untouched)', async () => {
    const { count } = await client()
      .from('ownership_backfill_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING')
    expect(count).toBe(1353)
  })
})
