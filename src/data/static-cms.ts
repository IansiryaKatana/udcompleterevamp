import { LEGAL_PAGES } from '@/lib/legal/marketingPageCopy'

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
  product: Pick<Product, 'id' | 'name' | 'slug' | 'imageUrl' | 'price' | 'inventoryCount' | 'variants'>
}

export type ProductBundle = {
  id: string
  name: string
  slug: string
  overview: string | null
  description: string | null
  price: number
  compareAtPrice: number | null
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
  location: 'header' | 'footer_categories' | 'footer_legal' | 'footer_help'
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

const CAT = {
  systemAccessories: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  graphicsCard: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
  mobilePhones: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
  gaming: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
  powerSupply: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb101',
  motherboards: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb102',
  ram: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb103',
  processors: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb104',
  gamingPc: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb105',
  msi: 'cccccccc-cccc-cccc-cccc-cccccccccc01',
  zotac: 'cccccccc-cccc-cccc-cccc-cccccccccc02',
  gigabyte: 'cccccccc-cccc-cccc-cccc-cccccccccc03',
  apple: 'dddddddd-dddd-dddd-dddd-dddddddddd01',
  samsung: 'dddddddd-dddd-dddd-dddd-dddddddddd02',
  google: 'dddddddd-dddd-dddd-dddd-dddddddddd03',
  oneplus: 'dddddddd-dddd-dddd-dddd-dddddddddd04',
  nintendo: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
  ps5: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
  xbox: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
}

const COL = {
  new: '22222222-2222-2222-2222-222222222201',
  deals: '22222222-2222-2222-2222-222222222202',
}

export const staticCmsSnapshot: CmsSnapshot = {
  siteName: 'Unique',
  logoText: 'UNIQUE',
  siteSettings: {
    brand_primary: '#1a3a5c',
    brand_surface: '#f4f6f8',
    newsletter_heading: 'Stay ahead with new tech drops',
    footer_tagline: 'Premium electronics for work, play, and everything in between.',
    currency_code: 'USD',
    currency_locale: 'en-US',
    contact_phone: '',
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
    email_brand_color: '#5c4a32',
    email_footer_text: 'Thank you for shopping with us.',
    email_from_name: 'Unique Distribution',
    store_url: '',
  },
  navLinks: [
    { id: '1', label: 'Home', href: '/', location: 'header', sortOrder: 0, isActive: true },
    { id: '14', label: 'Bundles', href: '/bundles', location: 'header', sortOrder: 1, isActive: true },
    { id: '6', label: 'New Arrivals', href: '/collection/new', location: 'footer_categories', sortOrder: 0, isActive: true },
    { id: '7', label: 'Best Sellers', href: '/collection/best', location: 'footer_categories', sortOrder: 1, isActive: true },
    { id: '12', label: 'Hot Deals', href: '/collection/deals', location: 'footer_categories', sortOrder: 2, isActive: true },
    { id: '8', label: 'Privacy Policy', href: '/pages/privacy', location: 'footer_legal', sortOrder: 0, isActive: true },
    { id: '9', label: 'Terms', href: '/pages/terms', location: 'footer_legal', sortOrder: 1, isActive: true },
    { id: '13', label: 'Cookie Policy', href: '/pages/cookies', location: 'footer_legal', sortOrder: 2, isActive: true },
    { id: '10', label: 'Contact', href: '/pages/contact', location: 'footer_help', sortOrder: 0, isActive: true },
    { id: '11', label: 'Shipping', href: '/pages/shipping', location: 'footer_help', sortOrder: 1, isActive: true },
  ],
  socialLinks: [],
  categories: [
    { id: CAT.systemAccessories, name: 'System Accessories', slug: 'system-accessories', parentId: null, sortOrder: 0, isActive: true },
    { id: CAT.graphicsCard, name: 'Graphics Card', slug: 'graphics-card', parentId: null, sortOrder: 1, isActive: true },
    { id: CAT.mobilePhones, name: 'Mobile Phones', slug: 'mobile-phones', parentId: null, sortOrder: 2, isActive: true },
    { id: CAT.gaming, name: 'Gaming', slug: 'gaming', parentId: null, sortOrder: 3, isActive: true },
    { id: CAT.powerSupply, name: 'Power Supply', slug: 'power-supply', parentId: CAT.systemAccessories, sortOrder: 0, isActive: true },
    { id: CAT.motherboards, name: 'Motherboards', slug: 'motherboards', parentId: CAT.systemAccessories, sortOrder: 1, isActive: true },
    { id: CAT.ram, name: 'Ram', slug: 'ram', parentId: CAT.systemAccessories, sortOrder: 2, isActive: true },
    { id: CAT.processors, name: 'Processors', slug: 'processors', parentId: CAT.systemAccessories, sortOrder: 3, isActive: true },
    { id: CAT.gamingPc, name: 'Gaming PC', slug: 'gaming-pc', parentId: CAT.systemAccessories, sortOrder: 4, isActive: true },
    { id: CAT.msi, name: 'MSI', slug: 'msi', parentId: CAT.graphicsCard, sortOrder: 0, isActive: true },
    { id: CAT.zotac, name: 'Zotac', slug: 'zotac', parentId: CAT.graphicsCard, sortOrder: 1, isActive: true },
    { id: CAT.gigabyte, name: 'Gigabyte', slug: 'gigabyte', parentId: CAT.graphicsCard, sortOrder: 2, isActive: true },
    { id: CAT.apple, name: 'Apple', slug: 'apple', parentId: CAT.mobilePhones, sortOrder: 0, isActive: true },
    { id: CAT.samsung, name: 'Samsung', slug: 'samsung', parentId: CAT.mobilePhones, sortOrder: 1, isActive: true },
    { id: CAT.google, name: 'Google', slug: 'google', parentId: CAT.mobilePhones, sortOrder: 2, isActive: true },
    { id: CAT.oneplus, name: 'Oneplus', slug: 'oneplus', parentId: CAT.mobilePhones, sortOrder: 3, isActive: true },
    { id: CAT.nintendo, name: 'Nintendo', slug: 'nintendo', parentId: CAT.gaming, sortOrder: 0, isActive: true },
    { id: CAT.ps5, name: 'Playstation 5', slug: 'playstation-5', parentId: CAT.gaming, sortOrder: 1, isActive: true },
    { id: CAT.xbox, name: 'Xbox', slug: 'xbox', parentId: CAT.gaming, sortOrder: 2, isActive: true },
  ],
  collections: [
    { id: COL.new, title: 'New Arrivals', slug: 'new', description: 'Latest tech releases', coverImageUrl: IMG.p6, type: 'seasonal', sortOrder: 0, isActive: true },
    { id: COL.deals, title: 'Hot Deals', slug: 'deals', description: 'Limited-time offers on top gear', coverImageUrl: IMG.p3, type: 'seasonal', sortOrder: 1, isActive: true },
  ],
  heroSlides: [
    {
      id: 'h1',
      headlineLines: ['Tech That', 'Powers Your', 'Everyday'],
      ctaLabel: 'Shop Now',
      ctaUrl: '/collection/new',
      imageUrl: IMG.hero,
      imageUrlTablet: '',
      imageUrlMobile: '',
      backgroundColor: '#1a3a5c',
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 'h2',
      headlineLines: ['Build Your', 'Dream', 'Setup'],
      ctaLabel: 'Browse Components',
      ctaUrl: '/collection/system-accessories',
      imageUrl: IMG.lifestyle1,
      imageUrlTablet: '',
      imageUrlMobile: '',
      backgroundColor: '#2d4a6a',
      sortOrder: 1,
      isActive: true,
    },
  ],
  featureCards: [
    {
      id: 'f1',
      title: 'Components Built For Performance — Reliable, Efficient, And Ready To Ship.',
      ctaLabel: 'Shop Components',
      ctaUrl: '/collection/system-accessories',
      imageUrl: IMG.feature1,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 'f2',
      title: 'Latest Phones & Tablets — Flagship Features At Competitive Prices.',
      ctaLabel: 'Shop Phones',
      ctaUrl: '/collection/mobile-phones',
      imageUrl: IMG.feature2,
      sortOrder: 1,
      isActive: true,
    },
    {
      id: 'f3',
      title: 'GAMING ZONE',
      ctaLabel: 'Shop Consoles',
      ctaUrl: '/collection/gaming',
      imageUrl: IMG.feature3,
      sortOrder: 2,
      isActive: true,
    },
  ],
  lifestyleCards: [
    { id: 'l1', title: 'Pro Gaming Rigs', ctaLabel: 'Explore', ctaUrl: '/collection/gaming-pc', imageUrl: IMG.lifestyle1, layout: 'large', sortOrder: 0, isActive: true },
    { id: 'l2', title: 'GPU Deals', ctaLabel: 'Shop', ctaUrl: '/collection/graphics-card', imageUrl: IMG.lifestyle2, layout: 'small', sortOrder: 1, isActive: true },
    { id: 'l3', title: 'Console Corner', ctaLabel: 'View', ctaUrl: '/collection/gaming', imageUrl: IMG.lifestyle3, layout: 'small', sortOrder: 2, isActive: true },
    { id: 'l4', title: 'Curated For Every Setup', ctaLabel: 'View All Products', ctaUrl: '/collection/all', imageUrl: IMG.lifestyleWide, layout: 'wide', sortOrder: 3, isActive: true },
  ],
  homepageSections: [
    {
      id: 's1',
      sectionKey: 'newly_dropped',
      title: 'Newly Arrived Tech',
      subtitle: 'The latest components, phones, and consoles — curated for performance and value.',
      imageUrl: '',
      ctaLabel: 'View All',
      ctaUrl: '/collection/new',
      sortOrder: 0,
      isActive: true,
    },
    {
      id: 's2',
      sectionKey: 'summer_collections',
      title: 'Hot Deals',
      subtitle: 'Save on GPUs, phones, and gaming gear while stocks last.',
      imageUrl: '',
      ctaLabel: 'View Deals',
      ctaUrl: '/collection/deals',
      sortOrder: 1,
      isActive: true,
    },
    {
      id: 's3',
      sectionKey: 'final_cta',
      title: 'Build Your Setup With Premium Electronics From Unique.',
      subtitle: '',
      imageUrl: IMG.finalCta,
      ctaLabel: 'Shop Now',
      ctaUrl: '/collection/all',
      sortOrder: 2,
      isActive: true,
    },
  ],
  bundles: [
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb901',
      name: 'AMD Gaming Build Kit',
      slug: 'amd-gaming-build-kit',
      overview: 'CPU, motherboard, and RAM bundled for a ready-to-build gaming PC.',
      description: '<p>Save when you buy together: Ryzen 7 7800X3D, ASUS ROG Strix B650-E, and 32GB DDR5.</p>',
      price: 799.99,
      compareAtPrice: 859.97,
      sku: null,
      imageUrl: IMG.feature1,
      galleryUrls: [],
      badge: 'Bundle',
      published: true,
      sortOrder: 0,
      availableQuantity: 9,
      items: [
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccc91',
          bundleId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb901',
          productId: 'p4',
          variantId: null,
          quantity: 1,
          sortOrder: 0,
          label: 'Processor',
          product: {
            id: 'p4',
            name: 'AMD Ryzen 7 7800X3D',
            slug: 'amd-ryzen-7-7800x3d',
            imageUrl: IMG.p4,
            price: 449.99,
            inventoryCount: 9,
          },
        },
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccc92',
          bundleId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb901',
          productId: 'p2',
          variantId: null,
          quantity: 1,
          sortOrder: 1,
          label: 'Motherboard',
          product: {
            id: 'p2',
            name: 'ASUS ROG Strix B650-E',
            slug: 'asus-rog-strix-b650e',
            imageUrl: IMG.p2,
            price: 289.99,
            inventoryCount: 12,
          },
        },
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccc93',
          bundleId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb901',
          productId: 'p3',
          variantId: null,
          quantity: 1,
          sortOrder: 2,
          label: 'Memory',
          product: {
            id: 'p3',
            name: 'Corsair Vengeance 32GB DDR5',
            slug: 'corsair-vengeance-32gb-ddr5',
            imageUrl: IMG.p3,
            price: 119.99,
            inventoryCount: 30,
          },
        },
      ],
    },
  ],
  marketingPages: [
    { id: 'mp1', title: LEGAL_PAGES.privacy.title, slug: LEGAL_PAGES.privacy.slug, bodyHtml: LEGAL_PAGES.privacy.bodyHtml, metaDescription: LEGAL_PAGES.privacy.metaDescription, published: true, sortOrder: 0 },
    { id: 'mp2', title: LEGAL_PAGES.terms.title, slug: LEGAL_PAGES.terms.slug, bodyHtml: LEGAL_PAGES.terms.bodyHtml, metaDescription: LEGAL_PAGES.terms.metaDescription, published: true, sortOrder: 1 },
    { id: 'mp3', title: LEGAL_PAGES.contact.title, slug: LEGAL_PAGES.contact.slug, bodyHtml: LEGAL_PAGES.contact.bodyHtml, metaDescription: LEGAL_PAGES.contact.metaDescription, published: true, sortOrder: 2 },
    { id: 'mp4', title: LEGAL_PAGES.shipping.title, slug: LEGAL_PAGES.shipping.slug, bodyHtml: LEGAL_PAGES.shipping.bodyHtml, metaDescription: LEGAL_PAGES.shipping.metaDescription, published: true, sortOrder: 3 },
    { id: 'mp5', title: LEGAL_PAGES.cookies.title, slug: LEGAL_PAGES.cookies.slug, bodyHtml: LEGAL_PAGES.cookies.bodyHtml, metaDescription: LEGAL_PAGES.cookies.metaDescription, published: true, sortOrder: 4 },
  ],
  products: [
    { id: 'p1', name: 'Corsair RM850x PSU', slug: 'corsair-rm850x-psu', description: '80 Plus Gold modular power supply with quiet fan and full protection suite.', price: 129.99, imageUrl: IMG.p1, categoryId: CAT.powerSupply, collectionId: COL.new, badge: 'New', isFeatured: true, isNew: true, isSummer: false, inventoryCount: 18, published: true, sortOrder: 0 },
    { id: 'p2', name: 'ASUS ROG Strix B650-E', slug: 'asus-rog-strix-b650e', description: 'AM5 ATX motherboard with PCIe 5.0, WiFi 6E, and robust VRM cooling.', price: 289.99, imageUrl: IMG.p2, categoryId: CAT.motherboards, collectionId: COL.new, badge: 'Bestseller', isFeatured: true, isNew: true, isSummer: false, inventoryCount: 12, published: true, sortOrder: 1 },
    { id: 'p3', name: 'Corsair Vengeance 32GB DDR5', slug: 'corsair-vengeance-32gb-ddr5', description: '32GB (2×16GB) DDR5-6000 kit optimized for AMD and Intel platforms.', price: 119.99, imageUrl: IMG.p3, categoryId: CAT.ram, collectionId: COL.deals, badge: 'Deal', isFeatured: false, isNew: false, isSummer: true, inventoryCount: 30, published: true, sortOrder: 2 },
    { id: 'p4', name: 'AMD Ryzen 7 7800X3D', slug: 'amd-ryzen-7-7800x3d', description: '8-core gaming processor with 3D V-Cache for exceptional frame rates.', price: 449.99, imageUrl: IMG.p4, categoryId: CAT.processors, collectionId: COL.new, badge: 'Hot', isFeatured: true, isNew: true, isSummer: false, inventoryCount: 9, published: true, sortOrder: 3 },
    { id: 'p5', name: 'Unique Phantom Gaming PC', slug: 'astor-phantom-gaming-pc', description: 'Pre-built RTX 4070 rig with Ryzen 7, 32GB RAM, and 1TB NVMe SSD.', price: 1599.99, imageUrl: IMG.p5, categoryId: CAT.gamingPc, collectionId: COL.new, badge: 'Premium', isFeatured: true, isNew: true, isSummer: false, inventoryCount: 5, published: true, sortOrder: 4 },
    { id: 'p6', name: 'MSI GeForce RTX 4070 Ti Super', slug: 'msi-rtx-4070-ti-super', description: 'Triple-fan cooling, 12GB GDDR6X, ideal for 1440p and 4K gaming.', price: 799.99, imageUrl: IMG.p6, categoryId: CAT.msi, collectionId: COL.new, badge: 'New', isFeatured: true, isNew: true, isSummer: false, inventoryCount: 8, published: true, sortOrder: 5 },
    { id: 'p7', name: 'Zotac RTX 4060 Twin Edge', slug: 'zotac-rtx-4060-twin-edge', description: 'Compact dual-fan GPU for efficient 1080p gaming builds.', price: 299.99, imageUrl: IMG.p5, categoryId: CAT.zotac, collectionId: COL.deals, badge: 'Deal', isFeatured: false, isNew: false, isSummer: true, inventoryCount: 15, published: true, sortOrder: 6 },
    { id: 'p8', name: 'Gigabyte RTX 4080 Super Aero', slug: 'gigabyte-rtx-4080-super-aero', description: '16GB GDDR6X with advanced cooling for demanding creators and gamers.', price: 1099.99, imageUrl: IMG.p6, categoryId: CAT.gigabyte, collectionId: COL.new, badge: 'Pro', isFeatured: true, isNew: false, isSummer: false, inventoryCount: 6, published: true, sortOrder: 7 },
    { id: 'p9', name: 'iPhone 15 Pro', slug: 'iphone-15-pro', description: 'Titanium design, A17 Pro chip, and advanced camera system.', price: 999.99, imageUrl: IMG.p7, categoryId: CAT.apple, collectionId: COL.new, badge: 'New', isFeatured: true, isNew: true, isSummer: false, inventoryCount: 20, published: true, sortOrder: 8 },
    { id: 'p10', name: 'Samsung Galaxy S24 Ultra', slug: 'samsung-galaxy-s24-ultra', description: '200MP camera, S Pen support, and vivid AMOLED display.', price: 1199.99, imageUrl: IMG.p8, categoryId: CAT.samsung, collectionId: COL.new, badge: 'Flagship', isFeatured: true, isNew: true, isSummer: false, inventoryCount: 14, published: true, sortOrder: 9 },
    { id: 'p11', name: 'Google Pixel 8 Pro', slug: 'google-pixel-8-pro', description: 'Pure Android with exceptional computational photography.', price: 899.99, imageUrl: IMG.p7, categoryId: CAT.google, collectionId: COL.deals, badge: 'Deal', isFeatured: false, isNew: false, isSummer: true, inventoryCount: 11, published: true, sortOrder: 10 },
    { id: 'p12', name: 'OnePlus 12', slug: 'oneplus-12', description: 'Snapdragon 8 Gen 3, fast charging, and smooth 120Hz display.', price: 799.99, imageUrl: IMG.p7, categoryId: CAT.oneplus, collectionId: COL.new, badge: 'Value', isFeatured: false, isNew: true, isSummer: false, inventoryCount: 16, published: true, sortOrder: 11 },
    { id: 'p13', name: 'Nintendo Switch OLED', slug: 'nintendo-switch-oled', description: '7-inch OLED screen with enhanced audio and versatile play modes.', price: 349.99, imageUrl: IMG.p9, categoryId: CAT.nintendo, collectionId: COL.deals, badge: 'Deal', isFeatured: true, isNew: false, isSummer: true, inventoryCount: 22, published: true, sortOrder: 12 },
    { id: 'p14', name: 'PlayStation 5 Slim', slug: 'playstation-5-slim', description: 'Next-gen gaming with ultra-fast SSD and DualSense controller.', price: 499.99, imageUrl: IMG.p10, categoryId: CAT.ps5, collectionId: COL.new, badge: 'Hot', isFeatured: true, isNew: true, isSummer: false, inventoryCount: 7, published: true, sortOrder: 13 },
    { id: 'p15', name: 'Xbox Series X', slug: 'xbox-series-x', description: '12 teraflops of power with Quick Resume and Game Pass ready.', price: 499.99, imageUrl: IMG.p11, categoryId: CAT.xbox, collectionId: COL.new, badge: 'Bestseller', isFeatured: true, isNew: false, isSummer: false, inventoryCount: 10, published: true, sortOrder: 14 },
  ],
}
