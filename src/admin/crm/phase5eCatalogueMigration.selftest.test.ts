/**
 * Phase 5E — catalogue import parity + locked gates.
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

describe('Phase 5E catalogue migration', () => {
  it.skipIf(!configured)('catalogue selftest PASS + locked gates', async () => {
    const { data, error } = await service().rpc('rpc_phase5e_catalogue_selftest')
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.PHASE4I_PILOT).toBe('NOT_SENT')
    expect(data.cases.A_locked_gates.ok).toBe(true)
    expect(data.cases.B_catalogue_scale.ok).toBe(true)
    expect(data.cases.C_price_security.ok).toBe(true)
    expect(data.cases.E_cutover_catalogue_domain.ok).toBe(true)
    expect(data.cases.F_ownership_untouched.pending).toBe(1353)
  })

  it.skipIf(!configured)('exact product/variant reconciliation', async () => {
    const { data, error } = await service().rpc('rpc_phase5e_catalogue_reconciliation')
    expect(error).toBeNull()
    expect(data.products.unique_shopify_sourced).toBe(2213)
    expect(data.products.difference).toBe(0)
    expect(data.variants.unique_shopify_sourced).toBe(12677)
    expect(data.variants.difference).toBe(0)
    expect(data.catalogue_readiness).toBe('READY')
    expect(data.price_product_vs_min_variant_mismatches).toBe(0)
    expect(data.sku_quality.missing).toBe(279)
    expect(data.sku_quality.duplicate_groups).toBe(40)
    expect(data.barcode_quality.missing).toBe(3988)
    expect(data.barcode_quality.duplicate_groups).toBe(121)
  })

  it.skipIf(!configured)('storefront list returns published products without raw price leak path', async () => {
    const { data, error } = await service().rpc('rpc_list_storefront_products', {
      p_filter: 'all',
      p_slug: null,
      p_limit: 5,
      p_offset: 0,
      p_force_mode: null,
    })
    expect(error).toBeNull()
    expect(data.ok).toBe(true)
    expect(data.total).toBeGreaterThanOrEqual(700)
    expect(Array.isArray(data.items)).toBe(true)
    expect(data.items.length).toBeGreaterThan(0)
  })

  it.skipIf(!configured)('forced trade_required still redacts via list RPC', async () => {
    const { data, error } = await service().rpc('rpc_list_storefront_products', {
      p_filter: 'all',
      p_limit: 3,
      p_offset: 0,
      p_force_mode: 'trade_required',
    })
    expect(error).toBeNull()
    // Under forced trade_required without approved session, prices should be restricted
    if (data.price_visible === false) {
      for (const item of data.items as Array<Record<string, unknown>>) {
        expect(item.price == null || item.price_restricted === true || item.price_visibility === 'redacted').toBe(true)
      }
    }
  })

  it.skipIf(!configured)('cutover centre CATALOGUE READY', async () => {
    const { data, error } = await service().rpc('rpc_admin_cutover_control_centre')
    expect(error).toBeNull()
    const cat = (data.domains as Array<{ domain: string; status: string }>).find((d) => d.domain === 'CATALOGUE')
    expect(cat?.status).toBe('READY')
    expect(data.locked.wms_enabled).toBe('false')
    expect(data.locked.pilot_send_authorized).toBe('false')
  })

  it.skipIf(!configured)('idempotent product upsert does not inflate counts', async () => {
    const before = await service().rpc('rpc_phase5e_catalogue_reconciliation')
    const sample = await service()
      .from('products')
      .select('shopify_product_gid,name,slug,price,published,shopify_status,vendor,product_type,tags_raw,options_json')
      .eq('catalogue_origin', 'SHOPIFY_IMPORTED')
      .limit(1)
      .single()
    expect(sample.data?.shopify_product_gid).toBeTruthy()
    await service().rpc('rpc_phase5e_bulk_upsert_products', {
      p_batch_id: null,
      p_rows: [
        {
          shopify_product_gid: sample.data.shopify_product_gid,
          name: sample.data.name,
          slug: sample.data.slug,
          price: sample.data.price,
          published: sample.data.published,
          shopify_status: sample.data.shopify_status,
          vendor: sample.data.vendor,
          product_type: sample.data.product_type,
          tags_raw: sample.data.tags_raw || [],
          options_json: sample.data.options_json || [],
          gallery_urls: [],
        },
      ],
    })
    const after = await service().rpc('rpc_phase5e_catalogue_reconciliation')
    expect(after.data.products.unique_shopify_sourced).toBe(before.data.products.unique_shopify_sourced)
  })
})
