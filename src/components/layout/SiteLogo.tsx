import { Link } from '@tanstack/react-router'
import { useCms } from '@/contexts/CmsContext'
import { getBrandSettings } from '@/lib/siteBrand'
import { cn } from '@/lib/utils'

type SiteLogoProps = {
  variant: 'dark' | 'light'
  className?: string
  imageClassName?: string
  onNavigate?: () => void
  to?: string
}

export function SiteLogo({ variant, className, imageClassName, onNavigate, to = '/' }: SiteLogoProps) {
  const { snapshot } = useCms()
  const brand = getBrandSettings(snapshot.siteSettings)
  const logoUrl =
    variant === 'dark' ? brand.logoDarkUrl || brand.logoLightUrl : brand.logoLightUrl || brand.logoDarkUrl

  return (
    <Link to={to} className={cn('inline-flex items-center', className)} onClick={onNavigate}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={snapshot.siteName}
          className={cn('h-8 w-auto max-w-[160px] object-contain object-left', imageClassName)}
        />
      ) : (
        <span className="font-display text-lg font-extrabold tracking-tight">{snapshot.logoText}</span>
      )}
    </Link>
  )
}
