import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type EmailBrandContext = {
  siteName: string
  logoUrl: string
  brandColor: string
  footerText: string
  storeUrl: string
  fromName: string
}

export type EmailTemplateRow = {
  template_key: string
  subject: string
  body_html: string
  enabled: boolean
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function replacePlaceholders(template: string, vars: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

function wrapBrandedEmailLayout(brand: EmailBrandContext, bodyHtml: string): string {
  const logoBlock = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.siteName)}" height="44" style="display:block;max-height:44px;width:auto;" />`
    : `<span style="font-size:22px;font-weight:800;letter-spacing:0.08em;color:#ffffff;">${escapeHtml(brand.siteName)}</span>`

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background-color:#f3f5f2;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f5f2;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(20,34,11,0.08);">
        <tr><td style="background-color:${escapeHtml(brand.brandColor)};padding:28px 32px;text-align:center;">${logoBlock}</td></tr>
        <tr><td style="padding:32px;">${bodyHtml}</td></tr>
        <tr><td style="padding:24px 32px;background-color:#fafbf9;border-top:1px solid #d4decf;text-align:center;">
          <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b7665;">${escapeHtml(brand.footerText)}</p>
          <p style="margin:0;font-size:12px;color:#6b7665;"><a href="${escapeHtml(brand.storeUrl)}" style="color:${escapeHtml(brand.brandColor)};text-decoration:none;font-weight:600;">${escapeHtml(brand.siteName)}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export function renderBrandedEmail(
  brand: EmailBrandContext,
  template: { subject: string; bodyHtml: string },
  vars: Record<string, string>,
): { subject: string; html: string } {
  const mergedVars: Record<string, string> = {
    site_name: escapeHtml(brand.siteName),
    logo_url: escapeHtml(brand.logoUrl),
    brand_color: escapeHtml(brand.brandColor),
    footer_text: escapeHtml(brand.footerText),
    store_url: escapeHtml(brand.storeUrl),
    ...Object.fromEntries(
      Object.entries(vars).map(([k, v]) => [k, k.endsWith('_html') || k === 'notes_block' ? v : escapeHtml(v)]),
    ),
  }

  const subject = replacePlaceholders(template.subject, mergedVars)
  const innerBody = replacePlaceholders(template.bodyHtml, mergedVars)
  return { subject, html: wrapBrandedEmailLayout(brand, innerBody) }
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export type OrderLineItem = {
  name: string
  quantity: number
  unit_price: number
  line_total: number
  image_url?: string | null
}

export function buildOrderItemsHtml(items: OrderLineItem[], currency: string): string {
  if (items.length === 0) return '<p style="margin:0;font-size:14px;color:#6b5d4d;">No items</p>'

  const rows = items
    .map((item) => {
      const img = item.image_url
        ? `<img src="${escapeHtml(item.image_url)}" alt="" width="48" height="48" style="border-radius:8px;object-fit:cover;display:block;" />`
        : ''
      return `<tr>
        <td style="padding:12px 8px;border-bottom:1px solid #e8e0d4;vertical-align:middle;width:56px;">${img}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #e8e0d4;vertical-align:middle;font-size:14px;color:#3d3428;">${escapeHtml(item.name)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #e8e0d4;vertical-align:middle;text-align:center;font-size:14px;color:#6b5d4d;">×${item.quantity}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #e8e0d4;vertical-align:middle;text-align:right;font-size:14px;font-weight:600;color:#3d3428;">${formatMoney(Number(item.line_total), currency)}</td>
      </tr>`
    })
    .join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <thead><tr>
      <th colspan="2" style="padding:8px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#9a8b78;border-bottom:2px solid #e8e0d4;">Item</th>
      <th style="padding:8px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#9a8b78;border-bottom:2px solid #e8e0d4;">Qty</th>
      <th style="padding:8px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#9a8b78;border-bottom:2px solid #e8e0d4;">Total</th>
    </tr></thead><tbody>${rows}</tbody></table>`
}

export function buildNotesBlock(notes: string): string {
  const trimmed = notes.trim()
  if (!trimmed) return ''
  return `<p style="margin:0 0 8px;font-size:14px;color:#6b5d4d;"><strong>Notes:</strong> ${escapeHtml(trimmed)}</p>`
}

async function loadSettingsMap(supabase: SupabaseClient, keys: string[]): Promise<Record<string, string>> {
  const { data } = await supabase.from('site_settings').select('key, value').in('key', keys)
  const map: Record<string, string> = {}
  for (const row of data ?? []) map[row.key] = row.value ?? ''
  return map
}

export async function loadEmailBrand(supabase: SupabaseClient): Promise<EmailBrandContext> {
  const settings = await loadSettingsMap(supabase, [
    'site_name',
    'logo_light_url',
    'email_brand_color',
    'email_footer_text',
    'email_from_name',
    'store_url',
    'brand_primary',
  ])

  const siteName = settings.site_name?.trim() || settings.email_from_name?.trim() || 'Unique Distribution'
  const storeUrl =
    settings.store_url?.trim() ||
    Deno.env.get('STORE_URL')?.trim() ||
    Deno.env.get('SITE_URL')?.trim() ||
    'https://uniquedistribution.com'

  return {
    siteName,
    logoUrl: settings.logo_light_url?.trim() || '',
    brandColor: settings.email_brand_color?.trim() || settings.brand_primary?.trim() || '#66a441',
    footerText: settings.email_footer_text?.trim() || `Thank you for shopping with ${siteName}.`,
    storeUrl: storeUrl.replace(/\/$/, ''),
    fromName: settings.email_from_name?.trim() || siteName,
  }
}

export async function loadEmailTemplate(
  supabase: SupabaseClient,
  templateKey: string,
): Promise<EmailTemplateRow | null> {
  const { data } = await supabase
    .from('email_templates')
    .select('template_key, subject, body_html, enabled')
    .eq('template_key', templateKey)
    .maybeSingle()

  return data ?? null
}

export async function sendBrandedEmail(opts: {
  to: string | string[]
  replyTo?: string
  brand: EmailBrandContext
  subject: string
  html: string
}): Promise<{ sent: boolean; reason?: string }> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return { sent: false, reason: 'RESEND_API_KEY not configured' }

  const fromEnv = Deno.env.get('RESEND_FROM_EMAIL')
  const from = fromEnv ?? `${opts.brand.fromName} <onboarding@resend.dev>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      reply_to: opts.replyTo,
      subject: opts.subject,
      html: opts.html,
    }),
  })

  if (!res.ok) {
    return { sent: false, reason: await res.text() }
  }
  return { sent: true }
}

export async function sendTemplateEmail(
  supabase: SupabaseClient,
  templateKey: string,
  to: string | string[],
  vars: Record<string, string>,
  opts?: { replyTo?: string },
): Promise<{ sent: boolean; reason?: string }> {
  const brand = await loadEmailBrand(supabase)
  const template = await loadEmailTemplate(supabase, templateKey)

  if (!template) return { sent: false, reason: `Template ${templateKey} not found` }
  if (!template.enabled) return { sent: false, reason: `Template ${templateKey} is disabled` }

  const rendered = renderBrandedEmail(
    brand,
    { subject: template.subject, bodyHtml: template.body_html },
    vars,
  )

  return sendBrandedEmail({
    to,
    replyTo: opts?.replyTo,
    brand,
    subject: rendered.subject,
    html: rendered.html,
  })
}
