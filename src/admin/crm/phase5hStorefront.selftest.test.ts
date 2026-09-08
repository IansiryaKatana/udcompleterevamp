/**
 * Phase 5H — storefront UX, navigation and content alignment.
 * Does not flip commercial / compliance / gateway / WMS / pilot locks.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { canUsePayLater, commercialPriceLabel, commercialUxMessage } from '@/lib/storefront/commercialSession'
import { wholesaleCollectionIntro } from '@/lib/storefront/wholesaleCopy'

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

describe('Phase 5H storefront UX helpers', () => {
  it('does not invent PAY LATER from historical-looking sessions', () => {
    expect(
      canUsePayLater({
        ok: true,
        pay_later_eligible: false,
        policy: { can_use_pay_later: true },
      }),
    ).toBe(false)
    expect(
      canUsePayLater({
        ok: true,
        pay_later_eligible: true,
        policy: { can_use_pay_later: true },
      }),
    ).toBe(true)
  })

  it('keeps restricted price copy customer-safe', () => {
    expect(commercialPriceLabel({ ok: true, ux_state: 'APPLICATION_PENDING' }, true)).toMatch(/reviewed/i)
    expect(commercialUxMessage('ACCESS_SUSPENDED')).toMatch(/suspended/i)
  })

  it('rewrites consumer collection intros to wholesale', () => {
    const { intro } = wholesaleCollectionIntro('Disposable Vapes', 'Find your next favourite vape.')
    expect(intro.toLowerCase()).toContain('wholesale')
    expect(intro.toLowerCase()).not.toContain('favourite')
  })
})

describe('Phase 5H storefront selftest', () => {
  it.skipIf(!configured)('rpc_phase5h_storefront_selftest keeps locks and catalogue counts', async () => {
    const { data, error } = await service().rpc('rpc_phase5h_storefront_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      PHASE4I_PILOT: string
      pilot_send_authorized: string
      commercial_access_mode: string
      trade_required_cutover_approved: string
      payment_gateway_mode: string
      locks_ok: boolean
      catalogue: { shopify_products: number; shopify_variants: number; shopify_collections: number }
    }
    expect(result.ok).toBe(true)
    expect(result.locks_ok).toBe(true)
    expect(result.PHASE4I_PILOT).toBe('NOT_SENT')
    expect(result.pilot_send_authorized).toMatch(/false|0|^$/i)
    expect(result.commercial_access_mode).toBe('catalogue_open')
    expect(result.trade_required_cutover_approved).toMatch(/false|0|^$/i)
    expect(result.payment_gateway_mode).toBe('disabled')
    expect(result.catalogue.shopify_products).toBe(2213)
    expect(result.catalogue.shopify_variants).toBe(12677)
    expect(result.catalogue.shopify_collections).toBe(368)
  }, 120_000)

  it.skipIf(!configured)('personas A–G: commercial policy is server-owned', async () => {
    const sb = service()
    const personas = [
      { name: 'A_anonymous', trade: 'ineligible', payLater: false, hasCrm: false, expectedPayLater: false },
      { name: 'B_unlinked', trade: 'ineligible', payLater: false, hasCrm: false, expectedPayLater: false },
      { name: 'C_pending', trade: 'pending', payLater: false, hasCrm: true, expectedPayLater: false },
      { name: 'D_approved', trade: 'approved', payLater: false, hasCrm: true, expectedPayLater: false },
      { name: 'E_suspended', trade: 'suspended', payLater: false, hasCrm: true, expectedPayLater: false },
      { name: 'F_pay_later_yes', trade: 'approved', payLater: true, hasCrm: true, expectedPayLater: true },
      { name: 'G_pay_later_no', trade: 'approved', payLater: false, hasCrm: true, expectedPayLater: false },
    ] as const

    for (const persona of personas) {
      const { data, error } = await sb.rpc('commercial_policy_evaluate', {
        p_trade_access_status: persona.trade,
        p_pay_later_eligible: persona.payLater,
        p_customer_status: persona.trade === 'suspended' ? 'suspended' : 'active',
        p_access_mode: 'catalogue_open',
        p_has_crm_customer: persona.hasCrm,
        p_customer_type: null,
        p_payment_terms: null,
      })
      expect(error, persona.name).toBeNull()
      expect(Boolean(data?.can_use_pay_later), persona.name).toBe(persona.expectedPayLater)
      if (persona.trade === 'approved' && persona.hasCrm) {
        expect(data?.can_view_price, persona.name).toBe(true)
      }
    }
  }, 60_000)

  it.skipIf(!configured || !anonKey)('anon catalogue RPC still paginates and does not dump the catalogue', async () => {
    const { data, error } = await anon().rpc('rpc_list_storefront_products', {
      p_filter: 'all',
      p_slug: null,
      p_limit: 12,
      p_offset: 0,
      p_min_price: null,
      p_max_price: null,
      p_in_stock_only: false,
      p_sort: 'default',
      p_vendor: null,
      p_product_type: null,
      p_strength: null,
    } as never)
    expect(error).toBeNull()
    expect(data?.ok).toBe(true)
    expect((data?.items ?? []).length).toBeLessThanOrEqual(12)
    expect(Number(data?.total ?? 0)).toBeGreaterThan(12)
  })

  it.skipIf(!configured)('publishes migrated Unique legal pages in CMS and footer', async () => {
    const sb = service()
    const slugs = ['tpd-compliance', 'modern-slavery-statement', 'medical-info-disclaimer']
    const { data: pages, error: pageError } = await sb
      .from('marketing_pages')
      .select('slug, published')
      .in('slug', slugs)
    expect(pageError).toBeNull()
    expect((pages ?? []).filter((p) => p.published).map((p) => p.slug).sort()).toEqual([...slugs].sort())

    const { data: links, error: linkError } = await sb
      .from('nav_links')
      .select('href, is_active')
      .eq('location', 'footer_legal')
      .in('href', slugs.map((slug) => `/pages/${slug}`))
    expect(linkError).toBeNull()
    expect((links ?? []).filter((l) => l.is_active).length).toBe(3)
  })

  it.skipIf(!configured)('footer columns use Unique live IA on Unique OS chrome', async () => {
    const sb = service()
    const { data: shop, error: shopError } = await sb
      .from('nav_links')
      .select('label')
      .eq('location', 'footer_shop')
      .eq('is_active', true)
      .order('sort_order')
    expect(shopError).toBeNull()
    expect((shop ?? []).map((row) => row.label)).toEqual([
      'Shop by Brand',
      'Shop by Category',
      'Confectionery',
      'Essentials',
      'Drinks',
      'New Arrivals',
      'Best Sellers',
    ])

    const { data: news, error: newsError } = await sb
      .from('nav_links')
      .select('label')
      .eq('location', 'footer_help')
      .eq('is_active', true)
      .order('sort_order')
    expect(newsError).toBeNull()
    expect((news ?? []).map((row) => row.label)).toContain('Vaping vs Smoking')
    expect((news ?? []).map((row) => row.label)).toContain('Blogs')
  })

  it.skipIf(!configured)('shop nav uses Unique collection handles, not electronics leftovers', async () => {
    const { data, error } = await service().rpc('rpc_storefront_shop_nav')
    expect(error).toBeNull()
    const labels = ((data?.header ?? []) as Array<{ label: string; href: string }>).map((item) => item.label)
    expect(labels).toEqual([
      'Vapes',
      'Nic Salts',
      'Nic Pouches',
      'Confectionery',
      'Drinks',
      'Smoking Accessories',
      'Essentials',
      'Offers',
      'CBD',
    ])
    const hrefs = JSON.stringify(data)
    expect(hrefs).not.toContain('/collection/electronics')
    expect(hrefs).not.toContain('buy-vapes-in-bulk')
    expect(hrefs).not.toContain('nicotine-pouches-copy')
    expect((data?.shop_by_category ?? []).length).toBeGreaterThanOrEqual(8)
  })

  it.skipIf(!configured || !anonKey)('Phase 4H: anon PostgREST cannot select products.price', async () => {
    const { data, error } = await anon().from('products').select('id,price').eq('published', true).limit(3)
    const rows = data ?? []
    expect(error || rows.length === 0).toBeTruthy()
  })

  it.skipIf(!configured)('trade_required eval still redacts prices without flipping production mode', async () => {
    const { data, error } = await service().rpc('rpc_list_storefront_products', {
      p_filter: 'all',
      p_slug: null,
      p_limit: 1,
      p_offset: 0,
      p_min_price: null,
      p_max_price: null,
      p_in_stock_only: false,
      p_sort: 'default',
      p_vendor: null,
      p_product_type: null,
      p_strength: null,
      p_force_mode: 'trade_required',
    } as never)
    expect(error).toBeNull()
    const item = data?.items?.[0]
    if (item && data?.ok) {
      expect(item.price_restricted === true || item.price == null || Number(item.price) === 0).toBe(true)
    }
  })
})
