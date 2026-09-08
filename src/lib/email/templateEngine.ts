import { DEFAULT_BRAND_PALETTE } from '@/lib/brandPalette'

/** Placeholder tokens available in email templates. */
export const EMAIL_TEMPLATE_VARIABLES = [
  { key: '{{site_name}}', desc: 'Store name from site settings' },
  { key: '{{logo_url}}', desc: 'Logo URL (dark background version)' },
  { key: '{{brand_color}}', desc: 'Email header accent color' },
  { key: '{{order_number}}', desc: 'Order or quote reference number' },
  { key: '{{customer_name}}', desc: 'Customer display name' },
  { key: '{{customer_email}}', desc: 'Customer email address' },
  { key: '{{order_total}}', desc: 'Formatted order total with currency' },
  { key: '{{order_subtotal}}', desc: 'Formatted subtotal with currency' },
  { key: '{{order_date}}', desc: 'Order date (localized)' },
  { key: '{{order_items_html}}', desc: 'HTML table of line items (auto-generated)' },
  { key: '{{notes_block}}', desc: 'Customer notes block (quote admin only)' },
  { key: '{{message_html}}', desc: 'Contact message body (HTML, auto-generated)' },
  { key: '{{account_url}}', desc: 'Link to customer account page' },
  { key: '{{store_url}}', desc: 'Storefront homepage URL' },
  { key: '{{footer_text}}', desc: 'Email footer message' },
] as const

export type EmailBrandContext = {
  siteName: string
  logoUrl: string
  brandColor: string
  footerText: string
  storeUrl: string
}

export type EmailTemplateContent = {
  subject: string
  bodyHtml: string
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function replacePlaceholders(template: string, vars: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value)
  }
  return out
}

export function wrapBrandedEmailLayout(brand: EmailBrandContext, bodyHtml: string): string {
  const logoBlock = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.siteName)}" height="44" style="display:block;max-height:44px;width:auto;" />`
    : `<span style="font-size:22px;font-weight:800;letter-spacing:0.08em;color:#ffffff;">${escapeHtml(brand.siteName)}</span>`
  const pageBg = DEFAULT_BRAND_PALETTE.pageBg
  const footerBg = DEFAULT_BRAND_PALETTE.contentBg
  const footerBorder = DEFAULT_BRAND_PALETTE.border
  const footerMuted = DEFAULT_BRAND_PALETTE.muted
  const brandColor = escapeHtml(brand.brandColor)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(brand.siteName)}</title>
</head>
<body style="margin:0;padding:0;background-color:${pageBg};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${pageBg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(20,34,11,0.08);">
          <tr>
            <td style="background-color:${brandColor};padding:28px 32px;text-align:center;">
              ${logoBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;background-color:${footerBg};border-top:1px solid ${footerBorder};text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${footerMuted};">${escapeHtml(brand.footerText)}</p>
              <p style="margin:0;font-size:12px;color:${footerMuted};">
                <a href="${escapeHtml(brand.storeUrl)}" style="color:${brandColor};text-decoration:none;font-weight:600;">${escapeHtml(brand.siteName)}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function renderBrandedEmail(
  brand: EmailBrandContext,
  template: EmailTemplateContent,
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
  const html = wrapBrandedEmailLayout(brand, innerBody)

  return { subject, html }
}

export type OrderLineItem = {
  name: string
  quantity: number
  unit_price: number
  line_total: number
  image_url?: string | null
}

export function buildOrderItemsHtml(items: OrderLineItem[], currency: string): string {
  if (items.length === 0) {
    return `<p style="margin:0;font-size:14px;color:${DEFAULT_BRAND_PALETTE.muted};">No items</p>`
  }

  const rows = items
    .map((item) => {
      const img = item.image_url
        ? `<img src="${escapeHtml(item.image_url)}" alt="" width="48" height="48" style="border-radius:8px;object-fit:cover;display:block;" />`
        : ''
      return `<tr>
        <td style="padding:12px 8px;border-bottom:1px solid ${DEFAULT_BRAND_PALETTE.border};vertical-align:middle;width:56px;">${img}</td>
        <td style="padding:12px 8px;border-bottom:1px solid ${DEFAULT_BRAND_PALETTE.border};vertical-align:middle;font-size:14px;color:${DEFAULT_BRAND_PALETTE.text};">${escapeHtml(item.name)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid ${DEFAULT_BRAND_PALETTE.border};vertical-align:middle;text-align:center;font-size:14px;color:${DEFAULT_BRAND_PALETTE.muted};">×${item.quantity}</td>
        <td style="padding:12px 8px;border-bottom:1px solid ${DEFAULT_BRAND_PALETTE.border};vertical-align:middle;text-align:right;font-size:14px;font-weight:600;color:${DEFAULT_BRAND_PALETTE.text};">${formatMoney(item.line_total, currency)}</td>
      </tr>`
    })
    .join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <thead>
      <tr>
        <th colspan="2" style="padding:8px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${DEFAULT_BRAND_PALETTE.muted};border-bottom:2px solid ${DEFAULT_BRAND_PALETTE.border};">Item</th>
        <th style="padding:8px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${DEFAULT_BRAND_PALETTE.muted};border-bottom:2px solid ${DEFAULT_BRAND_PALETTE.border};">Qty</th>
        <th style="padding:8px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:${DEFAULT_BRAND_PALETTE.muted};border-bottom:2px solid ${DEFAULT_BRAND_PALETTE.border};">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
}

export function buildNotesBlock(notes: string): string {
  const trimmed = notes.trim()
  if (!trimmed) return ''
  return `<p style="margin:0 0 8px;font-size:14px;color:${DEFAULT_BRAND_PALETTE.muted};"><strong>Notes:</strong> ${escapeHtml(trimmed)}</p>`
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function getSampleTemplateVars(storeUrl: string): Record<string, string> {
  const items = buildOrderItemsHtml(
    [
      { name: 'Corsair RM850x PSU', quantity: 1, unit_price: 129.99, line_total: 129.99, image_url: null },
      { name: 'AMD Ryzen 7 7800X3D', quantity: 1, unit_price: 449.99, line_total: 449.99, image_url: null },
    ],
    'USD',
  )

  return {
    order_number: 'AST-20250622-001',
    customer_name: 'Alex Customer',
    customer_email: 'alex@example.com',
    order_total: formatMoney(579.98, 'USD'),
    order_subtotal: formatMoney(579.98, 'USD'),
    order_date: new Date().toLocaleDateString('en-US', { dateStyle: 'long' }),
    order_items_html: items,
    notes_block: buildNotesBlock('Please confirm availability for bulk pricing.'),
    message_html: `<p style="margin:0;font-size:14px;line-height:1.6;color:${DEFAULT_BRAND_PALETTE.text};">Sample contact message from the storefront form.</p>`,
    account_url: `${storeUrl}/account`,
    store_url: storeUrl,
  }
}
