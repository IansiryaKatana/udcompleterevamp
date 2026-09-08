import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/integrations/supabase/database.types'
import type { CmsSnapshot } from '@/data/static-cms'
import { staticCmsSnapshot } from '@/data/static-cms'
import { normalizeCmsHref } from '@/lib/cmsLink'
import { DEFAULT_HERO_BACKGROUND } from '@/lib/brandPalette'

function mapCollection(row: Database['public']['Tables']['collections']['Row']): CmsSnapshot['collections'][0] {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description ?? '',
    coverImageUrl: row.cover_image_url ?? '',
    type: row.type ?? 'seasonal',
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapCategory(row: Database['public']['Tables']['categories']['Row']): CmsSnapshot['categories'][0] {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parent_id ?? null,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapHeroSlide(row: Database['public']['Tables']['hero_slides']['Row']): CmsSnapshot['heroSlides'][0] {
  const lines = Array.isArray(row.headline_lines)
    ? (row.headline_lines as string[])
    : []
  return {
    id: row.id,
    headlineLines: lines,
    ctaLabel: row.cta_label ?? 'Shop Now',
    ctaUrl: normalizeCmsHref(row.cta_url ?? '/'),
    imageUrl: row.image_url ?? '',
    imageUrlTablet: row.image_url_tablet ?? '',
    imageUrlMobile: row.image_url_mobile ?? '',
    backgroundColor: row.background_color ?? DEFAULT_HERO_BACKGROUND,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapFeatureCard(row: Database['public']['Tables']['feature_cards']['Row']): CmsSnapshot['featureCards'][0] {
  return {
    id: row.id,
    title: row.title,
    ctaLabel: row.cta_label ?? 'Shop',
    ctaUrl: normalizeCmsHref(row.cta_url ?? '/'),
    imageUrl: row.image_url ?? '',
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapLifestyleCard(row: Database['public']['Tables']['lifestyle_cards']['Row']): CmsSnapshot['lifestyleCards'][0] {
  return {
    id: row.id,
    title: row.title,
    ctaLabel: row.cta_label ?? 'Explore',
    ctaUrl: normalizeCmsHref(row.cta_url ?? '/'),
    imageUrl: row.image_url ?? '',
    layout: (row.layout as 'large' | 'small' | 'wide') ?? 'small',
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapHomepageSection(row: Database['public']['Tables']['homepage_sections']['Row']): CmsSnapshot['homepageSections'][0] {
  return {
    id: row.id,
    sectionKey: row.section_key,
    title: row.title ?? '',
    subtitle: row.subtitle ?? '',
    imageUrl: row.image_url ?? '',
    ctaLabel: row.cta_label ?? '',
    ctaUrl: normalizeCmsHref(row.cta_url ?? ''),
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapNavLink(row: Database['public']['Tables']['nav_links']['Row']): CmsSnapshot['navLinks'][0] {
  return {
    id: row.id,
    label: row.label,
    href: normalizeCmsHref(row.href),
    location: row.location as CmsSnapshot['navLinks'][0]['location'],
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapSocialLink(row: Database['public']['Tables']['social_links']['Row']): CmsSnapshot['socialLinks'][0] {
  return {
    id: row.id,
    label: row.label,
    href: row.href,
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapMarketingPage(row: Database['public']['Tables']['marketing_pages']['Row']): CmsSnapshot['marketingPages'][0] {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    bodyHtml: row.body_html ?? '',
    metaDescription: row.meta_description ?? '',
    published: row.published,
    sortOrder: row.sort_order,
  }
}

export function mapSiteSettingsRows(rows: Database['public']['Tables']['site_settings']['Row'][]) {
  const siteSettings: Record<string, string> = {}
  for (const row of rows) {
    siteSettings[row.key] = row.value
  }
  return siteSettings
}

export async function loadSiteSettingsMap(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.from('site_settings').select('*')
  if (error) throw new Error(error.message)
  return mapSiteSettingsRows(data ?? [])
}

function applySiteSettingsToSnapshot(snapshot: CmsSnapshot, siteSettings: Record<string, string>): CmsSnapshot {
  return {
    ...snapshot,
    siteName: siteSettings.site_name ?? snapshot.siteName,
    logoText: siteSettings.logo_text ?? snapshot.logoText,
    siteSettings: { ...snapshot.siteSettings, ...siteSettings },
  }
}

export async function loadCmsSnapshot(
  supabase: SupabaseClient<Database> | null,
): Promise<{ snapshot: CmsSnapshot; mode: 'static' | 'live'; cmsEmpty: boolean }> {
  if (!supabase) {
    return { snapshot: staticCmsSnapshot, mode: 'static', cmsEmpty: false }
  }

  try {
    const [
      collectionsRes,
      categoriesRes,
      heroRes,
      featureRes,
      lifestyleRes,
      sectionsRes,
      navRes,
      socialRes,
      settingsRes,
      pagesRes,
    ] = await Promise.all([
      supabase.from('collections').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('categories').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('hero_slides').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('feature_cards').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('lifestyle_cards').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('homepage_sections').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('nav_links').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('social_links').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('site_settings').select('*'),
      supabase.from('marketing_pages').select('*').eq('published', true).order('sort_order'),
    ])

    const hasData =
      (heroRes.data?.length ?? 0) > 0 ||
      (collectionsRes.data?.length ?? 0) > 0 ||
      (categoriesRes.data?.length ?? 0) > 0

    if (!hasData) {
      const siteSettings = mapSiteSettingsRows(settingsRes.data ?? [])
      return {
        snapshot: applySiteSettingsToSnapshot(staticCmsSnapshot, siteSettings),
        mode: 'static',
        cmsEmpty: true,
      }
    }

    const siteSettings = mapSiteSettingsRows(settingsRes.data ?? [])

    const snapshot: CmsSnapshot = {
      siteName: siteSettings.site_name ?? staticCmsSnapshot.siteName,
      logoText: siteSettings.logo_text ?? staticCmsSnapshot.logoText,
      products: [],
      collections: collectionsRes.data?.length
        ? collectionsRes.data.map(mapCollection)
        : staticCmsSnapshot.collections,
      categories: categoriesRes.data?.length
        ? categoriesRes.data.map(mapCategory)
        : [],
      heroSlides: heroRes.data?.length
        ? heroRes.data.map(mapHeroSlide)
        : staticCmsSnapshot.heroSlides,
      featureCards: featureRes.data?.length
        ? featureRes.data.map(mapFeatureCard)
        : staticCmsSnapshot.featureCards,
      lifestyleCards: lifestyleRes.data?.length
        ? lifestyleRes.data.map(mapLifestyleCard)
        : staticCmsSnapshot.lifestyleCards,
      homepageSections: sectionsRes.data?.length
        ? sectionsRes.data.map(mapHomepageSection)
        : staticCmsSnapshot.homepageSections,
      navLinks: navRes.data?.length
        ? navRes.data.map(mapNavLink)
        : staticCmsSnapshot.navLinks,
      socialLinks: socialRes.error
        ? staticCmsSnapshot.socialLinks
        : socialRes.data?.length
          ? socialRes.data.map(mapSocialLink)
          : [],
      bundles: [],
      marketingPages: pagesRes.data?.length
        ? pagesRes.data.map(mapMarketingPage)
        : staticCmsSnapshot.marketingPages,
      siteSettings: { ...staticCmsSnapshot.siteSettings, ...siteSettings },
    }

    return { snapshot, mode: 'live', cmsEmpty: false }
  } catch {
    return { snapshot: staticCmsSnapshot, mode: 'static', cmsEmpty: false }
  }
}

export function getSectionByKey(snapshot: CmsSnapshot, key: string) {
  return snapshot.homepageSections.find((s) => s.sectionKey === key)
}

export function getNavByLocation(snapshot: CmsSnapshot, location: CmsSnapshot['navLinks'][0]['location']) {
  return snapshot.navLinks.filter((l) => l.location === location).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getVisibleHeaderNavLinks(snapshot: CmsSnapshot, hasBundles: boolean) {
  return getNavByLocation(snapshot, 'header')
    .filter((l) => l.href !== '/')
    .filter((l) => (l.href === '/bundles' ? hasBundles : true))
}

export function getProductBySlug(snapshot: CmsSnapshot, slug: string) {
  return snapshot.products.find((p) => p.slug === slug)
}

export function getTopLevelCategories(snapshot: CmsSnapshot) {
  return snapshot.categories.filter((c) => !c.parentId && c.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getChildCategories(snapshot: CmsSnapshot, parentId: string) {
  return snapshot.categories.filter((c) => c.parentId === parentId && c.isActive).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getCategoryBySlug(snapshot: CmsSnapshot, slug: string) {
  return snapshot.categories.find((c) => c.slug === slug)
}

/** Returns category id and all descendant category ids for filtering products. */
export function getCategoryTreeIds(snapshot: CmsSnapshot, categoryId: string): string[] {
  const ids = [categoryId]
  for (const child of snapshot.categories.filter((c) => c.parentId === categoryId)) {
    ids.push(...getCategoryTreeIds(snapshot, child.id))
  }
  return ids
}
