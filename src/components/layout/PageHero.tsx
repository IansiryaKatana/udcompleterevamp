import { CmsLink } from '@/components/layout/CmsLink'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Storefront inner-page hero background (public/images/section bg.webp) */
export const PAGE_HERO_BG_IMAGE = '/images/section%20bg.webp'

type PageHeroProps = {
  title: string
  subtitle?: string
  backLabel?: string
  backTo?: string
  contained?: boolean
  className?: string
}

export function PageHero({
  title,
  subtitle,
  backLabel = 'Back to Home',
  backTo = '/',
  contained = false,
  className,
}: PageHeroProps) {
  return (
    <div className={cn('relative overflow-hidden bg-hero-brown text-white', className)}>
      <img
        src={PAGE_HERO_BG_IMAGE}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-b from-black/45 via-hero-brown/72 to-hero-brown/88"
        aria-hidden
      />
      <div className="relative z-10">
        <SiteHeader />
        <div className={cn('px-6 pb-24 pt-36 md:px-14', contained && 'md:pb-28')}>
          <h1 className="font-display text-4xl font-extrabold md:text-5xl">{title}</h1>
          {subtitle ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/75 md:text-base">{subtitle}</p> : null}
          <Button asChild variant="cream" size="sm" className="mt-6">
            <CmsLink href={backTo}>{backLabel}</CmsLink>
          </Button>
        </div>
      </div>
    </div>
  )
}
