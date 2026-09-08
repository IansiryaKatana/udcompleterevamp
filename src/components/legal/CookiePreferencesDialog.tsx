import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCookieConsent } from '@/contexts/CookieConsentContext'

export function CookiePreferencesDialog() {
  const { consent, preferencesOpen, closePreferences, savePreferences, acceptAll } = useCookieConsent()
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  useEffect(() => {
    if (preferencesOpen) {
      setAnalytics(consent?.analytics ?? false)
      setMarketing(consent?.marketing ?? false)
    }
  }, [consent?.analytics, consent?.marketing, preferencesOpen])

  return (
    <Dialog open={preferencesOpen} onOpenChange={(open) => !open && closePreferences()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-brand-border p-0 sm:max-w-md">
        <div className="border-b border-brand-border px-5 py-4 pr-12">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-extrabold text-text-brown">Cookie preferences</DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-sm text-muted">
            Choose which optional cookies we may use. Read our{' '}
            <Link to="/pages/cookies" className="font-semibold text-cta-brown underline" onClick={closePreferences}>
              Cookie Policy
            </Link>
            .
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="flex items-start gap-3 rounded-lg border border-brand-border bg-content-bg p-4">
            <input type="checkbox" checked disabled className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-text-brown">Strictly necessary</span>
              <span className="mt-1 block text-xs text-muted">Required for cart, checkout, account sign-in, and saving your consent choice.</span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-brand-border p-4">
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-text-brown">Analytics</span>
              <span className="mt-1 block text-xs text-muted">Helps us understand how visitors browse categories and improve the store.</span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-brand-border p-4">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-text-brown">Marketing</span>
              <span className="mt-1 block text-xs text-muted">Measures newsletter sign-ups and campaign performance.</span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-2 border-t border-brand-border px-5 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={closePreferences}>
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => savePreferences({ analytics, marketing })}
          >
            Save preferences
          </Button>
          <Button type="button" className="w-full sm:w-auto" onClick={acceptAll}>
            Accept all
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
