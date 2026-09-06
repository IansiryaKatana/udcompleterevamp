export default defineEventHandler(async (event) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }

  let products: Array<{
    id: string
    name: string
    description: string | null
    slug: string
    image_url: string | null
    price: number
    inventory_count: number
    published: boolean
  }> = []

  if (supabaseUrl && anonKey) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/products?select=id,name,description,slug,image_url,price,inventory_count,published&published=eq.true`,
      { headers },
    )
    if (res.ok) products = await res.json()
  }

  const origin = getRequestURL(event).origin
  const lines = [
    'id,title,description,link,image_link,availability,price,brand',
    ...products.map((p) => {
      const desc = (p.description ?? p.name).replace(/"/g, '""').slice(0, 5000)
      const image = p.image_url ?? ''
      const availability = p.inventory_count > 0 ? 'in_stock' : 'out_of_stock'
      return [
        p.id,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${desc}"`,
        `${origin}/product/${p.slug}`,
        image,
        availability,
        `${Number(p.price).toFixed(2)} USD`,
        'Unique Distribution',
      ].join(',')
    }),
  ]

  setResponseHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=3600')
  return lines.join('\n')
})
