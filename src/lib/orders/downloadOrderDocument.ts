import type { CustomerOrderDetail } from '@/lib/storefront/storefrontRpc'
import { DEFAULT_BRAND_PALETTE } from '@/lib/brandPalette'
import { formatShippingAddress } from '@/lib/formatShippingAddress'

export type OrderDocumentType = 'invoice' | 'receipt'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildOrderDocumentHtml(
  order: CustomerOrderDetail,
  siteName: string,
  type: OrderDocumentType,
  formatPrice: (amount: number) => string,
) {
  const title = type === 'invoice' ? 'Invoice' : 'Receipt'
  const shipping = formatShippingAddress(order.shipping_address)
  const rows = order.order_items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.product_name)}${item.variant_name ? ` — ${escapeHtml(item.variant_name)}` : ''}</td>
          <td style="text-align:right">${item.quantity}</td>
          <td style="text-align:right">${escapeHtml(formatPrice(Number(item.unit_price)))}</td>
          <td style="text-align:right">${escapeHtml(formatPrice(Number(item.line_total)))}</td>
        </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} ${escapeHtml(order.order_number)}</title>
  <style>
    body { font-family: system-ui, sans-serif; color: ${DEFAULT_BRAND_PALETTE.text}; margin: 40px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .meta { color: ${DEFAULT_BRAND_PALETTE.muted}; font-size: 14px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border-bottom: 1px solid ${DEFAULT_BRAND_PALETTE.border}; padding: 10px 8px; font-size: 14px; }
    th { text-align: left; font-size: 12px; text-transform: uppercase; color: ${DEFAULT_BRAND_PALETTE.muted}; }
    .totals { margin-top: 24px; max-width: 280px; margin-left: auto; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 0; }
    .totals .grand { font-weight: 800; font-size: 18px; border-top: 2px solid ${DEFAULT_BRAND_PALETTE.text}; margin-top: 8px; padding-top: 12px; }
    address { white-space: pre-line; font-style: normal; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">${escapeHtml(siteName)} · Order ${escapeHtml(order.order_number)} · ${new Date(order.created_at).toLocaleString()}</p>
  <p><strong>Status:</strong> ${escapeHtml(order.status.replace(/_/g, ' '))}</p>
  <p><strong>Email:</strong> ${escapeHtml(order.email)}</p>
  ${shipping ? `<p><strong>Ship to:</strong><br /><address>${escapeHtml(shipping)}</address></p>` : ''}
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:right">Qty</th>
        <th style="text-align:right">Price</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${escapeHtml(formatPrice(Number(order.subtotal)))}</span></div>
    <div class="grand"><span>Total</span><span>${escapeHtml(formatPrice(Number(order.total)))}</span></div>
  </div>
</body>
</html>`
}

export function downloadOrderDocument(
  order: CustomerOrderDetail,
  siteName: string,
  type: OrderDocumentType,
  formatPrice: (amount: number) => string,
) {
  const html = buildOrderDocumentHtml(order, siteName, type, formatPrice)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${type}-${order.order_number}.html`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function printOrderDocument(
  order: CustomerOrderDetail,
  siteName: string,
  type: OrderDocumentType,
  formatPrice: (amount: number) => string,
) {
  const html = buildOrderDocumentHtml(order, siteName, type, formatPrice)
  const printWindow = window.open('', '_blank', 'noopener,noreferrer')
  if (!printWindow) return
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}
