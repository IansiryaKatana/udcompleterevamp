export const COOKIE_CONSENT_VERSION = '1'
export const COOKIE_CONSENT_STORAGE_KEY = `unique_cookie_consent_v${COOKIE_CONSENT_VERSION}`

export type CookieConsentPreferences = {
  version: string
  essential: true
  analytics: boolean
  marketing: boolean
  decidedAt: string
}

export const DEFAULT_COOKIE_CONSENT: CookieConsentPreferences = {
  version: COOKIE_CONSENT_VERSION,
  essential: true,
  analytics: false,
  marketing: false,
  decidedAt: '',
}

export function readCookieConsent(): CookieConsentPreferences | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CookieConsentPreferences
    if (parsed.version !== COOKIE_CONSENT_VERSION) return null
    if (!parsed.decidedAt) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCookieConsent(prefs: Omit<CookieConsentPreferences, 'version' | 'essential' | 'decidedAt'> & { decidedAt?: string }) {
  const payload: CookieConsentPreferences = {
    version: COOKIE_CONSENT_VERSION,
    essential: true,
    analytics: prefs.analytics,
    marketing: prefs.marketing,
    decidedAt: prefs.decidedAt ?? new Date().toISOString(),
  }
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(payload))
  window.dispatchEvent(new CustomEvent('unique:cookie-consent', { detail: payload }))
  return payload
}

export function acceptAllCookies() {
  return writeCookieConsent({ analytics: true, marketing: true })
}

export function rejectNonEssentialCookies() {
  return writeCookieConsent({ analytics: false, marketing: false })
}
