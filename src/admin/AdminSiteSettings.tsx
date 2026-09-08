import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, RotateCcw, Save, Trash2, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { tryGetSupabase } from '@/integrations/supabase/client'
import type { Database } from '@/integrations/supabase/database.types'
import { useCms } from '@/contexts/CmsContext'
import { AdminErrorBanner, AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTabToolbar } from '@/admin/components/AdminTabToolbar'
import { ImageUploadField } from '@/admin/components/ImageUploadField'
import { RichTextEditor } from '@/admin/components/RichTextEditor'
import {
  getSettingValue,
  isManagedSettingKey,
  patchSetting,
  upsertSiteSettings,
  type SettingEntry,
} from '@/admin/lib/siteSettingsAdmin'
import {
  CUSTOM_CURRENCY_VALUE,
  formatCurrencyPreview,
  getDefaultLocaleForCurrency,
  isKnownCurrencyCode,
  SUPPORTED_CURRENCIES,
} from '@/lib/currency'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { adminBtnDanger, adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { sanitizeMarketingHtml } from '@/lib/sanitizeHtml'
import {
  BRAND_COLOR_FIELDS,
  BRAND_SETTING_KEYS,
  DEFAULT_BRAND_PALETTE,
  derivePaletteFromPrimary,
  deriveScaleFromPrimary,
  LEGACY_UNUSED_PRIMARY,
  normalizeHex,
  resolveBrandPalette,
  type BrandPalette,
} from '@/lib/brandPalette'

type Row = Database['public']['Tables']['site_settings']['Row']

export function AdminSiteSettings() {
  const { refetchCms } = useCms()
  const [entries, setEntries] = useState<SettingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savingSection, setSavingSection] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await tryGetSupabase().from('site_settings').select('*').order('key')
    if (fetchError) setError(fetchError.message)
    else {
      let mapped = (data ?? []).map((row) => ({ key: row.key, value: row.value }))
      const hasCompanion = mapped.some(
        (entry) =>
          (entry.key === BRAND_SETTING_KEYS.pageBg || entry.key === BRAND_SETTING_KEYS.footer) &&
          Boolean(normalizeHex(entry.value)),
      )
      if (!hasCompanion) {
        mapped = mapped.map((entry) =>
          entry.key === BRAND_SETTING_KEYS.primary && normalizeHex(entry.value) === LEGACY_UNUSED_PRIMARY
            ? { ...entry, value: DEFAULT_BRAND_PALETTE.primary }
            : entry,
        )
      }
      setEntries(mapped)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function addRow() {
    setEntries((prev) => [...prev, { key: '', value: '', isNew: true }])
  }

  function updateEntry(index: number, patch: Partial<SettingEntry>) {
    setEntries((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }

  async function saveEntry(index: number) {
    const entry = entries[index]
    if (!entry.key.trim()) return setError('Setting key is required.')

    setSavingKey(entry.key)
    setError(null)
    const supabase = tryGetSupabase()
    const { error: upsertError } = await supabase.from('site_settings').upsert({
      key: entry.key.trim(),
      value: entry.value,
      updated_at: new Date().toISOString(),
    })
    setSavingKey(null)

    if (upsertError) {
      setError(upsertError.message)
      return
    }

    toast.success(`Saved ${entry.key}`)
    await refresh()
    await refetchCms()
  }

  const brandSettings = Object.fromEntries(entries.map((entry) => [entry.key, entry.value]))
  const livePalette = resolveBrandPalette(brandSettings)
  const liveScale = deriveScaleFromPrimary(livePalette.primary)

  function applyPaletteToEntries(palette: BrandPalette) {
    setEntries((prev) => {
      let next = prev
      for (const field of BRAND_COLOR_FIELDS) {
        next = patchSetting(next, field.settingKey, palette[field.key])
      }
      return next
    })
  }

  async function saveBrandColors() {
    setSavingSection('colors')
    setError(null)
    try {
      const primary = normalizeHex(getSettingValue(entries, BRAND_SETTING_KEYS.primary)) ?? DEFAULT_BRAND_PALETTE.primary
      const palette = resolveBrandPalette({
        ...Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
        [BRAND_SETTING_KEYS.primary]: primary,
      })
      let next = entries
      for (const field of BRAND_COLOR_FIELDS) {
        next = patchSetting(next, field.settingKey, palette[field.key])
      }
      next = patchSetting(next, 'email_brand_color', palette.primary)
      await upsertSiteSettings([...Object.values(BRAND_SETTING_KEYS), 'email_brand_color'], next)
      toast.success('Brand colors saved')
      await refresh()
      await refetchCms()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save brand colors')
    } finally {
      setSavingSection(null)
    }
  }

  async function saveBrandAssets() {
    setSavingSection('brand')
    setError(null)
    try {
      await upsertSiteSettings(['favicon_url', 'logo_dark_url', 'logo_light_url'], entries)
      toast.success('Brand assets saved')
      await refresh()
      await refetchCms()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save brand assets')
    } finally {
      setSavingSection(null)
    }
  }

  async function saveDefaultDelivery() {
    setSavingSection('delivery')
    setError(null)
    try {
      const html = sanitizeMarketingHtml(getSettingValue(entries, 'default_delivery_info')) ?? ''
      await upsertSiteSettings(['default_delivery_info'], patchSetting(entries, 'default_delivery_info', html))
      toast.success('Default delivery information saved')
      await refresh()
      await refetchCms()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save delivery information')
    } finally {
      setSavingSection(null)
    }
  }

  async function saveHeroDefaults() {
    setSavingSection('hero')
    setError(null)
    try {
      await upsertSiteSettings(
        ['hero_bg_desktop', 'hero_bg_tablet', 'hero_bg_mobile'],
        entries,
      )
      toast.success('Hero background defaults saved')
      await refresh()
      await refetchCms()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save hero backgrounds')
    } finally {
      setSavingSection(null)
    }
  }

  function updateManagedSetting(key: string, value: string) {
    setEntries((prev) => patchSetting(prev, key, value))
  }

  const currencyCode = getSettingValue(entries, 'currency_code', 'USD')
  const currencySelectValue = isKnownCurrencyCode(currencyCode) ? currencyCode : CUSTOM_CURRENCY_VALUE

  async function saveCurrency() {
    setSavingSection('currency')
    setError(null)
    try {
      const code = getSettingValue(entries, 'currency_code', 'USD').trim().toUpperCase()
      if (!/^[A-Z]{3}$/.test(code)) {
        throw new Error('Currency code must be a 3-letter ISO code (e.g. USD, KES).')
      }
      const locale = getSettingValue(entries, 'currency_locale', 'en-US').trim() || getDefaultLocaleForCurrency(code)
      await upsertSiteSettings(['currency_code', 'currency_locale'], patchSetting(patchSetting(entries, 'currency_code', code), 'currency_locale', locale))
      toast.success(`Currency set to ${code}`)
      await refresh()
      await refetchCms()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save currency')
    } finally {
      setSavingSection(null)
    }
  }

  async function removeEntry(index: number) {
    const entry = entries[index]
    if (!entry.key.trim()) {
      setEntries((prev) => prev.filter((_, i) => i !== index))
      return
    }
    if (!window.confirm(`Delete setting "${entry.key}"?`)) return

    const { error: deleteError } = await tryGetSupabase().from('site_settings').delete().eq('key', entry.key)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    toast.success('Setting deleted')
    await refresh()
    await refetchCms()
  }

  if (loading) return <AdminLoadingState />

  return (
    <div>
      <AdminTabToolbar
        actions={
          <>
            <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button type="button" className={adminBtnPrimary} onClick={addRow}>
              <Plus className="h-4 w-4" />
              Add setting
            </button>
          </>
        }
      />
      <AdminErrorBanner message={error} />

      <div className="admin-section space-y-4">
        <h2 className="font-semibold">Brand colors</h2>
        <p className="text-sm text-[var(--admin-muted)]">
          Built around Unique Distribution green <span className="font-mono">#66a441</span>. These colors drive the
          storefront, admin chrome, and email header. Saving also updates the email accent color.
        </p>

        <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)]">
          <div className="flex h-10">
            {([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const).map((step) => (
              <div
                key={step}
                className="relative min-w-0 flex-1"
                style={{ backgroundColor: liveScale[step] }}
                title={`brand-${step} ${liveScale[step]}`}
              >
                <span
                  className={`absolute inset-x-0 bottom-0 pb-0.5 text-center text-[9px] font-medium ${
                    step >= 500 ? 'text-white/90' : 'text-[var(--admin-text)]/70'
                  }`}
                >
                  {step}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] bg-white px-4 py-3">
            <button
              type="button"
              className="rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: livePalette.primary }}
            >
              Primary button
            </button>
            <span className="text-sm font-medium" style={{ color: livePalette.text }}>
              Body text
            </span>
            <span className="text-sm" style={{ color: livePalette.muted }}>
              Muted caption
            </span>
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: livePalette.footer, color: livePalette.onDark }}
            >
              Dark surface
            </span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BRAND_COLOR_FIELDS.map((field) => {
            const value = getSettingValue(entries, field.settingKey, DEFAULT_BRAND_PALETTE[field.key])
            const pickerValue = normalizeHex(value) ?? DEFAULT_BRAND_PALETTE[field.key]
            return (
              <div key={field.settingKey}>
                <label className={adminLabel} htmlFor={`brand-${field.settingKey}`}>
                  {field.label}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="color"
                    aria-label={`${field.label} picker`}
                    className="h-10 w-12 cursor-pointer rounded border border-[var(--admin-border)] bg-white p-1"
                    value={pickerValue}
                    disabled={savingSection === 'colors'}
                    onChange={(e) => updateManagedSetting(field.settingKey, e.target.value)}
                  />
                  <input
                    id={`brand-${field.settingKey}`}
                    className={adminInput}
                    value={value}
                    spellCheck={false}
                    disabled={savingSection === 'colors'}
                    onChange={(e) => updateManagedSetting(field.settingKey, e.target.value)}
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--admin-muted)]">{field.hint}</p>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={adminBtnPrimary}
            disabled={savingSection === 'colors'}
            onClick={() => void saveBrandColors()}
          >
            <Save className="h-4 w-4" />
            Save brand colors
          </button>
          <button
            type="button"
            className={adminBtnSecondary}
            disabled={savingSection === 'colors'}
            onClick={() => {
              const primary =
                normalizeHex(getSettingValue(entries, BRAND_SETTING_KEYS.primary)) ?? DEFAULT_BRAND_PALETTE.primary
              applyPaletteToEntries(derivePaletteFromPrimary(primary))
            }}
          >
            <WandSparkles className="h-4 w-4" />
            Generate range from brand color
          </button>
          <button
            type="button"
            className={adminBtnSecondary}
            disabled={savingSection === 'colors'}
            onClick={() => applyPaletteToEntries(DEFAULT_BRAND_PALETTE)}
          >
            <RotateCcw className="h-4 w-4" />
            Reset to #66a441
          </button>
        </div>
      </div>

      <div className="admin-section space-y-4">
        <h2 className="font-semibold">Store currency</h2>
        <p className="text-sm text-[var(--admin-muted)]">
          Applies to product prices, cart, checkout, and order emails. Changes appear on the storefront immediately after saving.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={adminLabel}>Currency</label>
            <BrandedSelect
              value={currencySelectValue}
              disabled={savingSection === 'currency'}
              onValueChange={(value) => {
                if (value === CUSTOM_CURRENCY_VALUE) {
                  updateManagedSetting('currency_code', currencyCode.length === 3 ? currencyCode : '')
                  return
                }
                updateManagedSetting('currency_code', value)
                updateManagedSetting('currency_locale', getDefaultLocaleForCurrency(value))
              }}
              options={[
                ...SUPPORTED_CURRENCIES.map((c) => ({ value: c.code, label: c.label })),
                { value: CUSTOM_CURRENCY_VALUE, label: 'Custom ISO code…' },
              ]}
            />
          </div>
          {currencySelectValue === CUSTOM_CURRENCY_VALUE ? (
            <div>
              <label className={adminLabel}>Custom currency code</label>
              <input
                className={adminInput}
                value={currencyCode}
                maxLength={3}
                placeholder="e.g. TZS"
                disabled={savingSection === 'currency'}
                onChange={(e) => updateManagedSetting('currency_code', e.target.value.toUpperCase())}
              />
            </div>
          ) : null}
          <div className={currencySelectValue === CUSTOM_CURRENCY_VALUE ? 'sm:col-span-2' : undefined}>
            <label className={adminLabel}>Display locale</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'currency_locale', 'en-US')}
              placeholder="en-US"
              disabled={savingSection === 'currency'}
              onChange={(e) => updateManagedSetting('currency_locale', e.target.value)}
            />
            <p className="mt-1 text-xs text-[var(--admin-muted)]">
              Controls number formatting. Example: {formatCurrencyPreview({
                currency_code: getSettingValue(entries, 'currency_code', 'USD'),
                currency_locale: getSettingValue(entries, 'currency_locale', 'en-US'),
              })}
            </p>
          </div>
        </div>
        <button
          type="button"
          className={adminBtnPrimary}
          disabled={savingSection === 'currency'}
          onClick={() => void saveCurrency()}
        >
          <Save className="h-4 w-4" />
          Save currency
        </button>
      </div>

      <div className="admin-section space-y-4">
        <h2 className="font-semibold">Default delivery information</h2>
        <p className="text-sm text-[var(--admin-muted)]">
          Shown on product pages when a product uses the site default delivery setting. Products can override this with their own delivery copy.
        </p>
        <RichTextEditor
          label="Delivery copy"
          value={getSettingValue(entries, 'default_delivery_info')}
          onChange={(value) => updateManagedSetting('default_delivery_info', value)}
          placeholder="Standard delivery times, regions, and handling…"
          minHeight={140}
        />
        <button
          type="button"
          className={adminBtnPrimary}
          disabled={savingSection === 'delivery'}
          onClick={() => void saveDefaultDelivery()}
        >
          <Save className="h-4 w-4" />
          Save delivery information
        </button>
      </div>

      <div className="admin-section space-y-4">
        <h2 className="font-semibold">Storefront wholesale copy</h2>
        <p className="text-sm text-[var(--admin-muted)]">
          Homepage supporting copy and published company details. Do not invent dispatch guarantees or awards here.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={adminLabel}>Hero supporting copy</label>
            <textarea
              className={adminInput}
              rows={3}
              value={getSettingValue(entries, 'hero_supporting_copy')}
              onChange={(e) => updateManagedSetting('hero_supporting_copy', e.target.value)}
            />
          </div>
          <div>
            <label className={adminLabel}>Hero secondary CTA label</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'hero_secondary_cta_label')}
              onChange={(e) => updateManagedSetting('hero_secondary_cta_label', e.target.value)}
            />
          </div>
          <div>
            <label className={adminLabel}>Hero secondary CTA URL</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'hero_secondary_cta_url')}
              onChange={(e) => updateManagedSetting('hero_secondary_cta_url', e.target.value)}
            />
          </div>
          <div>
            <label className={adminLabel}>Legal company name</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'contact_company_legal_name')}
              onChange={(e) => updateManagedSetting('contact_company_legal_name', e.target.value)}
            />
          </div>
          <div>
            <label className={adminLabel}>Company number</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'contact_company_number')}
              onChange={(e) => updateManagedSetting('contact_company_number', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={adminLabel}>Registered address</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'contact_address')}
              onChange={(e) => updateManagedSetting('contact_address', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={adminLabel}>Contact hours</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'contact_hours')}
              onChange={(e) => updateManagedSetting('contact_hours', e.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          className={adminBtnPrimary}
          disabled={savingSection === 'storefront-copy'}
          onClick={async () => {
            setSavingSection('storefront-copy')
            try {
              await upsertSiteSettings(
                [
                  'hero_supporting_copy',
                  'hero_secondary_cta_label',
                  'hero_secondary_cta_url',
                  'contact_company_legal_name',
                  'contact_company_number',
                  'contact_address',
                  'contact_hours',
                ],
                entries,
              )
              toast.success('Storefront copy saved')
              await refresh()
              await refetchCms()
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to save storefront copy')
            } finally {
              setSavingSection(null)
            }
          }}
        >
          <Save className="h-4 w-4" />
          Save storefront copy
        </button>
      </div>

      <div className="admin-section space-y-4">
        <h2 className="font-semibold">Floating contact buttons</h2>
        <p className="text-sm text-[var(--admin-muted)]">
          Call and WhatsApp appear stacked bottom-right on the storefront. Use international format, e.g. +254 712 345 678.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={adminLabel}>Phone (call button)</label>
            <input
              className={adminInput}
              value={entries.find((e) => e.key === 'contact_phone')?.value ?? ''}
              onChange={(e) => {
                const val = e.target.value
                setEntries((prev) => {
                  const idx = prev.findIndex((x) => x.key === 'contact_phone')
                  if (idx >= 0) return prev.map((x, i) => (i === idx ? { ...x, value: val } : x))
                  return [...prev, { key: 'contact_phone', value: val, isNew: true }]
                })
              }}
              placeholder="+254 712 345 678"
            />
          </div>
          <div>
            <label className={adminLabel}>WhatsApp number</label>
            <input
              className={adminInput}
              value={entries.find((e) => e.key === 'contact_whatsapp')?.value ?? ''}
              onChange={(e) => {
                const val = e.target.value
                setEntries((prev) => {
                  const idx = prev.findIndex((x) => x.key === 'contact_whatsapp')
                  if (idx >= 0) return prev.map((x, i) => (i === idx ? { ...x, value: val } : x))
                  return [...prev, { key: 'contact_whatsapp', value: val, isNew: true }]
                })
              }}
              placeholder="+254 712 345 678"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={adminLabel}>WhatsApp pre-filled message (optional)</label>
            <input
              className={adminInput}
              value={entries.find((e) => e.key === 'contact_whatsapp_message')?.value ?? ''}
              onChange={(e) => {
                const val = e.target.value
                setEntries((prev) => {
                  const idx = prev.findIndex((x) => x.key === 'contact_whatsapp_message')
                  if (idx >= 0) return prev.map((x, i) => (i === idx ? { ...x, value: val } : x))
                  return [...prev, { key: 'contact_whatsapp_message', value: val, isNew: true }]
                })
              }}
              placeholder="Hello! I have a question about…"
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={getSettingValue(entries, 'floating_whatsapp_enabled', 'true') !== 'false'}
              onChange={(e) => updateManagedSetting('floating_whatsapp_enabled', e.target.checked ? 'true' : 'false')}
            />
            Show floating WhatsApp button
          </label>
        </div>
        <button
          type="button"
          className={adminBtnPrimary}
          onClick={async () => {
            const sb = tryGetSupabase()
            if (!sb) return
            const keys = ['contact_phone', 'contact_whatsapp', 'contact_whatsapp_message', 'floating_whatsapp_enabled'] as const
            const rows = keys.map((key) => ({
              key,
              value: entries.find((e) => e.key === key)?.value ?? (key === 'floating_whatsapp_enabled' ? 'true' : ''),
            }))
            await sb.from('site_settings').upsert(rows)
            toast.success('Contact buttons updated')
            await refresh()
            await refetchCms()
          }}
        >
          <Save className="h-4 w-4" />
          Save contact buttons
        </button>
      </div>

      <div className="admin-section space-y-4">
        <h2 className="font-semibold">Brand assets</h2>
        <p className="text-sm text-[var(--admin-muted)]">
          Favicon and logos used across the storefront. Use the dark-background logo on the hero header and footer; use the light-background logo on cream or white surfaces.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          <ImageUploadField
            label="Favicon"
            value={getSettingValue(entries, 'favicon_url')}
            onChange={(url) => updateManagedSetting('favicon_url', url)}
            folder="brand"
          />
          <ImageUploadField
            label="Logo (dark backgrounds)"
            value={getSettingValue(entries, 'logo_dark_url')}
            onChange={(url) => updateManagedSetting('logo_dark_url', url)}
            folder="brand"
          />
          <ImageUploadField
            label="Logo (light backgrounds)"
            value={getSettingValue(entries, 'logo_light_url')}
            onChange={(url) => updateManagedSetting('logo_light_url', url)}
            folder="brand"
          />
        </div>
        <button
          type="button"
          className={adminBtnPrimary}
          disabled={savingSection === 'brand'}
          onClick={() => void saveBrandAssets()}
        >
          <Save className="h-4 w-4" />
          Save brand assets
        </button>
      </div>

      <div className="admin-section space-y-4">
        <h2 className="font-semibold">Homepage hero backgrounds (defaults)</h2>
        <p className="text-sm text-[var(--admin-muted)]">
          Fallback images when a hero slide does not have its own desktop, tablet, or mobile background. Per-slide overrides are managed under Hero Slides.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          <ImageUploadField
            label="Desktop (1024px+)"
            value={getSettingValue(entries, 'hero_bg_desktop')}
            onChange={(url) => updateManagedSetting('hero_bg_desktop', url)}
            folder="hero"
          />
          <ImageUploadField
            label="Tablet (640px – 1023px)"
            value={getSettingValue(entries, 'hero_bg_tablet')}
            onChange={(url) => updateManagedSetting('hero_bg_tablet', url)}
            folder="hero"
          />
          <ImageUploadField
            label="Mobile (below 640px)"
            value={getSettingValue(entries, 'hero_bg_mobile')}
            onChange={(url) => updateManagedSetting('hero_bg_mobile', url)}
            folder="hero"
          />
        </div>
        <button
          type="button"
          className={adminBtnPrimary}
          disabled={savingSection === 'hero'}
          onClick={() => void saveHeroDefaults()}
        >
          <Save className="h-4 w-4" />
          Save hero defaults
        </button>
      </div>

      <div className="admin-table-frame divide-y divide-[var(--admin-border)]">
        {entries.filter((e) => !isManagedSettingKey(e.key)).length === 0 ? (
          <p className="p-6 text-sm text-[var(--admin-muted)]">No custom settings yet. Add your first key-value pair.</p>
        ) : (
          entries
            .map((entry, index) => ({ entry, index }))
            .filter(({ entry }) => !isManagedSettingKey(entry.key))
            .map(({ entry, index }) => (
            <div key={`${entry.key}-${index}`} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
              <div className="grid flex-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className={adminLabel}>Key</label>
                  <input
                    className={adminInput}
                    value={entry.key}
                    disabled={!entry.isNew}
                    onChange={(e) => updateEntry(index, { key: e.target.value })}
                  />
                </div>
                <div className="space-y-2 sm:col-span-1">
                  <label className={adminLabel}>Value</label>
                  <input
                    className={adminInput}
                    value={entry.value}
                    onChange={(e) => updateEntry(index, { value: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={adminBtnPrimary}
                  disabled={savingKey === entry.key}
                  onClick={() => void saveEntry(index)}
                >
                  <Save className="h-4 w-4" />
                  Save
                </button>
                <button type="button" className={adminBtnDanger} onClick={() => void removeEntry(index)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            ))
        )}
      </div>
    </div>
  )
}
