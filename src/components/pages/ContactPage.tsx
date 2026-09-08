import type { MarketingPage } from '@/data/static-cms'
import { ContactForm } from '@/components/ecommerce/ContactForm'
import { HeroSlideImage } from '@/components/home/HeroSlideImage'
import { CmsLink } from '@/components/layout/CmsLink'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { Button } from '@/components/ui/button'
import { useCms } from '@/contexts/CmsContext'
import { sanitizeMarketingHtml } from '@/lib/sanitizeHtml'

const CONTACT_FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1600&q=80'

export function ContactPage({ page }: { page: MarketingPage }) {
  const { snapshot } = useCms()
  const heroSlide = snapshot.heroSlides[0]
  const safeHtml = page.bodyHtml ? sanitizeMarketingHtml(page.bodyHtml) : ''

  const slideForImage = heroSlide ?? {
    imageUrl: CONTACT_FALLBACK_IMAGE,
    imageUrlTablet: CONTACT_FALLBACK_IMAGE,
    imageUrlMobile: CONTACT_FALLBACK_IMAGE,
  }

  return (
    <StorefrontLayout hideFooter className="bg-black">
      <section className="relative flex h-screen min-h-[100dvh] flex-col overflow-hidden">
        <HeroSlideImage slide={slideForImage} siteSettings={snapshot.siteSettings} />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/65"
          aria-hidden
        />

        <SiteHeader />

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-10 pt-24 text-center text-white md:px-14">
          <h1 className="font-display text-4xl font-extrabold md:text-5xl">{page.title}</h1>

          <Button asChild variant="cream" size="sm" className="mt-4">
            <CmsLink href="/">Back to Home</CmsLink>
          </Button>

          {safeHtml ? (
            <div
              className="prose prose-sm prose-invert mx-auto mt-5 max-w-lg text-white/85 prose-p:my-0 prose-p:text-sm prose-p:leading-relaxed"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : null}

          {(snapshot.siteSettings.contact_company_legal_name ||
            snapshot.siteSettings.contact_company_number ||
            snapshot.siteSettings.contact_address ||
            snapshot.siteSettings.contact_hours) ? (
            <div className="mx-auto mt-6 max-w-lg space-y-1 text-sm text-white/85">
              {snapshot.siteSettings.contact_company_legal_name ? (
                <p className="font-semibold">{snapshot.siteSettings.contact_company_legal_name}</p>
              ) : null}
              {snapshot.siteSettings.contact_company_number ? (
                <p>Company number {snapshot.siteSettings.contact_company_number}</p>
              ) : null}
              {snapshot.siteSettings.contact_address ? <p>{snapshot.siteSettings.contact_address}</p> : null}
              {snapshot.siteSettings.contact_hours ? <p>{snapshot.siteSettings.contact_hours}</p> : null}
              {snapshot.siteSettings.contact_phone ? <p>{snapshot.siteSettings.contact_phone}</p> : null}
            </div>
          ) : null}

          <ContactForm className="mt-8 w-full max-w-lg text-left" />
        </div>
      </section>
    </StorefrontLayout>
  )
}
