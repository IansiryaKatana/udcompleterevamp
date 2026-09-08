import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, Loader2, Mail, RefreshCw, Save, Send } from 'lucide-react'
import { toast } from 'sonner'
import { tryGetSupabase } from '@/integrations/supabase/client'
import type { Database } from '@/integrations/supabase/database.types'
import { useCms } from '@/contexts/CmsContext'
import { AdminErrorBanner, AdminLoadingState } from '@/admin/components/AdminPageHeading'
import {
  getSettingValue,
  patchSetting,
  upsertSiteSettings,
  type SettingEntry,
} from '@/admin/lib/siteSettingsAdmin'
import {
  EMAIL_TEMPLATE_VARIABLES,
  getSampleTemplateVars,
  renderBrandedEmail,
  type EmailBrandContext,
} from '@/lib/email/templateEngine'
import { DEFAULT_BRAND_PALETTE } from '@/lib/brandPalette'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { RichTextEditor } from '@/admin/components/RichTextEditor'

type TemplateRow = Database['public']['Tables']['email_templates']['Row']

const BRAND_KEYS = ['email_brand_color', 'email_footer_text', 'email_from_name', 'store_url'] as const

export function AdminEmailTemplates() {
  const { snapshot, refetchCms } = useCms()
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [entries, setEntries] = useState<SettingEntry[]>([])
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingBrand, setSavingBrand] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(true)

  const selected = templates.find((t) => t.template_key === selectedKey) ?? templates[0]

  const brand: EmailBrandContext = useMemo(() => {
    const storeUrl =
      getSettingValue(entries, 'store_url') ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://uniquedistribution.com')

    return {
      siteName: snapshot.siteName || getSettingValue(entries, 'email_from_name', 'Unique Distribution'),
      logoUrl: snapshot.siteSettings.logo_light_url?.trim() ?? '',
      brandColor:
        getSettingValue(entries, 'email_brand_color') ||
        snapshot.siteSettings.brand_primary ||
        DEFAULT_BRAND_PALETTE.primary,
      footerText: getSettingValue(entries, 'email_footer_text', 'Thank you for shopping with us.'),
      storeUrl: storeUrl.replace(/\/$/, ''),
    }
  }, [entries, snapshot.siteName, snapshot.siteSettings])

  const previewHtml = useMemo(() => {
    if (!subject && !bodyHtml) return ''
    const sampleVars = getSampleTemplateVars(brand.storeUrl)
    return renderBrandedEmail(brand, { subject, bodyHtml }, sampleVars).html
  }, [brand, subject, bodyHtml])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    const sb = tryGetSupabase()
    const [templatesRes, settingsRes] = await Promise.all([
      sb.from('email_templates').select('*').order('name'),
      sb.from('site_settings').select('key, value').in('key', [...BRAND_KEYS, 'site_name', 'logo_light_url', 'brand_primary']),
    ])

    if (templatesRes.error) setError(templatesRes.error.message)
    else {
      const rows = templatesRes.data ?? []
      setTemplates(rows)
      if (!selectedKey && rows[0]) setSelectedKey(rows[0].template_key)
    }

    if (!settingsRes.error) {
      setEntries((settingsRes.data ?? []).map((row) => ({ key: row.key, value: row.value })))
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selected) return
    setSelectedKey(selected.template_key)
    setSubject(selected.subject)
    setBodyHtml(selected.body_html)
    setEnabled(selected.enabled)
  }, [selected?.id])

  function updateBrandSetting(key: string, value: string) {
    setEntries((prev) => patchSetting(prev, key, value))
  }

  async function saveTemplate() {
    if (!selectedKey) return
    setSaving(true)
    setError(null)
    const sb = tryGetSupabase()
    const { error: updateError } = await sb
      .from('email_templates')
      .update({
        subject: subject.trim(),
        body_html: bodyHtml,
        enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('template_key', selectedKey)

    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    toast.success('Email template saved')
    await refresh()
  }

  async function saveBranding() {
    setSavingBrand(true)
    setError(null)
    try {
      await upsertSiteSettings([...BRAND_KEYS], entries)
      toast.success('Email branding saved')
      await refetchCms()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save branding')
    } finally {
      setSavingBrand(false)
    }
  }

  async function sendTest() {
    if (!selectedKey) return
    if (!testEmail.trim()) {
      toast.error('Enter a test recipient email')
      return
    }
    setSendingTest(true)
    const sb = tryGetSupabase()
    const { data: session } = await sb.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-test-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ template_key: selectedKey, to: testEmail.trim() }),
    })
    setSendingTest(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error((err as { error?: string }).error ?? 'Failed to send test email')
      return
    }
    toast.success(`Test email sent to ${testEmail.trim()}`)
  }

  if (loading) return <AdminLoadingState />

  return (
    <div className="space-y-6">
      {error ? <AdminErrorBanner message={error} /> : null}

      <section className="admin-section space-y-4">
        <h2 className="mb-1 text-lg font-semibold">Company branding</h2>
        <p className="mb-4 text-sm text-[var(--admin-text-muted)]">
          Logo uses your light-background logo from Site Settings. Header color and footer apply to all emails.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={adminLabel}>Header / accent color</label>
            <div className="flex gap-2">
              <input
                type="color"
                className="h-10 w-14 cursor-pointer rounded border border-[var(--admin-border)]"
                value={getSettingValue(entries, 'email_brand_color', DEFAULT_BRAND_PALETTE.primary)}
                onChange={(e) => updateBrandSetting('email_brand_color', e.target.value)}
              />
              <input
                className={adminInput}
                value={getSettingValue(entries, 'email_brand_color', DEFAULT_BRAND_PALETTE.primary)}
                onChange={(e) => updateBrandSetting('email_brand_color', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className={adminLabel}>From name</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'email_from_name', snapshot.siteName)}
              onChange={(e) => updateBrandSetting('email_from_name', e.target.value)}
              placeholder="Unique Distribution"
            />
          </div>
          <div>
            <label className={adminLabel}>Store URL</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'store_url', typeof window !== 'undefined' ? window.location.origin : '')}
              onChange={(e) => updateBrandSetting('store_url', e.target.value)}
              placeholder="https://yourstore.com"
            />
          </div>
          <div>
            <label className={adminLabel}>Footer message</label>
            <input
              className={adminInput}
              value={getSettingValue(entries, 'email_footer_text', '')}
              onChange={(e) => updateBrandSetting('email_footer_text', e.target.value)}
              placeholder="Thank you for shopping with us."
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={adminBtnPrimary} disabled={savingBrand} onClick={() => void saveBranding()}>
            {savingBrand ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save branding
          </button>
          {brand.logoUrl ? (
            <p className="flex items-center text-xs text-[var(--admin-text-muted)]">
              Logo: <img src={brand.logoUrl} alt="" className="ml-2 h-8 max-w-[120px] object-contain" />
            </p>
          ) : (
            <p className="text-xs text-[var(--admin-text-muted)]">Upload a light logo in Site Settings for email headers.</p>
          )}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <aside className="admin-panel p-3">
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">Templates</p>
          <ul className="space-y-1">
            {templates.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    row.template_key === selectedKey
                      ? 'bg-[var(--admin-primary-muted)] font-semibold text-[var(--admin-primary)]'
                      : 'hover:bg-[var(--admin-surface-muted)]'
                  }`}
                  onClick={() => setSelectedKey(row.template_key)}
                >
                  <span className="flex items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0" />
                    {row.name}
                  </span>
                  {!row.enabled ? <span className="ml-6 text-xs text-amber-600">Disabled</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="space-y-4">
          {selected ? (
            <>
              <section className="admin-section space-y-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selected.name}</h2>
                    <p className="text-sm text-[var(--admin-text-muted)]">{selected.description}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                    Enabled
                  </label>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className={adminLabel}>Subject line</label>
                    <input className={adminInput} value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </div>
                  <RichTextEditor
                    label="Email body"
                    value={bodyHtml}
                    onChange={setBodyHtml}
                    placeholder="Write your email content…"
                    minHeight={260}
                    snippets={EMAIL_TEMPLATE_VARIABLES.map((v) => ({
                      label: v.key.replace(/\{\{|\}\}/g, ''),
                      value: v.key,
                    }))}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className={adminBtnPrimary} disabled={saving} onClick={() => void saveTemplate()}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save template
                  </button>
                  <button type="button" className={adminBtnSecondary} onClick={() => setShowPreview((v) => !v)}>
                    <Eye className="h-4 w-4" />
                    {showPreview ? 'Hide preview' : 'Show preview'}
                  </button>
                  <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
                    <RefreshCw className="h-4 w-4" />
                    Reset
                  </button>
                </div>
              </section>

              <section className="admin-section space-y-4">
                <h3 className="mb-2 text-sm font-semibold">Available variables</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {EMAIL_TEMPLATE_VARIABLES.map((v) => (
                    <li key={v.key} className="rounded-lg border border-[var(--admin-border)] px-3 py-2 text-xs">
                      <code className="font-semibold text-[var(--admin-primary)]">{v.key}</code>
                      <p className="mt-0.5 text-[var(--admin-text-muted)]">{v.desc}</p>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="admin-section space-y-4">
                <h3 className="mb-2 text-sm font-semibold">Send test email</h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="email"
                    className={adminInput}
                    placeholder="you@company.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                  />
                  <button type="button" className={adminBtnSecondary} disabled={sendingTest} onClick={() => void sendTest()}>
                    {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send test
                  </button>
                </div>
              </section>

              {showPreview ? (
                <div className="admin-table-frame p-0">
                  <div className="border-b border-[var(--admin-border)] px-4 py-2 text-sm font-semibold">
                    Live preview (sample data)
                  </div>
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    className="h-[520px] w-full border-0 bg-[#f4f0ea]"
                    sandbox=""
                  />
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-[var(--admin-text-muted)]">No templates found. Run migration 013_email_templates.sql.</p>
          )}
        </div>
      </div>
    </div>
  )
}
