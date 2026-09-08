import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useCms } from '@/contexts/CmsContext'
import { paletteToCssVars, resolveBrandPalette } from '@/lib/brandPalette'

export const DEFAULT_FAVICON_URL = '/images/favicon%20astor.png'
export const DEFAULT_LOGO_DARK_URL = '/images/ASTOR%20logo.png'

export function getBrandSettings(siteSettings: Record<string, string>) {
  return {
    faviconUrl: siteSettings.favicon_url?.trim() || DEFAULT_FAVICON_URL,
    logoDarkUrl: siteSettings.logo_dark_url?.trim() || DEFAULT_LOGO_DARK_URL,
    logoLightUrl: siteSettings.logo_light_url?.trim() ?? '',
    heroBgDesktop: siteSettings.hero_bg_desktop?.trim() ?? '',
    heroBgTablet: siteSettings.hero_bg_tablet?.trim() ?? '',
    heroBgMobile: siteSettings.hero_bg_mobile?.trim() ?? '',
  }
}

export function resolveHeroSlideImages(
  slide: { imageUrl: string; imageUrlTablet?: string; imageUrlMobile?: string },
  defaults: ReturnType<typeof getBrandSettings>,
) {
  const desktop = slide.imageUrl || defaults.heroBgDesktop
  const tablet = slide.imageUrlTablet || defaults.heroBgTablet || desktop
  const mobile = slide.imageUrlMobile || defaults.heroBgMobile || tablet
  return { desktop, tablet, mobile }
}

/** Applies CMS brand colors to CSS custom properties on the document. */
export function SiteBrandTheme() {
  const { snapshot } = useCms()
  const cssVars = useMemo(
    () => paletteToCssVars(resolveBrandPalette(snapshot.siteSettings)),
    [snapshot.siteSettings],
  )

  useLayoutEffect(() => {
    const root = document.documentElement
    for (const [property, value] of Object.entries(cssVars)) {
      root.style.setProperty(property, value)
    }
  }, [cssVars])

  return null
}

/** Injects favicon from CMS site settings. */
export function SiteFavicon() {
  const { snapshot } = useCms()
  const faviconUrl = getBrandSettings(snapshot.siteSettings).faviconUrl

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = faviconUrl
  }, [faviconUrl])

  return null
}
