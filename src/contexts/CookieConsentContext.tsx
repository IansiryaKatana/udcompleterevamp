import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  acceptAllCookies,
  readCookieConsent,
  rejectNonEssentialCookies,
  writeCookieConsent,
  type CookieConsentPreferences,
} from '@/lib/cookies/consent'

type CookieConsentContextValue = {
  consent: CookieConsentPreferences | null
  hasDecided: boolean
  bannerOpen: boolean
  preferencesOpen: boolean
  acceptAll: () => void
  rejectNonEssential: () => void
  savePreferences: (prefs: Pick<CookieConsentPreferences, 'analytics' | 'marketing'>) => void
  openPreferences: () => void
  closePreferences: () => void
  dismissBanner: () => void
}

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null)

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState<CookieConsentPreferences | null>(null)
  const [bannerOpen, setBannerOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)

  useEffect(() => {
    const stored = readCookieConsent()
    setConsent(stored)
    setBannerOpen(!stored)
  }, [])

  useEffect(() => {
    function onConsentChange(event: Event) {
      const detail = (event as CustomEvent<CookieConsentPreferences>).detail
      setConsent(detail)
      setBannerOpen(false)
    }
    window.addEventListener('unique:cookie-consent', onConsentChange)
    return () => window.removeEventListener('unique:cookie-consent', onConsentChange)
  }, [])

  const acceptAll = useCallback(() => {
    setConsent(acceptAllCookies())
    setBannerOpen(false)
    setPreferencesOpen(false)
  }, [])

  const rejectNonEssential = useCallback(() => {
    setConsent(rejectNonEssentialCookies())
    setBannerOpen(false)
    setPreferencesOpen(false)
  }, [])

  const savePreferences = useCallback((prefs: Pick<CookieConsentPreferences, 'analytics' | 'marketing'>) => {
    setConsent(writeCookieConsent(prefs))
    setBannerOpen(false)
    setPreferencesOpen(false)
  }, [])

  const openPreferences = useCallback(() => {
    setPreferencesOpen(true)
    setBannerOpen(false)
  }, [])

  const closePreferences = useCallback(() => setPreferencesOpen(false), [])

  const dismissBanner = useCallback(() => setBannerOpen(false), [])

  const value = useMemo(
    () => ({
      consent,
      hasDecided: Boolean(consent?.decidedAt),
      bannerOpen,
      preferencesOpen,
      acceptAll,
      rejectNonEssential,
      savePreferences,
      openPreferences,
      closePreferences,
      dismissBanner,
    }),
    [acceptAll, bannerOpen, closePreferences, consent, dismissBanner, openPreferences, preferencesOpen, rejectNonEssential, savePreferences],
  )

  return <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>
}

export function useCookieConsent() {
  const ctx = useContext(CookieConsentContext)
  if (!ctx) throw new Error('useCookieConsent must be used within CookieConsentProvider')
  return ctx
}
