import { LEGAL_PAGES } from '@/lib/legal/marketingPageCopy'
import { DEFAULT_BRAND_PALETTE, DEFAULT_HERO_BACKGROUND } from '@/lib/brandPalette'
import { UNIQUE_FOOTER_PAGES } from '@/lib/storefront/uniquePublishedCopy'

export type ProductSpec = {
  key: string
  value: string
}

export type ProductVariant = {
  id: string
  productId: string
  name: string
  sku: string | null
  price: number | null
  compareAtPrice: number | null
  inventoryCount: number
  optionValues: Record<string, string>
  imageUrl: string | null
  sortOrder: number
}

export type ProductReviewItem = {
  id: string
  rating: number
  title: string | null
  body: string
  authorLabel: string
  createdAt: string
}

export type ProductReviewSummary = {
  averageRating: number
  count: number
  items: ProductReviewItem[]
}

export type Product = {
  id: string
  name: string
  slug: string
  description: string
  overview?: string
  deliveryText?: string | null
  price: number
  compareAtPrice?: number | null
  /** True when server redacted protected trade prices for this viewer. */
  priceRestricted?: boolean
  sku?: string | null
  weightKg?: number | null
  specs?: ProductSpec[]
  imageUrl: string
  galleryUrls?: string[]
  categoryId: string | null
  collectionId: string | null
  badge: string | null
  isFeatured: boolean
  isNew: boolean
  isSummer: boolean
  inventoryCount: number
  published: boolean
  sortOrder: number
  vendor?: string | null
  productType?: string | null
  nicotineStrength?: string | null
  packQuantity?: string | null
  variants?: ProductVariant[]
  reviews?: ProductReviewSummary
}

export type ProductBundleItem = {
  id: string
  bundleId: string
  productId: string
  variantId: string | null
  quantity: number
  sortOrder: number
  label: string | null
  product: Pick<
    Product,
    'id' | 'name' | 'slug' | 'imageUrl' | 'price' | 'priceRestricted' | 'inventoryCount' | 'variants'
  >
}

export type ProductBundle = {
  id: string
  name: string
  slug: string
  overview: string | null
  description: string | null
  price: number
  compareAtPrice: number | null
  /** True when server redacted protected trade prices for this viewer. */
  priceRestricted?: boolean
  sku: string | null
  imageUrl: string
  galleryUrls: string[]
  badge: string | null
  published: boolean
  sortOrder: number
  items: ProductBundleItem[]
  availableQuantity: number
}

export type Collection = {
  id: string
  title: string
  slug: string
  description: string
  coverImageUrl: string
  type: string
  sortOrder: number
  isActive: boolean
}

export type Category = {
  id: string
  name: string
  slug: string
  parentId: string | null
  sortOrder: number
  isActive: boolean
}

export type HeroSlide = {
  id: string
  headlineLines: string[]
  ctaLabel: string
  ctaUrl: string
  imageUrl: string
  imageUrlTablet: string
  imageUrlMobile: string
  backgroundColor: string
  sortOrder: number
  isActive: boolean
}

export type FeatureCard = {
  id: string
  title: string
  ctaLabel: string
  ctaUrl: string
  imageUrl: string
  sortOrder: number
  isActive: boolean
}

export type LifestyleCard = {
  id: string
  title: string
  ctaLabel: string
  ctaUrl: string
  imageUrl: string
  layout: 'large' | 'small' | 'wide'
  sortOrder: number
  isActive: boolean
}

export type HomepageSection = {
  id: string
  sectionKey: string
  title: string
  subtitle: string
  imageUrl: string
  ctaLabel: string
  ctaUrl: string
  sortOrder: number
  isActive: boolean
}

export type NavLink = {
  id: string
  label: string
  href: string
  location:
    | 'header'
    | 'footer_categories'
    | 'footer_legal'
    | 'footer_help'
    | 'footer_shop'
    | 'footer_trade'
    | 'footer_company'
    | 'footer_support'
  sortOrder: number
  isActive: boolean
}

export type SocialLink = {
  id: string
  label: string
  href: string
  icon: string
  sortOrder: number
  isActive: boolean
}

export type MarketingPage = {
  id: string
  title: string
  slug: string
  bodyHtml: string
  metaDescription: string
  published: boolean
  sortOrder: number
}

export type SiteSettings = Record<string, string>

export type CmsSnapshot = {
  siteName: string
  logoText: string
  products: Product[]
  collections: Collection[]
  categories: Category[]
  heroSlides: HeroSlide[]
  featureCards: FeatureCard[]
  lifestyleCards: LifestyleCard[]
  homepageSections: HomepageSection[]
  navLinks: NavLink[]
  socialLinks: SocialLink[]
  bundles: ProductBundle[]
  marketingPages: MarketingPage[]
  siteSettings: SiteSettings
}

const IMG = {
  hero: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=1200&q=80',
  feature1: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=800&q=80',
  feature2: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=80',
  feature3: 'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&q=80',
  lifestyle1: 'https://images.unsplash.com/photo-1587202372775-e229f172b9b7?w=900&q=80',
  lifestyle2: 'https://images.pexels.com/photos/1029757/pexels-photo-1029757.jpeg?auto=compress&cs=tinysrgb&w=800',
  lifestyle3: 'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=800&q=80',
  lifestyleWide: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&q=80',
  finalCta: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&q=80',
  p1: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&q=80',
  p2: 'https://images.pexels.com/photos/1029757/pexels-photo-1029757.jpeg?auto=compress&cs=tinysrgb&w=600',
  p3: 'https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=600',
  p4: 'https://images.unsplash.com/photo-1555618256-3c9d3e08750f?w=600&q=80',
  p5: 'https://images.unsplash.com/photo-1587202372775-e229f172b9b7?w=600&q=80',
  p6: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=600&q=80',
  p7: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&q=80',
  p8: 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600&q=80',
  p9: 'https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?w=600&q=80',
  p10: 'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600&q=80',
  p11: 'https://images.unsplash.com/photo-1621259182978-fbf93132d53d?w=600&q=80',
}

const COL = {
  new: '22222222-2222-2222-2222-222222222201',
  deals: '22222222-2222-2222-2222-222222222202',
}

export const staticCmsSnapshot: CmsSnapshot = {
  siteName: 'Unique',
  logoText: 'UNIQUE',
  siteSettings: {
    brand_primary: DEFAULT_BRAND_PALETTE.primary,
    brand_primary_hover: DEFAULT_BRAND_PALETTE.primaryHover,
    brand_primary_dark: DEFAULT_BRAND_PALETTE.primaryDark,
    brand_primary_muted: DEFAULT_BRAND_PALETTE.primaryMuted,
    brand_page_bg: DEFAULT_BRAND_PALETTE.pageBg,
    brand_content_bg: DEFAULT_BRAND_PALETTE.contentBg,
    brand_text: DEFAULT_BRAND_PALETTE.text,
    brand_muted: DEFAULT_BRAND_PALETTE.muted,
    brand_soft: DEFAULT_BRAND_PALETTE.soft,
    brand_footer: DEFAULT_BRAND_PALETTE.footer,
    brand_on_dark: DEFAULT_BRAND_PALETTE.onDark,
    brand_hero: DEFAULT_BRAND_PALETTE.hero,
    brand_border: DEFAULT_BRAND_PALETTE.border,
    brand_surface: DEFAULT_BRAND_PALETTE.contentBg,
    newsletter_heading: 'Trade updates from Unique Distribution',
    footer_tagline: 'UK wholesale distributor supplying retailers from one trade catalogue.',
    hero_supporting_copy:
      'Vapes, nicotine products, confectionery, drinks, accessories and retail essentials supplied to UK businesses through one trade platform.',
    hero_secondary_cta_label: 'Open a trade account',
    hero_secondary_cta_url: '/trade',
    lifestyle_heading: 'Shop the trade catalogue',
    lifestyle_subtitle: 'Browse wholesale ranges used by UK retailers.',
    contact_company_legal_name: 'UNIQUE WHOLESALE & DISTRIBUTION LIMITED',
    contact_company_number: '15678913',
    contact_address: '124 City Road, London, United Kingdom, EC1V 2NX',
    contact_hours: 'Monday – Friday: 9:00–20:00. Saturday: 11:00–15:00.',
    currency_code: 'GBP',
    currency_locale: 'en-GB',
    contact_phone: '+44 7340 676909',
    contact_whatsapp: '',
    contact_whatsapp_message: 'Hello! I have a question about Unique Distribution.',
    floating_whatsapp_enabled: 'true',
    stripe_enabled: 'false',
    stripe_publishable_key: '',
    stripe_mode: 'test',
    checkout_mode: 'quote',
    quote_notification_email: 'quotes@uniquedistribution.com',
    contact_notification_email: 'info@uniquedistribution.com',
    favicon_url: '/images/favicon%20astor.png',
    logo_dark_url: '/images/ASTOR%20logo.png',
    logo_light_url: '',
    hero_bg_desktop: '',
    hero_bg_tablet: '',
    hero_bg_mobile: '',
    email_brand_color: DEFAULT_BRAND_PALETTE.primary,
    email_footer_text: 'Thank you for shopping with us.',
    email_from_name: 'Unique Distribution',
    store_url: '',
    default_delivery_info: LEGAL_PAGES.shipping.bodyHtml,
  },
  navLinks: [
    { id: '14', label: 'Vapes', href: '/collection/vapes', location: 'header', sortOrder: 10, isActive: true },
    { id: '15', label: 'Nic Salts', href: '/collection/10ml-nic-salt', location: 'header', sortOrder: 20, isActive: true },
    { id: '30', label: 'Nic Pouches', href: '/collection/nicotine-pouches', location: 'header', sortOrder: 30, isActive: true },
    { id: '31', label: 'Confectionery', href: '/collection/confectionery', location: 'header', sortOrder: 40, isActive: true },
    { id: '32', label: 'Drinks', href: '/collection/drinks', location: 'header', sortOrder: 50, isActive: true },
    { id: '33', label: 'Smoking Accessories', href: '/collection/smoking-accessories', location: 'header', sortOrder: 60, isActive: true },
    { id: '34', label: 'Essentials', href: '/collection/essentials', location: 'header', sortOrder: 70, isActive: true },
    { id: '16', label: 'Offers', href: '/collection/deals', location: 'header', sortOrder: 80, isActive: true },
    { id: '35', label: 'CBD', href: '/collection/haze-cbd', location: 'header', sortOrder: 90, isActive: true },
    { id: '6', label: 'Shop by Brand', href: '/brands', location: 'footer_shop', sortOrder: 0, isActive: true },
    { id: '7', label: 'Shop by Category', href: '/#shop-by-category', location: 'footer_shop', sortOrder: 1, isActive: true },
    { id: '31f', label: 'Confectionery', href: '/collection/confectionery', location: 'footer_shop', sortOrder: 2, isActive: true },
    { id: '32f', label: 'Essentials', href: '/collection/essentials', location: 'footer_shop', sortOrder: 3, isActive: true },
    { id: '33f', label: 'Drinks', href: '/collection/drinks', location: 'footer_shop', sortOrder: 4, isActive: true },
    { id: '12', label: 'New Arrivals', href: '/collection/new', location: 'footer_shop', sortOrder: 5, isActive: true },
    { id: '20', label: 'Best Sellers', href: '/collection/best', location: 'footer_shop', sortOrder: 6, isActive: true },
    { id: '24', label: 'About Us', href: '/pages/about', location: 'footer_company', sortOrder: 0, isActive: true },
    { id: '10', label: 'Contact Us', href: '/pages/contact', location: 'footer_company', sortOrder: 1, isActive: true },
    { id: '11', label: 'Shipping & Returns', href: '/pages/shipping', location: 'footer_company', sortOrder: 2, isActive: true },
    { id: '21', label: 'Delivery Information', href: '/pages/shipping', location: 'footer_company', sortOrder: 3, isActive: true },
    { id: '8', label: 'Privacy Policy', href: '/pages/privacy', location: 'footer_company', sortOrder: 4, isActive: true },
    { id: '36', label: 'Careers', href: '/pages/careers', location: 'footer_company', sortOrder: 5, isActive: true },
    { id: '27', label: 'TPD Compliance', href: '/pages/tpd-compliance', location: 'footer_legal', sortOrder: 0, isActive: true },
    { id: '9', label: 'Terms & Conditions', href: '/pages/terms', location: 'footer_legal', sortOrder: 1, isActive: true },
    { id: '28', label: 'Modern Slavery Statement', href: '/pages/modern-slavery-statement', location: 'footer_legal', sortOrder: 2, isActive: true },
    { id: '29', label: 'Medical Info Disclaimer', href: '/pages/medical-info-disclaimer', location: 'footer_legal', sortOrder: 3, isActive: true },
    { id: '37', label: 'Vaping vs Smoking', href: '/pages/vaping-vs-smoking', location: 'footer_help', sortOrder: 0, isActive: true },
    { id: '38', label: 'Nic Pouches in the UK', href: '/pages/nic-pouches-in-the-uk', location: 'footer_help', sortOrder: 1, isActive: true },
    { id: '39', label: "Legal Big Puff 'Devices", href: '/pages/legal-big-puff-devices', location: 'footer_help', sortOrder: 2, isActive: true },
    { id: '40', label: 'Disposable Ban 2025', href: '/pages/disposable-ban-2025', location: 'footer_help', sortOrder: 3, isActive: true },
    { id: '41', label: 'Blogs', href: '/pages/blogs', location: 'footer_help', sortOrder: 4, isActive: true },
  ],
  socialLinks: [],
  categories: [],
  collections: [
    { id: COL.new, title: 'New Arrivals', slug: 'new', description: 'Latest additions to the Unique wholesale catalogue.', coverImageUrl: '', type: 'seasonal', sortOrder: 0, isActive: true },
    { id: COL.deals, title: 'Offers', slug: 'deals', description: 'Featured wholesale offers currently merchandised in the catalogue.', coverImageUrl: '', type: 'seasonal', sortOrder: 1, isActive: true },
  ],
  heroSlides: [
    {
      id: 'h1',
      headlineLines: ['Wholesale products', 'built for retail.'],
      ctaLabel: 'Shop wholesale',
      ctaUrl: '/collection/all',
      imageUrl: IMG.hero,
      imageUrlTablet: '',
      imageUrlMobile: '',
      backgroundColor: DEFAULT_HERO_BACKGROUND,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 'h2',
      headlineLines: ['Open a Unique', 'trade account.'],
      ctaLabel: 'Apply for trade',
      ctaUrl: '/trade',
      imageUrl: IMG.lifestyle1,
      imageUrlTablet: '',
      imageUrlMobile: '',
      backgroundColor: DEFAULT_BRAND_PALETTE.primaryDark,
      sortOrder: 1,
      isActive: true,
    },
  ],
  featureCards: [
    {
      id: 'f1',
      title: 'Vapes & nicotine products for retail shelves.',
      ctaLabel: 'Shop vapes',
      ctaUrl: '/collection/all',
      imageUrl: IMG.feature1,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 'f2',
      title: 'Confectionery, drinks and everyday retail essentials.',
      ctaLabel: 'Browse catalogue',
      ctaUrl: '/collection/all',
      imageUrl: IMG.feature2,
      sortOrder: 1,
      isActive: true,
    },
    {
      id: 'f3',
      title: 'Trade pricing, quotes and repeat wholesale ordering.',
      ctaLabel: 'Open trade account',
      ctaUrl: '/trade',
      imageUrl: IMG.feature3,
      sortOrder: 2,
      isActive: true,
    },
  ],
  lifestyleCards: [
    { id: 'l1', title: 'New wholesale arrivals', ctaLabel: 'Shop new', ctaUrl: '/collection/new', imageUrl: IMG.lifestyle1, layout: 'large', sortOrder: 0, isActive: true },
    { id: 'l2', title: 'Current offers', ctaLabel: 'View offers', ctaUrl: '/collection/deals', imageUrl: IMG.lifestyle2, layout: 'small', sortOrder: 1, isActive: true },
    { id: 'l3', title: 'Shop by brand', ctaLabel: 'Browse brands', ctaUrl: '/brands', imageUrl: IMG.lifestyle3, layout: 'small', sortOrder: 2, isActive: true },
    { id: 'l4', title: 'Full trade catalogue', ctaLabel: 'View all products', ctaUrl: '/collection/all', imageUrl: IMG.lifestyleWide, layout: 'wide', sortOrder: 3, isActive: true },
  ],
  homepageSections: [
    {
      id: 's1',
      sectionKey: 'newly_dropped',
      title: 'New arrivals',
      subtitle: 'Latest additions to the Unique wholesale catalogue.',
      imageUrl: '',
      ctaLabel: 'View All',
      ctaUrl: '/collection/new',
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 's2',
      sectionKey: 'summer_collections',
      title: 'Offers',
      subtitle: 'Featured wholesale offers currently merchandised in the catalogue.',
      imageUrl: '',
      ctaLabel: 'View Deals',
      ctaUrl: '/collection/deals',
      sortOrder: 1,
      isActive: true,
    },
    {
      id: 's4',
      sectionKey: 'shop_by_category',
      title: 'Shop by category',
      subtitle: 'Browse wholesale ranges used by UK retailers.',
      imageUrl: '',
      ctaLabel: '',
      ctaUrl: '',
      sortOrder: 5,
      isActive: true,
    },
    {
      id: 's3',
      sectionKey: 'final_cta',
      title: 'Stock your shop from one UK wholesale platform.',
      subtitle: '',
      imageUrl: IMG.finalCta,
      ctaLabel: 'Open a trade account',
      ctaUrl: '/trade',
      sortOrder: 2,
      isActive: true,
    },
  ],
  bundles: [],
  marketingPages: [
    { id: 'mp1', title: LEGAL_PAGES.privacy.title, slug: LEGAL_PAGES.privacy.slug, bodyHtml: LEGAL_PAGES.privacy.bodyHtml, metaDescription: LEGAL_PAGES.privacy.metaDescription, published: true, sortOrder: 0 },
    { id: 'mp2', title: LEGAL_PAGES.terms.title, slug: LEGAL_PAGES.terms.slug, bodyHtml: LEGAL_PAGES.terms.bodyHtml, metaDescription: LEGAL_PAGES.terms.metaDescription, published: true, sortOrder: 1 },
    { id: 'mp3', title: LEGAL_PAGES.contact.title, slug: LEGAL_PAGES.contact.slug, bodyHtml: LEGAL_PAGES.contact.bodyHtml, metaDescription: LEGAL_PAGES.contact.metaDescription, published: true, sortOrder: 2 },
    { id: 'mp4', title: LEGAL_PAGES.shipping.title, slug: LEGAL_PAGES.shipping.slug, bodyHtml: LEGAL_PAGES.shipping.bodyHtml, metaDescription: LEGAL_PAGES.shipping.metaDescription, published: true, sortOrder: 3 },
    { id: 'mp5', title: LEGAL_PAGES.cookies.title, slug: LEGAL_PAGES.cookies.slug, bodyHtml: LEGAL_PAGES.cookies.bodyHtml, metaDescription: LEGAL_PAGES.cookies.metaDescription, published: true, sortOrder: 4 },
    { id: 'mp6', title: LEGAL_PAGES.about.title, slug: LEGAL_PAGES.about.slug, bodyHtml: LEGAL_PAGES.about.bodyHtml, metaDescription: LEGAL_PAGES.about.metaDescription, published: true, sortOrder: 5 },
    { id: 'mp7', title: LEGAL_PAGES.help.title, slug: LEGAL_PAGES.help.slug, bodyHtml: LEGAL_PAGES.help.bodyHtml, metaDescription: LEGAL_PAGES.help.metaDescription, published: true, sortOrder: 6 },
    { id: 'mp8', title: LEGAL_PAGES.tpd.title, slug: LEGAL_PAGES.tpd.slug, bodyHtml: LEGAL_PAGES.tpd.bodyHtml, metaDescription: LEGAL_PAGES.tpd.metaDescription, published: true, sortOrder: 7 },
    { id: 'mp9', title: LEGAL_PAGES.modernSlavery.title, slug: LEGAL_PAGES.modernSlavery.slug, bodyHtml: LEGAL_PAGES.modernSlavery.bodyHtml, metaDescription: LEGAL_PAGES.modernSlavery.metaDescription, published: true, sortOrder: 8 },
    { id: 'mp10', title: LEGAL_PAGES.medicalDisclaimer.title, slug: LEGAL_PAGES.medicalDisclaimer.slug, bodyHtml: LEGAL_PAGES.medicalDisclaimer.bodyHtml, metaDescription: LEGAL_PAGES.medicalDisclaimer.metaDescription, published: true, sortOrder: 9 },
    { id: 'mp11', title: UNIQUE_FOOTER_PAGES.careers.title, slug: UNIQUE_FOOTER_PAGES.careers.slug, bodyHtml: UNIQUE_FOOTER_PAGES.careers.bodyHtml, metaDescription: UNIQUE_FOOTER_PAGES.careers.metaDescription, published: true, sortOrder: 10 },
    { id: 'mp12', title: UNIQUE_FOOTER_PAGES.vapingVsSmoking.title, slug: UNIQUE_FOOTER_PAGES.vapingVsSmoking.slug, bodyHtml: UNIQUE_FOOTER_PAGES.vapingVsSmoking.bodyHtml, metaDescription: UNIQUE_FOOTER_PAGES.vapingVsSmoking.metaDescription, published: true, sortOrder: 11 },
    { id: 'mp13', title: UNIQUE_FOOTER_PAGES.nicPouches.title, slug: UNIQUE_FOOTER_PAGES.nicPouches.slug, bodyHtml: UNIQUE_FOOTER_PAGES.nicPouches.bodyHtml, metaDescription: UNIQUE_FOOTER_PAGES.nicPouches.metaDescription, published: true, sortOrder: 12 },
    { id: 'mp14', title: UNIQUE_FOOTER_PAGES.legalBigPuff.title, slug: UNIQUE_FOOTER_PAGES.legalBigPuff.slug, bodyHtml: UNIQUE_FOOTER_PAGES.legalBigPuff.bodyHtml, metaDescription: UNIQUE_FOOTER_PAGES.legalBigPuff.metaDescription, published: true, sortOrder: 13 },
    { id: 'mp15', title: UNIQUE_FOOTER_PAGES.disposableBan.title, slug: UNIQUE_FOOTER_PAGES.disposableBan.slug, bodyHtml: UNIQUE_FOOTER_PAGES.disposableBan.bodyHtml, metaDescription: UNIQUE_FOOTER_PAGES.disposableBan.metaDescription, published: true, sortOrder: 14 },
    { id: 'mp16', title: UNIQUE_FOOTER_PAGES.blogs.title, slug: UNIQUE_FOOTER_PAGES.blogs.slug, bodyHtml: UNIQUE_FOOTER_PAGES.blogs.bodyHtml, metaDescription: UNIQUE_FOOTER_PAGES.blogs.metaDescription, published: true, sortOrder: 15 },
  ],
  products: [],
}
