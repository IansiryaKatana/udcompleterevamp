import { describe, expect, it } from 'vitest'
import { resolveProductImageUrl } from '@/lib/cms/mapProduct'
import { staticCmsSnapshot } from '@/data/static-cms'
import { LEGAL_PAGES } from '@/lib/legal/marketingPageCopy'
import { canUsePayLater, commercialPriceLabel } from '@/lib/storefront/commercialSession'
import { UNIQUE_HEADER_CATEGORIES, UNIQUE_SHOP_BY_CATEGORY } from '@/lib/storefront/uniqueCatalogueNav'
import { stripStorefrontMigrationNote, UNIQUE_FOOTER_PAGES, UNIQUE_PUBLISHED_DELIVERY } from '@/lib/storefront/uniquePublishedCopy'
import { productMetaChips, wholesaleCollectionIntro } from '@/lib/storefront/wholesaleCopy'

describe('Phase 5H wholesale copy', () => {
  it('hides empty product chips', () => {
    expect(productMetaChips({})).toEqual([])
    expect(productMetaChips({ vendor: 'Elf Bar', packQuantity: '10' })).toEqual([
      { label: 'Brand', value: 'Elf Bar' },
      { label: 'Pack', value: '10' },
    ])
  })

  it('does not invent bestseller language', () => {
    const { intro } = wholesaleCollectionIntro('New arrivals')
    expect(intro.toLowerCase()).not.toContain('best seller')
  })

  it('restricted price label never implies a zero price', () => {
    expect(commercialPriceLabel({ ok: true, ux_state: 'SIGN_IN' }, true).toLowerCase()).not.toContain('£0')
    expect(canUsePayLater(null)).toBe(false)
  })

  it('rewrites leftover electronics collection intros to wholesale', () => {
    const { intro } = wholesaleCollectionIntro('New Arrivals', 'Latest tech releases')
    expect(intro.toLowerCase()).toContain('wholesale')
    expect(intro.toLowerCase()).not.toContain('tech releases')
  })

  it('rewrites consumer vape phrasing anywhere in a collection description', () => {
    const { intro } = wholesaleCollectionIntro(
      'New Shopify',
      '<p>Browse the range.</p><p>Discover your next favorite vape today.</p>',
    )
    expect(intro.toLowerCase()).toContain('wholesale')
    expect(intro.toLowerCase()).not.toContain('favorite vape')
  })

  it('exposes migrated Unique legal pages without inventing extra duties', () => {
    expect(LEGAL_PAGES.tpd.slug).toBe('tpd-compliance')
    expect(LEGAL_PAGES.modernSlavery.slug).toBe('modern-slavery-statement')
    expect(LEGAL_PAGES.medicalDisclaimer.slug).toBe('medical-info-disclaimer')
    expect(LEGAL_PAGES.tpd.bodyHtml).toContain('Migrated from Unique Distribution')
    expect(LEGAL_PAGES.help.bodyHtml).toContain('/pages/tpd-compliance')
  })

  it('falls back to gallery then variant image when the primary URL is empty', () => {
    expect(resolveProductImageUrl({ imageUrl: '', galleryUrls: [' https://cdn.example/a.jpg '] })).toBe(
      'https://cdn.example/a.jpg',
    )
    expect(
      resolveProductImageUrl({
        imageUrl: null,
        galleryUrls: [],
        variants: [{ imageUrl: 'https://cdn.example/v.jpg' }],
      }),
    ).toBe('https://cdn.example/v.jpg')
  })

  it('does not ship electronics demo products in the static CMS fallback', () => {
    expect(staticCmsSnapshot.products).toEqual([])
    expect(staticCmsSnapshot.bundles).toEqual([])
    expect(staticCmsSnapshot.categories).toEqual([])
  })

  it('pins Unique live category routes onto Unique OS collection handles', () => {
    expect(UNIQUE_HEADER_CATEGORIES.map((item) => item.label)).toEqual([
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
    expect(UNIQUE_SHOP_BY_CATEGORY).toHaveLength(12)
    expect(UNIQUE_HEADER_CATEGORIES.find((item) => item.highlight)?.slug).toBe('deals')
  })

  it('pins Unique published delivery facts for the homepage overlay', () => {
    expect(UNIQUE_PUBLISHED_DELIVERY.map((item) => item.title)).toEqual([
      'Swift Delivery',
      'Same Day Dispatch',
      'Saturday Delivery',
    ])
    expect(UNIQUE_PUBLISHED_DELIVERY[1]?.detail).toBe('Weekdays by 4:00PM')
  })

  it('maps Unique footer news and careers onto Unique OS pages', () => {
    expect(UNIQUE_FOOTER_PAGES.careers.slug).toBe('careers')
    expect(UNIQUE_FOOTER_PAGES.vapingVsSmoking.bodyHtml).toContain('Migrated from Unique Distribution')
    expect(stripStorefrontMigrationNote(UNIQUE_FOOTER_PAGES.vapingVsSmoking.bodyHtml)).not.toContain('Migrated from Unique Distribution')
    expect(stripStorefrontMigrationNote(UNIQUE_FOOTER_PAGES.vapingVsSmoking.bodyHtml)).toContain('The Costly Truth')
    expect(staticCmsSnapshot.navLinks.filter((link) => link.location === 'footer_shop').map((link) => link.label)).toEqual([
      'Shop by Brand',
      'Shop by Category',
      'Confectionery',
      'Essentials',
      'Drinks',
      'New Arrivals',
      'Best Sellers',
    ])
    expect(staticCmsSnapshot.navLinks.filter((link) => link.location === 'footer_legal').map((link) => link.label)).toEqual([
      'TPD Compliance',
      'Terms & Conditions',
      'Modern Slavery Statement',
      'Medical Info Disclaimer',
    ])
  })
})
