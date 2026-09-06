import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { useCookieConsent } from '@/contexts/CookieConsentContext'
import { CookiePreferencesDialog } from '@/components/legal/CookiePreferencesDialog'

export function CookieConsentBanner() {
  const { bannerOpen, acceptAll, rejectNonEssential, openPreferences } = useCookieConsent()

  return (
    <>
      {bannerOpen ? (
        <div
          className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-footer-dark/95 px-4 py-4 text-[#f7efe5] shadow-[0_-8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md md:px-8"
          role="dialog"
          aria-labelledby="cookie-consent-title"
          aria-describedby="cookie-consent-desc"
        >
          <div className="mx-auto flex max-w-[1280px] flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <p id="cookie-consent-title" className="text-sm font-semibold text-white">
                We value your privacy
              </p>
              <p id="cookie-consent-desc" className="mt-1 text-xs leading-relaxed text-white/75 sm:text-sm">
                We use strictly necessary cookies for checkout and your cart. With your consent we also use optional analytics and marketing cookies to improve Unique Distribution. See our{' '}
                <Link to="/pages/cookies" className="font-semibold text-[#f7efe5] underline">
                  Cookie Policy
                </Link>
                .
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto lg:justify-end">
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-full border border-white/20 text-white hover:bg-white/10 sm:w-auto"
                onClick={openPreferences}
              >
                Customize
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full border-white/30 bg-transparent text-white hover:bg-white/10 sm:w-auto"
                onClick={rejectNonEssential}
              >
                Reject non-essential
              </Button>
              <Button
                type="button"
                className="h-9 w-full bg-[#f7efe5] text-[#1e140c] hover:bg-white sm:w-auto"
                onClick={acceptAll}
              >
                Accept all
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <CookiePreferencesDialog />
    </>
  )
}
