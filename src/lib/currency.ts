import { useCms } from '@/contexts/CmsContext'

export type CurrencyConfig = {
  code: string
  locale: string
}

export const CUSTOM_CURRENCY_VALUE = '__custom__'

export function getCurrencyFromSettings(siteSettings: Record<string, string>): CurrencyConfig {
  return {
    code: (siteSettings.currency_code || 'USD').trim().toUpperCase(),
    locale: (siteSettings.currency_locale || 'en-US').trim(),
  }
}

export function isKnownCurrencyCode(code: string) {
  return SUPPORTED_CURRENCIES.some((entry) => entry.code === code)
}

export function getDefaultLocaleForCurrency(code: string) {
  return SUPPORTED_CURRENCIES.find((entry) => entry.code === code)?.locale ?? 'en-US'
}

export function formatCurrency(
  value: number,
  currency: CurrencyConfig | string = { code: 'USD', locale: 'en-US' },
) {
  const cfg = typeof currency === 'string' ? { code: currency, locale: 'en-GB' } : currency
  const normalizedCode = String(cfg.code || 'USD').trim().toUpperCase()
  const locale = cfg.locale || 'en-US'
  const zeroDecimal = normalizedCode === 'JPY' || normalizedCode === 'KRW'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCode,
      minimumFractionDigits: zeroDecimal ? 0 : 2,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(value)
  } catch {
    return `${normalizedCode} ${value.toFixed(zeroDecimal ? 0 : 2)}`
  }
}

export function useCurrency() {
  const { snapshot } = useCms()
  return getCurrencyFromSettings(snapshot.siteSettings)
}

export function useFormatPrice() {
  const currency = useCurrency()
  return (value: number) => formatCurrency(value, currency)
}

export const SUPPORTED_CURRENCIES = [
  { code: 'USD', locale: 'en-US', label: 'US Dollar (USD)' },
  { code: 'EUR', locale: 'de-DE', label: 'Euro (EUR)' },
  { code: 'GBP', locale: 'en-GB', label: 'British Pound (GBP)' },
  { code: 'CAD', locale: 'en-CA', label: 'Canadian Dollar (CAD)' },
  { code: 'AUD', locale: 'en-AU', label: 'Australian Dollar (AUD)' },
  { code: 'JPY', locale: 'ja-JP', label: 'Japanese Yen (JPY)' },
  { code: 'KES', locale: 'en-KE', label: 'Kenyan Shilling (KES)' },
  { code: 'NGN', locale: 'en-NG', label: 'Nigerian Naira (NGN)' },
  { code: 'GHS', locale: 'en-GH', label: 'Ghanaian Cedi (GHS)' },
  { code: 'ZAR', locale: 'en-ZA', label: 'South African Rand (ZAR)' },
  { code: 'INR', locale: 'en-IN', label: 'Indian Rupee (INR)' },
  { code: 'AED', locale: 'ar-AE', label: 'UAE Dirham (AED)' },
] as const

export function formatCurrencyPreview(siteSettings: Record<string, string>, sample = 1299.99) {
  return formatCurrency(sample, getCurrencyFromSettings(siteSettings))
}
