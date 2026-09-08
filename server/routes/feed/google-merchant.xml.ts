/**
 * Google Merchant feed — server-side only via service-role RPC.
 * Prices included only while commercial_access_mode=catalogue_open
 * and merchant_feed_price_mode allows it. Never uses anon PostgREST price select.
 */
export default defineEventHandler(async (event) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  type FeedItem = {
    id: string
    name: string
    description: string | null
    slug: string
    image_url: string | null
    price: number | null
    inventory_count: number
    published: boolean
    price_included?: boolean
  }

  let products: FeedItem[] = []
  let priceIncluded = false
  let disabled = false

  if (supabaseUrl && serviceKey) {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/rpc_merchant_feed_products`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    if (res.ok) {
      const payload = (await res.json()) as {
        ok?: boolean
        items?: FeedItem[]
        price_included?: boolean
        disabled?: boolean
      }
      products = payload.items ?? []
      priceIncluded = Boolean(payload.price_included)
      disabled = Boolean(payload.disabled)
    }
  }

  const origin = getRequestURL(event).origin

  if (disabled) {
    setResponseHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setResponseHeader(event, 'cache-control', 'public, max-age=300')
    return 'id,title,description,link,image_link,availability,price,brand\n'
  }

  const lines = [
    'id,title,description,link,image_link,availability,price,brand',
    ...products.map((p) => {
      const desc = (p.description ?? p.name).replace(/"/g, '""').slice(0, 5000)
      const image = p.image_url ?? ''
      const availability = p.inventory_count > 0 ? 'in_stock' : 'out_of_stock'
      const priceCell =
        priceIncluded && p.price != null ? `${Number(p.price).toFixed(2)} USD` : ''
      return [
        p.id,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${desc}"`,
        `${origin}/product/${p.slug}`,
        image,
        availability,
        priceCell,
        'Unique Distribution',
      ].join(',')
    }),
  ]

  setResponseHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return lines.join('\n')
})
