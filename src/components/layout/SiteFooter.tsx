import { Mail } from 'lucide-react'
import { CmsLink } from '@/components/layout/CmsLink'
import { SiteLogo } from '@/components/layout/SiteLogo'
import { SocialLinks } from '@/components/layout/SocialLinks'
import { useCookieConsent } from '@/contexts/CookieConsentContext'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useCms } from '@/contexts/CmsContext'
import { getNavByLocation } from '@/lib/cms/loadCmsSnapshot'
import { newsletterSchema, type NewsletterFormValues } from '@/lib/validators/newsletter.schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toTelHref, toWhatsAppHref } from '@/lib/contactLinks'
import { uniqueRegisteredOfficeLine } from '@/lib/storefront/uniquePublishedCopy'
import { cn } from '@/lib/utils'

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

export function NewsletterForm({ className }: { className?: string }) {
  const { snapshot } = useCms()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NewsletterFormValues>({
    resolver: zodResolver(newsletterSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: NewsletterFormValues) {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/subscribe-newsletter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email: values.email, source: 'homepage_footer' }),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) {
      toast.error((body as { error?: string }).error ?? 'Subscription failed')
      return
    }
    toast.success('Thanks for subscribing!')
    reset()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn('w-full space-y-2', className)}>
      <p className="text-sm font-semibold text-cream-text">
        {snapshot.siteSettings.newsletter_heading ?? 'Trade updates from Unique Distribution'}
      </p>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <Input
          {...register('email')}
          type="email"
          placeholder="Enter your email address"
          className="h-9 w-full rounded-md border-white/16 bg-white/8 text-cream-text placeholder:text-white/40 sm:w-56"
        />
        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-9 shrink-0 rounded-md bg-cream-text px-5 text-footer-dark hover:bg-white"
        >
          Subscribe
        </Button>
      </div>
      {errors.email && <p className="text-xs text-red-300">{errors.email.message}</p>}
    </form>
  )
}

export function SiteFooter() {
  const { snapshot } = useCms()
  const { openPreferences } = useCookieConsent()
  const shop = [...getNavByLocation(snapshot, 'footer_shop'), ...getNavByLocation(snapshot, 'footer_categories')]
  const service = getNavByLocation(snapshot, 'footer_company')
  const legal = getNavByLocation(snapshot, 'footer_legal')
  const news = getNavByLocation(snapshot, 'footer_help')
  const phone = snapshot.siteSettings.contact_phone?.trim() || '+44 7340 676909'
  const email =
    snapshot.siteSettings.contact_notification_email?.trim() || 'info@uniquedistribution.com'
  const whatsappNumber = snapshot.siteSettings.contact_whatsapp?.trim() || phone
  const telHref = toTelHref(phone)
  const whatsappHref = toWhatsAppHref(
    whatsappNumber,
    snapshot.siteSettings.contact_whatsapp_message?.trim() || undefined,
  )

  function FooterCol({ title, links }: { title: string; links: typeof shop }) {
    if (links.length === 0) return null
    return (
      <div>
        <p className="mb-4 text-xs font-bold uppercase tracking-widest text-white/50">{title}</p>
        <ul className="space-y-2 text-sm">
          {links.map((link) => (
            <li key={link.id}>
              <CmsLink href={link.href} className="text-white/80 transition hover:text-white">
                {link.label}
              </CmsLink>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <footer className="relative overflow-hidden bg-footer-dark px-6 py-14 text-cream-text md:px-14">
      <div className="relative z-10 grid gap-10 md:grid-cols-2 lg:grid-cols-6 lg:gap-8">
        <div className="space-y-5 md:col-span-2 lg:col-span-2">
          <SiteLogo variant="dark" className="text-cream-text" imageClassName="h-10 max-w-[200px]" />
          <div className="space-y-2">
            <p className="text-sm font-semibold text-cream-text">Got Questions? Call us 24/7</p>
            {whatsappHref ? (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-cta-brown transition hover:text-white"
              >
                <WhatsAppIcon className="h-4 w-4 shrink-0" />
                {phone}
              </a>
            ) : telHref ? (
              <a href={telHref} className="flex items-center gap-2 text-sm text-cta-brown transition hover:text-white">
                <WhatsAppIcon className="h-4 w-4 shrink-0" />
                {phone}
              </a>
            ) : null}
            <a
              href={`mailto:${email}`}
              className="flex items-center gap-2 text-sm text-cta-brown transition hover:text-white"
            >
              <Mail className="h-4 w-4 shrink-0" />
              {email}
            </a>
          </div>
          <p className="max-w-sm text-sm text-white/70">
            {snapshot.siteSettings.footer_tagline ??
              'UK wholesale distributor supplying retailers from one trade catalogue.'}
          </p>
          <SocialLinks links={snapshot.socialLinks} />
          <div className="flex flex-col gap-2 text-xs text-white/40">
            <p>© {new Date().getFullYear()} {snapshot.siteName}. All rights reserved.</p>
            <button
              type="button"
              onClick={openPreferences}
              className="text-left text-white/60 underline-offset-2 transition hover:text-white hover:underline"
            >
              Cookie settings
            </button>
          </div>
        </div>

        <FooterCol title="Shop" links={shop} />
        <FooterCol title="Service" links={service} />
        <FooterCol title="Legal" links={legal} />
        <FooterCol title="Vape News" links={news} />
      </div>

      <div className="relative z-10 mt-10 border-t border-white/10 pt-8">
        <NewsletterForm />
      </div>

      <p className="pointer-events-none absolute -bottom-10 -right-8 select-none font-display text-[220px] font-extrabold leading-none text-white/[0.08]">
        {snapshot.logoText.slice(0, 1)}
      </p>

      <p className="relative z-10 mt-8 max-w-4xl text-xs leading-relaxed text-white/45">
        {uniqueRegisteredOfficeLine(snapshot.siteSettings)}
      </p>
      <p className="relative z-10 mt-3 text-xs text-white/45">
        Checkout currently supports trade quotes. Card payments are not shown as live while the payment gateway is
        disabled.
      </p>
    </footer>
  )
}
